# Blue Bee Priority Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four concrete bugs/gaps found by the 2026-09-08 full-project review (a payment race, a credits idempotency gap, a driver GPS shift-boundary leak, and untested driver authorization) and clean up the two project-hygiene issues (stale root docs, no test-concurrency guidance) that came out of the same review — without touching the `packages/ui` design-system consolidation, which is scoped as its own follow-up plan.

**Architecture:** Each task is a surgical, test-first fix inside the existing module it belongs to. No new modules, no new architectural seams — every fix follows a pattern the codebase already uses elsewhere (the invoice-payment lock pattern, the `IdempotencyInterceptor` convention, the existing e2e/unit test conventions).

**Tech Stack:** NestJS 10 + Prisma 5 (apps/api), Jest for unit + e2e tests, React Native + Expo (apps/driver), npm workspaces + Turborepo.

**Spec:** The 2026-09-08 full-project review (conversation record) — no separate spec doc exists; this plan **is** the spec, argued from the review's exact findings (file:line references preserved below).

## Global Constraints

- **TypeScript strict** everywhere — no new `any`, no `@ts-ignore`.
- **Never redefine a type/enum that already exists in `@blue-bee/shared`** — import it.
- **`org_id` explicit on every raw SQL / `tx.*` query that bypasses `scopedPrisma`** (the codebase's own convention; `Prisma.TransactionClient` does not inherit the row-scoping extension).
- **No stubs.** Every step below ships real code proven by a real, passing test — never a placeholder, TODO, or mocked data layer.
- **Idempotency for money/once-per-entity mutations = `IdempotencyInterceptor` (header-based replay safety) AND a DB-level guarantee (unique constraint or row lock) — never one alone.** This is the exact pattern `payments.controller.ts` + the invoice-lock in `payment.service.ts` already use; Tasks 1–2 extend it, they don't invent a new one.
- **`npm run infra:up` from the repo root** (Docker Postgres+PostGIS+Timescale, Redis) must be running before any `apps/api` e2e test (`npm run test:e2e --workspace @blue-bee/api`, which already bakes in `--runInBand`).
- **Run `apps/api` unit tests with `npx jest --runInBand` (from `apps/api`), not the root `turbo run test`.** Confirmed during the review: the plain parallel `turbo run test` OOM-crashes Jest workers on this machine (a resource-contention issue, not a code defect — see Task 5). Every task below gives the exact serial command to use.
- **Commit after each task**, message style `fix(scope): ...` / `test(scope): ...` / `docs: ...` matching existing history (see `git log --oneline` for examples). Never `--no-verify`.
- **Append a dated line to `CHANGELOG.md`** (newest on top) as the last step of each task — CLAUDE.md's "non-negotiable" build-log rule. Use the actual date you ship the fix (the examples below use 2026-09-08).

---

### Task 1: Fix the order-level payment race condition

**Files:**
- Modify: `apps/api/src/payments/payment.service.ts:90-212` (`createIntent`)
- Test: `apps/api/test/payments.e2e-spec.ts` (add a new `describe` block near the existing `describe('failed payment ...')` block, ~line 243)

**Interfaces:**
- Consumes: `OrderAccessService.requireOrderForWrite`, `CreditsService.redeemForOrder`/`balanceOf`, `PAYMENT_PROVIDER.createPaymentIntent`, `PrismaService` — all unchanged, already imported in this file.
- Produces: no new exports; `createIntent`'s public signature and `PaymentIntentResponse` return shape are unchanged, so nothing downstream needs to change.

**Root cause (from the review):** unlike `createInvoiceIntent` (same file, ~line 338), which locks the Invoice row (`SELECT ... FOR UPDATE`) before deciding whether to reuse a pending payment or create a new one, `createIntent`'s order-level path does the "is there a pending payment / how many attempts / create a new payment" sequence with **no lock**. Two near-simultaneous requests (double-tap, client retry) can both pass the pending-payment check, both create a PENDING row with the same computed idempotency key, then both try to save the Stripe intent id onto their own row — the second `update` collides with the unique constraint on `stripePaymentIntentId` and throws, leaving an orphaned PENDING row the webhook can never match.

**Fix:** mirror the invoice-level pattern exactly — lock the Order row, decide (reuse-pending vs. create-new) inside the lock, then call Stripe **outside** the lock (never hold a row lock across an external network call), using the decided idempotency key so a reused or freshly-created row converges on the same Stripe intent either way.

- [ ] **Step 1: Write the failing test**

Open `apps/api/test/payments.e2e-spec.ts` and add this new `describe` block directly after the closing `});` of the `describe('payment_intent.payment_failed ...')` block (around line 272):

```typescript
  // ─────────────────────────── concurrency: no orphaned duplicate payment rows ───────────────────────────

  describe('order-level payment concurrency (double-tap / retry safety)', () => {
    it('two concurrent create-intent calls for the same order converge on ONE payment row, never two', async () => {
      const orderId = await makeApprovedOrder();

      const [a, b] = await Promise.all([
        post(`/v1/orders/${orderId}/payment-intent`, 'rita'),
        post(`/v1/orders/${orderId}/payment-intent`, 'rita'),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.paymentId).toBe(b.body.paymentId); // same row reused, not a second PENDING payment

      expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
      const row = await prisma.payment.findFirstOrThrow({ where: { orderId } });
      expect(row.stripePaymentIntentId).toBeTruthy(); // never left null/orphaned by a losing concurrent update
      expect(row.status).toBe('PENDING');
    });
  });
```

- [ ] **Step 2: Run the test to verify it fails (or flakes) on current code**

Run (from `apps/api`, with `npm run infra:up` already running from the repo root):
```
npm run test:e2e -- payments.e2e-spec.ts
```
Expected: the new test is flaky/fails — either `prisma.payment.count` returns `2`, or the request throws a 500 from the unhandled unique-constraint collision on `stripePaymentIntentId`. (Race conditions don't fail 100% of the time — if it passes on the first try, re-run it 3–4 times; the unlocked window is real but narrow.)

- [ ] **Step 3: Replace `createIntent` with the locked version**

In `apps/api/src/payments/payment.service.ts`, replace the block from the `succeeded` check (line 109) through the end of the method (line 212) — i.e. everything from:
```typescript
    // Already fully paid?
    const succeeded = await this.prisma.payment.findFirst({ where: { orderId, orgId: order.orgId, status: PaymentStatus.SUCCEEDED } });
```
down to the method's closing `}` before `private async creditSplit` — with:

```typescript
    // Already fully paid?
    const succeeded = await this.prisma.payment.findFirst({ where: { orderId, orgId: order.orgId, status: PaymentStatus.SUCCEEDED } });
    if (succeeded) {
      throw new ConflictException({ error: PAYMENT_ERRORS.ALREADY_PAID, message: 'This order has already been paid' });
    }

    /**
     * [Inc-37] APPLY THE CUSTOMER'S CREDIT before we charge a card.
     *
     * Idempotent per order (DB unique index on `[orgId, REDEMPTION, orderId]`), so a re-attempt reuses the
     * SAME redemption rather than spending the balance twice — which is why the split is computed here, once,
     * and every later path (including the pending re-attempt below) derives its charge from the actual
     * applied amount rather than recomputing against a balance that may have moved.
     */
    const applyMinor = await this.creditSplit(order.orgId, principal.userId, orderTotalMinor);
    const creditApplied = await this.credits.redeemForOrder(
      order.orgId,
      principal.userId,
      orderId,
      new Prisma.Decimal(centsToMoney(applyMinor)),
    );
    const creditMinor = moneyToCents(creditApplied.toFixed(2));
    const amountMinor = orderTotalMinor - creditMinor; // what the CARD is charged
    const amountStr = centsToMoney(amountMinor);
    const creditStr = creditApplied.toFixed(2);

    // Credit covered the ENTIRE bill → there is nothing to charge. Settle it here (no Stripe intent, no
    // client secret) with a CREDIT-method payment, and mark the order paid exactly as the webhook would.
    if (amountMinor <= 0) {
      return this.settleFromCreditOnly(principal, order, orderId, orderTotalStr, creditStr, currency);
    }

    // Decide the single Payment row to drive — SERIALIZED per order via a row lock so two concurrent
    // pay attempts (double-tap, client retry) can never create two PENDING payments / two Stripe intents
    // (the orphaned-row race this fix closes). Mirrors createInvoiceIntent's lock below; the Stripe call
    // happens OUTSIDE the lock (never hold a row lock across an external network call).
    const decision = await this.prisma.$transaction(async (tx) => {
      // Lock THIS order row (tx does not inherit the scoped extension → pin orgId explicitly).
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId}::uuid AND org_id = ${order.orgId}::uuid FOR UPDATE`;

      // Defensive re-check: another concurrent call may have just succeeded (the succeeded-check above
      // ran before the lock).
      const alreadySucceeded = await tx.payment.findFirst({ where: { orderId, orgId: order.orgId, status: PaymentStatus.SUCCEEDED } });
      if (alreadySucceeded) {
        throw new ConflictException({ error: PAYMENT_ERRORS.ALREADY_PAID, message: 'This order has already been paid' });
      }

      // Re-attempt of the SAME pending intent: reuse it rather than creating a second one.
      const pending = await tx.payment.findFirst({ where: { orderId, orgId: order.orgId, status: PaymentStatus.PENDING }, orderBy: { createdAt: 'desc' } });
      if (pending && pending.idempotencyKey) {
        return { reuse: true as const, payment: pending };
      }

      // New attempt — bounded by the dunning retry cap. The count runs under the row lock, so the
      // attempt number (→ the idempotency key) is consistent even under concurrency.
      const attempts = await tx.payment.count({ where: { orderId, orgId: order.orgId } });
      if (attempts >= this.config.maxPaymentAttempts) {
        throw new ConflictException({ error: PAYMENT_ERRORS.RETRY_LIMIT_REACHED, message: 'Payment retry limit reached; please contact support' });
      }

      const created = await tx.payment.create({
        data: {
          orgId: order.orgId,
          orderId,
          accountId: order.accountId,
          amount: amountStr,
          currency,
          status: PaymentStatus.PENDING,
          captureMethod: this.captureMethod(),
          idempotencyKey: `pi-order-${orderId}-${attempts + 1}`,
          attempts: attempts + 1,
          createdBy: principal.userId,
        },
      });
      return { reuse: false as const, payment: created };
    });

    const payment = decision.payment;
    const idempotencyKey = payment.idempotencyKey as string;

    // Create the intent OUTSIDE the lock — the deterministic key means a reuse re-calls the provider
    // with the SAME key, so Stripe returns the identical intent + client secret (no double-charge).
    let intent;
    try {
      intent = await this.provider.createPaymentIntent({
        amountMinor,
        currency: currency.toLowerCase(),
        orderId,
        orgId: order.orgId,
        accountId: order.accountId,
        idempotencyKey,
        captureMethod: this.captureMethod(),
      });
    } catch (err) {
      // The intent couldn't be created — mark this attempt FAILED so the row isn't a dangling PENDING.
      // Only do this for a freshly-created row: a reused pending row is shared with whichever request
      // wins the retry, so we must not fail it out from under a concurrent caller.
      const reason = err instanceof Error ? err.message : String(err);
      if (!decision.reuse) {
        await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, lastError: reason } });
      }
      throw new UnprocessableEntityException({ error: PAYMENT_ERRORS.ORDER_NOT_PAYABLE, message: `Could not start payment: ${reason}` });
    }

    if (payment.stripePaymentIntentId !== intent.id) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: intent.id } });
    }
    if (!decision.reuse) {
      await this.audit.record({
        orgId: order.orgId,
        actorId: principal.userId,
        entity: 'Payment',
        entityId: payment.id,
        action: 'PAYMENT_INTENT_CREATED',
        after: { orderId, amount: amountStr, creditApplied: creditStr, orderTotal: orderTotalStr, currency, intentId: intent.id, attempt: payment.attempts, provider: this.provider.name },
      });
    }

    return this.intentResponse(payment.id, intent.clientSecret, amountStr, currency, PaymentStatus.PENDING, creditStr, orderTotalStr);
  }
```

This removes the old unlocked "re-attempt" and "new attempt" branches entirely — they're replaced by the single `decision` transaction plus the unified post-lock Stripe call.

- [ ] **Step 4: Run the test to verify it passes**

```
npm run test:e2e -- payments.e2e-spec.ts
```
Expected: PASS, including the new concurrency test — run it 5 times in a row (`for i in 1 2 3 4 5; do npm run test:e2e -- payments.e2e-spec.ts -t "concurrent create-intent" || break; done`) to confirm the race is actually closed, not just usually-not-triggered.

- [ ] **Step 5: Update CHANGELOG.md**

Add to the top of `CHANGELOG.md` (after the `## 2026-09-08` header if one already exists today, else create it):
```
- HH:MM IST · **fix(payments): close the order-level payment race** — `createIntent` now locks the Order row (mirroring the existing invoice-level lock) before deciding whether to reuse a pending payment or create a new one, so two concurrent pay attempts can never create two PENDING rows / orphan one on the `stripePaymentIntentId` unique constraint. → `apps/api/src/payments/payment.service.ts`, `apps/api/test/payments.e2e-spec.ts`
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/payments/payment.service.ts apps/api/test/payments.e2e-spec.ts CHANGELOG.md
git commit -m "fix(payments): lock the order row before deciding the payment-intent, closing a double-tap race that could orphan a PENDING payment"
```

---

### Task 2: Add idempotency protection to the credits adjustment endpoint

**Files:**
- Modify: `apps/api/src/credits/credits.module.ts`
- Modify: `apps/api/src/credits/credits.controller.ts`
- Create: `apps/api/test/credits.e2e-spec.ts`

**Interfaces:**
- Consumes: `IdempotencyInterceptor` from `../common/idempotency.interceptor` (already used by 8+ other controllers — see `apps/api/src/payments/payments.controller.ts` for the exact pattern being copied); `REDIS` token is provided by the `@Global()` `RedisModule`, so no new import is needed for DI to resolve it.
- Produces: no change to `CreditsService`'s public methods or `CreditBalanceView` shape — this is purely a controller/module-level guard, identical in shape to how `PaymentsController` is wrapped.

**Root cause (from the review):** every other mutation controller in this codebase (`payments`, `orders`, `logistics`, `facility-linen`, `ratings`, `driver`, `chat`, `auth`, `media`, `sites`, `service-zones`) applies `@UseInterceptors(IdempotencyInterceptor)`. `CreditsAdminController.adjust` (`POST /v1/admin/customers/:id/credits/adjust`) doesn't. A retried or double-clicked finance adjustment in the console creates a second `CreditEntry` — double-granting or double-deducting real customer credit, with no unique constraint to catch it (unlike the referral-earn/redemption paths, which are keyed and protected at the DB level).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/credits.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

const ORG1 = '11111111-1111-4111-8111-111111111111';

// Seeded fixtures (must match prisma/seed.ts) — reused from ratings.e2e-spec.ts's PHONES map.
const PHONES = {
  finance: '+14165550005', // FINANCE (org-wide)
  rita: '+14165550010', // RESIDENTIAL_CUSTOMER, Account A
};

/**
 * Credits admin-adjust idempotency (fix for the 2026-09-08 review finding: the console's manual
 * grant/deduct endpoint was the only money-moving mutation in the codebase with no Idempotency-Key
 * protection, so a retried/double-clicked adjustment could double-grant or double-deduct real credit).
 */
describe('Credits e2e — admin adjust idempotency', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const userId: Record<string, string> = {};

  const post = (path: string, who: string, body: unknown = {}, key?: string) => {
    let req = request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`);
    if (key) req = req.set('Idempotency-Key', key);
    return req.send(body as object);
  };

  const adjustmentCount = () => prisma.creditEntry.count({ where: { orgId: ORG1, userId: userId.rita, kind: 'ADJUSTMENT' } });

  beforeAll(async () => {
    app = await createTestApp();
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, phone] of Object.entries(PHONES)) {
      const user = await prisma.user.findFirstOrThrow({ where: { phone } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
      userId[name] = user.id;
    }
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('replaying the same Idempotency-Key does not double-grant credit', async () => {
    const key = `adjust-${Date.now()}`;
    const before = await adjustmentCount();

    const a = await post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 10, note: 'Goodwill credit' }, key).expect(201);
    const b = await post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 10, note: 'Goodwill credit' }, key).expect(201);

    expect(b.body.balance).toBe(a.body.balance); // replay returns the cached response, not a second grant
    expect((await adjustmentCount()) - before).toBe(1); // exactly one entry written
  });

  it('is concurrency-safe: two CONCURRENT same-key adjustments write exactly one entry', async () => {
    const key = `adjust-concurrent-${Date.now()}`;
    const before = await adjustmentCount();

    const [a, b] = await Promise.all([
      post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 5, note: 'Concurrent test' }, key),
      post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 5, note: 'Concurrent test' }, key),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.balance).toBe(b.body.balance);
    expect((await adjustmentCount()) - before).toBe(1);
  });

  it('without an Idempotency-Key, two distinct requests both apply (no accidental de-dup of real adjustments)', async () => {
    const before = await adjustmentCount();
    await post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 1, note: 'No key A' }).expect(201);
    await post(`/v1/admin/customers/${userId.rita}/credits/adjust`, 'finance', { amount: 1, note: 'No key B' }).expect(201);
    expect((await adjustmentCount()) - before).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```
npm run test:e2e -- credits.e2e-spec.ts
```
Expected (from `apps/api`): the first two tests FAIL — `adjustmentCount()` shows `2` instead of `1`, because nothing currently de-dupes the replay/concurrent calls.

- [ ] **Step 3: Register the interceptor in `credits.module.ts`**

In `apps/api/src/credits/credits.module.ts`, add the import and provider:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CreditsController, CreditsAdminController } from './credits.controller';
import { CreditsService } from './credits.service';

/**
 * [Inc-37] The customer credit ledger. Depends on NOTHING but Prisma, so it can be imported by the modules
 * that move money without creating a cycle: LogisticsModule (grant on DELIVERED), PaymentsModule (redeem at
 * PaymentIntent), AccountModule (customer balance), AdminModule (console ledger + adjust), HomeModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CreditsController, CreditsAdminController],
  providers: [CreditsService, IdempotencyInterceptor],
  exports: [CreditsService],
})
export class CreditsModule {}
```

- [ ] **Step 4: Apply the interceptor to `CreditsAdminController`**

In `apps/api/src/credits/credits.controller.ts`, add the import and decorator (matching `PaymentsController`'s pattern exactly):

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseInterceptors } from '@nestjs/common';
```
(add `UseInterceptors` to the existing `@nestjs/common` import)

```typescript
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { CurrentUser, Roles } from '../auth/rbac/decorators';
```
(add the `IdempotencyInterceptor` import line)

Then change the class decorator:
```typescript
@ApiTags('admin')
@ApiBearerAuth()
@Roles(RoleType.OWNER, RoleType.FINANCE)
@UseInterceptors(IdempotencyInterceptor)
@Controller('admin')
export class CreditsAdminController {
```

(`IdempotencyInterceptor` no-ops on GET requests, so the two `@Get` endpoints on this controller are unaffected — applying it at the controller level matches the existing `PaymentsController` convention rather than singling out one method.)

- [ ] **Step 5: Run the test to verify it passes**

```
npm run test:e2e -- credits.e2e-spec.ts
```
Expected: all 3 tests PASS.

- [ ] **Step 6: Run the full api e2e suite once to confirm no regression**

```
npm run test:e2e
```
Expected: all suites still pass (this change only adds a guard to a previously-unprotected endpoint; no existing test calls `credits/adjust` without expecting exactly the effect it already had for a single, non-retried call).

- [ ] **Step 7: Update CHANGELOG.md**

```
- HH:MM IST · **fix(credits): idempotency-protect the console credit adjustment** — `POST /v1/admin/customers/:id/credits/adjust` now wraps `IdempotencyInterceptor` like every other money-moving mutation in the codebase; a retried/double-clicked finance adjustment now replays the cached response instead of writing a second `CreditEntry`. New `credits.e2e-spec.ts` proves replay-safety and concurrency-safety. → `apps/api/src/credits/credits.module.ts`, `apps/api/src/credits/credits.controller.ts`, `apps/api/test/credits.e2e-spec.ts`
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/credits/credits.module.ts apps/api/src/credits/credits.controller.ts apps/api/test/credits.e2e-spec.ts CHANGELOG.md
git commit -m "fix(credits): add Idempotency-Key protection to the manual adjust endpoint"
```

---

### Task 3: Fix the driver GPS shift-boundary leak

**Files:**
- Modify: `apps/driver/src/location/duty-cycle.ts` (add `LocationOutbox.clear()`)
- Modify: `apps/driver/src/location/tracker.ts` (`ingestFixes`, `startTracking`, `stopTracking`)
- Test: `apps/driver/src/location/duty-cycle.test.ts` (add one case)
- Test: `apps/driver/src/location/tracker.test.ts` (add one case)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LocationOutbox.clear(): void` — a new public method later tasks/code may call; no existing signature changes.

**Root cause (from the review, refined):** the API's ingestion endpoint already rejects a location batch for a non-ACTIVE shift (`apps/api/src/tracking/ingestion.service.ts:60`, `TRACKING_ERRORS.SHIFT_NOT_ACTIVE`), so a single in-flight POST that lands after the shift has genuinely ended server-side is already rejected — that part isn't silent corruption. The real, undefended bug is narrower and worse: the module-level `LocationOutbox` in `tracker.ts` is a single shared instance that is **never cleared** in `stopTracking()`. If a flush fails while a shift is active (a network blip — the documented, expected failure mode) and the pings stay queued, then a **new** shift starts later, the **next** `ingestFixes` call flushes those old queued pings **tagged with the new shift's `shiftId`/`vehicleId`** (since the `send` closure reads whatever `state` is current at call time) — and the server accepts them, because by then that new shift genuinely is ACTIVE. This silently fabricates GPS history for a shift that never visited those coordinates, with no server-side defense.

**Fix:** clear the outbox when a shift ends, so no shift's unsent pings can ever be resent under a different shift's identity. Additionally add a session-token guard in the `send` closure as defense-in-depth, matching the code's own stated invariant ("it can never POST under the just-ended shift") for the case where a flush is processing multiple batches in one call and a stop happens mid-loop.

- [ ] **Step 1: Write the failing tests**

In `apps/driver/src/location/duty-cycle.test.ts`, add this case inside the existing `describe('LocationOutbox', ...)` block (after the `'dedupes by recordedAt...'` test):

```typescript
  it('clear() discards all pending pings', () => {
    const box = new LocationOutbox();
    box.enqueue([ping(1), ping(2)]);
    expect(box.size).toBe(2);
    box.clear();
    expect(box.size).toBe(0);
    expect(box.peek()).toEqual([]);
  });
```

In `apps/driver/src/location/tracker.test.ts`, add this case inside the existing `describe('location tracker gating (US-T5 / §6.2)', ...)` block:

```typescript
  it('does not carry an ended shift\'s unsent pings into the next shift', async () => {
    await tracker.startTracking(fakeClient, 'shift-A', 'veh-A');
    (fakeClient.postLocations as jest.Mock).mockRejectedValueOnce(new Error('network blip'));
    await tracker.ingestFixes([{ latitude: 1, longitude: 1, timestampMs: 1_700_000_200_000 }]);
    expect(tracker.pendingPingCount()).toBe(1); // failed flush left it queued — the designed, expected behavior

    await tracker.stopTracking();
    expect(tracker.pendingPingCount()).toBe(0); // the ended shift's unsent ping must not survive the boundary

    (fakeClient.postLocations as jest.Mock).mockClear();
    (fakeClient.postLocations as jest.Mock).mockResolvedValue({});
    await tracker.startTracking(fakeClient, 'shift-B', 'veh-B');
    await tracker.ingestFixes([{ latitude: 2, longitude: 2, timestampMs: 1_700_000_300_000 }]);

    expect(fakeClient.postLocations).toHaveBeenCalledTimes(1);
    const batch = (fakeClient.postLocations as jest.Mock).mock.calls[0][0];
    expect(batch.shiftId).toBe('shift-B');
    expect(batch.pings).toHaveLength(1); // only shift-B's own ping — never shift-A's leftover
    expect(batch.pings[0]).toMatchObject({ lat: 2, lng: 2 });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npx jest --runInBand duty-cycle.test.ts tracker.test.ts
```
(run from `apps/driver`)

Expected: the `duty-cycle.test.ts` case fails with `box.clear is not a function`. The `tracker.test.ts` case fails at `expect(tracker.pendingPingCount()).toBe(0)` right after `stopTracking()` — it's still `1`, and later the shift-B batch will contain 2 pings instead of 1 (the leaked one plus the new one).

- [ ] **Step 3: Add `clear()` to `LocationOutbox`**

In `apps/driver/src/location/duty-cycle.ts`, add this method to the `LocationOutbox` class, right after the `peek()` method:

```typescript
  /** Discard all pending pings. Used when a shift ends so its unsent pings never leak into the next shift. */
  clear(): void {
    this.pending = [];
  }
```

- [ ] **Step 4: Fix `tracker.ts`**

In `apps/driver/src/location/tracker.ts`, make three changes.

First, add a session counter next to the existing module state (after line 28's `let tracking = false;`):

```typescript
let tracking = false;
// Bumped on every stopTracking() so a `send` closure already queued inside an in-flight
// outbox.flush() can detect its shift has ended and skip the network call, instead of
// posting under a shift/vehicle binding that no longer applies.
let sessionId = 0;
```

Second, replace `ingestFixes` (lines 55-61) with:

```typescript
export async function ingestFixes(fixes: DeviceFix[]): Promise<void> {
  const { client, shiftId, vehicleId } = state;
  if (!client || !shiftId || !vehicleId) return; // not emitting unless a shift is active
  const session = sessionId;
  outbox.enqueue(fixes.map(toPing));
  if (outbox.size === 0) return;
  await outbox.flush((pings) => {
    if (session !== sessionId) return Promise.resolve(); // the shift ended mid-flush — drop, never POST stale
    return client.postLocations({ shiftId, vehicleId, pings });
  });
}
```

Third, replace `stopTracking` (lines 133-140) with:

```typescript
export async function stopTracking(): Promise<void> {
  sessionId++; // invalidate any in-flight flush so it can never POST under this now-ended shift
  state.client = null;
  state.shiftId = null;
  state.vehicleId = null;
  outbox.clear(); // discard unsent pings — they belong to the shift that just ended, never carry forward
  setTracking(false);
  const started = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```
npx jest --runInBand duty-cycle.test.ts tracker.test.ts
```
Expected: PASS.

- [ ] **Step 6: Run the full driver unit suite to confirm no regression**

```
npx jest --runInBand
```
(from `apps/driver`) — Expected: all suites pass.

- [ ] **Step 7: Update CHANGELOG.md**

```
- HH:MM IST · **fix(driver): clear the location outbox on shift end** — a failed-to-send ping from an ended shift could previously sit queued and get flushed (and misattributed) under the NEXT shift once the driver started one; `stopTracking()` now clears the outbox, and a session-token guard in the flush closure stops an in-flight send from posting under a stale shift/vehicle binding. → `apps/driver/src/location/duty-cycle.ts`, `apps/driver/src/location/tracker.ts`
```

- [ ] **Step 8: Commit**

```bash
git add apps/driver/src/location/duty-cycle.ts apps/driver/src/location/tracker.ts apps/driver/src/location/duty-cycle.test.ts apps/driver/src/location/tracker.test.ts CHANGELOG.md
git commit -m "fix(driver): clear the GPS outbox on shift end so unsent pings never leak into the next shift"
```

---

### Task 4: Add test coverage for the driver duty-loop authorization boundary

**Files:**
- Create: `apps/api/test/driver.e2e-spec.ts`

**Interfaces:**
- Consumes: `DriverController`/`DriverService` (`apps/api/src/driver/`) — no source changes, test-only task.

**Root cause (from the review):** `apps/api/src/driver/driver.service.ts` is where every duty-loop authorization check lives (`requireDriver`, `assertOwnShift`, `requireOwnStop`, and the `asOrgScoped` read-scope widening ARCHITECTURE.md itself calls out as security-sensitive) — and it has zero spec files. A future change to any of those three gates has nothing to catch a driver reaching another driver's shift or stop.

- [ ] **Step 1: Write the test file (this task is test-only — there is no "make it pass" step against new source; it proves the EXISTING gates work, and will catch a regression the day one breaks)**

Create `apps/api/test/driver.e2e-spec.ts`:

```typescript
import { INestApplication } from '@nestjs/common';
import { PrismaClient, RouteStatus, RouteStopKind, RouteStopStatus, ShiftStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DRIVER_ERRORS, POD_ERRORS, RoleScope, RoleType } from '@blue-bee/shared';
import { createTestApp } from './app.factory';
import { TokenService } from '../src/auth/token.service';
import { PrincipalService } from '../src/auth/principal.service';

const ORG1 = '11111111-1111-4111-8111-111111111111';
const ORG2_OWNER_PHONE = '+14165559001'; // "Demo Org-2 Owner" (prisma/seed.ts:464) — used only to prove cross-org isolation

/**
 * Driver duty-loop authorization boundary (Increment 9) — the gap the 2026-09-08 review flagged:
 * `driver.service.ts`'s ownership checks (`assertOwnShift`, `requireOwnStop`) had NO test coverage
 * despite being the entire authorization surface for the app that emits GPS + captures POD. Every
 * fixture here is created directly by this spec (never the seed), matching the codebase's own
 * pattern for isolating a surface under test.
 */
describe('Driver e2e — duty-loop authorization boundary', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const token: Record<string, string> = {};
  const nonce = randomUUID().slice(0, 8);

  const post = (path: string, who: string, body: unknown = {}) =>
    request(app.getHttpServer()).post(path).set('Authorization', `Bearer ${token[who]}`).send(body as object);
  const get = (path: string, who: string) => request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${token[who]}`);

  async function tokenFor(name: string, phone: string): Promise<void> {
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    const user = await prisma.user.findFirstOrThrow({ where: { phone } });
    const roles = await principals.loadGrants(user.id);
    const scope = await principals.deriveScope(roles);
    token[name] = tokens.signAccess(user, roles, scope);
  }

  /** Create a fresh driver user + Driver profile + Vehicle + a PUBLISHED route with one PENDING stop, all in ORG1. */
  async function makeDriverRig(label: string): Promise<{ driverUserId: string; driverId: string; shiftId: string; routeId: string; stopId: string; deliveryStopId: string }> {
    const phone = `+1416555${nonce}${label}`.slice(0, 12);
    const user = await prisma.user.create({ data: { orgId: ORG1, name: `Test Driver ${label}`, phone } });
    await prisma.userRole.create({ data: { orgId: ORG1, userId: user.id, role: RoleType.DRIVER, scope: RoleScope.ORG } });
    const vehicle = await prisma.vehicle.create({ data: { orgId: ORG1, label: `Van-${label}-${nonce}` } });
    const driver = await prisma.driver.create({ data: { orgId: ORG1, userId: user.id, defaultVehicleId: vehicle.id } });
    const shift = await prisma.shift.create({ data: { orgId: ORG1, driverId: driver.id, vehicleId: vehicle.id, status: ShiftStatus.SCHEDULED } });
    const route = await prisma.route.create({ data: { orgId: ORG1, date: new Date(), driverId: driver.id, vehicleId: vehicle.id, status: RouteStatus.PUBLISHED } });
    const stop = await prisma.routeStop.create({ data: { orgId: ORG1, routeId: route.id, seq: 1, kind: RouteStopKind.PICKUP, status: RouteStopStatus.PENDING } });
    const deliveryStop = await prisma.routeStop.create({ data: { orgId: ORG1, routeId: route.id, seq: 2, kind: RouteStopKind.DELIVERY, status: RouteStopStatus.PENDING } });
    return { driverUserId: user.id, driverId: driver.id, shiftId: shift.id, routeId: route.id, stopId: stop.id, deliveryStopId: deliveryStop.id };
  }

  let A: Awaited<ReturnType<typeof makeDriverRig>>;
  let B: Awaited<ReturnType<typeof makeDriverRig>>;

  beforeAll(async () => {
    app = await createTestApp();
    A = await makeDriverRig('a');
    B = await makeDriverRig('b');
    const tokens = app.get(TokenService);
    const principals = app.get(PrincipalService);
    for (const [name, userId] of [['driverA', A.driverUserId], ['driverB', B.driverUserId]] as const) {
      const user = await prisma.user.findFirstOrThrow({ where: { id: userId } });
      const roles = await principals.loadGrants(user.id);
      const scope = await principals.deriveScope(roles);
      token[name] = tokens.signAccess(user, roles, scope);
    }
    await tokenFor('org2Owner', ORG2_OWNER_PHONE);
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it("assignment returns ONLY the caller's own shift + route, never another driver's", async () => {
    const res = await get('/v1/driver/assignment', 'driverA').expect(200);
    expect(res.body.shift.id).toBe(A.shiftId);
    expect(res.body.route.id).toBe(A.routeId);
    expect(res.body.route.id).not.toBe(B.routeId);
  });

  describe('shift ownership', () => {
    it('a driver can start their OWN shift', async () => {
      const res = await post(`/v1/driver/shifts/${A.shiftId}/start`, 'driverA').expect(200);
      expect(res.body.status).toBe('ACTIVE');
    });

    it("a driver CANNOT start another driver's shift (403 not_own_shift)", async () => {
      const res = await post(`/v1/driver/shifts/${B.shiftId}/start`, 'driverA').expect(403);
      expect(res.body.error).toBe(DRIVER_ERRORS.NOT_OWN_SHIFT);
    });

    it('starting a nonexistent shift id is a 404, not a 500 or a silent success', async () => {
      await post(`/v1/driver/shifts/${randomUUID()}/start`, 'driverA').expect(404);
    });
  });

  describe('stop ownership', () => {
    it('a driver can act on a stop on THEIR OWN route', async () => {
      const res = await post(`/v1/driver/stops/${A.stopId}/depart`, 'driverA').expect(200);
      expect(res.body.status).toBe('EN_ROUTE');
    });

    it("a driver CANNOT act on a stop on another driver's route (403 not_own_stop)", async () => {
      const res = await post(`/v1/driver/stops/${B.stopId}/depart`, 'driverA').expect(403);
      expect(res.body.error).toBe(DRIVER_ERRORS.NOT_OWN_STOP);
    });

    it('acting on a nonexistent stop id is a 404', async () => {
      await post(`/v1/driver/stops/${randomUUID()}/depart`, 'driverA').expect(404);
    });

    it('a delivery stop cannot be completed without a captured proof of delivery (400 pod_required)', async () => {
      const res = await post(`/v1/driver/stops/${A.deliveryStopId}/complete`, 'driverA').expect(400);
      expect(res.body.error).toBe(POD_ERRORS.POD_REQUIRED);
    });
  });

  describe('weigh + POD read surfaces are stop-owned, not just role-gated', () => {
    it("driver A cannot read driver B's stop weight", async () => {
      await get(`/v1/driver/stops/${B.stopId}/weight`, 'driverA').expect(403);
    });

    it("driver A cannot presign POD media for driver B's stop", async () => {
      await post(`/v1/driver/stops/${B.deliveryStopId}/pod/presign`, 'driverA', { contentType: 'image/jpeg', sizeBytes: 1000, kind: 'POD_PHOTO' }).expect(403);
    });
  });

  describe('cross-org isolation', () => {
    it("an org-2 principal (not even a driver) cannot resolve an org-1 driver's shift/stop as anything but 403/404", async () => {
      // org2Owner has no Driver profile at all → the very first gate (`requireDriver`) 404s.
      await post(`/v1/driver/shifts/${A.shiftId}/start`, 'org2Owner').expect(404);
    });
  });
});
```

- [ ] **Step 2: Run the test**

```
npm run test:e2e -- driver.e2e-spec.ts
```
(from `apps/api`, `npm run infra:up` running)

Expected: PASS.

- [ ] **Step 3: Run the full api e2e suite to confirm no interference with other specs**

```
npm run test:e2e
```
Expected: all suites pass, including the new one. (This spec creates its own users/drivers/routes/stops with a random nonce in the phone number, so it can't collide with seed data or other specs' fixtures.)

- [ ] **Step 4: Update CHANGELOG.md**

```
- HH:MM IST · **test(driver): cover the duty-loop authorization boundary** — new `driver.e2e-spec.ts` proves `assertOwnShift`/`requireOwnStop` actually reject cross-driver and cross-org access (previously zero test coverage on the API's driver-app authorization surface). → `apps/api/test/driver.e2e-spec.ts`
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/driver.e2e-spec.ts CHANGELOG.md
git commit -m "test(driver): add e2e coverage for the shift/stop ownership authorization boundary"
```

---

### Task 5: Project hygiene — root docs, test-runner guidance, branch cleanup

**Files:**
- Modify: `README.md`
- Modify: `START-HERE.md`
- Modify: `package.json` (root) — add a `test:unit-safe` script documenting the serial test command
- No file changes for branch cleanup — it's a manual, confirm-before-you-delete step (see Step 4).

This task has no failing test to write first — it's documentation and a script convenience, not behavior. Do it last, after Tasks 1–4 are merged, so the docs describe the actually-current state.

- [ ] **Step 1: Rewrite the status line in `README.md`**

In `apps/../README.md` (repo root), replace line 5:
```
> **Status: foundation / scaffold.** No application code yet. To begin the build with Claude Code, open this folder in VS Code and follow **`START-HERE.md`** (and read **`CLAUDE.md`**).
```
with:
```
> **Status: Phase-1 MVP built and iterating** (39+ increments as of 2026-09-08) — auth, orders, logistics/tracking, payments, notifications, and all four client surfaces exist and are tested. See `CHANGELOG.md` for the build log and `handoffs/` for the latest developer handover before making changes.
```

- [ ] **Step 2: Rewrite `START-HERE.md`'s framing**

`START-HERE.md` is written as a one-time bootstrap prompt for a repo with no code yet. Replace its line 3:
```
This is a **foundation only** — structure, configs, and docs are in place, but there is **no app code yet** and it is **not a git repo yet**. Open the folder in VS Code, then run the two prompts below in Claude Code, in order.
```
with:
```
This repo is **past initial bootstrap** — Phase-1 MVP is built and iterating (see `CHANGELOG.md`). The two prompts below are kept for reference/onboarding context only; do NOT re-run Prompt 1 (`git init`) against this repo. For picking up ongoing work, read `CHANGELOG.md`, the latest file in `handoffs/`, and `BUILD-PLAN.md`'s checklist instead.
```

- [ ] **Step 3: Add the serial-test convenience script**

In the root `package.json`, add a script next to the existing `"test"` entry:
```json
    "test": "turbo run test",
    "test:api-safe": "cd apps/api && npx jest --runInBand",
```
(Full key: this documents, in the one place a new developer will look, that the API's suite should be run serially on a resource-constrained machine — the parallel `turbo run test` OOM-crashing here was independently re-discovered during the 2026-09-08 review after already being diagnosed once in the 2026-08-12 handover.)

- [ ] **Step 4: Clean up merged remote branches (confirm with the repo owner before running — this is a shared, hard-to-fully-reverse action)**

The review found 17 of 19 non-`main` remote branches are fully merged into `main` and safe to delete; 2 (`feat/cost-center-billing`, `feat/cost-center-billing-b5`) are unmerged, stale since 2026-06-27, and point to the identical commit (duplicate leftovers — the feature they represent already shipped on `main` in a different form). **Do not run this step unattended** — confirm with whoever owns the GitHub remote first, since deleting a remote branch is not something this plan should do silently.

Once confirmed, from the repo root:
```bash
for b in backup/all-99f68be backup/geo-blocking-inc19-7d8297f backup/inc37-1578fa3 backup/inc38-15cba8e backup/s3-media-golive-27e9f0f chore/railway-verify feat/b2b-invoice-portal feat/care-home-linen-par feat/corporate-pricing feat/corporate-pricing-app feat/cost-center-ui feat/driver-pod feature/customer-ux feature/dryclean-catalog-inc17 feature/geo-blocking-inc19 feature/in-app-chat-inc18 feature/s3-media-golive; do
  git push origin --delete "$b"
done
# The two unmerged duplicates — confirm they're truly superseded (git log main..origin/feat/cost-center-billing
# should show the same 3 commits already reachable from main under different hashes, i.e. squash-merged)
# before deleting these two specifically.
git push origin --delete feat/cost-center-billing feat/cost-center-billing-b5
```

- [ ] **Step 5: Update CHANGELOG.md**

```
- HH:MM IST · **docs: root README/START-HERE corrected to reflect the actual build state** — both previously read "no application code yet," 39 increments after that stopped being true; added a `test:api-safe` script documenting the serial-test workaround for this machine's Jest worker OOM issue; cleaned up merged remote branches. → `README.md`, `START-HERE.md`, `package.json`
```

- [ ] **Step 6: Commit**

```bash
git add README.md START-HERE.md package.json CHANGELOG.md
git commit -m "docs: correct root README/START-HERE staleness, document the serial-test workaround"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** all 4 "fix first" bugs from the review (payment race, credits idempotency, driver GPS leak, driver test gap) have a task; the 2 hygiene items (stale docs, test-concurrency footgun) are folded into Task 5; branch cleanup is included but gated on explicit confirmation since it's a shared/remote action. The `packages/ui` consolidation is deliberately **not** in this plan — it touches 4 apps and needs its own scoping pass; raise it as a follow-up plan once this one ships.
- **Type consistency check:** Task 1's `decision` object shape (`{ reuse: boolean, payment: Payment }`) is used consistently in both the reuse and create branches, matching the existing `createInvoiceIntent`'s `decision` shape in the same file. Task 3's `sessionId`/`clear()` names are used identically across the `duty-cycle.ts` and `tracker.ts` edits and their tests.
- **Task independence:** Tasks 1–4 touch disjoint files and can be done in any order (or in parallel by different engineers/subagents). Task 5 should go last since it documents the post-fix state.
