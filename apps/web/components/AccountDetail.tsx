'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  BillingMode,
  OrderVertical,
  RoleType,
  StandingOrderCadence,
  type AccountDetailView,
  type AccountManifestView,
  type CreateStandingOrderDto,
  type Metric,
  type OwnerException,
  type ServiceCatalogResult,
  type StandingOrderView,
} from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { ArrowLeft, CalendarClock, Package, ScrollText, TriangleAlert } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { formatNumber, humanize, money, orderRef, shortDate } from '@/lib/format';
import type { OrderListResult, OrderSummary } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  KV,
  Select,
  Skeleton,
  StatusPill,
  Table,
  TableSkeleton,
  Tabs,
  Td,
  Th,
} from './ui';
import { RequireCapability } from './AppShell';
import { CostCenterPicker, CostCenterSplitStat, CostCentersTab } from './CostCenters';

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

type TabKey = 'overview' | 'orders' | 'cost-centers' | 'manifests' | 'exceptions';
const TABS: { value: TabKey; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'orders', label: 'Orders' },
  { value: 'cost-centers', label: 'Cost centres' },
  { value: 'manifests', label: 'Manifests' },
  { value: 'exceptions', label: 'Exceptions' },
];

function AccountDetailInner({ accountId }: { accountId: string }): React.ReactElement {
  const { client, me } = useSession();
  const [nonce, setNonce] = useState(0);
  const [tab, setTab] = useState<TabKey>('overview');
  const reloadHeader = (): void => setNonce((n) => n + 1);
  const state = useAsync<AccountDetailView>(() => client.getAccount(accountId), [accountId, nonce]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link
          href="/accounts"
          className="inline-flex items-center gap-1.5 text-footnote font-medium text-secondary transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:shadow-focus rounded"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Accounts
        </Link>
      </div>

      {!state.data && state.loading ? (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
          <Card>
            <TableSkeleton rows={4} cols={4} />
          </Card>
        </div>
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="Account not found." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-title1 text-ink">{state.data.name}</h1>
            <Badge tone={state.data.type === 'BUSINESS' ? 'blue' : 'neutral'}>{humanize(state.data.type)}</Badge>
            <Badge tone={state.data.billingMode === 'BATCH_PERIODIC' ? 'amber' : 'neutral'}>{humanize(state.data.billingMode)}</Badge>
            <span className="text-footnote text-secondary">
              <span className="font-mono tabular-nums">{formatNumber(state.data.siteCount)}</span> site(s) ·{' '}
              <span className="font-mono tabular-nums">{formatNumber(state.data.activeStandingOrderCount)}</span> active standing order(s)
            </span>
          </div>

          <Tabs tabs={TABS} value={tab} onChange={(v) => setTab(v as TabKey)} />

          {tab === 'overview' && (
            <div role="tabpanel" className="space-y-6">
              {can.analyticsScorecard(me) && <ScorecardCard accountId={accountId} />}
              <StandingOrdersCard account={state.data} onChanged={reloadHeader} />
              <GeneratedCard accountId={accountId} reloadKey={nonce} />
              {can.finance(me) && <BillingCard account={state.data} onChanged={reloadHeader} />}
            </div>
          )}
          {tab === 'orders' && (
            <div role="tabpanel">
              <OrdersTab accountId={accountId} />
            </div>
          )}
          {tab === 'cost-centers' && (
            <div role="tabpanel">
              <CostCentersTab accountId={accountId} sites={state.data.sites} />
            </div>
          )}
          {tab === 'manifests' && (
            <div role="tabpanel">
              <ManifestsTab accountId={accountId} />
            </div>
          )}
          {tab === 'exceptions' && (
            <div role="tabpanel">
              <ExceptionsTab accountId={accountId} />
            </div>
          )}
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[88px] rounded-card" />
          ))}
        </div>
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="No scorecard." />
      ) : (
        <div className="grid grid-cols-2 gap-3 stagger sm:grid-cols-4">
          <Stat label="Loss rate" metric={state.data.metrics.lossRatePercent} render={(v) => `${v}%`} />
          <Stat label="On-time" metric={state.data.metrics.onTimePercent} render={(v) => `${v}%`} />
          <Stat
            label="Monthly spend"
            metric={state.data.metrics.monthlySpend}
            render={(v) => `${money(v.total, state.data!.currency)} · ${money(v.perMonth, state.data!.currency)}/mo`}
          />
          <div
            className="rounded-card border border-hairline bg-subtle p-3.5"
            data-testid="stat-Cost-center split"
            title="The real per-centre split for this period, from the cost-centre report."
          >
            <div className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-tertiary">Cost-centre split</div>
            <CostCenterSplitStat accountId={accountId} from={state.data.range.from} to={state.data.range.to} />
          </div>
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
  else if (metric.value === null) body = <span className="text-tertiary">—</span>;
  else body = <span className="text-title2 font-semibold tabular-nums text-ink">{render(metric.value)}</span>;
  return (
    <div className="rounded-card border border-hairline bg-subtle p-3.5" data-testid={`stat-${label}`} title={metric.note}>
      <div className="mb-1.5 text-caption font-semibold uppercase tracking-wide text-tertiary">{label}</div>
      {body}
      {metric.status === 'ok' && metric.rowCount !== null && (
        <div className="mt-1.5 font-mono text-caption tabular-nums text-tertiary">n={metric.rowCount}</div>
      )}
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
      {runMsg && (
        <p className="mb-3 rounded-btn border border-primary-tint bg-primary-tint px-3 py-2 text-footnote font-medium text-primary-strong">{runMsg}</p>
      )}
      {err && (
        <p className="mb-3 rounded-btn border border-danger-tint bg-danger-tint px-3 py-2 text-footnote font-medium text-danger-strong">{err}</p>
      )}

      {canWrite && showCreate && (
        <form className="mb-4 grid gap-3 rounded-card border border-hairline bg-subtle p-4 sm:grid-cols-2 lg:grid-cols-3" onSubmit={create}>
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
          <label className="flex items-center gap-2 self-end text-subhead text-ink">
            <input
              type="checkbox"
              checked={form.concierge}
              onChange={(e) => set('concierge', e.target.checked)}
              aria-label="Concierge handoff"
              className="h-4 w-4 rounded border-hairline text-primary accent-primary focus-visible:outline-none focus-visible:shadow-focus"
            />
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
        <TableSkeleton rows={3} cols={canWrite ? 7 : 6} />
      ) : !list.data && list.error ? (
        <ErrorBox message={list.error} onRetry={reload} />
      ) : !list.data || list.data.standingOrders.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" strokeWidth={1.75} />}
          title="No standing orders"
          message="This account has no recurring orders yet."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Cadence</Th>
              <Th>Day</Th>
              <Th>Pickup window</Th>
              <Th>Handoff</Th>
              <Th>Status</Th>
              <Th>Next run</Th>
              {canWrite && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody className="stagger">
            {list.data.standingOrders.map((so) => (
              <tr key={so.id} className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`so-${so.id}`}>
                <Td className="font-medium">{humanize(so.cadence)}</Td>
                <Td>{WEEKDAYS[so.weekday] ?? so.weekday}</Td>
                <Td className="font-mono tabular-nums text-secondary">
                  {so.pickupWindow.start}–{so.pickupWindow.end}
                </Td>
                <Td>{so.concierge ? <Badge tone="blue">Concierge</Badge> : <span className="text-tertiary">Direct</span>}</Td>
                <Td>{so.active ? <StatusPill tone="green">Active</StatusPill> : <StatusPill tone="neutral">Paused</StatusPill>}</Td>
                <Td className="text-secondary">{so.nextRunAt ? shortDate(so.nextRunAt) : '—'}</Td>
                {canWrite && (
                  <Td>
                    <div className="flex gap-2">
                      <button
                        className="rounded px-1 text-footnote font-semibold text-primary underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        onClick={() => void toggleActive(so)}
                      >
                        {so.active ? 'Pause' : 'Resume'}
                      </button>
                      <button
                        className="rounded px-1 text-footnote font-semibold text-danger underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        onClick={() => void remove(so)}
                      >
                        Delete
                      </button>
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
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
        <TableSkeleton rows={3} cols={4} />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.occurrences.length === 0 ? (
        <EmptyState
          icon={<Package className="h-5 w-5" strokeWidth={1.75} />}
          title="Nothing generated yet"
          message="Run due generation (or wait for the schedule) to materialize recurring orders here."
        />
      ) : (
        <>
          <p className="mb-3 text-footnote text-secondary">
            <span className="font-mono tabular-nums">{formatNumber(state.data.orderCount)}</span> order(s) ·{' '}
            <span className="font-mono tabular-nums">{formatNumber(state.data.routeCount)}</span> route(s) from{' '}
            <span className="font-mono tabular-nums">{formatNumber(state.data.occurrences.length)}</span> occurrence(s).
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Order</Th>
                <Th>Route</Th>
                <Th>Generated</Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {state.data.occurrences.map((o) => (
                <tr key={o.id} className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`occ-${o.id}`}>
                  <Td className="font-mono tabular-nums">{o.periodKey}</Td>
                  <Td className="font-mono text-caption text-secondary">{o.orderId ? o.orderId.slice(0, 8) : '—'}</Td>
                  <Td className="font-mono text-caption text-secondary">{o.routeId ? o.routeId.slice(0, 8) : '—'}</Td>
                  <Td className="text-secondary">{shortDate(o.generatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
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
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-full rounded-input" />
            <Skeleton className="h-10 w-28 rounded-btn" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full rounded-input" />
            <Skeleton className="h-10 w-44 rounded-btn" />
          </div>
        </div>
      ) : !terms.data && terms.error ? (
        <ErrorBox message={terms.error} onRetry={() => setNonce((n) => n + 1)} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* terms */}
          <form className="space-y-3" onSubmit={saveTerms}>
            <h3 className="text-subhead font-semibold text-ink">Terms</h3>
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
            {termsMsg && <p className="text-footnote font-medium text-success-strong">{termsMsg}</p>}
            {termsErr && <p className="text-footnote font-medium text-danger-strong">{termsErr}</p>}
          </form>

          {/* batch invoice */}
          <div className="space-y-3">
            <h3 className="text-subhead font-semibold text-ink">Periodic invoice</h3>
            {!isBatch ? (
              <p className="text-footnote text-secondary">
                This account bills <span className="font-medium text-ink">per order</span>. Switch billing to{' '}
                <span className="font-medium text-ink">Batch periodic</span> to batch a period’s orders into one invoice.
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
                {batchErr && <p className="text-footnote font-medium text-danger-strong">{batchErr}</p>}
              </form>
            )}

            {invoice && (
              <div className="animate-scale-in rounded-card border border-hairline bg-subtle p-4" data-testid="batch-invoice">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-subhead font-semibold tabular-nums text-ink">{invoice.number ?? 'Invoice'}</div>
                  <Badge tone="blue">{humanize(invoice.status)}</Badge>
                </div>
                <div className="mt-2 space-y-1 border-t border-hairline pt-2">
                  <KV label="Total" value={money(invoice.total, invoice.currency)} mono />
                  <KV label="Due" value={invoice.dueAt ? shortDate(invoice.dueAt) : '—'} mono />
                </div>
                <ul className="mt-3 space-y-1.5 border-t border-hairline pt-3">
                  {invoice.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-4 text-footnote">
                      <span className="text-secondary">{l.description}</span>
                      <span className="shrink-0 font-mono tabular-nums text-ink">{money(l.amount, invoice.currency)}</span>
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

// ───────────────────────────── orders tab ─────────────────────────────

const TERMINAL_GREEN = new Set(['DELIVERED', 'INVOICED', 'CLOSED', 'APPROVED']);
function orderTone(status: string): 'green' | 'amber' | 'red' | 'blue' {
  if (TERMINAL_GREEN.has(status)) return 'green';
  if (status === 'ON_HOLD') return 'amber';
  if (status === 'CANCELLED' || status === 'DECLINED') return 'red';
  return 'blue';
}

/** The account's orders — reads the proven order listing (server delegates), confined to the account. */
function OrdersTab({ accountId }: { accountId: string }): React.ReactElement {
  const { client, me } = useSession();
  const state = useAsync<OrderListResult>(() => client.getAccountOrders(accountId, { limit: 50 }), [accountId]);
  // Cost-centre attribution: one account-scoped list powers every row's picker (no N-row fetch).
  const centres = useAsync(() => client.listCostCenters(accountId), [accountId]);
  const canAttribute = can.accounts(me);
  const orderTotal = (o: OrderSummary): string | null => o.totals?.total ?? o.quotes?.[0]?.total ?? null;
  return (
    <Card title="Orders">
      {!state.data && state.loading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.orders.length === 0 ? (
        <EmptyState
          icon={<Package className="h-5 w-5" strokeWidth={1.75} />}
          title="No orders"
          message="This account has no orders yet."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Order</Th>
              <Th>Status</Th>
              <Th>Vertical</Th>
              <Th numeric>Amount</Th>
              <Th>Cost centre</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {state.data.orders.map((o) => (
              <tr key={o.id} className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`order-${o.id}`}>
                <Td className="font-mono text-caption text-secondary">{orderRef(o.id)}</Td>
                <Td>
                  <StatusPill tone={orderTone(o.status)}>{humanize(o.status)}</StatusPill>
                </Td>
                <Td>{humanize(o.vertical)}</Td>
                <Td numeric className="text-secondary">{money(orderTotal(o), o.totals?.currency ?? 'CAD')}</Td>
                <Td>
                  {!centres.data && centres.loading ? (
                    <Skeleton className="h-8 w-40 rounded-input" />
                  ) : (
                    <CostCenterPicker
                      orderId={o.id}
                      accountId={accountId}
                      value={o.costCenterId}
                      costCenters={centres.data?.costCenters ?? []}
                      canWrite={canAttribute}
                      variant="inline"
                    />
                  )}
                </Td>
                <Td className="text-secondary">{shortDate(o.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ───────────────────────────── manifests tab ─────────────────────────────

/** A read-only VIEW of the account's already-generated route-stop manifests (never generates one). */
function ManifestsTab({ accountId }: { accountId: string }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync<{ manifests: AccountManifestView[] }>(() => client.getAccountManifests(accountId), [accountId]);
  return (
    <Card title="Manifests">
      {!state.data && state.loading ? (
        <TableSkeleton rows={5} cols={7} />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.manifests.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" strokeWidth={1.75} />}
          title="No manifests"
          message="Manifests are generated on the route/stop endpoints — none exist for this account yet."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Stop</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th>Order</Th>
              <Th>Site</Th>
              <Th numeric>Expected items</Th>
              <Th>Generated</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {state.data.manifests.map((m) => (
              <tr key={m.id} className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`manifest-${m.id}`}>
                <Td className="font-mono tabular-nums text-secondary">{m.stopSeq != null ? `#${m.stopSeq}` : '—'}</Td>
                <Td>{m.stopKind ? humanize(m.stopKind) : '—'}</Td>
                <Td>{m.stopStatus ? <StatusPill tone="neutral">{humanize(m.stopStatus)}</StatusPill> : '—'}</Td>
                <Td className="font-mono text-caption text-secondary">{m.orderId ? orderRef(m.orderId) : '—'}</Td>
                <Td className="text-secondary">{m.siteName ?? '—'}</Td>
                <Td numeric>{formatNumber(m.expectedItemCount)}</Td>
                <Td className="text-secondary">{shortDate(m.generatedAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ───────────────────────────── exceptions tab ─────────────────────────────

function exceptionTone(kind: OwnerException['kind']): 'red' | 'amber' {
  return kind === 'STOP_FAILED' || kind === 'PAYMENT_FAILED' || kind === 'PAYMENT_DISPUTE' ? 'red' : 'amber';
}

/** The account's exceptions feed (failed/skipped stops, held orders, open disputes, failed payments). */
function ExceptionsTab({ accountId }: { accountId: string }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync<{ exceptions: OwnerException[] }>(() => client.getAccountExceptions(accountId), [accountId]);
  return (
    <Card title="Exceptions">
      {!state.data && state.loading ? (
        <TableSkeleton rows={5} cols={4} />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.exceptions.length === 0 ? (
        <EmptyState
          icon={<TriangleAlert className="h-5 w-5" strokeWidth={1.75} />}
          title="No exceptions"
          message="No failed/skipped stops, held orders, open disputes, or failed payments for this account."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th>Detail</Th>
              <Th numeric>Amount</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {state.data.exceptions.map((x) => (
              <tr key={x.id} className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`exception-${x.id}`}>
                <Td>
                  <StatusPill tone={exceptionTone(x.kind)}>{humanize(x.kind)}</StatusPill>
                </Td>
                <Td className="text-secondary">
                  <span className="text-ink">{x.title}</span>
                  {x.detail ? <span className="text-secondary"> — {x.detail}</span> : null}
                </Td>
                <Td numeric className="text-secondary">{x.amount ? money(x.amount, x.currency ?? 'CAD') : '—'}</Td>
                <Td className="text-secondary">{shortDate(x.occurredAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
