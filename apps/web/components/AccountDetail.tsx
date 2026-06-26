'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  BillingMode,
  OrderVertical,
  RoleType,
  StandingOrderCadence,
  type AccountDetailView,
  type CreateStandingOrderDto,
  type Metric,
  type ServiceCatalogResult,
  type StandingOrderView,
} from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { formatNumber, humanize, money, shortDate } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Select } from './ui';
import { RequireCapability } from './AppShell';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const apiErr = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);
/** A date-input "YYYY-MM-DD" → ISO instant at UTC midnight (or undefined when blank). */
const toIso = (d: string): string | undefined => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : undefined);

/**
 * B2B account detail (Track-A condo console) — the full management surface for one building account
 * over the now-merged condo endpoints: the per-account scorecard, FULL standing/recurring-order
 * management (create / edit / delete + the org-wide generation run), the generated-orders feed, and
 * per-account billing terms + batch/periodic invoicing. Server-authoritative + RBAC-gated for UX (the
 * server enforces independently); finance actions are OWNER/FINANCE, standing-order writes OWNER/DISPATCHER.
 */
export function AccountDetail({ accountId }: { accountId: string }): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.accounts(me)}>
      <AccountDetailInner accountId={accountId} />
    </RequireCapability>
  );
}

function AccountDetailInner({ accountId }: { accountId: string }): React.ReactElement {
  const { client, me } = useSession();
  const [nonce, setNonce] = useState(0);
  const reloadHeader = (): void => setNonce((n) => n + 1);
  const state = useAsync<AccountDetailView>(() => client.getAccount(accountId), [accountId, nonce]);

  return (
    <div className="space-y-4">
      <div>
        <Link href="/accounts" className="text-sm text-bb-blue hover:underline">
          ← Accounts
        </Link>
      </div>

      {!state.data && state.loading ? (
        <Loading />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="Account not found." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-bb-ink">{state.data.name}</h1>
            <Badge tone={state.data.type === 'BUSINESS' ? 'blue' : 'neutral'}>{humanize(state.data.type)}</Badge>
            <Badge tone={state.data.billingMode === 'BATCH_PERIODIC' ? 'amber' : 'neutral'}>{humanize(state.data.billingMode)}</Badge>
            <span className="text-sm text-bb-sub">
              {formatNumber(state.data.siteCount)} site(s) · {formatNumber(state.data.activeStandingOrderCount)} active standing order(s)
            </span>
          </div>

          {can.analyticsScorecard(me) && <ScorecardCard accountId={accountId} />}
          <StandingOrdersCard account={state.data} onChanged={reloadHeader} />
          <GeneratedCard accountId={accountId} reloadKey={nonce} />
          {can.finance(me) && <BillingCard account={state.data} onChanged={reloadHeader} />}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── scorecard ─────────────────────────────

function ScorecardCard({ accountId }: { accountId: string }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync(() => client.accountScorecard(accountId), [accountId]);
  return (
    <Card title="Scorecard (last 30 days)">
      {!state.data && state.loading ? (
        <Loading />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="No scorecard." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Loss rate" metric={state.data.metrics.lossRatePercent} render={(v) => `${v}%`} />
          <Stat label="On-time" metric={state.data.metrics.onTimePercent} render={(v) => `${v}%`} />
          <Stat
            label="Monthly spend"
            metric={state.data.metrics.monthlySpend}
            render={(v) => `${money(v.total, state.data!.currency)} · ${money(v.perMonth, state.data!.currency)}/mo`}
          />
          <Stat label="Cost-center split" metric={state.data.metrics.costCenterSplit} render={() => '—'} />
        </div>
      )}
    </Card>
  );
}

/** A single scorecard tile honouring the {@link Metric} wrapper — never invents a value (honesty firewall). */
function Stat<T>({ label, metric, render }: { label: string; metric: Metric<T>; render: (v: T) => string }): React.ReactElement {
  let body: React.ReactNode;
  if (metric.status === 'unavailable_in_phase_1') body = <Badge tone="amber">Phase 2</Badge>;
  else if (metric.status === 'error') body = <Badge tone="red">Unavailable</Badge>;
  else if (metric.value === null) body = <span className="text-bb-sub">—</span>;
  else body = <span className="text-xl font-semibold text-bb-ink">{render(metric.value)}</span>;
  return (
    <div className="rounded-lg border border-bb-line bg-white p-3" data-testid={`stat-${label}`} title={metric.note}>
      <div className="mb-1 text-xs font-medium text-bb-sub">{label}</div>
      {body}
      {metric.status === 'ok' && metric.rowCount !== null && <div className="mt-1 text-[11px] text-bb-sub">n={metric.rowCount}</div>}
    </div>
  );
}

// ───────────────────────────── standing orders (full CRUD + run) ─────────────────────────────

const BLANK_CREATE = {
  siteId: '',
  serviceId: '',
  vertical: OrderVertical.SPECIALTY as OrderVertical,
  cadence: StandingOrderCadence.WEEKLY as StandingOrderCadence,
  weekday: 1,
  start: '07:00',
  end: '09:00',
  concierge: false,
  startsOn: '',
};

function StandingOrdersCard({ account, onChanged }: { account: AccountDetailView; onChanged: () => void }): React.ReactElement {
  const { client, me } = useSession();
  const canWrite = can.standingOrderWrite(me);
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const list = useAsync(() => client.listStandingOrders({ accountId: account.id, limit: 100 }), [account.id, nonce]);
  const services = useAsync<ServiceCatalogResult>(() => client.getServices(), []);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_CREATE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]): void => setForm((f) => ({ ...f, [k]: v }));

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const dto: CreateStandingOrderDto = {
        accountId: account.id,
        siteId: form.siteId,
        serviceId: form.serviceId,
        vertical: form.vertical,
        cadence: form.cadence,
        weekday: form.weekday,
        pickupWindow: { start: form.start, end: form.end },
        concierge: form.concierge,
        startsOn: new Date(`${form.startsOn}T00:00:00.000Z`),
        active: true,
      };
      await client.createStandingOrder(dto);
      setShowCreate(false);
      setForm(BLANK_CREATE);
      reload();
      onChanged();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not create the standing order.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (so: StandingOrderView): Promise<void> => {
    setErr(null);
    try {
      await client.updateStandingOrder(so.id, { active: !so.active });
      reload();
      onChanged();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not update the standing order.'));
    }
  };

  const remove = async (so: StandingOrderView): Promise<void> => {
    setErr(null);
    try {
      await client.deleteStandingOrder(so.id);
      reload();
      onChanged();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not delete the standing order.'));
    }
  };

  const runGeneration = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    setRunMsg(null);
    try {
      const r = await client.runStandingOrderGeneration({});
      setRunMsg(`Org-wide run: ${r.ordersCreated} order(s) + ${r.routesCreated} route(s) generated from ${r.occurrencesCreated} new occurrence(s).`);
      reload();
      onChanged();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not run generation.'));
    } finally {
      setBusy(false);
    }
  };

  const actions = canWrite ? (
    <div className="flex items-center gap-2">
      <Button variant="secondary" loading={busy} onClick={() => void runGeneration()} title="Generates ALL the org's due standing orders, not only this account.">
        Run due generation (org-wide)
      </Button>
      <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : 'New standing order'}</Button>
    </div>
  ) : undefined;

  return (
    <Card title="Standing / recurring orders" actions={actions}>
      {runMsg && <p className="mb-2 rounded-lg bg-bb-blueSoft px-3 py-2 text-sm text-bb-blue">{runMsg}</p>}
      {err && <p className="mb-2 text-sm text-red-700">{err}</p>}

      {canWrite && showCreate && (
        <form className="mb-4 grid gap-3 rounded-lg border border-bb-line p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={create}>
          <Field label="Site">
            <Select value={form.siteId} onChange={(e) => set('siteId', e.target.value)} aria-label="Site" required>
              <option value="">Select…</option>
              {account.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service">
            <Select value={form.serviceId} onChange={(e) => set('serviceId', e.target.value)} aria-label="Service" required>
              <option value="">Select…</option>
              {(services.data?.services ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Vertical">
            <Select value={form.vertical} onChange={(e) => set('vertical', e.target.value as OrderVertical)} aria-label="Vertical">
              {Object.values(OrderVertical).map((v) => (
                <option key={v} value={v}>
                  {humanize(v)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cadence">
            <Select value={form.cadence} onChange={(e) => set('cadence', e.target.value as StandingOrderCadence)} aria-label="Cadence">
              {Object.values(StandingOrderCadence).map((c) => (
                <option key={c} value={c}>
                  {humanize(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Weekday">
            <Select value={String(form.weekday)} onChange={(e) => set('weekday', Number(e.target.value))} aria-label="Weekday">
              {WEEKDAYS.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Starts on">
            <Input type="date" value={form.startsOn} onChange={(e) => set('startsOn', e.target.value)} aria-label="Starts on" required />
          </Field>
          <Field label="Pickup from">
            <Input type="time" value={form.start} onChange={(e) => set('start', e.target.value)} aria-label="Pickup from" required />
          </Field>
          <Field label="Pickup to">
            <Input type="time" value={form.end} onChange={(e) => set('end', e.target.value)} aria-label="Pickup to" required />
          </Field>
          <label className="flex items-center gap-2 self-end text-sm text-bb-ink">
            <input type="checkbox" checked={form.concierge} onChange={(e) => set('concierge', e.target.checked)} aria-label="Concierge handoff" />
            Concierge / lobby handoff
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" loading={busy} disabled={!form.siteId || !form.serviceId || !form.startsOn}>
              Create standing order
            </Button>
          </div>
        </form>
      )}

      {!list.data && list.loading ? (
        <Loading />
      ) : !list.data && list.error ? (
        <ErrorBox message={list.error} onRetry={reload} />
      ) : !list.data || list.data.standingOrders.length === 0 ? (
        <EmptyState title="No standing orders" message="This account has no recurring orders yet." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bb-line text-left text-bb-sub">
              <th className="py-2 pr-4 font-medium">Cadence</th>
              <th className="py-2 pr-4 font-medium">Day</th>
              <th className="py-2 pr-4 font-medium">Pickup window</th>
              <th className="py-2 pr-4 font-medium">Handoff</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Next run</th>
              {canWrite && <th className="py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {list.data.standingOrders.map((so) => (
              <tr key={so.id} className="border-b border-bb-line last:border-0" data-testid={`so-${so.id}`}>
                <td className="py-2 pr-4">{humanize(so.cadence)}</td>
                <td className="py-2 pr-4">{WEEKDAYS[so.weekday] ?? so.weekday}</td>
                <td className="py-2 pr-4 text-bb-sub">
                  {so.pickupWindow.start}–{so.pickupWindow.end}
                </td>
                <td className="py-2 pr-4">{so.concierge ? <Badge tone="blue">Concierge</Badge> : <span className="text-bb-sub">Direct</span>}</td>
                <td className="py-2 pr-4">{so.active ? <Badge tone="green">Active</Badge> : <Badge tone="neutral">Paused</Badge>}</td>
                <td className="py-2 pr-4 text-bb-sub">{so.nextRunAt ? shortDate(so.nextRunAt) : '—'}</td>
                {canWrite && (
                  <td className="py-2">
                    <div className="flex gap-3">
                      <button className="text-xs text-bb-blue hover:underline" onClick={() => void toggleActive(so)}>
                        {so.active ? 'Pause' : 'Resume'}
                      </button>
                      <button className="text-xs text-red-700 hover:underline" onClick={() => void remove(so)}>
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ───────────────────────────── generated orders feed ─────────────────────────────

function GeneratedCard({ accountId, reloadKey }: { accountId: string; reloadKey: number }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync(() => client.getGeneratedForAccount(accountId), [accountId, reloadKey]);
  return (
    <Card title="Generated orders & routes">
      {!state.data && state.loading ? (
        <Loading />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.occurrences.length === 0 ? (
        <EmptyState title="Nothing generated yet" message="Run due generation (or wait for the schedule) to materialize recurring orders here." />
      ) : (
        <>
          <p className="mb-3 text-sm text-bb-sub">
            {formatNumber(state.data.orderCount)} order(s) · {formatNumber(state.data.routeCount)} route(s) from {formatNumber(state.data.occurrences.length)} occurrence(s).
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bb-line text-left text-bb-sub">
                <th className="py-2 pr-4 font-medium">Period</th>
                <th className="py-2 pr-4 font-medium">Order</th>
                <th className="py-2 pr-4 font-medium">Route</th>
                <th className="py-2 font-medium">Generated</th>
              </tr>
            </thead>
            <tbody>
              {state.data.occurrences.map((o) => (
                <tr key={o.id} className="border-b border-bb-line last:border-0" data-testid={`occ-${o.id}`}>
                  <td className="py-2 pr-4">{o.periodKey}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-bb-sub">{o.orderId ? o.orderId.slice(0, 8) : '—'}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-bb-sub">{o.routeId ? o.routeId.slice(0, 8) : '—'}</td>
                  <td className="py-2 text-bb-sub">{shortDate(o.generatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

// ───────────────────────────── billing terms + batch invoice ─────────────────────────────

function defaultMonthWindow(): { from: string; to: string; period: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(next), period: iso(first).slice(0, 7) };
}

function BillingCard({ account, onChanged }: { account: AccountDetailView; onChanged: () => void }): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const terms = useAsync(() => client.getBillingTerms(account.id), [account.id, nonce]);

  const [mode, setMode] = useState<BillingMode>(account.billingMode as BillingMode);
  const [netDays, setNetDays] = useState<number>(account.billingNetDays);
  const [savingTerms, setSavingTerms] = useState(false);
  const [termsErr, setTermsErr] = useState<string | null>(null);
  const [termsMsg, setTermsMsg] = useState<string | null>(null);

  // Keep the form in sync once the live terms load.
  React.useEffect(() => {
    if (terms.data) {
      setMode(terms.data.billingMode);
      setNetDays(terms.data.billingNetDays);
    }
  }, [terms.data]);

  const saveTerms = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSavingTerms(true);
    setTermsErr(null);
    setTermsMsg(null);
    try {
      await client.setBillingTerms(account.id, { billingMode: mode, netDays });
      setTermsMsg('Billing terms saved.');
      setNonce((n) => n + 1);
      onChanged();
    } catch (e2) {
      setTermsErr(apiErr(e2, 'Could not save billing terms.'));
    } finally {
      setSavingTerms(false);
    }
  };

  // batch invoice
  const win = defaultMonthWindow();
  const [from, setFrom] = useState(win.from);
  const [to, setTo] = useState(win.to);
  const [period, setPeriod] = useState(win.period);
  const [batching, setBatching] = useState(false);
  const [batchErr, setBatchErr] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<import('@blue-bee/shared').InvoiceView | null>(null);

  const liveMode = terms.data?.billingMode ?? (account.billingMode as BillingMode);
  const isBatch = liveMode === BillingMode.BATCH_PERIODIC;

  const runBatch = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBatching(true);
    setBatchErr(null);
    setInvoice(null);
    try {
      const inv = await client.batchInvoice(account.id, { from: toIso(from)!, to: toIso(to)!, period: period || undefined });
      setInvoice(inv);
    } catch (e2) {
      setBatchErr(apiErr(e2, 'Could not generate the batch invoice.'));
    } finally {
      setBatching(false);
    }
  };

  return (
    <Card title="Billing">
      {!terms.data && terms.loading ? (
        <Loading />
      ) : !terms.data && terms.error ? (
        <ErrorBox message={terms.error} onRetry={() => setNonce((n) => n + 1)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* terms */}
          <form className="space-y-3" onSubmit={saveTerms}>
            <h3 className="text-sm font-semibold text-bb-ink">Terms</h3>
            <Field label="Billing mode">
              <Select value={mode} onChange={(e) => setMode(e.target.value as BillingMode)} aria-label="Billing mode">
                {Object.values(BillingMode).map((m) => (
                  <option key={m} value={m}>
                    {humanize(m)}
                  </option>
                ))}
              </Select>
            </Field>
            {mode === BillingMode.BATCH_PERIODIC && (
              <Field label="Net days">
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={netDays}
                  onChange={(e) => setNetDays(Number(e.target.value))}
                  aria-label="Net days"
                />
              </Field>
            )}
            <Button type="submit" loading={savingTerms}>
              Save terms
            </Button>
            {termsMsg && <p className="text-sm text-green-700">{termsMsg}</p>}
            {termsErr && <p className="text-sm text-red-700">{termsErr}</p>}
          </form>

          {/* batch invoice */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-bb-ink">Periodic invoice</h3>
            {!isBatch ? (
              <p className="text-sm text-bb-sub">
                This account bills <span className="font-medium">per order</span>. Switch billing to{' '}
                <span className="font-medium">Batch periodic</span> to batch a period’s orders into one invoice.
              </p>
            ) : (
              <form className="space-y-3" onSubmit={runBatch}>
                <div className="flex gap-2">
                  <Field label="From">
                    <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Invoice from" />
                  </Field>
                  <Field label="To">
                    <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Invoice to" />
                  </Field>
                </div>
                <Field label="Period label">
                  <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="2026-06" aria-label="Period label" />
                </Field>
                <Button type="submit" loading={batching} disabled={!from || !to || batching}>
                  Generate periodic invoice
                </Button>
                {batchErr && <p className="text-sm text-red-700">{batchErr}</p>}
              </form>
            )}

            {invoice && (
              <div className="rounded-lg border border-bb-line bg-bb-blueSoft/40 p-3 text-sm" data-testid="batch-invoice">
                <div className="font-semibold text-bb-ink">{invoice.number ?? 'Invoice'}</div>
                <div className="text-bb-sub">
                  {humanize(invoice.status)} · {money(invoice.total, invoice.currency)} · due {invoice.dueAt ? shortDate(invoice.dueAt) : '—'}
                </div>
                <ul className="mt-2 space-y-1">
                  {invoice.lines.map((l, i) => (
                    <li key={i} className="flex justify-between text-bb-sub">
                      <span>{l.description}</span>
                      <span>{money(l.amount, invoice.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
