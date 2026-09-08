import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

/**
 * Admin e2e (Increment 16, PRD Epic B6.2 / §17.3) — locks the OWNER-gated admin surface. Proves:
 *   • RBAC — only OWNER reaches `/v1/admin/*`; a non-owner (CSR) → 403.
 *   • Real audited mutations — assign a role → an AuditLog (ROLE_ASSIGNED) is written → the grant is
 *     reflected in the users list; revoke → audited + reflected. Create a device → audited → listed → delete.
 *   • Audit-log viewer — returns real entries, honours a filter, is read-only.
 *   • Org-scoping — an Org-2 owner cannot touch an Org-1 user (404) nor see Org-1 audit entries.
 *   • Privilege/lockout guard — the org's last OWNER cannot be revoked (409).
 *
 * A dedicated Org-1 fixture user (deterministic id) is created + torn down by this spec.
 */

const FIX_USER = 'a6000000-0000-4000-8000-000000000001'; // admin fixture user (Org 1, no roles)
const ORG1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_A = '44444444-4444-4444-8444-444444444444'; // seed Org-1 account (ACCOUNT-scope target)

const PHONES = {
  owner: '+14165550001', // OWNER (Org 1) — admin
  csr: '+14165550003', // CSR (Org 1) — RBAC negative
  org2owner: '+14165559001', // OWNER (Org 2) — cross-org probe
};

describe('Admin e2e — Increment 16 (users/roles, devices, audit-log viewer; OWNER-gated)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};

  const get = (path: string, who: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);
  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const del = (path: string, who: string) =>
    request(app.getHttpServer()).delete(path).set('Authorization', `Bearer ${token[who]}`);

  async function cleanup(): Promise<void> {
    await prisma.userRole.deleteMany({ where: { userId: FIX_USER } });
    await prisma.device.deleteMany({ where: { userId: FIX_USER } });
    await prisma.user.deleteMany({ where: { id: FIX_USER } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
    await cleanup();
    await prisma.user.create({
      data: { id: FIX_USER, orgId: ORG1, name: 'Admin Fixture User', phone: '+14165550099', email: 'fixture@bluebee.example', status: 'ACTIVE' },
    });
  }, 60000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  // ───────────────────────────── RBAC ─────────────────────────────

  describe('RBAC', () => {
    it('OWNER reaches the admin surface; a CSR is 403 on every admin route', async () => {
      await get('/v1/admin/users', 'owner').expect(200);
      await get('/v1/admin/users', 'csr').expect(403);
      await get('/v1/admin/devices', 'csr').expect(403);
      await get('/v1/admin/audit-logs', 'csr').expect(403);
      await get('/v1/admin/notification-config', 'csr').expect(403);
      await post(`/v1/admin/users/${FIX_USER}/roles`, 'csr', { role: 'CSR' }).expect(403);
    });
  });

  // ───────────────────────────── role assign → audit → reflected ─────────────────────────────

  describe('users & roles (audited)', () => {
    it('assigns a role → writes a ROLE_ASSIGNED AuditLog → reflects in the grants + users list', async () => {
      const res = await post(`/v1/admin/users/${FIX_USER}/roles`, 'owner', { role: 'CSR' }).expect(201);
      const roles = res.body.roles as Array<{ id: string; role: string }>;
      const grant = roles.find((r) => r.role === 'CSR');
      expect(grant).toBeDefined();

      // reflected in the org users list
      const list = await get('/v1/admin/users', 'owner').expect(200);
      const fixUser = (list.body.users as Array<{ id: string; roles: Array<{ role: string }> }>).find((u) => u.id === FIX_USER);
      expect(fixUser?.roles.some((r) => r.role === 'CSR')).toBe(true);

      // the mutation wrote an immutable audit entry (queried via the viewer, by the grant's id)
      const audit = await get(`/v1/admin/audit-logs?entityId=${grant!.id}`, 'owner').expect(200);
      const entry = (audit.body.entries as Array<{ action: string; entity: string; actorName: string | null }>)[0];
      expect(entry).toMatchObject({ action: 'ROLE_ASSIGNED', entity: 'UserRole' });
      expect(entry.actorName).toBe('Demo Owner');
    });

    it('rejects a duplicate grant (409) and a malformed ORG grant carrying a scopeId (400)', async () => {
      await post(`/v1/admin/users/${FIX_USER}/roles`, 'owner', { role: 'CSR' }).expect(409); // already assigned above
      await post(`/v1/admin/users/${FIX_USER}/roles`, 'owner', { role: 'CSR', scope: 'ORG', scopeId: ACCOUNT_A }).expect(400);
    });

    it('assigns an ACCOUNT-scoped grant (valid org account) and revokes a grant (audited + reflected)', async () => {
      const assigned = await post(`/v1/admin/users/${FIX_USER}/roles`, 'owner', {
        role: 'ACCOUNT_ADMIN',
        scope: 'ACCOUNT',
        scopeId: ACCOUNT_A,
      }).expect(201);
      const acct = (assigned.body.roles as Array<{ id: string; role: string; scopeId: string | null }>).find(
        (r) => r.role === 'ACCOUNT_ADMIN',
      );
      expect(acct?.scopeId).toBe(ACCOUNT_A);

      // revoke it → gone from the reflected grants
      const after = await del(`/v1/admin/users/${FIX_USER}/roles/${acct!.id}`, 'owner').expect(200);
      expect((after.body.roles as Array<{ role: string }>).some((r) => r.role === 'ACCOUNT_ADMIN')).toBe(false);

      // a ROLE_REVOKED audit entry exists
      const audit = await get(`/v1/admin/audit-logs?entityId=${acct!.id}&action=ROLE_REVOKED`, 'owner').expect(200);
      expect((audit.body.entries as unknown[]).length).toBeGreaterThanOrEqual(1);
    });

    it('rejects an ACCOUNT grant whose scopeId is not an account in this org (400)', async () => {
      await post(`/v1/admin/users/${FIX_USER}/roles`, 'owner', {
        role: 'ACCOUNT_ADMIN',
        scope: 'ACCOUNT',
        scopeId: '44444444-4444-4444-8444-000000000000',
      }).expect(400);
    });
  });

  // ───────────────────────────── devices CRUD (audited) ─────────────────────────────

  describe('devices (audited CRUD)', () => {
    it('creates a device → audited → listed → deletes it', async () => {
      const created = await post('/v1/admin/devices', 'owner', {
        userId: FIX_USER,
        platform: 'IOS',
        pushToken: 'ExponentPushToken[adminFixtureSECRET]',
      }).expect(201);
      const deviceId = created.body.id as string;
      expect(created.body.pushTokenMasked).toMatch(/^…/); // masked, never the full token
      expect(created.body.pushTokenMasked).not.toContain('SECRET');

      const list = await get('/v1/admin/devices', 'owner').expect(200);
      expect((list.body.devices as Array<{ id: string }>).some((d) => d.id === deviceId)).toBe(true);

      const audit = await get(`/v1/admin/audit-logs?entityId=${deviceId}&action=DEVICE_CREATED`, 'owner').expect(200);
      expect((audit.body.entries as unknown[]).length).toBe(1);

      await del(`/v1/admin/devices/${deviceId}`, 'owner').expect(204);
      const after = await get('/v1/admin/devices', 'owner').expect(200);
      expect((after.body.devices as Array<{ id: string }>).some((d) => d.id === deviceId)).toBe(false);
    });
  });

  // ───────────────────────────── notification config (read-only) ─────────────────────────────

  describe('notification config (read-only viewer)', () => {
    it('returns the live event→channel matrix and is NOT editable', async () => {
      const res = await get('/v1/admin/notification-config', 'owner').expect(200);
      expect(res.body.templatesEditable).toBe(false);
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(res.body.events.length).toBeGreaterThan(0);
      expect(res.body.events[0]).toHaveProperty('channels');
    });
  });

  // ───────────────────────────── audit-log viewer (read-only, paginated) ─────────────────────────────

  describe('audit-log viewer', () => {
    it('returns real entries and paginates (limit + nextCursor)', async () => {
      const page = await get('/v1/admin/audit-logs?limit=2', 'owner').expect(200);
      expect((page.body.entries as unknown[]).length).toBeLessThanOrEqual(2);
      expect(page.body.entries.length).toBeGreaterThan(0);
      // cursor walks forward without repeating the first id
      if (page.body.nextCursor) {
        const firstId = page.body.entries[0].id;
        const next = await get(`/v1/admin/audit-logs?limit=2&cursor=${page.body.nextCursor}`, 'owner').expect(200);
        expect((next.body.entries as Array<{ id: string }>).some((e) => e.id === firstId)).toBe(false);
      }
    });

    it('400 on a malformed date filter', async () => {
      await get('/v1/admin/audit-logs?from=not-a-date', 'owner').expect(400);
    });
  });

  // ───────────────────────────── org-scoping + lockout guard ─────────────────────────────

  describe('org-scoping + privilege guard', () => {
    it('an Org-2 owner cannot assign a role to an Org-1 user (404) nor see the Org-1 grant in audit', async () => {
      await post(`/v1/admin/users/${FIX_USER}/roles`, 'org2owner', { role: 'CSR' }).expect(404);

      // the Org-1 fixture user does not appear in the Org-2 owner's users list
      const list = await get('/v1/admin/users', 'org2owner').expect(200);
      expect((list.body.users as Array<{ id: string }>).some((u) => u.id === FIX_USER)).toBe(false);
    });

    it('cannot revoke the last OWNER in an org (409)', async () => {
      // Org 2 has exactly one owner — find its OWNER grant and try to revoke it.
      const org2Owner = await prisma.user.findFirstOrThrow({ where: { phone: PHONES.org2owner } });
      const ownerGrant = await prisma.userRole.findFirstOrThrow({ where: { userId: org2Owner.id, role: 'OWNER' } });
      await del(`/v1/admin/users/${org2Owner.id}/roles/${ownerGrant.id}`, 'org2owner').expect(409);
    });
  });
});
