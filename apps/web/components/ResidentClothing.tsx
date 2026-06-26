'use client';

import React, { useEffect, useState } from 'react';
import {
  GarmentStatus,
  type GarmentView,
  type LostFoundItemView,
  type ResidentClothingView,
  type ResidentView,
} from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, shortDate } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, Select } from './ui';
import { RequireCapability } from './AppShell';

const apiErr = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

function garmentTone(s: GarmentStatus): 'blue' | 'amber' | 'green' | 'red' {
  if (s === GarmentStatus.GARMENT_ENROLLED) return 'blue';
  if (s === GarmentStatus.DELIVERED_TO_RESIDENT) return 'green';
  if (s === GarmentStatus.LOST_FOUND_POOL) return 'red';
  return 'amber';
}

const BUCKET_LABELS: { key: keyof ResidentClothingView['buckets']; label: string }[] = [
  { key: 'enrolled', label: 'Enrolled' },
  { key: 'inProcess', label: 'In process' },
  { key: 'returned', label: 'Returned' },
  { key: 'lostFound', label: 'Lost & found' },
];

/**
 * Resident personal-clothing view (Track-B care homes, PRD A4.2). Look up a resident → their garments
 * in the four buckets (enrolled / in-process / returned / lost & found), plus the site's lost & found
 * pool with a reconcile action (B3.3). Server-authoritative + RBAC-gated; resident reads are audited
 * server-side (§12.2). Site is chosen via the account → site pickers (reuses the Track-A reads).
 */
export function ResidentClothing(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.residents(me)}>
      <ResidentClothingInner />
    </RequireCapability>
  );
}

function ResidentClothingInner(): React.ReactElement {
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-bb-ink">Resident clothing</h1>
        <p className="mt-1 text-sm text-bb-sub">
          Care-home personal garments — enrolled, in process, returned, and lost &amp; found. Resident
          reads are audited.
        </p>
      </div>

      <Card>
        {accounts.loading ? (
          <Loading />
        ) : accounts.error ? (
          <ErrorBox message={accounts.error} onRetry={accounts.reload} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Account">
              <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
                {(accounts.data?.accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Site">
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

      {siteId ? <SitePanel siteId={siteId} /> : <EmptyState message="Pick an account and site to view residents." />}
    </div>
  );
}

function SitePanel({ siteId }: { siteId: string }): React.ReactElement {
  const { client, me } = useSession();
  const canOps = can.garmentOps(me);
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const residents = useAsync(() => client.listResidents(siteId), [siteId, nonce]);
  const [residentId, setResidentId] = useState('');
  useEffect(() => {
    const list = residents.data?.residents ?? [];
    const first = list[0];
    if (first && !list.some((r) => r.id === residentId)) setResidentId(first.id);
    if (!list.length) setResidentId('');
  }, [residents.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Residents">
        {!residents.data && residents.loading ? (
          <Loading />
        ) : !residents.data && residents.error ? (
          <ErrorBox message={residents.error} onRetry={reload} />
        ) : !residents.data || residents.data.residents.length === 0 ? (
          <EmptyState title="No residents" message="Enroll residents at this site to track their clothing." />
        ) : (
          <ul className="space-y-1">
            {residents.data.residents.map((r) => (
              <li key={r.id}>
                <button
                  data-testid={`resident-${r.id}`}
                  onClick={() => setResidentId(r.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                    r.id === residentId ? 'bg-bb-blueSoft text-bb-blue' : 'hover:bg-bb-line/40 text-bb-ink'
                  }`}
                >
                  <span className="font-medium">{r.name}</span>
                  {r.room && <span className="text-bb-sub"> · Room {r.room}</span>}
                  {r.status !== 'ACTIVE' && <Badge tone="neutral">{humanize(r.status)}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-4 lg:col-span-2">
        {residentId ? (
          <ClothingPanel residentId={residentId} reloadKey={nonce} />
        ) : (
          <Card title="Garments">
            <EmptyState message="Select a resident to see their garments." />
          </Card>
        )}
        <LostFoundPanel siteId={siteId} residents={residents.data?.residents ?? []} canOps={canOps} reloadKey={nonce} onReconciled={reload} />
      </div>
    </div>
  );
}

function GarmentRow({ g }: { g: GarmentView }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-bb-line py-1.5 last:border-0" data-testid={`garment-${g.id}`}>
      <div className="min-w-0">
        <div className="truncate text-sm text-bb-ink">{g.description ?? 'Garment'}</div>
        <div className="font-mono text-[11px] text-bb-sub">{g.tagCode ?? '—'}</div>
      </div>
      <Badge tone={garmentTone(g.garmentStatus)}>{humanize(g.garmentStatus)}</Badge>
    </div>
  );
}

function ClothingPanel({ residentId, reloadKey }: { residentId: string; reloadKey: number }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync<ResidentClothingView>(() => client.getResidentClothing(residentId), [residentId, reloadKey]);
  return (
    <Card title={state.data ? `Garments — ${state.data.resident.name}` : 'Garments'}>
      {!state.data && state.loading ? (
        <Loading />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="No resident." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {BUCKET_LABELS.map(({ key, label }) => {
            const garments = state.data!.buckets[key];
            return (
              <div key={key} className="rounded-lg border border-bb-line p-3" data-testid={`bucket-${key}`}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-bb-sub">{label}</span>
                  <span className="text-xs text-bb-sub">{garments.length}</span>
                </div>
                {garments.length === 0 ? (
                  <p className="text-xs text-bb-sub">—</p>
                ) : (
                  garments.map((g) => <GarmentRow key={g.id} g={g} />)
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function LostFoundPanel({
  siteId,
  residents,
  canOps,
  reloadKey,
  onReconciled,
}: {
  siteId: string;
  residents: ResidentView[];
  canOps: boolean;
  reloadKey: number;
  onReconciled: () => void;
}): React.ReactElement {
  const { client } = useSession();
  const state = useAsync(() => client.getLostFoundPool(siteId), [siteId, reloadKey]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const reconcile = async (lf: LostFoundItemView): Promise<void> => {
    const residentId = pick[lf.id] || lf.candidateResidentId || residents[0]?.id;
    if (!residentId) return;
    setBusy(lf.id);
    setErr(null);
    try {
      await client.reconcileLostFound(lf.id, { residentId });
      onReconciled();
    } catch (e) {
      setErr(apiErr(e, 'Could not reconcile the garment.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="Lost & found">
      {err && <p className="mb-2 text-sm text-red-700">{err}</p>}
      {!state.data && state.loading ? (
        <Loading />
      ) : !state.data && state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data || state.data.lostFound.length === 0 ? (
        <EmptyState title="Nothing in lost & found" message="Unmatched garments on return sort land here for reconciliation." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-bb-line text-left text-bb-sub">
              <th className="py-2 pr-4 font-medium">Garment</th>
              <th className="py-2 pr-4 font-medium">Tag</th>
              <th className="py-2 pr-4 font-medium">Candidate</th>
              <th className="py-2 pr-4 font-medium">Found</th>
              {canOps && <th className="py-2 font-medium">Reconcile to</th>}
            </tr>
          </thead>
          <tbody>
            {state.data.lostFound.map((lf) => (
              <tr key={lf.id} className="border-b border-bb-line last:border-0" data-testid={`lostfound-${lf.id}`}>
                <td className="py-2 pr-4">{lf.notes ?? 'Garment'}</td>
                <td className="py-2 pr-4 font-mono text-[11px] text-bb-sub">{lf.tagCode ?? '—'}</td>
                <td className="py-2 pr-4 text-bb-sub">{lf.candidateResidentName ?? '—'}</td>
                <td className="py-2 pr-4 text-bb-sub">{shortDate(lf.createdAt)}</td>
                {canOps && (
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <Select
                        value={pick[lf.id] ?? lf.candidateResidentId ?? ''}
                        onChange={(e) => setPick((p) => ({ ...p, [lf.id]: e.target.value }))}
                        aria-label={`Reconcile ${lf.id} to`}
                      >
                        <option value="">Select resident…</option>
                        {residents.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                            {r.room ? ` · ${r.room}` : ''}
                          </option>
                        ))}
                      </Select>
                      <Button loading={busy === lf.id} onClick={() => void reconcile(lf)}>
                        Reconcile
                      </Button>
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
