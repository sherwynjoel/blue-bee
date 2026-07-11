'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ApiError } from '@blue-bee/api-client';
import { DEFAULT_PICKUP_SCHEDULE, orgScheduleSchema, type OrgSchedule, type ScheduleWindow } from '@blue-bee/shared';
import { Clock, Plus, X } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { Badge, Button, Card, ErrorBox, Field, Input, SkeletonText } from './ui';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** The form's editable shape — everything a text input holds is a string until it is parsed. */
interface ScheduleForm {
  windows: ScheduleWindow[];
  leadTimeHours: string;
  horizonDays: string;
  /** '' = no cap. Distinct from '0', which is invalid and must be rejected, not silently treated as "none". */
  maxPerSlot: string;
  closedDays: number[];
}

const toForm = (s: OrgSchedule): ScheduleForm => ({
  windows: s.windows.map((w) => ({ ...w })),
  leadTimeHours: String(s.leadTimeHours),
  horizonDays: String(s.horizonDays),
  maxPerSlot: s.maxPerSlot === null ? '' : String(s.maxPerSlot),
  closedDays: [...s.closedDays],
});

/**
 * Parse the form back to an `OrgSchedule` and validate it against the SAME Zod schema the API validates
 * with (`orgScheduleSchema`, exported from `@blue-bee/shared`). One schema, one set of rules — the console
 * cannot come to disagree with the endpoint about what a legal schedule is, and the server re-validates
 * regardless, so a tampered client changes nothing.
 *
 * The two things the schema cannot do for us are the empty-string translations, and both are traps:
 * `Number('')` is `0`, so a blank cap would become "zero pickups per window" and a blank notice period would
 * become "no notice required". Neither is what an empty box means. A blank cap means *no cap*; a blank
 * number field means *unanswered*, and is rejected.
 *
 * Exported for unit testing.
 */
export function parseSchedule(form: ScheduleForm): { ok: true; value: OrgSchedule } | { ok: false; error: string } {
  if (form.leadTimeHours.trim() === '') return { ok: false, error: 'Enter how much notice you need (0 for none).' };
  if (form.horizonDays.trim() === '') return { ok: false, error: 'Enter how many days ahead customers may book.' };

  const candidate = {
    windows: form.windows.map((w) => ({ label: w.label.trim(), start: w.start, end: w.end })),
    leadTimeHours: Number(form.leadTimeHours),
    horizonDays: Number(form.horizonDays),
    // A blank cap is "no cap configured" — a real, deliberate setting the availability endpoint understands.
    // It is NOT zero, which the schema rejects precisely so this can never be confused.
    maxPerSlot: form.maxPerSlot.trim() === '' ? null : Number(form.maxPerSlot),
    closedDays: [...form.closedDays].sort((a, b) => a - b),
  };
  const parsed = orgScheduleSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
    return { ok: false, error: `${where}${issue?.message ?? 'That schedule is not valid.'}` };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Scheduling (Increment 28 Part C) — the OWNER control for the org's pickup operating hours.
 *
 * This is the whole reason Part A is not a stub. `GET /v1/availability/pickup-slots` serves exactly what is
 * saved here; until something IS saved, it serves the documented default and says so (`source: 'default'`),
 * and this card says so too. Before Inc-28 the org's `settings` column had no writer anywhere in the
 * codebase — `taxRate` could only be set at bootstrap, and `minOrderCents` had a reader and no writer at all
 * — so "configurable" meant "editable with a SQL client".
 *
 * The capacity cap is deliberately optional and empty by default. Blue Bee has no measured per-slot truck
 * capacity yet; shipping a number would invent scarcity, and the customer app is built to render availability
 * honestly when there is no cap at all.
 */
export function SchedulingCard(): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const state = useAsync(() => client.adminGetSchedule(), [nonce]);

  const [form, setForm] = useState<ScheduleForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Seed the editor from the server's answer (the founder's saved hours, or the default it is standing in
  // for). Re-seeds on reload so a failed save never leaves the form drifting from the truth.
  useEffect(() => {
    if (state.data) setForm(toForm(state.data.schedule));
  }, [state.data]);

  const validation = useMemo(() => (form ? parseSchedule(form) : null), [form]);
  const invalidReason = validation && !validation.ok ? validation.error : null;

  const patch = (over: Partial<ScheduleForm>): void => {
    setSaved(false);
    setForm((f) => (f ? { ...f, ...over } : f));
  };

  const patchWindow = (i: number, over: Partial<ScheduleWindow>): void => {
    setSaved(false);
    setForm((f) => (f ? { ...f, windows: f.windows.map((w, idx) => (idx === i ? { ...w, ...over } : w)) } : f));
  };

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!validation?.ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      await client.adminUpdateSchedule(validation.value);
      setSaved(true);
      setNonce((n) => n + 1); // re-read: `source` flips to `org` and the card stops calling it a default
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save the schedule.');
    } finally {
      setSaving(false);
    }
  };

  if (state.loading) {
    return (
      <Card title="Scheduling">
        <SkeletonText lines={6} />
      </Card>
    );
  }
  if (state.error || !state.data || !form) {
    return (
      <Card title="Scheduling">
        <ErrorBox message={state.error ?? 'Could not load the pickup schedule.'} onRetry={state.reload} />
      </Card>
    );
  }

  const { timezone, source } = state.data;

  return (
    <Card
      title="Scheduling"
      subtitle={`Pickup windows customers can book, in ${timezone}.`}
      actions={
        // `Badge` renders a bare span and does not forward arbitrary props, so the test hook lives on a
        // wrapper rather than being smuggled through it.
        source === 'default' ? (
          <span data-testid="schedule-source-default">
            <Badge tone="amber">Using default hours</Badge>
          </span>
        ) : (
          <span data-testid="schedule-source-org">
            <Badge tone="green">Your hours</Badge>
          </span>
        )
      }
    >
      {source === 'default' ? (
        // Honesty firewall, on the founder's own screen: these are OUR defaults, being served to real
        // customers right now, not hours anyone at Blue Bee has confirmed.
        <p data-testid="schedule-default-note" className="mb-4 rounded-card border border-hairline bg-subtle p-3 text-footnote text-secondary">
          No pickup hours have been saved yet, so customers are being offered Blue Bee&apos;s{' '}
          <strong className="text-ink">standard windows</strong> ({DEFAULT_PICKUP_SCHEDULE.windows.map((w) => w.label).join(' · ')}), a{' '}
          {DEFAULT_PICKUP_SCHEDULE.horizonDays}-day horizon and {DEFAULT_PICKUP_SCHEDULE.leadTimeHours} hours&apos; notice. Save below to
          replace them with your real hours.
        </p>
      ) : null}

      <form onSubmit={(e) => void save(e)} className="space-y-5">
        {/* ── windows ── */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-footnote font-medium text-secondary">Pickup windows</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="schedule-add-window"
              onClick={() => patch({ windows: [...form.windows, { label: '', start: '09:00', end: '12:00' }] })}
            >
              <Plus className="h-4 w-4" /> Add window
            </Button>
          </div>

          <div className="space-y-2">
            {form.windows.map((w, i) => (
              <div key={i} className="flex items-end gap-2" data-testid={`schedule-window-${i}`}>
                <Field label="Name" className="flex-1">
                  <Input
                    value={w.label}
                    placeholder="Morning"
                    aria-label={`Window ${i + 1} name`}
                    onChange={(e) => patchWindow(i, { label: e.target.value })}
                  />
                </Field>
                <Field label="From">
                  <Input type="time" value={w.start} aria-label={`Window ${i + 1} start`} onChange={(e) => patchWindow(i, { start: e.target.value })} />
                </Field>
                <Field label="To">
                  <Input type="time" value={w.end} aria-label={`Window ${i + 1} end`} onChange={(e) => patchWindow(i, { end: e.target.value })} />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove window ${i + 1}`}
                  data-testid={`schedule-remove-window-${i}`}
                  disabled={form.windows.length === 1}
                  onClick={() => patch({ windows: form.windows.filter((_, idx) => idx !== i) })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        {/* ── policy ── */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Notice required (hours)" helper="How far ahead of a window a customer must book.">
            <Input
              type="number"
              min={0}
              step="0.5"
              value={form.leadTimeHours}
              aria-label="Notice required in hours"
              onChange={(e) => patch({ leadTimeHours: e.target.value })}
            />
          </Field>
          <Field label="Days bookable ahead" helper="Counting today as day 1.">
            <Input type="number" min={1} max={30} value={form.horizonDays} aria-label="Days bookable ahead" onChange={(e) => patch({ horizonDays: e.target.value })} />
          </Field>
          <Field label="Max pickups per window" helper="Leave blank for no cap. We never show customers a limit you haven't set.">
            <Input
              type="number"
              min={1}
              placeholder="No cap"
              value={form.maxPerSlot}
              aria-label="Max pickups per window"
              onChange={(e) => patch({ maxPerSlot: e.target.value })}
            />
          </Field>
        </div>

        {/* ── closed days ── */}
        <Field label="Closed on" helper="Customers are told you're closed on these days; no windows are offered.">
          <div className="flex flex-wrap gap-2 pt-1">
            {WEEKDAYS.map((name, idx) => {
              const on = form.closedDays.includes(idx);
              return (
                <button
                  key={name}
                  type="button"
                  data-testid={`schedule-closed-${idx}`}
                  aria-pressed={on}
                  onClick={() => patch({ closedDays: on ? form.closedDays.filter((d) => d !== idx) : [...form.closedDays, idx] })}
                  className={`rounded-pill border px-3 py-1.5 text-footnote transition duration-fast ${
                    on ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-hairline text-secondary hover:text-ink'
                  }`}
                >
                  {name.slice(0, 3)}
                </button>
              );
            })}
          </div>
        </Field>

        {/* The SAME Zod rules the server enforces, surfaced before the round-trip rather than as a 400. */}
        {invalidReason ? (
          <p data-testid="schedule-invalid" className="text-caption font-medium text-danger">
            {invalidReason}
          </p>
        ) : null}
        {saveError ? <ErrorBox message={saveError} /> : null}

        <div className="flex items-center gap-3">
          <Button type="submit" data-testid="schedule-save" loading={saving} disabled={!!invalidReason || saving}>
            <Clock className="h-4 w-4" /> Save schedule
          </Button>
          {saved && !invalidReason ? (
            <span data-testid="schedule-saved" className="text-footnote text-secondary">
              Saved. Customers see these windows now.
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}
