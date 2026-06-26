'use client';

import React, { useState } from 'react';
import type {
  AccountScorecard,
  ArAging,
  CommercialAnalytics,
  Metric,
  OperationalAnalytics,
} from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { money } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading } from './ui';
import { RequireCapability } from './AppShell';

/** Default window: the last 30 days, as YYYY-MM-DD date-input strings. */
function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(today) };
}

/** A YYYY-MM-DD date-input value → an ISO instant at UTC midnight (or undefined when blank). */
function toIso(date: string): string | undefined {
  return date ? new Date(`${date}T00:00:00.000Z`).toISOString() : undefined;
}

/**
 * Analytics console (Increment 15, PRD §13 / Epic B6.1 "MVP basic") — the operational + commercial
 * dashboards and the per-account scorecard, rendered from the new read-only `/v1/analytics/*`
 * endpoints. Server-authoritative: the page renders the aggregates verbatim (no KPI math here).
 *
 * HONESTY FIREWALL surfaced in the UI: every number is a {@link Metric}; the {@link Stat} renderer
 * shows a computed value, an honest "—" (computed but no rows), a "Phase 2" badge for deferred
 * metrics, or a degraded note — it never invents a number. Each section is RBAC-gated for UX (the
 * server enforces independently) and has loading / empty / error states.
 */
export function AnalyticsHome(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.analytics(me)}>
      <AnalyticsHomeInner />
    </RequireCapability>
  );
}

function AnalyticsHomeInner(): React.ReactElement {
  const { me } = useSession();
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  // The applied range drives the fetches; editing the inputs doesn't refetch until "Apply".
  const [applied, setApplied] = useState(init);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold text-bb-ink">Analytics</h1>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ from, to });
          }}
        >
          <Field label="From">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </Field>
          <Button type="submit">Apply</Button>
        </form>
      </div>

      {can.analyticsOperational(me) && <OperationalSection range={applied} />}
      {can.analyticsCommercial(me) && <CommercialSection range={applied} />}
      {can.analyticsScorecard(me) && <ScorecardSection range={applied} />}
    </div>
  );
}

interface Range {
  from: string;
  to: string;
}

// ───────────────────────────── operational ─────────────────────────────

function OperationalSection({ range }: { range: Range }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync<OperationalAnalytics>(
    () => client.analyticsOperational({ from: toIso(range.from), to: toIso(range.to) }),
    [range.from, range.to],
  );

  return (
    <Card title="Operational">
      <SectionBody state={state}>
        {(data) => (
          <StatGrid>
            <Stat label="On-time pickup" metric={data.metrics.onTimePickupPercent} render={asPercent} />
            <Stat label="On-time delivery" metric={data.metrics.onTimeDeliveryPercent} render={asPercent} />
            <Stat label="Route adherence" metric={data.metrics.routeAdherencePercent} render={asPercent} />
            <Stat label="Failed/skip rate" metric={data.metrics.failedSkipRatePercent} render={asPercent} />
            <Stat label="Stops / hour" metric={data.metrics.stopsPerHour} render={asNumber} />
            <Stat label="Avg dwell (min)" metric={data.metrics.avgDwellMinutes} render={asNumber} />
            <Stat label="Items-lost rate" metric={data.metrics.itemsLostRatePercent} render={asPercent} />
            <Stat label="Rewash rate" metric={data.metrics.rewashRatePercent} render={asPercent} />
            <Stat
              label="Plant throughput"
              metric={data.metrics.plantThroughput}
              render={(v) => `${v.itemsCompleted} items · ${v.perDay}/day`}
            />
            <Stat label="Par stockouts" metric={data.metrics.parStockoutIncidents} render={asNumber} />
            <Stat label="Plant PPOH" metric={data.metrics.ppoh} render={asNumber} />
          </StatGrid>
        )}
      </SectionBody>
    </Card>
  );
}

// ───────────────────────────── commercial ─────────────────────────────

function CommercialSection({ range }: { range: Range }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync<CommercialAnalytics>(
    () => client.analyticsCommercial({ from: toIso(range.from), to: toIso(range.to) }),
    [range.from, range.to],
  );

  return (
    <Card title="Commercial">
      <SectionBody state={state}>
        {(data) => (
          <>
            <StatGrid>
              <Stat label="Tracked GMV" metric={data.metrics.trackedGmv} render={(v) => money(v, data.currency)} />
              <Stat label="Jobs" metric={data.metrics.jobCount} render={asNumber} />
              <Stat label="Jobs / week" metric={data.metrics.jobsPerWeek} render={asNumber} />
              <Stat label="Repeat rate" metric={data.metrics.repeatRatePercent} render={asPercent} />
              <Stat label="Revenue / route" metric={data.metrics.revenuePerRoute} render={(v) => money(v, data.currency)} />
              <Stat
                label="Quote→approval"
                metric={data.metrics.quoteApprovalConversionPercent}
                render={asPercent}
              />
              <Stat label="Median approval (h)" metric={data.metrics.medianQuoteApprovalHours} render={asNumber} />
              <Stat label="Damage-claim rate" metric={data.metrics.damageClaimRatePercent} render={asPercent} />
              <Stat label="Claim resolution (d)" metric={data.metrics.medianClaimResolutionDays} render={asNumber} />
              <Stat label="Active contracts" metric={data.metrics.activeContracts} render={asNumber} />
              <Stat label="CSAT" metric={data.metrics.csat} render={asNumber} />
            </StatGrid>
            <ArAgingView metric={data.metrics.arAging} currency={data.currency} />
          </>
        )}
      </SectionBody>
    </Card>
  );
}

function ArAgingView({ metric, currency }: { metric: Metric<ArAging>; currency: string }): React.ReactElement {
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold text-bb-ink">AR aging</h3>
      {metric.status !== 'ok' || metric.value === null ? (
        <p className="text-sm text-bb-sub">{metric.status === 'ok' ? 'No outstanding invoices in range.' : metric.note}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bb-line text-left text-bb-sub">
              <th className="py-2 pr-4 font-medium">Bucket</th>
              <th className="py-2 pr-4 font-medium">Outstanding</th>
              <th className="py-2 font-medium">Invoices</th>
            </tr>
          </thead>
          <tbody>
            {metric.value.buckets.map((b) => (
              <tr key={b.label} className="border-b border-bb-line last:border-0" data-testid={`ar-${b.label}`}>
                <td className="py-2 pr-4">{b.label}</td>
                <td className="py-2 pr-4">{money(b.amount, currency)}</td>
                <td className="py-2 text-bb-sub">{b.count}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4">{money(metric.value.totalOutstanding, currency)}</td>
              <td className="py-2" />
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

// ───────────────────────────── account scorecard ─────────────────────────────

function ScorecardSection({ range }: { range: Range }): React.ReactElement {
  const { client } = useSession();
  const [accountInput, setAccountInput] = useState('');
  const [accountId, setAccountId] = useState('');

  const state = useAsync<AccountScorecard | null>(
    () => (accountId ? client.accountScorecard(accountId, { from: toIso(range.from), to: toIso(range.to) }) : Promise.resolve(null)),
    [accountId, range.from, range.to],
  );

  return (
    <Card title="Account scorecard">
      <form
        className="mb-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setAccountId(accountInput.trim());
        }}
      >
        <Field label="Account id">
          <Input
            value={accountInput}
            onChange={(e) => setAccountInput(e.target.value)}
            placeholder="account uuid"
            aria-label="Account id"
          />
        </Field>
        <Button type="submit" disabled={!accountInput.trim()}>
          Load
        </Button>
      </form>

      {!accountId ? (
        <EmptyState message="Enter an account id to load its scorecard." />
      ) : state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="No scorecard." />
      ) : (
        <>
          <p className="mb-3 text-sm text-bb-sub">
            <span className="font-medium text-bb-ink">{state.data.accountName}</span> · {state.data.accountId}
          </p>
          <StatGrid>
            <Stat label="Loss rate" metric={state.data.metrics.lossRatePercent} render={asPercent} />
            <Stat label="On-time" metric={state.data.metrics.onTimePercent} render={asPercent} />
            <Stat
              label="Monthly spend"
              metric={state.data.metrics.monthlySpend}
              render={(v) => `${money(v.total, state.data!.currency)} · ${money(v.perMonth, state.data!.currency)}/mo`}
            />
            <Stat label="Cost-center split" metric={state.data.metrics.costCenterSplit} render={() => '—'} />
          </StatGrid>
        </>
      )}
    </Card>
  );
}

// ───────────────────────────── shared renderers ─────────────────────────────

const asPercent = (v: number): string => `${v}%`;
const asNumber = (v: number): string => String(v);

function StatGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

/** A single metric tile that honours the {@link Metric} wrapper — never invents a value. */
function Stat<T>({
  label,
  metric,
  render,
}: {
  label: string;
  metric: Metric<T>;
  render: (value: T) => string;
}): React.ReactElement {
  let body: React.ReactNode;
  if (metric.status === 'unavailable_in_phase_1') {
    body = <Badge tone="amber">Phase 2</Badge>;
  } else if (metric.status === 'error') {
    body = <Badge tone="red">Unavailable</Badge>;
  } else if (metric.value === null) {
    body = <span className="text-bb-sub">—</span>;
  } else {
    body = <span className="text-xl font-semibold text-bb-ink">{render(metric.value)}</span>;
  }

  return (
    <div className="rounded-lg border border-bb-line bg-white p-3" data-testid={`stat-${label}`} title={metric.note}>
      <div className="mb-1 text-xs font-medium text-bb-sub">{label}</div>
      {body}
      {metric.status === 'ok' && metric.rowCount !== null && (
        <div className="mt-1 text-[11px] text-bb-sub">n={metric.rowCount}</div>
      )}
    </div>
  );
}

/** Loading / error / empty / populated wrapper shared by the operational + commercial sections. */
function SectionBody<T>({
  state,
  children,
}: {
  state: { data: T | null; loading: boolean; error: string | null; reload: () => void };
  children: (data: T) => React.ReactNode;
}): React.ReactElement {
  if (state.loading) return <Loading />;
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data) return <EmptyState message="No data." />;
  return <>{children(state.data)}</>;
}
