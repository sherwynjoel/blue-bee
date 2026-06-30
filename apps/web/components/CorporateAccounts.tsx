'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import type { CorporateAccountView, CorporateBuildingView, RateCardItemView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { ArrowLeft, Landmark, MapPin, Plus, KeyRound } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  StatusPill,
  Table,
  TableSkeleton,
  Td,
  Th,
  type Tone,
} from './ui';
import { RequireCapability } from './AppShell';

const apiErr = (e: unknown, fallback: string): string => (e instanceof ApiError ? e.message : fallback);

/** Where the resolved rate came from → a tone (corporate override = green; default = blue; base = neutral). */
const SOURCE_TONE: Record<string, Tone> = { account_override: 'green', account_list: 'green', default_list: 'blue', service_base: 'neutral' };

// ───────────────────────────── list + create ─────────────────────────────

/**
 * Corporate accounts directory (Inc-15) — corporate accounts (members order + pay individually but are
 * priced on the account's rate card), with their building + member counts and join-code status, plus a
 * finance-gated "new corporate account" create. OWNER/FINANCE only (mirrors the server @Roles).
 */
export function CorporateHome(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.corporate(me)}>
      <CorporateHomeInner />
    </RequireCapability>
  );
}

function CorporateHomeInner(): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const state = useAsync(() => client.listCorporateAccounts(), [nonce]);

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.createCorporateAccount({ name: name.trim() });
      setName('');
      setNonce((n) => n + 1);
    } catch (e2) {
      setErr(apiErr(e2, 'Could not create the corporate account.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader title="Corporate accounts" subtitle="Buildings & employers whose members pay individually but are priced on the account's rate card." />

      <Card title="New corporate account" subtitle="A BUSINESS account; members are billed per order.">
        <form onSubmit={create} className="flex flex-wrap items-end gap-3" data-testid="corp-create-form">
          <div className="min-w-[18rem] flex-1">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maple District Towers" required />
            </Field>
          </div>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            <Plus className="h-4 w-4" strokeWidth={2} /> Create
          </Button>
        </form>
        {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
      </Card>

      <Card padded={false} className="p-5">
        {state.loading ? (
          <TableSkeleton rows={4} cols={5} />
        ) : state.error ? (
          <ErrorBox message={state.error} onRetry={state.reload} />
        ) : !state.data || state.data.accounts.length === 0 ? (
          <EmptyState icon={<Landmark className="h-5 w-5" strokeWidth={1.75} />} title="No corporate accounts" message="Create one above to set up its buildings and rate card." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th numeric>Buildings</Th>
                <Th numeric>Members</Th>
                <Th>Join code</Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {state.data.accounts.map((a) => (
                <CorporateRow key={a.id} account={a} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function CorporateRow({ account: a }: { account: CorporateAccountView }): React.ReactElement {
  return (
    <tr className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`corp-${a.id}`}>
      <Td>
        <Link href={`/corporate/${a.id}`} className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded">
          {a.name}
        </Link>
      </Td>
      <Td numeric className="text-secondary">{a.buildingCount}</Td>
      <Td numeric className="text-secondary">{a.memberCount}</Td>
      <Td>{a.joinCode ? <Badge tone="blue">{a.joinCode}</Badge> : <span className="text-tertiary">—</span>}</Td>
    </tr>
  );
}

// ───────────────────────────── detail (buildings + rate card + join code) ─────────────────────────────

export function CorporateDetail({ accountId }: { accountId: string }): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.corporate(me)}>
      <CorporateDetailInner accountId={accountId} />
    </RequireCapability>
  );
}

function CorporateDetailInner({ accountId }: { accountId: string }): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const reload = (): void => setNonce((n) => n + 1);
  const account = useAsync(() => client.getCorporateAccount(accountId), [accountId, nonce]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link href="/corporate" className="inline-flex items-center gap-1.5 text-footnote font-medium text-secondary transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:shadow-focus rounded">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Corporate
        </Link>
      </div>
      <PageHeader title={account.data?.name ?? 'Corporate account'} subtitle="Members pay individually; orders are priced on this account's rate card." />
      {account.error ? (
        <ErrorBox message={account.error} onRetry={account.reload} />
      ) : (
        <>
          <JoinCodeCard accountId={accountId} account={account.data} onChanged={reload} />
          <BuildingsCard accountId={accountId} />
          <RateCardEditor accountId={accountId} />
        </>
      )}
    </div>
  );
}

// ── join code ──

function JoinCodeCard({ accountId, account, onChanged }: { accountId: string; account: CorporateAccountView | null; onChanged: () => void }): React.ReactElement {
  const { client } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await client.generateJoinCode(accountId, {});
      onChanged();
    } catch (e2) {
      setErr(apiErr(e2, 'Could not generate a join code.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Join code" subtitle="Members redeem this code to be priced on the rate card (the TTC path).">
      <div className="flex flex-wrap items-center gap-3">
        {account?.joinCode ? (
          <Badge tone="blue"><span className="font-mono text-base tracking-wide" data-testid="corp-join-code">{account.joinCode}</span></Badge>
        ) : (
          <span className="text-tertiary">No code yet.</span>
        )}
        <Button variant="secondary" size="sm" loading={busy} onClick={() => void generate()}>
          <KeyRound className="h-4 w-4" strokeWidth={2} /> {account?.joinCode ? 'Regenerate' : 'Generate'} code
        </Button>
        {account?.joinCodeExpiresAt && <span className="text-sm text-tertiary">Expires {new Date(account.joinCodeExpiresAt).toLocaleDateString()}</span>}
      </div>
      {err && <p className="mt-2 text-sm text-danger" role="alert">{err}</p>}
    </Card>
  );
}

// ── buildings ──

const BLANK_BUILDING = { name: '', address: '', lat: '', lng: '', matchRadiusM: '300' };

function BuildingsCard({ accountId }: { accountId: string }): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const list = useAsync(() => client.listCorporateBuildings(accountId), [accountId, nonce]);
  const [form, setForm] = useState(BLANK_BUILDING);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: string): void => setForm((f) => ({ ...f, [k]: v }));

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.createCorporateBuilding(accountId, {
        name: form.name.trim(),
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
        geo: { lat: Number(form.lat), lng: Number(form.lng) },
        matchRadiusM: Number(form.matchRadiusM),
      });
      setForm(BLANK_BUILDING);
      setNonce((n) => n + 1);
    } catch (e2) {
      setErr(apiErr(e2, 'Could not add the building.'));
    } finally {
      setBusy(false);
    }
  };

  const ready = form.name.trim() && form.lat !== '' && form.lng !== '' && form.matchRadiusM !== '';

  return (
    <Card title="Buildings" subtitle="A booking whose service address falls inside a building's radius is priced on this account (the condo path).">
      <form onSubmit={create} className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6" data-testid="corp-building-form">
        <div className="lg:col-span-2"><Field label="Name"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Tower 1" required /></Field></div>
        <div className="lg:col-span-2"><Field label="Address"><Input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="200 Bay St" /></Field></div>
        <Field label="Latitude"><Input value={form.lat} onChange={(e) => set('lat', e.target.value)} type="number" step="any" placeholder="43.6489" required /></Field>
        <Field label="Longitude"><Input value={form.lng} onChange={(e) => set('lng', e.target.value)} type="number" step="any" placeholder="-79.3801" required /></Field>
        <Field label="Match radius (m)"><Input value={form.matchRadiusM} onChange={(e) => set('matchRadiusM', e.target.value)} type="number" min="10" max="5000" required /></Field>
        <div className="flex items-end">
          <Button type="submit" loading={busy} disabled={!ready}><Plus className="h-4 w-4" strokeWidth={2} /> Add</Button>
        </div>
      </form>
      {err && <p className="mb-2 text-sm text-danger" role="alert">{err}</p>}
      {list.loading ? (
        <TableSkeleton rows={2} cols={4} />
      ) : list.error ? (
        <ErrorBox message={list.error} onRetry={list.reload} />
      ) : !list.data || list.data.buildings.length === 0 ? (
        <EmptyState icon={<MapPin className="h-5 w-5" strokeWidth={1.75} />} title="No buildings" message="Add a building above with its address point + match radius." />
      ) : (
        <Table>
          <thead><tr><Th>Building</Th><Th>Address</Th><Th>Point (lat, lng)</Th><Th numeric>Radius (m)</Th></tr></thead>
          <tbody>
            {list.data.buildings.map((b) => (
              <BuildingRow key={b.id} b={b} />
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function BuildingRow({ b }: { b: CorporateBuildingView }): React.ReactElement {
  return (
    <tr className="border-b border-hairline last:border-0" data-testid={`corp-building-${b.id}`}>
      <Td className="font-medium text-primary">{b.name}</Td>
      <Td className="text-secondary">{b.address ?? '—'}</Td>
      <Td className="text-secondary font-mono text-xs">{b.geo ? `${b.geo.lat.toFixed(5)}, ${b.geo.lng.toFixed(5)}` : '—'}</Td>
      <Td numeric className="text-secondary">{b.matchRadiusM ?? '—'}</Td>
    </tr>
  );
}

// ── rate card ──

function RateCardEditor({ accountId }: { accountId: string }): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const card = useAsync(() => client.getRateCard(accountId), [accountId, nonce]);
  const [err, setErr] = useState<string | null>(null);

  return (
    <Card title="Rate card" subtitle="Per-pound (LB) wash & fold and per-item (ITEM) dry-clean prices. The resolved rate is what an order actually pays.">
      {err && <p className="mb-2 text-sm text-danger" role="alert">{err}</p>}
      {card.loading ? (
        <TableSkeleton rows={3} cols={5} />
      ) : card.error ? (
        <ErrorBox message={card.error} onRetry={card.reload} />
      ) : !card.data || card.data.items.length === 0 ? (
        <EmptyState title="No services" message="No catalog services to price yet." />
      ) : (
        <Table>
          <thead>
            <tr><Th>Service</Th><Th>Unit</Th><Th numeric>Default</Th><Th>Account rate</Th><Th>Resolved</Th></tr>
          </thead>
          <tbody>
            {card.data.items.map((it) => (
              <RateRow key={it.serviceId} accountId={accountId} item={it} onSaved={() => setNonce((n) => n + 1)} onError={setErr} />
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function RateRow({ accountId, item, onSaved, onError }: { accountId: string; item: RateCardItemView; onSaved: () => void; onError: (m: string | null) => void }): React.ReactElement {
  const { client } = useSession();
  const [draft, setDraft] = useState(item.accountRate ?? '');
  const [busy, setBusy] = useState(false);
  const dirty = draft.trim() !== '' && Number(draft) > 0 && draft !== (item.accountRate ?? '');

  const save = async (): Promise<void> => {
    setBusy(true);
    onError(null);
    try {
      await client.setRateCardItem(accountId, item.serviceId, { rate: Number(draft) });
      onSaved();
    } catch (e2) {
      onError(apiErr(e2, 'Could not set the rate.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-hairline last:border-0" data-testid={`rate-${item.serviceId}`}>
      <Td className="font-medium text-primary">{item.serviceName}</Td>
      <Td><Badge tone="neutral">{item.unit}</Badge></Td>
      <Td numeric className="text-tertiary">{item.defaultRate ?? item.baseRate}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} type="number" step="any" min="0" className="w-28" aria-label={`${item.serviceName} rate`} />
          <Button size="sm" variant="secondary" loading={busy} disabled={!dirty} onClick={() => void save()}>Save</Button>
        </div>
      </Td>
      <Td>
        <span data-testid={`resolved-${item.serviceId}`}>
          <StatusPill tone={SOURCE_TONE[item.source] ?? 'neutral'}>
            {item.effectiveRate} · {humanize(item.source)}
          </StatusPill>
        </span>
      </Td>
    </tr>
  );
}
