'use client';

import React, { useState } from 'react';
import { HOME_CTA_TARGETS, type HomeBlockAdminView, type HomeCtaTarget, type ReferralRewardTerms } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { Megaphone } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { money } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Select, Skeleton } from './ui';
import { RequireCapability } from './AppShell';

const apiErr = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

const BLANK = { title: '', body: '', ctaLabel: '', ctaTarget: '' as '' | HomeCtaTarget, sortOrder: 0 };

/**
 * [Inc-37] The founder's control over the customer HOME tab:
 *   • **What's new** — the announcement cards customers see. Nothing on Home is hard-coded in the app, so
 *     whatever is written here IS what they read (on their next Home refresh).
 *   • **Referral reward** — the REAL money a referrer earns when a friend they invited has their FIRST order
 *     delivered. This is the ONLY place a reward can come into existence.
 *
 * ⚑ HONESTY. The app renders the reward TERMS + the customer's BALANCE from the ledger/config — never from a
 * card's free text. So while you can write anything here, you cannot *promise* a reward that isn't funded:
 * with the reward off, the app shows no reward claim at all. Fund it below and the promise becomes real.
 */
export function HomeContentAdmin(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.catalog(me)}>
      <HomeContentInner />
    </RequireCapability>
  );
}

function HomeContentInner(): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);

  const blocks = useAsync(() => client.listHomeBlocks(), [nonce]);
  const reward = useAsync<ReferralRewardTerms>(() => client.getReferralReward(), [nonce]);

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-title1 text-ink">Customer home</h1>

      <RewardCard terms={reward.data} loading={reward.loading} error={reward.error} onChanged={reload} />

      <Card title="What’s new" subtitle="The cards customers see at the top of their Home tab. The app hard-codes no copy — this is it.">
        {!blocks.data && blocks.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-card" />
            <Skeleton className="h-24 w-full rounded-card" />
          </div>
        ) : !blocks.data && blocks.error ? (
          <ErrorBox message={blocks.error} onRetry={reload} />
        ) : (
          <BlockEditor blocks={blocks.data?.blocks ?? []} onChanged={reload} />
        )}
      </Card>
    </div>
  );
}

// ───────────────────────────── the referral reward (real money) ─────────────────────────────

function RewardCard({
  terms,
  loading,
  error,
  onChanged,
}: {
  terms: ReferralRewardTerms | null;
  loading: boolean;
  error: string | null;
  onChanged: () => void;
}): React.ReactElement {
  const { client } = useSession();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async (value: number | null): Promise<void> => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const next = await client.setReferralReward(value);
      setMsg(
        next.enabled
          ? `Reward funded: a referrer earns ${money(next.amount!, next.currency)} when their friend’s first order is delivered.`
          : 'Reward is OFF — nothing is granted, and the app shows no reward claim.',
      );
      setAmount('');
      onChanged();
    } catch (e) {
      setErr(apiErr(e, 'Could not save the referral reward.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Referral reward" subtitle="Real credit, granted when a referred friend’s FIRST order is DELIVERED (not at signup — that would be farmable).">
      {loading && !terms ? (
        <Skeleton className="h-10 w-64" />
      ) : error && !terms ? (
        <ErrorBox message={error} onRetry={onChanged} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3" data-testid="reward-state">
            {terms?.enabled ? (
              <>
                <Badge tone="green">Reward ON</Badge>
                <span className="text-subhead text-ink">
                  A referrer earns{' '}
                  <span className="font-semibold tabular-nums">{money(terms.amount!, terms.currency)}</span> credit per friend.
                </span>
              </>
            ) : (
              <>
                <Badge tone="neutral">Reward OFF</Badge>
                <span className="text-subhead text-secondary">
                  No reward exists, so the app promises none. Fund one below to make it real.
                </span>
              </>
            )}
          </div>

          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(amount);
              if (Number.isFinite(n) && n > 0) void save(n);
            }}
          >
            <Field label="Credit per referral (CAD)">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 10.00"
                aria-label="Credit per referral"
                data-testid="reward-amount"
              />
            </Field>
            <Button type="submit" loading={busy} disabled={busy || !(Number(amount) > 0)} data-testid="reward-save">
              Fund reward
            </Button>
            {terms?.enabled && (
              <Button variant="secondary" type="button" loading={busy} onClick={() => void save(null)} data-testid="reward-off">
                Turn reward off
              </Button>
            )}
          </form>

          {msg && <p className="mt-3 text-footnote font-medium text-success-strong">{msg}</p>}
          {err && <p className="mt-3 text-footnote font-medium text-danger-strong">{err}</p>}
        </>
      )}
    </Card>
  );
}

// ───────────────────────────── the "What's new" cards ─────────────────────────────

function BlockEditor({ blocks, onChanged }: { blocks: HomeBlockAdminView[]; onChanged: () => void }): React.ReactElement {
  const { client } = useSession();
  const [form, setForm] = useState(BLANK);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]): void => setForm((f) => ({ ...f, [k]: v }));

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.createHomeBlock({
        title: form.title,
        body: form.body,
        ctaLabel: form.ctaLabel || null,
        ctaTarget: form.ctaTarget || null,
        sortOrder: form.sortOrder,
      });
      setForm(BLANK);
      setShowNew(false);
      onChanged();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not create the card.'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (b: HomeBlockAdminView): Promise<void> => {
    setErr(null);
    try {
      await client.updateHomeBlock(b.id, { active: !b.active });
      onChanged();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not update the card.'));
    }
  };

  const remove = async (b: HomeBlockAdminView): Promise<void> => {
    setErr(null);
    try {
      await client.deleteHomeBlock(b.id);
      onChanged();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not delete the card.'));
    }
  };

  return (
    <>
      {err && <p className="mb-3 rounded-btn border border-danger-tint bg-danger-tint px-3 py-2 text-footnote font-medium text-danger-strong">{err}</p>}

      <div className="mb-4">
        <Button onClick={() => setShowNew((v) => !v)} data-testid="new-block">
          {showNew ? 'Cancel' : 'New card'}
        </Button>
      </div>

      {showNew && (
        <form className="mb-5 grid gap-3 rounded-card border border-hairline bg-subtle p-4 sm:grid-cols-2" onSubmit={create}>
          <Field label="Title">
            <Input value={form.title} onChange={(e) => set('title', e.target.value)} required maxLength={120} aria-label="Title" data-testid="block-title" />
          </Field>
          <Field label="Order">
            <Input type="number" min={0} value={form.sortOrder} onChange={(e) => set('sortOrder', Number(e.target.value))} aria-label="Order" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Body">
              <Input value={form.body} onChange={(e) => set('body', e.target.value)} required maxLength={500} aria-label="Body" data-testid="block-body" />
            </Field>
          </div>
          <Field label="Button label (optional)">
            <Input value={form.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} maxLength={40} aria-label="Button label" />
          </Field>
          <Field label="Button goes to">
            <Select value={form.ctaTarget} onChange={(e) => set('ctaTarget', e.target.value as '' | HomeCtaTarget)} aria-label="Button goes to">
              <option value="">No button</option>
              {HOME_CTA_TARGETS.map((t) => (
                <option key={t} value={t}>
                  {t === 'refer' ? 'Refer tab' : t === 'orders' ? 'Orders tab' : 'Services tab'}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy} disabled={busy || !form.title.trim() || !form.body.trim()} data-testid="block-save">
              Add card
            </Button>
          </div>
        </form>
      )}

      {blocks.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="h-5 w-5" strokeWidth={1.75} />}
          title="No cards yet"
          message="With no cards, the customer's Home simply shows no promo area — never a placeholder."
        />
      ) : (
        <ul className="space-y-3" data-testid="home-blocks">
          {blocks.map((b) => (
            <li key={b.id} data-testid={`block-${b.id}`} className="rounded-card border border-hairline p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-subhead font-semibold text-ink">{b.title}</span>
                {b.active ? <Badge tone="green">Live</Badge> : <Badge tone="neutral">Hidden</Badge>}
                {b.ctaTarget && <Badge tone="blue">→ {b.ctaTarget}</Badge>}
              </div>
              <p className="mt-1.5 text-footnote text-secondary">{b.body}</p>
              <div className="mt-3 flex gap-3">
                <button
                  className="rounded px-1 text-footnote font-semibold text-primary underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  onClick={() => void toggle(b)}
                  data-testid={`toggle-${b.id}`}
                >
                  {b.active ? 'Hide from Home' : 'Show on Home'}
                </button>
                <button
                  className="rounded px-1 text-footnote font-semibold text-danger underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                  onClick={() => void remove(b)}
                  data-testid={`delete-${b.id}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
