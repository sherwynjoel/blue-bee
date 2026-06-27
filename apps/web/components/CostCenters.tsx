'use client';

import React, { useState } from 'react';
import { CostCenterKind, type CostCenterView, type InvoiceView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { Building2, CheckCircle2, Download, Layers, Plus } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { formatNumber, humanize, money } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
  Skeleton,
  StatusPill,
  Table,
  TableSkeleton,
  Td,
  Th,
  type Tone,
} from './ui';

// ───────────────────────────── shared helpers ─────────────────────────────

const apiErr = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);
/** A date-input "YYYY-MM-DD" → ISO instant at UTC midnight (or undefined when blank). */
const toIso = (d: string): string | undefined => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : undefined);

const KIND_OPTIONS = Object.values(CostCenterKind);
const KIND_TONE: Record<string, Tone> = { WING: 'blue', FLOOR: 'blue', AMENITY: 'green', FUNDING: 'amber', OTHER: 'neutral' };
function kindBadge(kind: CostCenterKind | null): React.ReactElement {
  if (!kind) return <span className="text-tertiary">—</span>;
  return <Badge tone={KIND_TONE[kind] ?? 'neutral'}>{humanize(kind)}</Badge>;
}

/** Cents-exact sum of fixed-2 dollar strings (presentation reconciliation — never re-derives amounts). */
function sumCents(values: string[]): number {
  return values.reduce((acc, v) => acc + Math.round(Number(v) * 100), 0);
}
const fromCents = (cents: number): string => (cents / 100).toFixed(2);

/** The first day of the current UTC month → the first of next month (the default report/billing window). */
function defaultMonthWindow(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  return { from: iso(first), to: iso(next) };
}

/** Browser-only file download from an in-memory blob (SSR-safe; no-op without a DOM). */
function triggerDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

interface SiteOption {
  id: string;
  name: string;
}

// ───────────────────────────── (1) management ─────────────────────────────

const BLANK_CREATE = { code: '', name: '', kind: CostCenterKind.WING as CostCenterKind, siteId: '' };

/**
 * Cost-centre management for one account (PRD §B4.1) — list (code · name · kind · status), FINANCE-gated
 * create, and per-centre rename / re-classify / activate-deactivate (`PATCH /v1/cost-centers/:id`). Reads
 * are OWNER/FINANCE/DISPATCHER/CSR; writes are OWNER/FINANCE only (the server enforces independently).
 */
export function CostCenterManagementCard({ accountId, sites = [] }: { accountId: string; sites?: SiteOption[] }): React.ReactElement {
  const { client, me } = useSession();
  const canWrite = can.finance(me);
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const list = useAsync(() => client.listCostCenters(accountId), [accountId, nonce]);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_CREATE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<CostCenterView | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]): void => setForm((f) => ({ ...f, [k]: v }));

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.createCostCenter(accountId, {
        code: form.code.trim(),
        name: form.name.trim(),
        kind: form.kind,
        ...(form.siteId ? { siteId: form.siteId } : {}),
      });
      setShowCreate(false);
      setForm(BLANK_CREATE);
      reload();
    } catch (e2) {
      // 409 duplicate code / 400 bad site / 404 cross-org → server authority, surfaced verbatim.
      setErr(apiErr(e2, 'Could not create the cost centre.'));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (cc: CostCenterView): Promise<void> => {
    setErr(null);
    try {
      await client.updateCostCenter(cc.id, { active: !cc.active });
      reload();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not update the cost centre.'));
    }
  };

  const actions = canWrite ? (
    <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
      {showCreate ? (
        'Cancel'
      ) : (
        <>
          <Plus className="h-4 w-4" aria-hidden="true" /> New cost centre
        </>
      )}
    </Button>
  ) : undefined;

  return (
    <Card title="Cost centres" subtitle="Split this account's billing by wing, floor, amenity, or funding source." actions={actions}>
      {err && (
        <p className="mb-3 rounded-btn border border-danger-tint bg-danger-tint px-3 py-2 text-footnote font-medium text-danger-strong" role="alert">
          {err}
        </p>
      )}

      {canWrite && showCreate && (
        <form className="mb-4 grid gap-3 rounded-card border border-hairline bg-subtle p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={create}>
          <Field label="Code" helper="Unique per account">
            <Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="TWR-A" aria-label="Code" maxLength={40} required />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Tower A" aria-label="Name" maxLength={160} required />
          </Field>
          <Field label="Kind">
            <Select value={form.kind} onChange={(e) => set('kind', e.target.value as CostCenterKind)} aria-label="Kind">
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {humanize(k)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Site" helper="Optional">
            <Select value={form.siteId} onChange={(e) => set('siteId', e.target.value)} aria-label="Site">
              <option value="">All / unscoped</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" loading={busy} disabled={!form.code.trim() || !form.name.trim()}>
              Create cost centre
            </Button>
          </div>
        </form>
      )}

      {!list.data && list.loading ? (
        <TableSkeleton rows={3} cols={canWrite ? 5 : 4} />
      ) : !list.data && list.error ? (
        <ErrorBox message={list.error} onRetry={reload} />
      ) : !list.data || list.data.costCenters.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-5 w-5" strokeWidth={1.75} />}
          title="No cost centres yet"
          message="No cost centres yet — add one to split this account's billing."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th>Status</Th>
              {canWrite && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody className="stagger">
            {list.data.costCenters.map((cc) => (
              <tr key={cc.id} className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`cc-${cc.id}`}>
                <Td className="font-mono tabular-nums font-medium text-ink">{cc.code}</Td>
                <Td>{cc.name}</Td>
                <Td>{kindBadge(cc.kind)}</Td>
                <Td>{cc.active ? <StatusPill tone="green">Active</StatusPill> : <StatusPill tone="neutral">Inactive</StatusPill>}</Td>
                {canWrite && (
                  <Td>
                    <div className="flex gap-3">
                      <button
                        className="rounded px-1 text-footnote font-semibold text-primary underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        onClick={() => setEditing(cc)}
                        data-testid={`cc-edit-${cc.id}`}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded px-1 text-footnote font-semibold text-secondary underline-offset-2 transition-colors duration-fast hover:text-ink hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                        onClick={() => void toggleActive(cc)}
                        data-testid={`cc-toggle-${cc.id}`}
                      >
                        {cc.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <EditCostCenterModal
          costCenter={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

/** Rename / re-classify a cost centre (`code` is immutable). FINANCE-gated by the parent. */
function EditCostCenterModal({ costCenter, onClose, onSaved }: { costCenter: CostCenterView; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const { client } = useSession();
  const [name, setName] = useState(costCenter.name);
  const [kind, setKind] = useState<CostCenterKind>(costCenter.kind ?? CostCenterKind.OTHER);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.updateCostCenter(costCenter.id, { name: name.trim(), kind });
      onSaved();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not save the cost centre.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit ${costCenter.code}`} onClose={onClose} size="sm">
      <form className="space-y-3" onSubmit={save}>
        <Field label="Code" helper="The stable key — immutable.">
          <Input value={costCenter.code} aria-label="Code" disabled />
        </Field>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={160} required />
        </Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as CostCenterKind)} aria-label="Kind">
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {humanize(k)}
              </option>
            ))}
          </Select>
        </Field>
        {err && <p className="text-footnote font-medium text-danger-strong" role="alert">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── (4) period report + CSV ─────────────────────────────

/**
 * The per-cost-centre period report (`GET …/cost-centers/report`) + the real CSV export
 * (`…/report.csv`). Account-scoped, OWNER/FINANCE/DISPATCHER/CSR. Date range is [from, to); the table
 * reconciles to a grand-total row, and "Download CSV" streams the server's real attachment bytes.
 */
export function CostCenterReportCard({ accountId }: { accountId: string }): React.ReactElement {
  const { client } = useSession();
  const win = defaultMonthWindow();
  const [from, setFrom] = useState(win.from);
  const [to, setTo] = useState(win.to);
  const [downloading, setDownloading] = useState(false);
  const [dlErr, setDlErr] = useState<string | null>(null);

  const validRange = Boolean(from && to && from < to);
  const report = useAsync(
    () => (validRange ? client.getCostCenterReport(accountId, { from: toIso(from)!, to: toIso(to)! }) : Promise.resolve(null)),
    [accountId, from, to],
  );

  const download = async (): Promise<void> => {
    if (!validRange) return;
    setDownloading(true);
    setDlErr(null);
    try {
      const { blob, filename } = await client.downloadCostCenterReportCsv(accountId, { from: toIso(from)!, to: toIso(to)! });
      triggerDownload(blob, filename);
    } catch (e) {
      setDlErr(apiErr(e, 'Could not download the CSV.'));
    } finally {
      setDownloading(false);
    }
  };

  const rows = report.data?.rows ?? [];
  const hasActivity = rows.some((r) => r.orderCount > 0 || Number(r.total) !== 0);

  return (
    <Card
      title="Cost-centre report"
      subtitle="Per-centre totals over a period (orders by created-at), with an explicit Unassigned bucket."
      actions={
        <Button size="sm" variant="secondary" onClick={() => void download()} loading={downloading} disabled={!validRange || downloading} data-testid="cc-report-csv">
          <Download className="h-4 w-4" aria-hidden="true" /> Download CSV
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Report from" />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Report to" />
        </Field>
      </div>

      {dlErr && (
        <p className="mb-3 rounded-btn border border-danger-tint bg-danger-tint px-3 py-2 text-footnote font-medium text-danger-strong" role="alert">
          {dlErr}
        </p>
      )}

      {!validRange ? (
        <EmptyState icon={<Layers className="h-5 w-5" strokeWidth={1.75} />} title="Pick a date range" message="Choose a start date strictly before the end date." />
      ) : !report.data && report.loading ? (
        <TableSkeleton rows={4} cols={7} />
      ) : report.error ? (
        <ErrorBox message={report.error} onRetry={report.reload} />
      ) : !report.data || !hasActivity ? (
        <EmptyState icon={<Layers className="h-5 w-5" strokeWidth={1.75} />} title="No activity" message="No cost-centre activity in this period." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th numeric>Orders</Th>
              <Th numeric>Subtotal</Th>
              <Th numeric>HST</Th>
              <Th numeric>Total</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {rows.map((r) => (
              <tr
                key={r.costCenterId ?? 'unassigned'}
                className="border-b border-hairline transition-colors duration-fast hover:bg-subtle"
                data-testid={`ccr-${r.costCenterId ?? 'unassigned'}`}
              >
                <Td className="font-mono tabular-nums font-medium text-ink">{r.code}</Td>
                <Td className={r.costCenterId ? '' : 'text-secondary'}>{r.name}</Td>
                <Td>{kindBadge(r.kind)}</Td>
                <Td numeric className="text-secondary">{formatNumber(r.orderCount)}</Td>
                <Td numeric>{money(r.subtotal, report.data!.currency)}</Td>
                <Td numeric>{money(r.tax, report.data!.currency)}</Td>
                <Td numeric className="font-semibold">{money(r.total, report.data!.currency)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-hairline" data-testid="ccr-total">
              <Td className="font-semibold text-ink">Total</Td>
              <Td />
              <Td />
              <Td numeric className="font-semibold text-secondary">
                {formatNumber(rows.reduce((n, r) => n + r.orderCount, 0))}
              </Td>
              <Td numeric className="font-semibold">{money(report.data!.grandTotal.subtotal, report.data!.currency)}</Td>
              <Td numeric className="font-semibold">{money(report.data!.grandTotal.tax, report.data!.currency)}</Td>
              <Td numeric className="font-bold text-ink">{money(report.data!.grandTotal.total, report.data!.currency)}</Td>
            </tr>
          </tfoot>
        </Table>
      )}
    </Card>
  );
}

/** The "Cost centres" account tab — management + the period report/CSV, stacked. */
export function CostCentersTab({ accountId, sites = [] }: { accountId: string; sites?: SiteOption[] }): React.ReactElement {
  return (
    <div className="space-y-6">
      <CostCenterManagementCard accountId={accountId} sites={sites} />
      <CostCenterReportCard accountId={accountId} />
    </div>
  );
}

// ───────────────────────────── (3) split-invoice breakdown ─────────────────────────────

/**
 * The PRD §A5.2 split-billing breakdown for a batch invoice — one row per cost centre (+ an explicit
 * Unassigned bucket), with a grand-total footer that VISIBLY reconciles (cents-exact) to the invoice
 * total. Renders nothing for an unsplit/single-order invoice (empty `costCenterBreakdown`).
 */
export function CostCenterBreakdownTable({ invoice }: { invoice: InvoiceView }): React.ReactElement | null {
  const breakdown = Array.isArray(invoice.costCenterBreakdown) ? invoice.costCenterBreakdown : [];
  if (breakdown.length === 0) return null;

  const subtotalCents = sumCents(breakdown.map((b) => b.subtotal));
  const taxCents = sumCents(breakdown.map((b) => b.tax));
  const totalCents = sumCents(breakdown.map((b) => b.total));
  const invoiceTotalCents = Math.round(Number(invoice.total) * 100);
  const reconciles = totalCents === invoiceTotalCents;

  return (
    <div className="mt-4 border-t border-hairline pt-4" data-testid="cost-center-breakdown">
      <div className="mb-2 flex items-center gap-1.5 text-footnote font-semibold text-ink">
        <Layers className="h-4 w-4 text-tertiary" aria-hidden="true" strokeWidth={2} /> Cost-centre split
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Centre</Th>
            <Th numeric>Subtotal</Th>
            <Th numeric>HST</Th>
            <Th numeric>Total</Th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((b) => (
            <tr key={b.costCenterId ?? 'unassigned'} className="border-b border-hairline last:border-0" data-testid={`ccb-${b.costCenterId ?? 'unassigned'}`}>
              <Td className="font-mono tabular-nums font-medium text-ink">{b.code}</Td>
              <Td className={b.costCenterId ? '' : 'text-secondary'}>{b.name}</Td>
              <Td numeric>{money(b.subtotal, invoice.currency)}</Td>
              <Td numeric>{money(b.tax, invoice.currency)}</Td>
              <Td numeric className="font-semibold">{money(b.total, invoice.currency)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-hairline" data-testid="ccb-total">
            <Td className="font-semibold text-ink">Total</Td>
            <Td />
            <Td numeric className="font-semibold">{money(fromCents(subtotalCents), invoice.currency)}</Td>
            <Td numeric className="font-semibold">{money(fromCents(taxCents), invoice.currency)}</Td>
            <Td numeric className="font-bold text-ink">{money(fromCents(totalCents), invoice.currency)}</Td>
          </tr>
        </tfoot>
      </Table>
      {reconciles ? (
        <p className="mt-2 flex items-center gap-1.5 text-caption font-medium text-success-strong" data-testid="ccb-reconciles">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={2} /> Reconciles to the invoice total ({money(invoice.total, invoice.currency)}).
        </p>
      ) : (
        <p className="mt-2 text-caption font-medium text-danger-strong" role="alert">
          Split totals {money(fromCents(totalCents), invoice.currency)} do not match the invoice total {money(invoice.total, invoice.currency)}.
        </p>
      )}
    </div>
  );
}

// ───────────────────────────── (2) order attribution picker ─────────────────────────────

interface CostCenterPickerProps {
  orderId: string;
  accountId: string;
  /** The order's current attribution (null = Unassigned). */
  value: string | null;
  /** Pre-loaded centres (account-scoped) — pass to avoid an N-row fetch in a list; omit to self-load. */
  costCenters?: CostCenterView[];
  /** Mirrors the server gate: OWNER/FINANCE/DISPATCHER/CSR may attribute; others see a read-only badge. */
  canWrite: boolean;
  /** Called with the new attribution after a successful PUT (so the parent can reflect it). */
  onChanged?: (costCenterId: string | null) => void;
  /** `inline` = compact (table cell); `field` = labelled control (detail card). */
  variant?: 'inline' | 'field';
}

/**
 * Attribute an order to a cost centre (`PUT /v1/orders/:id/cost-center`, with an "Unassigned" option).
 * Reflects the current attribution and surfaces server 4xx (cross-account centre → 400) via ApiError.
 * Write-gated for OWNER/FINANCE/DISPATCHER/CSR; everyone else gets a read-only reflection.
 */
export function CostCenterPicker({ orderId, accountId, value, costCenters, canWrite, onChanged, variant = 'field' }: CostCenterPickerProps): React.ReactElement {
  const { client } = useSession();
  const self = useAsync(() => (costCenters ? Promise.resolve({ costCenters }) : client.listCostCenters(accountId)), [accountId, costCenters]);
  const centres = costCenters ?? self.data?.costCenters ?? [];

  const [current, setCurrent] = useState<string | null>(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Keep in sync if the order reloads with a different attribution.
  React.useEffect(() => setCurrent(value), [value]);

  const byId = (id: string | null): CostCenterView | undefined => (id ? centres.find((c) => c.id === id) : undefined);

  const change = async (next: string): Promise<void> => {
    const costCenterId = next || null;
    const prev = current;
    setCurrent(costCenterId);
    setBusy(true);
    setErr(null);
    try {
      await client.attachOrderCostCenter(orderId, { costCenterId });
      onChanged?.(costCenterId);
    } catch (e) {
      setCurrent(prev); // server authority — revert the optimistic change
      setErr(apiErr(e, 'Could not set the cost centre.'));
    } finally {
      setBusy(false);
    }
  };

  if (!canWrite) {
    const cc = byId(current);
    return cc ? (
      <span className="inline-flex items-center gap-1.5">
        <span className="font-mono tabular-nums text-footnote text-ink">{cc.code}</span>
        {kindBadge(cc.kind)}
      </span>
    ) : (
      <span className="text-tertiary">Unassigned</span>
    );
  }

  const label = (
    <Select
      value={current ?? ''}
      onChange={(e) => void change(e.target.value)}
      disabled={busy || (!costCenters && self.loading)}
      aria-label="Cost centre"
      className={variant === 'inline' ? 'h-8 py-1 text-footnote' : ''}
    >
      <option value="">Unassigned</option>
      {centres.map((c) => (
        <option key={c.id} value={c.id}>
          {c.code} — {c.name}
          {c.active ? '' : ' (inactive)'}
        </option>
      ))}
    </Select>
  );

  if (variant === 'inline') {
    return (
      <div className="min-w-[12rem]">
        {label}
        {err && <p className="mt-1 text-caption font-medium text-danger-strong" role="alert">{err}</p>}
      </div>
    );
  }
  return (
    <Field label="Cost centre" error={err ?? undefined} helper="Attribute this order's billing to a cost centre.">
      {label}
    </Field>
  );
}

// ───────────────────────────── (5) scorecard split tile ─────────────────────────────

/**
 * The wired account-scorecard "Cost-center split" tile (replaces the Phase-2 placeholder). Reads the
 * REAL per-centre report for the scorecard's window and shows the amount split across cost centres +
 * the centre count — or an honest "—" / "No split this period" when nothing is attributed. Never a
 * fabricated number (honesty firewall). The parent supplies the tile chrome + label.
 */
export function CostCenterSplitStat({ accountId, from, to }: { accountId: string; from: string; to: string }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync(() => client.getCostCenterReport(accountId, { from, to }), [accountId, from, to]);

  if (!state.data && state.loading) return <Skeleton className="h-7 w-20" />;
  if (state.error || !state.data) {
    return (
      <span className="text-tertiary" title={state.error ?? undefined}>
        —
      </span>
    );
  }

  const real = state.data.rows.filter((r) => r.costCenterId !== null && (r.orderCount > 0 || Number(r.total) !== 0));
  if (real.length === 0) {
    return (
      <div>
        <span className="text-tertiary">—</span>
        <div className="mt-1 text-caption text-tertiary">No split this period</div>
      </div>
    );
  }

  const total = fromCents(sumCents(real.map((r) => r.total)));
  return (
    <div data-testid="cc-split-real">
      <span className="text-title2 font-mono font-semibold tabular-nums text-ink">{money(total, state.data.currency)}</span>
      <div className="mt-1 text-caption text-tertiary">
        {formatNumber(real.length)} cost centre{real.length === 1 ? '' : 's'}
      </div>
    </div>
  );
}
