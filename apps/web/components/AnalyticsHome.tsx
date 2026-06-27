'use client';

import React, { useState } from 'react';
import type {
  AccountScorecard,
  ArAging,
  CommercialAnalytics,
  Metric,
  OperationalAnalytics,
} from '@blue-bee/shared';
import { LineChart, Search } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { formatNumber, money } from '@/lib/format';
import { guardStopsPerHour, type RateGuard } from '@/lib/ratio';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Table,
  TableSkeleton,
  Td,
  Th,
  cn,
} from './ui';
import { RequireCapability } from './AppShell';
import { CostCenterSplitStat } from './CostCenters';

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
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Operational, commercial, and per-account read-only dashboards."
        actions={
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
        }
      />

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
            <Stat label="Stops / hour" metric={data.metrics.stopsPerHour} render={asNumber} guard={guardStopsPerHour} />
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
              <Stat label="Tracked GMV" metric={data.metrics.trackedGmv} render={(v) => money(v, data.currency)} mono />
              <Stat label="Jobs" metric={data.metrics.jobCount} render={asNumber} mono />
              <Stat label="Jobs / week" metric={data.metrics.jobsPerWeek} render={asNumber} mono />
              <Stat label="Repeat rate" metric={data.metrics.repeatRatePercent} render={asPercent} mono />
              <Stat label="Revenue / route" metric={data.metrics.revenuePerRoute} render={(v) => money(v, data.currency)} mono />
              <Stat
                label="Quote→approval"
                metric={data.metrics.quoteApprovalConversionPercent}
                render={asPercent}
                mono
              />
              <Stat label="Median approval (h)" metric={data.metrics.medianQuoteApprovalHours} render={asNumber} mono />
              <Stat label="Damage-claim rate" metric={data.metrics.damageClaimRatePercent} render={asPercent} mono />
              <Stat label="Claim resolution (d)" metric={data.metrics.medianClaimResolutionDays} render={asNumber} mono />
              <Stat label="Active contracts" metric={data.metrics.activeContracts} render={asNumber} mono />
              <Stat label="CSAT" metric={data.metrics.csat} render={asNumber} mono />
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
    <div className="mt-6">
      <h3 className="mb-3 text-subhead font-semibold text-ink">AR aging</h3>
      {metric.status !== 'ok' || metric.value === null ? (
        <p className="text-footnote text-secondary">{metric.status === 'ok' ? 'No outstanding invoices in range.' : metric.note}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Bucket</Th>
              <Th numeric>Outstanding</Th>
              <Th numeric>Invoices</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {metric.value.buckets.map((b) => (
              <tr key={b.label} data-testid={`ar-${b.label}`}>
                <Td>{b.label}</Td>
                <Td numeric>{money(b.amount, currency)}</Td>
                <Td numeric className="text-secondary">{b.count}</Td>
              </tr>
            ))}
            <tr className="border-t border-hairline font-semibold">
              <Td className="font-semibold">Total</Td>
              <Td numeric className="font-semibold">{money(metric.value.totalOutstanding, currency)}</Td>
              <Td numeric />
            </tr>
          </tbody>
        </Table>
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
        className="mb-5 flex items-end gap-2"
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
        <EmptyState
          icon={<Search className="h-5 w-5" strokeWidth={1.75} />}
          title="No account loaded"
          message="Enter an account id to load its scorecard."
        />
      ) : state.loading ? (
        <div className="space-y-4">
          <TableSkeleton rows={1} cols={2} />
          <StatGrid>
            {Array.from({ length: 4 }).map((_, i) => (
              <StatTile key={i} label="">
                <span className="block h-6 w-16 rounded-md bg-subtle" aria-hidden="true" />
              </StatTile>
            ))}
          </StatGrid>
        </div>
      ) : state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="No scorecard." />
      ) : (
        <>
          <p className="mb-4 text-footnote text-secondary">
            <span className="font-semibold text-ink">{state.data.accountName}</span> ·{' '}
            <span className="font-mono tabular-nums">{state.data.accountId}</span>
          </p>
          <StatGrid>
            <Stat label="Loss rate" metric={state.data.metrics.lossRatePercent} render={asPercent} />
            <Stat label="On-time" metric={state.data.metrics.onTimePercent} render={asPercent} />
            <Stat
              label="Monthly spend"
              metric={state.data.metrics.monthlySpend}
              render={(v) => `${money(v.total, state.data!.currency)} · ${money(v.perMonth, state.data!.currency)}/mo`}
              mono
            />
            <StatTile label="Cost-center split" title="The real per-centre split for this period, from the cost-centre report.">
              <CostCenterSplitStat accountId={state.data.accountId} from={state.data.range.from} to={state.data.range.to} />
            </StatTile>
          </StatGrid>
        </>
      )}
    </Card>
  );
}

// ───────────────────────────── shared renderers ─────────────────────────────

const asPercent = (v: number): string => `${v}%`;
const asNumber = (v: number): string => formatNumber(v);

function StatGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

/** The shared tile chrome for a metric (also reused by the loading placeholder). */
function StatTile({
  label,
  title,
  children,
  footer,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="flex flex-col rounded-card border border-hairline bg-surface p-4 shadow-e1 transition duration-fast ease-daylight hover:shadow-e2"
      data-testid={`stat-${label}`}
      title={title}
    >
      <div className="mb-1.5 text-caption font-medium uppercase tracking-wide text-tertiary">{label}</div>
      {children}
      {footer}
    </div>
  );
}

/**
 * A single metric tile that honours the {@link Metric} wrapper — never invents a value. An optional
 * `guard` adds a display-side plausibility check for rate metrics: a computed-but-implausible figure
 * (collapsed denominator) renders an honest "n/a (insufficient data)" with the raw value disclosed in
 * the tooltip, instead of an absurd number. The data-layer source of truth is unchanged.
 */
function Stat<T>({
  label,
  metric,
  render,
  guard,
  mono,
}: {
  label: string;
  metric: Metric<T>;
  render: (value: T) => string;
  guard?: (value: T) => RateGuard;
  mono?: boolean;
}): React.ReactElement {
  let body: React.ReactNode;
  let tooltip = metric.note;
  if (metric.status === 'unavailable_in_phase_1') {
    body = <Badge tone="amber">Phase 2</Badge>;
  } else if (metric.status === 'error') {
    body = <Badge tone="red">Unavailable</Badge>;
  } else if (metric.value === null) {
    body = <span className="text-title3 font-semibold text-tertiary">—</span>;
  } else {
    const checked = guard?.(metric.value);
    if (checked && !checked.plausible) {
      tooltip = checked.reason;
      body = (
        <span className="text-headline font-semibold text-secondary">
          n/a <span className="text-caption font-normal">(insufficient data)</span>
        </span>
      );
    } else {
      body = (
        <span className={cn('text-title2 font-semibold text-ink', mono && 'font-mono tabular-nums')}>{render(metric.value)}</span>
      );
    }
  }

  return (
    <StatTile
      label={label}
      title={tooltip}
      footer={
        metric.status === 'ok' && metric.rowCount !== null ? (
          <div className="mt-1.5 font-mono text-caption tabular-nums text-tertiary">n={metric.rowCount}</div>
        ) : null
      }
    >
      {body}
    </StatTile>
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
  if (state.loading)
    return (
      <StatGrid>
        {Array.from({ length: 8 }).map((_, i) => (
          <StatTile key={i} label="">
            <span className="block h-7 w-20 rounded-md bg-subtle" aria-hidden="true" />
          </StatTile>
        ))}
      </StatGrid>
    );
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data)
    return (
      <EmptyState
        icon={<LineChart className="h-5 w-5" strokeWidth={1.75} />}
        title="Nothing in this window"
        message="No analytics rows for the selected date range. Try widening the dates."
      />
    );
  return <>{children(state.data)}</>;
}
