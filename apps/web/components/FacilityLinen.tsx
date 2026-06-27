'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ServiceVertical, type CostCenterView, type PackToParLine, type ParLevelView, type ServiceCatalogItem, type SoilPickupView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Select, SkeletonText, StatusPill, Table, TableSkeleton, Td, Th } from './ui';
import { RequireCapability } from './AppShell';
import { Boxes, Layers, Package, Plus, Truck, X } from 'lucide-react';

const apiErr = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);
const dt = (iso: string): string => {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

/** A cost-centre label ("Site-level" for the NULL/site bucket). */
function ccLabel(costCenterId: string | null, centres: CostCenterView[]): string {
  if (!costCenterId) return 'Site-level';
  const cc = centres.find((c) => c.id === costCenterId);
  return cc ? `${cc.code} — ${cc.name}` : costCenterId.slice(0, 8);
}

/**
 * Facility-linen par loop (Track-B care homes, PRD §2.2/§5.2/§B3). The rental/par half of the care-home
 * vertical: par levels per site/cost-centre, the pack-to-par load sheet (par vs on-hand → what to pack),
 * and soiled-cart pickup confirmation. Server-authoritative + RBAC-gated; the account's own staff see only
 * their own sites. Site is chosen via the account → site pickers (reuses the Track-A reads).
 */
export function FacilityLinen(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.facilityLinen(me)}>
      <FacilityLinenInner />
    </RequireCapability>
  );
}

function FacilityLinenInner(): React.ReactElement {
  const { client } = useSession();
  const accounts = useAsync(() => client.listAccounts({ limit: 100 }), []);
  const [accountId, setAccountId] = useState('');
  useEffect(() => {
    const first = accounts.data?.accounts[0];
    if (!accountId && first) setAccountId(first.id);
  }, [accounts.data, accountId]);

  const account = useAsync(() => (accountId ? client.getAccount(accountId) : Promise.resolve(null)), [accountId]);
  const sites = account.data?.sites ?? [];
  const [siteId, setSiteId] = useState('');
  useEffect(() => {
    const first = sites[0];
    if (first && !sites.some((s) => s.id === siteId)) setSiteId(first.id);
  }, [account.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const centresState = useAsync(() => (accountId ? client.listCostCenters(accountId) : Promise.resolve(null)), [accountId]);
  const centres = useMemo(() => centresState.data?.costCenters ?? [], [centresState.data]);

  const servicesState = useAsync(() => client.getServices(), []);
  const linenSkus = useMemo<ServiceCatalogItem[]>(() => (servicesState.data?.services ?? []).filter((s) => s.vertical === ServiceVertical.LINEN), [servicesState.data]);

  return (
    <div className="space-y-6 animate-fade-up">
      <PageHeader title="Facility linen" subtitle="Care-home bulk linen — par levels per wing, soiled-cart pickup confirmation, and pack-to-par load sheets." />

      <Card title="Scope" subtitle="Pick a care-home account and site (a wing). Par and on-hand are tracked per site / cost-centre.">
        {accounts.loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <SkeletonText lines={2} />
            <SkeletonText lines={2} />
          </div>
        ) : accounts.error ? (
          <ErrorBox message={accounts.error} onRetry={accounts.reload} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
                {(accounts.data?.accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Site / wing">
              <Select value={siteId} onChange={(e) => setSiteId(e.target.value)} aria-label="Site" disabled={!sites.length}>
                {sites.length === 0 && <option value="">No sites</option>}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Card>

      {siteId ? (
        <>
          <PackToParCard siteId={siteId} centres={centres} />
          <ParManagementCard siteId={siteId} centres={centres} linenSkus={linenSkus} />
          <SoilPickupsCard siteId={siteId} centres={centres} linenSkus={linenSkus} />
        </>
      ) : (
        <EmptyState icon={<Boxes className="h-5 w-5" strokeWidth={1.75} />} title="No site selected" message="Pick a care-home account and site to manage facility linen." />
      )}
    </div>
  );
}

// ───────────────────────────── (1) pack-to-par load sheet ─────────────────────────────

function PackToParCard({ siteId, centres }: { siteId: string; centres: CostCenterView[] }): React.ReactElement {
  const { client, me } = useSession();
  const canGenerate = can.linenOps(me);
  const canAdjust = can.stockAdjust(me);
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const sheet = useAsync(() => client.packToPar(siteId), [siteId, nonce]);
  const manifests = useAsync(() => client.listPackToParManifests(siteId, { limit: 5 }), [siteId, nonce]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState<PackToParLine | null>(null);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await client.generatePackToPar(siteId, {});
      reload();
    } catch (e) {
      setErr(apiErr(e, 'Could not generate the load sheet.'));
    } finally {
      setBusy(false);
    }
  };

  const lines = sheet.data?.lines ?? [];
  return (
    <Card
      title="Pack-to-par load sheet"
      subtitle="What to pack to refill each SKU to par: gap = par − on-hand (never below zero). Generate a load sheet to snapshot it."
      actions={canGenerate ? <Button size="sm" onClick={() => void generate()} loading={busy} disabled={!lines.length} data-testid="ptp-generate"><Package className="h-4 w-4" aria-hidden="true" /> Generate load sheet</Button> : undefined}
    >
      {err && <p className="mb-3 rounded-btn border border-danger-tint bg-danger-tint px-3 py-2 text-footnote font-medium text-danger-strong" role="alert">{err}</p>}

      {!sheet.data && sheet.loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : sheet.error ? (
        <ErrorBox message={sheet.error} onRetry={sheet.reload} />
      ) : lines.length === 0 ? (
        <EmptyState icon={<Layers className="h-5 w-5" strokeWidth={1.75} />} title="No par set yet" message="Set a par level below to see the pack-to-par gap." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th>Cost-centre</Th>
              <Th numeric>Par</Th>
              <Th numeric>On-hand</Th>
              <Th numeric>To pack</Th>
              {canAdjust && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody className="stagger">
            {lines.map((l) => (
              <tr key={`${l.costCenterId ?? 'site'}-${l.serviceId}`} className="border-b border-hairline last:border-0 hover:bg-subtle" data-testid={`ptp-${l.costCenterId ?? 'site'}-${l.serviceId}`}>
                <Td className="font-medium text-ink">{l.sku}</Td>
                <Td className={l.costCenterId ? '' : 'text-secondary'}>{ccLabel(l.costCenterId, centres)}</Td>
                <Td numeric className="tabular-nums">{l.par}</Td>
                <Td numeric className="tabular-nums">{l.onHand}</Td>
                <Td numeric>{l.gap > 0 ? <Badge tone="amber">{l.gap}</Badge> : <span className="text-secondary tabular-nums">0</span>}</Td>
                {canAdjust && (
                  <Td>
                    <button className="rounded px-1 text-footnote font-semibold text-primary underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:shadow-focus" onClick={() => setAdjusting(l)} data-testid={`ptp-adjust-${l.costCenterId ?? 'site'}-${l.serviceId}`}>
                      Adjust on-hand
                    </button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-hairline" data-testid="ptp-total">
              <Td className="font-semibold text-ink">Total to pack</Td>
              <Td />
              <Td />
              <Td />
              <Td numeric className="font-bold text-ink">{sheet.data?.totalGap ?? 0}</Td>
              {canAdjust && <Td />}
            </tr>
          </tfoot>
        </Table>
      )}

      {lines.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-3">
          <p className="mb-2 text-footnote font-semibold text-secondary">Generated load sheets</p>
          {manifests.loading && !manifests.data ? (
            <SkeletonText lines={2} />
          ) : manifests.error ? (
            <ErrorBox message={manifests.error} onRetry={manifests.reload} />
          ) : manifests.data && manifests.data.manifests.length > 0 ? (
            <ul className="space-y-1">
              {manifests.data.manifests.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-footnote" data-testid={`ptp-sheet-${m.id}`}>
                  <span className="text-secondary">{dt(m.generatedAt)}</span>
                  <span className="tabular-nums text-ink">{m.totalGap} pieces · {m.lines.length} SKUs</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-footnote text-tertiary">No load sheets generated yet.</p>
          )}
        </div>
      )}

      {adjusting && <AdjustOnHandModal siteId={siteId} line={adjusting} onClose={() => setAdjusting(null)} onSaved={() => { setAdjusting(null); reload(); }} />}
    </Card>
  );
}

function AdjustOnHandModal({ siteId, line, onClose, onSaved }: { siteId: string; line: PackToParLine; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const { client } = useSession();
  const [onHand, setOnHand] = useState(String(line.onHand));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.adjustLinenStock(siteId, { serviceId: line.serviceId, ...(line.costCenterId ? { costCenterId: line.costCenterId } : {}), onHand: Number(onHand) });
      onSaved();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not adjust on-hand.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Adjust on-hand — ${line.sku}`} onClose={onClose} size="sm">
      <form className="space-y-3" onSubmit={save}>
        <p className="text-footnote text-secondary">Records an append-only adjustment so on-hand lands exactly on the new count.</p>
        <Field label="On-hand (pieces)">
          <Input type="number" min={0} value={onHand} onChange={(e) => setOnHand(e.target.value)} required data-testid="adjust-onhand-input" />
        </Field>
        {err && <p className="text-footnote font-medium text-danger-strong" role="alert">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={onHand.trim() === ''} data-testid="adjust-onhand-save">Save</Button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── (2) par management ─────────────────────────────

const BLANK_PAR = { serviceId: '', costCenterId: '', targetQty: '' };

function ParManagementCard({ siteId, centres, linenSkus }: { siteId: string; centres: CostCenterView[]; linenSkus: ServiceCatalogItem[] }): React.ReactElement {
  const { client, me } = useSession();
  const canWrite = can.parWrite(me);
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const list = useAsync(() => client.listParLevels(siteId), [siteId, nonce]);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(BLANK_PAR);
  const set = (k: keyof typeof BLANK_PAR, v: string): void => setForm((f) => ({ ...f, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<ParLevelView | null>(null);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.setParLevel(siteId, { serviceId: form.serviceId, ...(form.costCenterId ? { costCenterId: form.costCenterId } : {}), targetQty: Number(form.targetQty) });
      setShowCreate(false);
      setForm(BLANK_PAR);
      reload();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not set the par level.'));
    } finally {
      setBusy(false);
    }
  };

  const actions = canWrite ? (
    <Button size="sm" onClick={() => setShowCreate((v) => !v)} data-testid="par-new">
      {showCreate ? 'Cancel' : <><Plus className="h-4 w-4" aria-hidden="true" /> Set par</>}
    </Button>
  ) : undefined;

  const rows = list.data?.parLevels ?? [];
  return (
    <Card title="Par levels" subtitle="The clean-linen target per SKU, per site or wing (cost-centre). Set by account management." actions={actions}>
      {err && <p className="mb-3 rounded-btn border border-danger-tint bg-danger-tint px-3 py-2 text-footnote font-medium text-danger-strong" role="alert">{err}</p>}

      {canWrite && showCreate && (
        <form className="mb-4 grid gap-3 rounded-card border border-hairline bg-subtle p-4 sm:grid-cols-2 lg:grid-cols-4" onSubmit={create}>
          <Field label="Linen SKU">
            <Select value={form.serviceId} onChange={(e) => set('serviceId', e.target.value)} required aria-label="Linen SKU">
              <option value="">Select a SKU…</option>
              {linenSkus.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Cost-centre" helper="Optional — site-level if unset">
            <Select value={form.costCenterId} onChange={(e) => set('costCenterId', e.target.value)}>
              <option value="">Site-level</option>
              {centres.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Target (pieces)">
            <Input type="number" min={0} value={form.targetQty} onChange={(e) => set('targetQty', e.target.value)} required data-testid="par-target" />
          </Field>
          <div className="flex items-end">
            <Button type="submit" loading={busy} disabled={!form.serviceId || form.targetQty.trim() === ''} data-testid="par-submit">Set par</Button>
          </div>
        </form>
      )}

      {!list.data && list.loading ? (
        <TableSkeleton rows={3} cols={canWrite ? 4 : 3} />
      ) : !list.data && list.error ? (
        <ErrorBox message={list.error} onRetry={list.reload} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Layers className="h-5 w-5" strokeWidth={1.75} />} title="No par levels yet" message="Set a par level to start tracking what each wing should hold." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>SKU</Th>
              <Th>Cost-centre</Th>
              <Th numeric>Target</Th>
              {canWrite && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody className="stagger">
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-subtle" data-testid={`par-${p.id}`}>
                <Td className="font-medium text-ink">{p.sku}</Td>
                <Td className={p.costCenterId ? '' : 'text-secondary'}>{ccLabel(p.costCenterId, centres)}</Td>
                <Td numeric className="tabular-nums font-medium">{p.targetQty}</Td>
                {canWrite && (
                  <Td>
                    <button className="rounded px-1 text-footnote font-semibold text-primary underline-offset-2 transition-colors duration-fast hover:underline focus-visible:outline-none focus-visible:shadow-focus" onClick={() => setEditing(p)} data-testid={`par-edit-${p.id}`}>Edit</button>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && <EditParModal par={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </Card>
  );
}

function EditParModal({ par, onClose, onSaved }: { par: ParLevelView; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const { client } = useSession();
  const [targetQty, setTargetQty] = useState(String(par.targetQty));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.updateParLevel(par.id, { targetQty: Number(targetQty) });
      onSaved();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not update the par level.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit par — ${par.sku}`} onClose={onClose} size="sm">
      <form className="space-y-3" onSubmit={save}>
        <Field label="Target (pieces)">
          <Input type="number" min={0} value={targetQty} onChange={(e) => setTargetQty(e.target.value)} required data-testid="par-edit-target" />
        </Field>
        {err && <p className="text-footnote font-medium text-danger-strong" role="alert">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy} disabled={targetQty.trim() === ''} data-testid="par-edit-save">Save</Button>
        </div>
      </form>
    </Modal>
  );
}

// ───────────────────────────── (3) soiled-cart pickups ─────────────────────────────

function SoilPickupsCard({ siteId, centres, linenSkus }: { siteId: string; centres: CostCenterView[]; linenSkus: ServiceCatalogItem[] }): React.ReactElement {
  const { client, me } = useSession();
  const canRecord = can.linenOps(me);
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const list = useAsync(() => client.listSoilPickups(siteId, { limit: 20 }), [siteId, nonce]);
  const [showRecord, setShowRecord] = useState(false);

  const actions = canRecord ? (
    <Button size="sm" onClick={() => setShowRecord((v) => !v)} data-testid="pickup-new">
      {showRecord ? 'Cancel' : <><Truck className="h-4 w-4" aria-hidden="true" /> Record pickup</>}
    </Button>
  ) : undefined;

  const pickups = list.data?.pickups ?? [];
  return (
    <Card title="Soiled-cart pickups" subtitle="Confirm a soiled-cart collection (carts, weight, soiled counts). Each pickup decrements on-hand." actions={actions}>
      {canRecord && showRecord && (
        <RecordPickupForm siteId={siteId} centres={centres} linenSkus={linenSkus} onDone={() => { setShowRecord(false); reload(); }} />
      )}

      {!list.data && list.loading ? (
        <TableSkeleton rows={3} cols={5} />
      ) : !list.data && list.error ? (
        <ErrorBox message={list.error} onRetry={list.reload} />
      ) : pickups.length === 0 ? (
        <EmptyState icon={<Truck className="h-5 w-5" strokeWidth={1.75} />} title="No pickups yet" message="No soiled-cart pickups recorded for this site." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Cost-centre</Th>
              <Th numeric>Carts</Th>
              <Th numeric>Weight (kg)</Th>
              <Th numeric>Pieces</Th>
            </tr>
          </thead>
          <tbody className="stagger">
            {pickups.map((p: SoilPickupView) => (
              <tr key={p.id} className="border-b border-hairline last:border-0 hover:bg-subtle" data-testid={`pickup-${p.id}`}>
                <Td className="text-secondary">{dt(p.occurredAt)}</Td>
                <Td className={p.costCenterId ? '' : 'text-secondary'}>{ccLabel(p.costCenterId, centres)}</Td>
                <Td numeric className="tabular-nums">{p.cartCount}</Td>
                <Td numeric className="tabular-nums">{p.weightKg ?? '—'}</Td>
                <Td numeric><StatusPill tone="blue">{p.totalPieces}</StatusPill></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function RecordPickupForm({ siteId, centres, linenSkus, onDone }: { siteId: string; centres: CostCenterView[]; linenSkus: ServiceCatalogItem[]; onDone: () => void }): React.ReactElement {
  const { client } = useSession();
  const [cartCount, setCartCount] = useState('1');
  const [bagCount, setBagCount] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [lines, setLines] = useState<{ serviceId: string; qty: string }[]>([{ serviceId: '', qty: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setLine = (i: number, k: 'serviceId' | 'qty', v: string): void => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const addLine = (): void => setLines((ls) => [...ls, { serviceId: '', qty: '' }]);
  const removeLine = (i: number): void => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls));

  const validLines = lines.filter((l) => l.serviceId && Number(l.qty) > 0);
  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.recordSoilPickup(siteId, {
        cartCount: Number(cartCount),
        ...(bagCount.trim() ? { bagCount: Number(bagCount) } : {}),
        ...(weightKg.trim() ? { weightKg: Number(weightKg) } : {}),
        ...(costCenterId ? { costCenterId } : {}),
        lines: validLines.map((l) => ({ serviceId: l.serviceId, qty: Number(l.qty) })),
      });
      onDone();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not record the pickup.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mb-4 space-y-3 rounded-card border border-hairline bg-subtle p-4" onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Carts">
          <Input type="number" min={1} value={cartCount} onChange={(e) => setCartCount(e.target.value)} required data-testid="pickup-carts" />
        </Field>
        <Field label="Bags" helper="Optional">
          <Input type="number" min={0} value={bagCount} onChange={(e) => setBagCount(e.target.value)} />
        </Field>
        <Field label="Weight (kg)" helper="Optional">
          <Input type="number" min={0} step="0.01" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} data-testid="pickup-weight" />
        </Field>
        <Field label="Cost-centre" helper="Optional">
          <Select value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)}>
            <option value="">Site-level</option>
            {centres.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="space-y-2">
        <p className="text-footnote font-semibold text-secondary">Soiled counts (per SKU)</p>
        {lines.map((l, i) => (
          <div key={i} className="flex items-end gap-2" data-testid={`pickup-line-${i}`}>
            <Field label={`SKU ${i + 1}`} className="flex-1">
              <Select value={l.serviceId} onChange={(e) => setLine(i, 'serviceId', e.target.value)}>
                <option value="">Select a SKU…</option>
                {linenSkus.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label={`Qty ${i + 1}`} className="w-28">
              <Input type="number" min={1} value={l.qty} onChange={(e) => setLine(i, 'qty', e.target.value)} />
            </Field>
            <button type="button" className="mb-1 rounded p-2 text-secondary hover:text-danger focus-visible:outline-none focus-visible:shadow-focus" onClick={() => removeLine(i)} aria-label="Remove line">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={addLine}><Plus className="h-4 w-4" aria-hidden="true" /> Add SKU</Button>
      </div>

      {err && <p className="text-footnote font-medium text-danger-strong" role="alert">{err}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={validLines.length === 0 || cartCount.trim() === ''} data-testid="pickup-submit">Record pickup</Button>
      </div>
    </form>
  );
}
