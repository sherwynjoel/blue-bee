'use client';

import React, { useState } from 'react';
import {
  RoleScope,
  RoleType,
  type AdminUser,
  type AuditLogEntry,
  type NotificationConfigView,
} from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, shortDate } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading, Select } from './ui';
import { RequireCapability } from './AppShell';
import type { VehicleView } from '@/lib/types';

/**
 * Admin console (Increment 16, PRD Epic B6.2 / §17.3) — OWNER-only: users & roles, fleet & devices,
 * a read-only notification-config viewer, and the read-only audit-log viewer. Server-authoritative:
 * every mutation is independently OWNER-gated + audited server-side; this UI just calls the endpoint
 * and re-reads. Honest states (loading/empty/error) on every section.
 */
export function AdminHome(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.admin(me)}>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-bb-ink">Admin</h1>
        <UsersRolesCard />
        <FleetDevicesCard />
        <NotificationConfigCard />
        <AuditLogCard />
      </div>
    </RequireCapability>
  );
}

// ───────────────────────────── users & roles ─────────────────────────────

const ALL_ROLES = Object.values(RoleType);

function UsersRolesCard(): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const state = useAsync(() => client.adminListUsers(), [nonce]);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<RoleType>(RoleType.CSR);
  const [scope, setScope] = useState<RoleScope>(RoleScope.ORG);
  const [scopeId, setScopeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const reload = () => setNonce((n) => n + 1);

  const assign = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.adminAssignRole(userId, {
        role,
        scope,
        scopeId: scope === RoleScope.ORG ? null : scopeId.trim() || null,
      });
      setScopeId('');
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not assign the role.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (u: AdminUser, roleId: string): Promise<void> => {
    setErr(null);
    try {
      await client.adminRevokeRole(u.id, roleId);
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not revoke the role.');
    }
  };

  return (
    <Card title="Users & roles">
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorBox message={state.error} onRetry={reload} />
      ) : !state.data || state.data.users.length === 0 ? (
        <EmptyState message="No users." />
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bb-line text-left text-bb-sub">
                <th className="py-2 pr-4 font-medium">User</th>
                <th className="py-2 pr-4 font-medium">Contact</th>
                <th className="py-2 font-medium">Roles</th>
              </tr>
            </thead>
            <tbody>
              {state.data.users.map((u) => (
                <tr key={u.id} className="border-b border-bb-line last:border-0" data-testid={`user-${u.id}`}>
                  <td className="py-2 pr-4 font-medium text-bb-ink">{u.name}</td>
                  <td className="py-2 pr-4 text-bb-sub">{u.phone ?? u.email ?? '—'}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 ? (
                        <span className="text-bb-sub">—</span>
                      ) : (
                        u.roles.map((r) => (
                          <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                            {humanize(r.role)}
                            {r.scope !== 'ORG' && <span className="text-blue-500">·{humanize(r.scope)}</span>}
                            <button
                              aria-label={`Revoke ${r.role} from ${u.name}`}
                              className="ml-0.5 font-bold text-blue-500 hover:text-blue-900"
                              onClick={() => void revoke(u, r.id)}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-bb-line pt-4" onSubmit={assign}>
            <Field label="User">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Assign user">
                <option value="">Select…</option>
                {state.data.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role">
              <Select value={role} onChange={(e) => setRole(e.target.value as RoleType)} aria-label="Assign role">
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {humanize(r)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Scope">
              <Select value={scope} onChange={(e) => setScope(e.target.value as RoleScope)} aria-label="Assign scope">
                {Object.values(RoleScope).map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
            </Field>
            {scope !== RoleScope.ORG && (
              <Field label="Scope id">
                <Input value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder="account/site uuid" aria-label="Scope id" />
              </Field>
            )}
            <Button type="submit" loading={busy} disabled={!userId}>
              Assign role
            </Button>
          </form>
          {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
        </>
      )}
    </Card>
  );
}

// ───────────────────────────── fleet & devices ─────────────────────────────

function FleetDevicesCard(): React.ReactElement {
  const { client } = useSession();
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);
  const vehicles = useAsync<VehicleView[]>(() => client.listVehicles(), []);
  const drivers = useAsync(() => client.adminListDrivers(), [nonce]);
  const devices = useAsync(() => client.adminListDevices(), [nonce]);
  const users = useAsync(() => client.adminListUsers(), []);
  const [err, setErr] = useState<string | null>(null);

  // device add form
  const [dUser, setDUser] = useState('');
  const [dPlatform, setDPlatform] = useState('IOS');
  const [dToken, setDToken] = useState('');
  const [busy, setBusy] = useState(false);

  const addDevice = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await client.adminCreateDevice({ userId: dUser, platform: dPlatform as never, pushToken: dToken.trim() || undefined });
      setDToken('');
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not add the device.');
    } finally {
      setBusy(false);
    }
  };

  const removeDevice = async (id: string): Promise<void> => {
    setErr(null);
    try {
      await client.adminDeleteDevice(id);
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not delete the device.');
    }
  };

  const assignVehicle = async (driverId: string, vehicleId: string): Promise<void> => {
    setErr(null);
    try {
      await client.adminAssignDriverVehicle(driverId, { defaultVehicleId: vehicleId || null });
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not assign the vehicle.');
    }
  };

  return (
    <Card title="Fleet & devices">
      {err && <p className="mb-2 text-sm text-red-700">{err}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* drivers + vehicle assignment */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-bb-ink">Drivers · default vehicle</h3>
          {drivers.loading || vehicles.loading ? (
            <Loading />
          ) : drivers.error ? (
            <ErrorBox message={drivers.error} onRetry={reload} />
          ) : !drivers.data || drivers.data.drivers.length === 0 ? (
            <EmptyState message="No drivers." />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {drivers.data.drivers.map((d) => (
                  <tr key={d.id} className="border-b border-bb-line last:border-0" data-testid={`driver-${d.id}`}>
                    <td className="py-2 pr-4 text-bb-ink">{d.name ?? d.userId.slice(0, 8)}</td>
                    <td className="py-2">
                      <Select
                        aria-label={`Vehicle for ${d.name ?? d.id}`}
                        value={d.defaultVehicleId ?? ''}
                        onChange={(e) => void assignVehicle(d.id, e.target.value)}
                      >
                        <option value="">— none —</option>
                        {(vehicles.data ?? []).map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.label}
                          </option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* devices */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-bb-ink">Devices</h3>
          {devices.loading ? (
            <Loading />
          ) : devices.error ? (
            <ErrorBox message={devices.error} onRetry={reload} />
          ) : !devices.data || devices.data.devices.length === 0 ? (
            <EmptyState message="No devices." />
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {devices.data.devices.map((dv) => (
                  <tr key={dv.id} className="border-b border-bb-line last:border-0" data-testid={`device-${dv.id}`}>
                    <td className="py-2 pr-4 text-bb-ink">{dv.userName ?? dv.userId.slice(0, 8)}</td>
                    <td className="py-2 pr-4 text-bb-sub">{dv.platform}</td>
                    <td className="py-2 pr-4 font-mono text-xs text-bb-sub">{dv.pushTokenMasked ?? '—'}</td>
                    <td className="py-2 text-right">
                      <button className="text-xs text-red-700 hover:underline" onClick={() => void removeDevice(dv.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={addDevice}>
            <Field label="User">
              <Select value={dUser} onChange={(e) => setDUser(e.target.value)} aria-label="Device user">
                <option value="">Select…</option>
                {(users.data?.users ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Platform">
              <Select value={dPlatform} onChange={(e) => setDPlatform(e.target.value)} aria-label="Device platform">
                <option value="IOS">IOS</option>
                <option value="ANDROID">ANDROID</option>
                <option value="WEB">WEB</option>
              </Select>
            </Field>
            <Field label="Push token (optional)">
              <Input value={dToken} onChange={(e) => setDToken(e.target.value)} placeholder="ExponentPushToken[…]" aria-label="Push token" />
            </Field>
            <Button type="submit" loading={busy} disabled={!dUser}>
              Add device
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────────── notification config (read-only) ─────────────────────────────

function NotificationConfigCard(): React.ReactElement {
  const { client } = useSession();
  const state = useAsync<NotificationConfigView>(() => client.adminNotificationConfig(), []);
  return (
    <Card title="Notification config">
      {state.loading ? (
        <Loading />
      ) : state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="No config." />
      ) : (
        <>
          <p className="mb-3 text-xs text-bb-sub">{state.data.note}</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bb-line text-left text-bb-sub">
                <th className="py-2 pr-4 font-medium">Event</th>
                <th className="py-2 pr-4 font-medium">Channels</th>
                <th className="py-2 font-medium">Urgent</th>
              </tr>
            </thead>
            <tbody>
              {state.data.events.map((ev) => (
                <tr key={ev.event} className="border-b border-bb-line last:border-0" data-testid={`notif-${ev.event}`}>
                  <td className="py-2 pr-4 font-mono text-xs">{ev.event}</td>
                  <td className="py-2 pr-4">{ev.channels.join(', ')}</td>
                  <td className="py-2">{ev.urgent ? <Badge tone="amber">urgent</Badge> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

// ───────────────────────────── audit-log viewer ─────────────────────────────

function AuditLogCard(): React.ReactElement {
  const { client } = useSession();
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [applied, setApplied] = useState<{ entity: string; action: string }>({ entity: '', action: '' });
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = React.useCallback(
    async (reset: boolean): Promise<void> => {
      setLoading(true);
      setErr(null);
      try {
        const res = await client.adminAuditLogs({
          entity: applied.entity || undefined,
          action: applied.action || undefined,
          cursor: reset ? undefined : cursor ?? undefined,
          limit: 20,
        });
        setEntries((prev) => (reset ? res.entries : [...prev, ...res.entries]));
        setCursor(res.nextCursor);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : 'Could not load the audit log.');
      } finally {
        setLoading(false);
      }
    },
    [client, applied, cursor],
  );

  React.useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  return (
    <Card title="Audit log">
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied({ entity: entity.trim(), action: action.trim() });
        }}
      >
        <Field label="Entity">
          <Input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="e.g. UserRole" aria-label="Filter entity" />
        </Field>
        <Field label="Action">
          <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. ROLE_ASSIGNED" aria-label="Filter action" />
        </Field>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      {err ? (
        <ErrorBox message={err} onRetry={() => void load(true)} />
      ) : loading && entries.length === 0 ? (
        <Loading />
      ) : entries.length === 0 ? (
        <EmptyState message="No audit entries." />
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bb-line text-left text-bb-sub">
                <th className="py-2 pr-4 font-medium">When</th>
                <th className="py-2 pr-4 font-medium">Entity</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 font-medium">Actor</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((a) => (
                <tr key={a.id} className="border-b border-bb-line last:border-0" data-testid={`audit-${a.id}`}>
                  <td className="py-2 pr-4 text-bb-sub">{shortDate(a.at)}</td>
                  <td className="py-2 pr-4">{a.entity}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{a.action}</td>
                  <td className="py-2 text-bb-sub">{a.actorName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {cursor && (
            <div className="mt-3">
              <Button variant="secondary" loading={loading} onClick={() => void load(false)}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
