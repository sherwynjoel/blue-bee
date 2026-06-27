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
import { Smartphone, Truck, Users, X } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, shortDate } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  PageHeader,
  Select,
  StatusPill,
  Table,
  TableSkeleton,
  Td,
  Th,
} from './ui';
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
      <div className="space-y-6">
        <PageHeader title="Admin" subtitle="Users & roles, fleet, devices, and the read-only config + audit viewers." />
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
        <TableSkeleton rows={4} cols={3} />
      ) : state.error ? (
        <ErrorBox message={state.error} onRetry={reload} />
      ) : !state.data || state.data.users.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" strokeWidth={1.75} />} title="No users yet" message="No users." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Contact</Th>
                <Th>Roles</Th>
              </tr>
            </thead>
            <tbody className="stagger divide-y divide-hairline">
              {state.data.users.map((u) => (
                <tr key={u.id} data-testid={`user-${u.id}`}>
                  <Td className="font-medium">{u.name}</Td>
                  <Td className="text-secondary">{u.phone ?? u.email ?? '—'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {u.roles.length === 0 ? (
                        <span className="text-tertiary">—</span>
                      ) : (
                        u.roles.map((r) => (
                          <span
                            key={r.id}
                            className="inline-flex items-center gap-1 rounded-full bg-primary-tint px-2 py-0.5 text-caption font-semibold text-primary-strong"
                          >
                            {humanize(r.role)}
                            {r.scope !== 'ORG' && <span className="text-primary">·{humanize(r.scope)}</span>}
                            <button
                              aria-label={`Revoke ${r.role} from ${u.name}`}
                              className="-mr-0.5 ml-0.5 inline-flex items-center rounded-full text-primary transition duration-fast hover:text-primary-active focus-visible:outline-none focus-visible:shadow-focus"
                              onClick={() => void revoke(u, r.id)}
                            >
                              <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <form className="mt-5 flex flex-wrap items-end gap-3 border-t border-hairline pt-5" onSubmit={assign}>
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
          {err && <p className="mt-3 text-footnote font-medium text-danger">{err}</p>}
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
      {err && <p className="mb-3 text-footnote font-medium text-danger">{err}</p>}
      <div className="grid gap-8 lg:grid-cols-2">
        {/* drivers + vehicle assignment */}
        <div>
          <h3 className="mb-3 text-subhead font-semibold text-ink">Drivers · default vehicle</h3>
          {drivers.loading || vehicles.loading ? (
            <TableSkeleton rows={3} cols={2} />
          ) : drivers.error ? (
            <ErrorBox message={drivers.error} onRetry={reload} />
          ) : !drivers.data || drivers.data.drivers.length === 0 ? (
            <EmptyState icon={<Truck className="h-5 w-5" strokeWidth={1.75} />} title="No drivers" message="No drivers." />
          ) : (
            <Table>
              <tbody className="divide-y divide-hairline">
                {drivers.data.drivers.map((d) => (
                  <tr key={d.id} data-testid={`driver-${d.id}`}>
                    <Td>{d.name ?? d.userId.slice(0, 8)}</Td>
                    <Td>
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
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>

        {/* devices */}
        <div>
          <h3 className="mb-3 text-subhead font-semibold text-ink">Devices</h3>
          {devices.loading ? (
            <TableSkeleton rows={3} cols={4} />
          ) : devices.error ? (
            <ErrorBox message={devices.error} onRetry={reload} />
          ) : !devices.data || devices.data.devices.length === 0 ? (
            <EmptyState icon={<Smartphone className="h-5 w-5" strokeWidth={1.75} />} title="No devices" message="No devices." />
          ) : (
            <Table>
              <tbody className="divide-y divide-hairline">
                {devices.data.devices.map((dv) => (
                  <tr key={dv.id} data-testid={`device-${dv.id}`}>
                    <Td>{dv.userName ?? dv.userId.slice(0, 8)}</Td>
                    <Td className="text-secondary">{dv.platform}</Td>
                    <Td className="font-mono text-caption tabular-nums text-secondary">{dv.pushTokenMasked ?? '—'}</Td>
                    <Td numeric>
                      <Button variant="danger" size="sm" onClick={() => void removeDevice(dv.id)}>
                        Remove
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={addDevice}>
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
        <TableSkeleton rows={4} cols={3} />
      ) : state.error ? (
        <ErrorBox message={state.error} onRetry={state.reload} />
      ) : !state.data ? (
        <EmptyState message="No config." />
      ) : (
        <>
          <p className="mb-4 text-footnote text-tertiary">{state.data.note}</p>
          <Table>
            <thead>
              <tr>
                <Th>Event</Th>
                <Th>Channels</Th>
                <Th>Urgent</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {state.data.events.map((ev) => (
                <tr key={ev.event} data-testid={`notif-${ev.event}`}>
                  <Td className="font-mono text-caption tabular-nums">{ev.event}</Td>
                  <Td className="text-secondary">{ev.channels.join(', ')}</Td>
                  <Td>{ev.urgent ? <Badge tone="amber">urgent</Badge> : <span className="text-tertiary">—</span>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
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
        className="mb-4 flex flex-wrap items-end gap-3"
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
        <TableSkeleton rows={5} cols={4} />
      ) : entries.length === 0 ? (
        <EmptyState message="No audit entries." />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Entity</Th>
                <Th>Action</Th>
                <Th>Actor</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {entries.map((a) => (
                <tr key={a.id} data-testid={`audit-${a.id}`}>
                  <Td className="text-secondary">{shortDate(a.at)}</Td>
                  <Td>{a.entity}</Td>
                  <Td className="font-mono text-caption tabular-nums">{a.action}</Td>
                  <Td className="text-secondary">{a.actorName ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {cursor && (
            <div className="mt-4">
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
