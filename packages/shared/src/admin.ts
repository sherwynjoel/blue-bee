/**
 * Admin contract (Increment 16, PRD Epic B6.2 / §17.3) — the OWNER-gated, org-scoped, AUDITED admin
 * surface the web console renders: users & roles, devices, driver→vehicle assignment, a read-only
 * notification-config viewer, and a read-only audit-log viewer. Mirrors the Inc-15 analytics / Inc-14a
 * owner thin-module shape. Vehicle/Driver CRUD already ships (Inc-4 logistics, audited) and is REUSED
 * — the admin surface adds only what was missing.
 *
 * HONESTY: notification *templates* are static code-config (EN, Inc-8) — the viewer is strictly
 * read-only (`templatesEditable: false`); no fake edit capability. The audit log is append-only
 * (DB trigger) — viewer only. Every mutation here writes an immutable AuditLog (§8.7).
 */
import { z } from 'zod';
import { DevicePlatform, RoleScope, RoleType } from './enums';

// ───────────────────────────── users & roles ─────────────────────────────

/** Assign a role grant to an org user. ORG scope ⇒ no scopeId; ACCOUNT/SITE ⇒ scopeId required. */
export const assignRoleSchema = z.object({
  role: z.nativeEnum(RoleType),
  scope: z.nativeEnum(RoleScope).default(RoleScope.ORG),
  scopeId: z.string().uuid().nullable().optional(),
});
export type AssignRoleDto = z.infer<typeof assignRoleSchema>;

export interface AdminRoleGrant {
  id: string;
  role: RoleType;
  scope: RoleScope;
  scopeId: string | null;
}

export interface AdminUser {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  roles: AdminRoleGrant[];
}

export interface AdminUsersResult {
  users: AdminUser[];
  count: number;
}

/** Returned by assign/revoke — the target user's id + its grants after the change (reflected). */
export interface AdminUserRolesResult {
  userId: string;
  roles: AdminRoleGrant[];
}

// ───────────────────────────── devices ─────────────────────────────

export const createDeviceSchema = z.object({
  userId: z.string().uuid(),
  platform: z.nativeEnum(DevicePlatform),
  pushToken: z.string().min(1).max(400).optional(),
});
export type CreateDeviceDto = z.infer<typeof createDeviceSchema>;

export interface AdminDevice {
  id: string;
  userId: string;
  userName: string | null;
  platform: DevicePlatform;
  /** Push token masked to its tail (never the full token over the wire), or null. */
  pushTokenMasked: string | null;
  lastSeen: string | null;
  createdAt: string;
}

export interface AdminDevicesResult {
  devices: AdminDevice[];
  count: number;
}

// ───────────────────────────── drivers (vehicle assignment) ─────────────────────────────

/** Set (or clear, with null) a driver's default vehicle. */
export const assignDriverVehicleSchema = z.object({
  defaultVehicleId: z.string().uuid().nullable(),
});
export type AssignDriverVehicleDto = z.infer<typeof assignDriverVehicleSchema>;

export interface AdminDriver {
  id: string;
  userId: string;
  name: string | null;
  license: string | null;
  defaultVehicleId: string | null;
}

export interface AdminDriversResult {
  drivers: AdminDriver[];
  count: number;
}

// ───────────────────────────── notification config (read-only) ─────────────────────────────

export interface NotificationChannelRow {
  event: string;
  /** Ordered delivery channels for this event (PUSH/SMS/EMAIL/IN_APP). */
  channels: string[];
  /** Whether the event bypasses quiet-hours deferral (time-critical). */
  urgent: boolean;
}

export interface NotificationConfigView {
  appName: string;
  events: NotificationChannelRow[];
  quietHours: { policy: string; defaultTimezone: string };
  /** Always false this phase — templates are static EN code-config (no DB-backed editor). */
  templatesEditable: false;
  note: string;
}

// ───────────────────────────── audit-log viewer (read-only) ─────────────────────────────

export interface AuditLogEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  at: string;
  before: unknown;
  after: unknown;
}

export interface AuditLogResult {
  entries: AuditLogEntry[];
  /** Opaque cursor for the next page, or null when exhausted. */
  nextCursor: string | null;
}
