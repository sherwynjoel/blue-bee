# Blue Bee Remaining Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the remaining findings from the 2026-09-08 full-project review that weren't in the first priority-fixes round: idempotency-wiring gaps on 5 admin/console controllers, duplicated notification-dispatch logic, a stale/contradictory code comment, two defensive org-scoping hardenings, missing concurrency-race test coverage on 3 modules, missing lint configs on 2 packages, one docs-accuracy fix, a web CI pipeline, weakly-typed view models, untested console entry screens, and — the big one — migrating the web console's refresh token off `localStorage` onto an httpOnly cookie.

**Explicitly out of scope for this plan** (deferred by prior agreement): the `packages/ui` design-system consolidation (needs its own visually-verified pass), and a broad sweep adding direct unit tests to ~14 API services that already have partial e2e coverage (large, open-ended, lower value than the items here — raise as its own plan if wanted later).

**Architecture:** Every task follows an existing proven pattern in this codebase rather than inventing a new one — the `IdempotencyInterceptor` wiring mirrors `PaymentsController`'s exact usage; the cookie migration keeps the *same* `/v1/auth/refresh` endpoint serving both native apps (body-based, unchanged) and the web console (cookie-based, new) rather than forking the shared `packages/api-client` transport into a separate BFF.

**Tech Stack:** NestJS 10 + Prisma 5 + `cookie-parser` (new dependency) for the API; Next.js + the shared `@blue-bee/api-client` for the web console; Jest for unit + e2e tests; GitHub Actions for CI (new).

**Spec:** The 2026-09-08 full-project review and its follow-up conversation (no separate spec doc) — this plan **is** the spec, argued from the review's findings and from source verified fresh during planning (two of the "no test coverage" claims from the original review turned out to be wrong — see Task 4 — so every claim below was re-verified against current source, not copied from the original review).

## Global Constraints

- **TypeScript strict** everywhere — no new `any` except where a task explicitly removes one.
- **`org_id` explicit on every raw SQL / `tx.*` query that bypasses `scopedPrisma`.**
- **No stubs.** Every step ships real code proven by a real, passing test.
- **`npm run infra:up` from the repo root** (Docker Postgres/Redis/MinIO) must be running before any `apps/api` e2e test. Migrations + seed must be applied (`npx prisma migrate deploy` then `npx prisma db seed`, both from `apps/api`) on a fresh database.
- **Run `apps/api` tests serially** — `npm run test:api-safe` (unit) from the repo root, or `npm run test:e2e` (e2e, already bakes `--runInBand`) from `apps/api`. The plain parallel `turbo run test` is known to OOM-crash workers on constrained machines.
- **Commit after each task**, message style `fix(scope): ...` / `feat(scope): ...` / `test(scope): ...` / `docs: ...` / `chore(scope): ...` matching existing history. Never `--no-verify`.
- **Append a dated line to `CHANGELOG.md`** (newest on top) as the last step of each task, using the actual date/time you ship it.
- **Before assuming a file needs to be created or a module has "no tests," check whether it already exists.** Two tasks in the prior round discovered the review's "zero test coverage" claims were wrong for files that already existed with real coverage — Task 4 in this plan hits the same class of module (corporate/referral/ratings) and starts from files confirmed to exist as of this plan's writing, but re-confirm before assuming the exact line numbers below are still current.

---

### Task 1: Wire `IdempotencyInterceptor` into the 5 remaining unprotected mutation controllers

**Files:**
- Modify: `apps/api/src/corporate/corporate.controller.ts`, `apps/api/src/corporate/corporate.module.ts`
- Modify: `apps/api/src/cost-centers/cost-centers.controller.ts`, `apps/api/src/cost-centers/cost-centers.module.ts`
- Modify: `apps/api/src/residents/residents.controller.ts`, `apps/api/src/residents/residents.module.ts`
- Modify: `apps/api/src/notifications/device-token.controller.ts`, `apps/api/src/notifications/notifications.module.ts`
- Modify: `apps/api/src/recurring/account-billing.controller.ts`, `apps/api/src/recurring/recurring.module.ts`
- Test: one new e2e test per controller (append to the existing spec file covering each surface — see Step 1)

**Interfaces:**
- Consumes: `IdempotencyInterceptor` from `apps/api/src/common/idempotency.interceptor.ts` (unchanged — the same class already used by `PaymentsController`, `OrdersController`, `DriverController`, etc.).
- Produces: no behavior change to any existing caller without an `Idempotency-Key` header (the interceptor no-ops without one).

**Root cause:** these 5 controllers are the only mutation-bearing controllers in the codebase that don't apply `@UseInterceptors(IdempotencyInterceptor)`. A retried/double-clicked request against any of their `POST`/`PATCH`/`PUT` endpoints creates a duplicate row (a corporate account, a building, a cost centre, a device-token registration, a billing-terms change) with no compensating unique constraint to catch it.

This is the same edit repeated 5 times — apply it identically to each, batched as one task.

- [ ] **Step 1: Write the failing tests**

For each of the 5 controllers, add ONE e2e test proving a replayed `Idempotency-Key` doesn't duplicate the created row. Find each controller's existing e2e spec file first (e.g. `apps/api/test/corporate-pricing.e2e-spec.ts` likely already covers `CorporateController`; `apps/api/test/cost-centers.e2e-spec.ts` for `CostCentersController`; check `apps/api/test/` for the others by grepping each controller's route path, e.g. `grep -rl "device-tokens" apps/api/test/`, `grep -rl "residents" apps/api/test/`, `grep -rl "billing-terms\|accounts.*cost-center\|standing-order" apps/api/test/`). Append to whichever existing file covers each surface, following that file's own `post()` helper pattern (it should already support a `key?: string` parameter appending `Idempotency-Key` — see `apps/api/test/orders.e2e-spec.ts:37-41` or `apps/api/test/payments.e2e-spec.ts` for the exact pattern to copy: `if (key) req = req.set('Idempotency-Key', key);`). If a file's `post()` helper doesn't yet support a key parameter, add it (additive, matches the established pattern verbatim).

One representative example (adapt the exact endpoint path, DTO body, and row-count-check to each controller — do not literally reuse this body, it's illustrative of the shape every one of the 5 should take):

```typescript
it('idempotency: replaying the same Idempotency-Key does not create a duplicate cost centre', async () => {
  const key = `create-cc-${Date.now()}`;
  const before = await prisma.costCenter.count({ where: { accountId: CONDO_ACCOUNT } });
  const a = await post(`/v1/accounts/${CONDO_ACCOUNT}/cost-centers`, 'owner', { code: `IDEMP-${Date.now()}`, name: 'Idempotency test' }, key).expect(201);
  const b = await post(`/v1/accounts/${CONDO_ACCOUNT}/cost-centers`, 'owner', { code: `IDEMP-${Date.now()}`, name: 'Idempotency test' }, key).expect(201);
  expect(b.body.id).toBe(a.body.id);
  expect((await prisma.costCenter.count({ where: { accountId: CONDO_ACCOUNT } })) - before).toBe(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```
npm run test:e2e -- <each-spec-file>
```
Expected: FAIL — each duplicate-check shows 2 created rows / 2 different ids, since nothing dedupes yet.

- [ ] **Step 3: Wire the interceptor — repeat identically for all 5**

For **`apps/api/src/corporate/corporate.controller.ts`**: add `UseInterceptors` to the `@nestjs/common` import, add `import { IdempotencyInterceptor } from '../common/idempotency.interceptor';`, and add `@UseInterceptors(IdempotencyInterceptor)` to the `@Controller('corporate')` class decorator block (same position as `PaymentsController`'s: right before `@Controller(...)`, after `@ApiBearerAuth()`). In `apps/api/src/corporate/corporate.module.ts`, add the same import and add `IdempotencyInterceptor` to the `providers: [CorporateService]` array (→ `providers: [CorporateService, IdempotencyInterceptor]`).

For **`apps/api/src/cost-centers/cost-centers.controller.ts`**: same pattern — `@UseInterceptors(IdempotencyInterceptor)` on `CostCentersController`'s class decorator (this file also exports `CostCenterAdminController` and there's a separate `OrderCostCenterController` in `order-cost-center.controller.ts` — leave those two untouched; only `CostCentersController`, which owns the flagged `POST :accountId/cost-centers`, needs this). In `apps/api/src/cost-centers/cost-centers.module.ts`, add `IdempotencyInterceptor` to `providers: [CostCentersService]` → `providers: [CostCentersService, IdempotencyInterceptor]`.

For **`apps/api/src/residents/residents.controller.ts`**: same pattern on `ResidentsController`'s class decorator. In `apps/api/src/residents/residents.module.ts`, add `IdempotencyInterceptor` to `providers: [ResidentService, GarmentService, AuditService]` → `..., IdempotencyInterceptor]`.

For **`apps/api/src/notifications/device-token.controller.ts`**: same pattern on `DeviceTokenController`'s class decorator (note this file currently has no `@ApiBearerAuth()`/`@Roles` decorators above the class besides `@ApiTags`/`@Controller` — add `@UseInterceptors(IdempotencyInterceptor)` directly above `@Controller('device-tokens')`). In `apps/api/src/notifications/notifications.module.ts`, add the import and add `IdempotencyInterceptor` to the `providers` array (after `DeviceTokenService`).

For **`apps/api/src/recurring/account-billing.controller.ts`**: same pattern on `AccountBillingController`'s class decorator. In `apps/api/src/recurring/recurring.module.ts`, add `IdempotencyInterceptor` to the `providers` array (after `StandingOrderGenerationService`) — note `StandingOrdersController` is a SEPARATE controller in the same module; leave it untouched unless you find it also has an unprotected mutation matching this same gap (if so, flag it in your report as a DONE_WITH_CONCERNS observation, don't silently expand scope).

`REDIS` (which `IdempotencyInterceptor` depends on) resolves in all 5 modules automatically — `RedisModule` is `@Global()`, no import needed.

- [ ] **Step 4: Run the tests to verify they pass**

```
npm run test:e2e -- <each-spec-file>
```
Expected: PASS.

- [ ] **Step 5: Run the full api e2e suite once to confirm no regression**

```
npm run test:e2e
```
(from `apps/api`) — Expected: all suites pass.

- [ ] **Step 6: Update CHANGELOG.md**

```
- HH:MM IST · **fix(api): idempotency-protect the 5 remaining unprotected mutation controllers** — corporate accounts/buildings, cost-centre creation, resident/garment writes, device-token registration, and account billing-terms/batch-invoice now wrap `IdempotencyInterceptor` like every other mutation controller in the codebase. → `apps/api/src/{corporate,cost-centers,residents,notifications,recurring}/*.{controller,module}.ts`
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/corporate/corporate.controller.ts apps/api/src/corporate/corporate.module.ts apps/api/src/cost-centers/cost-centers.controller.ts apps/api/src/cost-centers/cost-centers.module.ts apps/api/src/residents/residents.controller.ts apps/api/src/residents/residents.module.ts apps/api/src/notifications/device-token.controller.ts apps/api/src/notifications/notifications.module.ts apps/api/src/recurring/account-billing.controller.ts apps/api/src/recurring/recurring.module.ts CHANGELOG.md
git add apps/api/test/*.e2e-spec.ts
git commit -m "fix(api): idempotency-protect the 5 remaining unprotected mutation controllers"
```

---

### Task 2: De-duplicate the notification dispatch pipeline

**Files:**
- Modify: `apps/api/src/notifications/notification.service.ts`

**Interfaces:**
- Consumes: `NotificationPreferencesService.load`, `decideChannel` (from `./notification-policy`), `renderTemplate` (from `./notification-templates`), `NotificationProcessor.drainDue` — all unchanged.
- Produces: `dispatchGeofence`, `dispatchPayment`, `dispatchRateRequest` keep their exact existing public signatures — this is an internal refactor, zero change to any caller.

**Root cause:** `dispatchOne` (~line 66), `dispatchPayment` (~line 216), and `dispatchRateRequest` (~line 331) each independently implement the identical recipient×channel decide→render→enqueue loop (resolve preferences, call `decideChannel`, call `renderTemplate`, resolve addresses, compute `status`/`scheduledFor`/`lastError`/`dueNow`, call `insertOnce`, track `anyDue`, kick the drain). A future policy change (e.g. a new suppression branch) is easy to apply to two copies and miss the third.

- [ ] **Step 1: Write the failing test — a characterization test proving the current 3 methods behave identically before you touch them**

Before refactoring, confirm the existing e2e coverage for geofence/payment/rate-request notifications actually exercises all 3 methods (`grep -rl "dispatchGeofence\|dispatchPayment\|dispatchRateRequest\|GEOFENCE_APPROACHING\|payment.succeeded.*notif\|rate_request" apps/api/test/`). These tests are your regression net for this refactor — you are not writing new tests for this task, you're relying on and re-running the existing ones. If you find a genuine gap (one of the three has zero e2e coverage), note it in your report but do not expand this task's scope to add it — that's Task 4's kind of work, not this refactor's.

- [ ] **Step 2: Extract the shared loop into a private helper**

In `apps/api/src/notifications/notification.service.ts`, add this new private method (place it right after `dispatchGeofence`, before the now-private `dispatchOne` becomes a thin wrapper):

```typescript
  /**
   * The shared (recipient × channel) decide → render → enqueue loop every dispatch* method drives.
   * Extracted because dispatchOne/dispatchPayment/dispatchRateRequest previously reimplemented this
   * identically three times — a future policy change had to be applied in three places, easy to miss one.
   */
  private async dispatchToRecipients(params: {
    orgId: string;
    eventType: string;
    channels: CommsChannel[];
    recipients: RecipientUser[];
    urgent: boolean;
    sourceType: string;
    sourceId: string;
    dedupeKeyFor: (userId: string, channel: CommsChannel) => string;
    renderContextFor: (recipient: RecipientUser) => Record<string, unknown>;
    payloadExtrasFor?: (recipient: RecipientUser) => Record<string, unknown>;
    drainKickFailureLabel: string;
  }): Promise<void> {
    const now = new Date();
    let anyDue = false;

    for (const r of params.recipients) {
      const pref = await this.preferences.load(params.orgId, r.userId);
      for (const channel of params.channels) {
        const decision = decideChannel(
          pref,
          channel,
          params.urgent,
          now,
          this.config.quietHours.policy,
          this.config.quietHours.defaultTimezone,
        );
        const rendered = renderTemplate(params.eventType, channel, {
          appName: this.config.appName,
          ...params.renderContextFor(r),
        });
        const addresses = await this.addressesFor(params.orgId, channel, r);

        let status: NotificationStatus = NotificationStatus.PENDING;
        let scheduledFor: Date | null = null;
        let lastError: string | null = null;
        let dueNow = false;
        if (decision.action === 'suppress') {
          status = NotificationStatus.SUPPRESSED;
          lastError = decision.reason;
        } else if (addresses.length === 0) {
          status = NotificationStatus.SUPPRESSED;
          lastError = 'no destination address for channel';
        } else if (decision.action === 'defer') {
          scheduledFor = decision.scheduledFor;
        } else {
          dueNow = true;
        }

        const insertedId = await this.insertOnce({
          orgId: params.orgId,
          userId: r.userId,
          eventType: params.eventType,
          channel,
          status,
          urgent: params.urgent,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          dedupeKey: params.dedupeKeyFor(r.userId, channel),
          scheduledFor,
          lastError,
          payload: {
            recipients: addresses,
            subject: rendered.subject,
            title: rendered.title,
            body: rendered.body,
            eventType: params.eventType,
            ...(params.payloadExtrasFor?.(r) ?? {}),
          },
        });
        if (insertedId && dueNow) anyDue = true;
      }
    }

    if (anyDue && this.config.retry.kickOnDispatch) {
      void this.processor.drainDue().catch((err) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.logger.warn(`${params.drainKickFailureLabel} drain kick failed: ${reason}`);
      });
    }
  }
```

Add `CommsChannel` to the existing `@blue-bee/shared` import at the top of the file if it isn't already imported as a value (check — it's currently imported for `.SMS`/`.EMAIL`/`.PUSH` usage in `addressesFor`, so it should already be a value import; just confirm the type usage in the new method's signature compiles).

- [ ] **Step 3: Rewrite `dispatchOne` as a thin wrapper**

Replace the body of `dispatchOne` (currently everything from `if (!ev.orderId) return;` through the closing `}` before `addressesFor`) with:

```typescript
  private async dispatchOne(orgId: string, ev: GeofenceNotification): Promise<void> {
    if (!ev.orderId) return; // no order ⇒ no owning customer to notify
    const eventType =
      ev.kind === 'ARRIVED' ? NOTIFICATION_EVENTS.GEOFENCE_ARRIVED : NOTIFICATION_EVENTS.GEOFENCE_APPROACHING;
    const channels = this.config.matrix[eventType] ?? [];
    if (channels.length === 0) return;

    const recipients = await this.recipients.resolveOrderRecipients(orgId, ev.orderId);
    if (recipients.length === 0) return;

    const driverName = await this.recipients.driverNameForStop(orgId, ev.stopId);
    const orderRef = shortOrderRef(ev.orderId);
    const etaMinutes = etaSecondsToMinutes(ev.etaSeconds);
    const urgent = this.config.urgentEventTypes.has(eventType);

    await this.dispatchToRecipients({
      orgId,
      eventType,
      channels,
      recipients,
      urgent,
      sourceType: 'GeofenceEvent',
      sourceId: ev.geofenceEventId,
      dedupeKeyFor: (userId, channel) => `${ev.geofenceEventId}:${userId}:${channel}`,
      renderContextFor: () => ({ driverName, orderRef, etaMinutes }),
      payloadExtrasFor: () => ({ orderId: ev.orderId }),
      drainKickFailureLabel: 'notification',
    });
  }
```

- [ ] **Step 4: Rewrite `dispatchPayment` as a thin wrapper**

Replace `dispatchPayment`'s body (the `try { ... } catch` block's contents, keeping the outer try/catch since this method — unlike `dispatchOne`, which is called from within `dispatchGeofence`'s own try/catch per event — is called directly and must stay self-contained/never-throwing) with:

```typescript
  async dispatchPayment(input: {
    orgId: string;
    eventType: string;
    sourceType: 'Payment' | 'Dispute';
    sourceId: string;
    orderId: string | null;
    accountId?: string | null;
    recipientScope: 'customer' | 'staff';
    amount?: string | null;
    currency?: string | null;
    reason?: string | null;
  }): Promise<void> {
    try {
      const channels = this.config.matrix[input.eventType] ?? [];
      if (channels.length === 0) return;

      const recipients =
        input.recipientScope === 'staff'
          ? await this.recipients.resolveOrgStaffRecipients(input.orgId)
          : input.orderId
            ? await this.recipients.resolveOrderRecipients(input.orgId, input.orderId)
            : input.accountId
              ? await this.recipients.resolveAccountRecipients(input.orgId, input.accountId)
              : [];
      if (recipients.length === 0) return;

      const orderRef = input.orderId ? shortOrderRef(input.orderId) : `#${input.sourceId.slice(0, 8)}`;
      const urgent = this.config.urgentEventTypes.has(input.eventType);

      await this.dispatchToRecipients({
        orgId: input.orgId,
        eventType: input.eventType,
        channels,
        recipients,
        urgent,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        dedupeKeyFor: (userId, channel) => `${input.sourceId}:${input.eventType}:${userId}:${channel}`,
        renderContextFor: () => ({ orderRef, amount: input.amount, currency: input.currency, reason: input.reason }),
        payloadExtrasFor: () => ({ orderId: input.orderId }),
        drainKickFailureLabel: `payment notification (${input.eventType} ${input.sourceId})`,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`payment notification dispatch failed (${input.eventType} ${input.sourceId}): ${reason}`);
    }
  }
```

- [ ] **Step 5: Rewrite `dispatchRateRequest` as a thin wrapper**

Replace `dispatchRateRequest`'s body similarly:

```typescript
  async dispatchRateRequest(orgId: string, orderId: string): Promise<void> {
    try {
      const eventType = NOTIFICATION_EVENTS.RATE_REQUEST;
      const channels = this.config.matrix[eventType] ?? [];
      if (channels.length === 0) return;

      const recipients = await this.recipients.resolveOrderRecipients(orgId, orderId);
      if (recipients.length === 0) return;

      const orderRef = shortOrderRef(orderId);
      const urgent = this.config.urgentEventTypes.has(eventType);

      await this.dispatchToRecipients({
        orgId,
        eventType,
        channels,
        recipients,
        urgent,
        sourceType: 'Order',
        sourceId: orderId,
        dedupeKeyFor: (userId, channel) => `${orderId}:${eventType}:${userId}:${channel}`,
        renderContextFor: () => ({ orderRef }),
        drainKickFailureLabel: `rate-request notification (order ${orderId})`,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`rate-request notification dispatch failed (order ${orderId}): ${reason}`);
    }
  }
```

- [ ] **Step 6: Run the existing notification-related e2e tests to verify byte-identical behavior**

Run whichever spec files Step 1 identified (e.g. `tracking.e2e-spec.ts` or a dedicated notifications spec for geofence alerts, `payments.e2e-spec.ts` for payment notifications, `ratings.e2e-spec.ts` for rate-request). Expected: PASS, identical to before the refactor — this is a pure structural change, no behavior should differ (dedupe keys, payload shapes, and the suppress/defer/due-now decision logic are unchanged, just deduplicated into one method).

- [ ] **Step 7: Run the full api e2e suite once to confirm no interference**

```
npm run test:e2e
```

- [ ] **Step 8: Update CHANGELOG.md**

```
- HH:MM IST · **refactor(notifications): de-duplicate the dispatch pipeline** — `dispatchOne`/`dispatchPayment`/`dispatchRateRequest` each reimplemented the identical recipient×channel decide/render/enqueue loop; extracted into one shared `dispatchToRecipients` helper. No behavior change (verified against existing e2e coverage). → `apps/api/src/notifications/notification.service.ts`
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/notifications/notification.service.ts CHANGELOG.md
git commit -m "refactor(notifications): de-duplicate the dispatch pipeline into one shared recipient loop"
```

---

### Task 3: Small API hardening & hygiene batch

**Files:**
- Modify: `apps/api/src/auth/otp.service.ts`
- Modify: `apps/api/src/auth/principal.service.ts`
- Investigate + fix: `apps/api/src/orders/weigh.service.ts`
- Create: `apps/api/.eslintrc.js`
- Modify: `apps/api/package.json`
- Create: `packages/shared/.eslintrc.js`
- Modify: `packages/shared/package.json`
- Modify: `packages/api-client/README.md`

**Interfaces:** none of these changes affect any public interface — all are internal hardening, tooling, or documentation.

This task bundles 5 small, independent, low-risk fixes. Do them in order; each gets its own commit-worthy verification step, but they land in one commit since none is worth its own task-review cycle in isolation.

- [ ] **Step 1: Defensive org-scoping on `otp.service.ts`'s `resolveUser`**

Read `apps/api/src/auth/otp.service.ts`'s `resolveUser(phone: string, orgId?: string)` method (~line 37) and the caller(s) — `requestOtp` calls it WITHOUT an `orgId` (single-tenant today, but `verifyOtp` passes one). Change `requestOtp`'s call site to pass the org id it already has available (check what's in scope at that call site — if `requestOtp` doesn't currently resolve an org first, this may require finding how `verifyOtp` gets its org id and mirroring that, OR — if there is genuinely no org context available before the user is resolved in a multi-tenant-ready way — document why in a comment rather than fabricate a fix that doesn't actually scope anything). This is genuinely defensive (single-tenant today, so no live bug), so if after investigating you find there's no clean way to pass an org id without a larger refactor, it's acceptable to leave the existing code-comment explaining the known gap and move on — report this as a DONE_WITH_CONCERNS note rather than force a change that doesn't hold up. Write a unit test (`apps/api/src/auth/otp.service.spec.ts` — check if one exists first) asserting whatever the actual resulting behavior is (either the org-scoped lookup, or — if left as documented-gap — no new test needed).

- [ ] **Step 2: Defensive org-scoping on `principal.service.ts`'s `loadGrants`**

Read `apps/api/src/auth/principal.service.ts:11-12` (`loadGrants(userId: string)` → `this.prisma.userRole.findMany({ where: { userId } })`, no `orgId` filter). Since `userId` already uniquely identifies a user (and a `User` row belongs to exactly one org, per `apps/api/prisma/schema.prisma`'s `User.orgId`), this isn't exploitable today, but hardening it costs nothing: change the signature to `loadGrants(userId: string, orgId?: string)` and, when `orgId` is provided, filter `where: { userId, orgId }`. Check every call site (`grep -rn "loadGrants(" apps/api/src apps/api/test`) — most already have a `user` object with `.orgId` available (e.g. `ratings.e2e-spec.ts`'s test helper does `principals.loadGrants(user.id)` right after `prisma.user.findFirstOrThrow(...)`). Update `TokenService.issuePair`/`.rotate` (the two call sites inside `token.service.ts`) to pass `user.orgId` since they already have the full `User` row in scope. Leave test-helper call sites as-is (optional param, backward compatible) unless updating them is trivial. Add a unit test in `apps/api/src/auth/principal.service.spec.ts` (check if one exists first) asserting `loadGrants(userId, wrongOrgId)` returns an empty array even when the user has real roles in their actual org.

- [ ] **Step 3: Investigate and reconcile the weigh.service.ts re-quote comment inconsistency**

This one needs actual investigation, not a blind text edit — a quick read during planning found the situation is more nuanced than "one comment is simply stale":
- `apps/api/src/orders/weigh.service.ts:22-27` (`QUOTABLE` array's doc comment) claims a plant re-weigh after `QUOTE_APPROVED` "re-opens the quote (QUOTE_APPROVED → QUOTED) and re-prices."
- The same file's class-level doc comment (~line 40-42) has a `TODO (deferred, needs a re-quote flow)` claiming re-pricing after `QUOTE_APPROVED` is **not** implemented.
- But the actual method body (~line 212-236) DOES contain an `isRequote = currentStatus === OrderStatus.QUOTE_APPROVED` branch that calls `this.quotes.build(...)` and either re-approves with a `'re-priced on plant re-weigh'` audit note or returns `{ orderStatus: OrderStatus.QUOTED }` for the FROM_MEASURED case.

Your job: determine which claim is actually true by reading `QuoteService.build`/`QuoteService.approve` (in `apps/api/src/orders/quote.service.ts`) and the order state-machine's transition graph (`apps/api/src/orders/state-machine.service.ts` or wherever `canTransitionOrder`/the §5.1 graph lives) to see whether `quotes.build`/`quotes.approve` actually mutate `Order.status` via a guarded state-machine transition for this path, or whether the `orderStatus` field returned by `weighForOrder` is just a computed/reported value that doesn't correspond to an actual persisted transition. Check for an existing e2e test that exercises a re-weigh after `QUOTE_APPROVED` (`grep -rn "QUOTE_APPROVED" apps/api/test/weigh.e2e-spec.ts`) — if one exists and passes, that's your ground truth for what actually happens; if none exists, write one that re-weighs an order already at `QUOTE_APPROVED` and asserts the actual resulting `Order.status` and whether a new `Quote` row was created, to settle the question empirically. Then:
- If the re-quote flow genuinely works end-to-end: delete the stale TODO (lines ~40-42) since it's simply wrong, and keep the QUOTABLE comment.
- If it genuinely doesn't fully work (e.g. `orderStatus: QUOTED` is returned but `Order.status` in the DB never actually changes, or the customer-facing quote-approval flow doesn't correctly re-surface for a FROM_MEASURED re-weigh): fix the QUOTABLE comment to match the TODO's honest framing instead.
- Either way, leave exactly ONE comment describing this behavior, matching verified reality — write the e2e test in Step 3 as your evidence for the report either way, even if you conclude no code change is needed beyond the comment.

- [ ] **Step 4: Run the affected unit/e2e tests**

```
npx jest --runInBand otp.service principal.service   # from apps/api, unit
npm run test:e2e -- weigh.e2e-spec.ts                # from apps/api, e2e
```
Expected: PASS.

- [ ] **Step 5: Add lint configuration to `apps/api` and `packages/shared`**

Create `apps/api/.eslintrc.js` with this exact content (verbatim copy of `packages/api-client/.eslintrc.js`'s pattern, which is identical across every TS-only package in this monorepo):

```javascript
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, node: true, jest: true },
  ignorePatterns: ['node_modules/', 'dist/', '.eslintrc.js', 'jest.config.js', 'jest-e2e.config.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['**/*.spec.ts', 'test/**/*.ts'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};
```

Add a `lint` script to `apps/api/package.json`, in the same position/style as the other scripts: `"lint": "eslint . --ext .ts --max-warnings=0",`.

Create `packages/shared/.eslintrc.js` with the identical content (adjust `ignorePatterns`/`overrides` if `packages/shared` has no test files matching `**/*.spec.ts` — check first: `find packages/shared/src -name "*.test.ts" -o -name "*.spec.ts"`, and use whatever pattern actually matches, e.g. `**/*.test.ts` if that's the convention there). Add the same `"lint"` script to `packages/shared/package.json`.

- [ ] **Step 6: Run lint on both and fix any findings**

```
cd apps/api && npx eslint . --ext .ts --max-warnings=0
cd packages/shared && npx eslint . --ext .ts --max-warnings=0
```
These are BRAND NEW lint configs running against existing, previously-unlinted code — expect real findings (unused vars, etc.). Fix every one; do not add `// eslint-disable` comments to silence a finding unless the existing codebase convention already does so for that exact situation (e.g. `packages/shared`'s own `Prisma`-generated-type interop comments, if any) — a genuine unused variable or import should be deleted, not suppressed. If eslint or `@typescript-eslint/*` packages aren't resolvable from these workspaces (check by running the command — if it errors with "Cannot find module", not "self-explanatory lint findings"), add the exact same `devDependencies` versions `packages/api-client/package.json` declares for `eslint`/`@typescript-eslint/parser`/`@typescript-eslint/eslint-plugin` to `apps/api/package.json` and `packages/shared/package.json`, then `npm install` from the repo root and retry.

- [ ] **Step 7: Fix the `packages/api-client` README's inaccurate "OpenAPI-generated" framing**

The monorepo's `ARCHITECTURE.md` (and originally `CLAUDE.md`) describe `packages/api-client` as "typed API client (generated from OpenAPI)." It isn't — `packages/api-client/README.md` already correctly says so ("Not OpenAPI-generated... the contract that matters is the shared types in `@blue-bee/shared`"), but the ROOT docs still describe it the old way. Find the exact line in `README.md` (repo root) — `| \`packages/api-client\` | typed API client |` — and `CLAUDE.md`'s monorepo-layout section (`packages/api-client                             — typed API client (generated from OpenAPI)`), and remove the "(generated from OpenAPI)" parenthetical from both, replacing with something accurate like "(hand-written, typed against `@blue-bee/shared`)". Do not touch `packages/api-client/README.md` itself — it's already correct.

- [ ] **Step 8: Update CHANGELOG.md**

```
- HH:MM IST · **fix(auth): defensive org-scoping on loadGrants** — `PrincipalService.loadGrants` now accepts an optional `orgId` filter (harmless today, single-tenant; hardens ahead of multi-tenancy). `OtpService.requestOtp`'s user lookup [reconciled per investigation — describe actual outcome]. Investigated and reconciled the contradictory re-quote comments in `weigh.service.ts` against verified behavior. Added lint configs to `apps/api` and `packages/shared` (previously the only two workspaces without one) and fixed every finding. Corrected the root README/CLAUDE.md's inaccurate claim that `packages/api-client` is OpenAPI-generated. → `apps/api/src/auth/{otp,principal}.service.ts`, `apps/api/src/orders/weigh.service.ts`, `apps/api/.eslintrc.js`, `packages/shared/.eslintrc.js`, `README.md`, `CLAUDE.md`
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/auth/otp.service.ts apps/api/src/auth/principal.service.ts apps/api/src/auth/token.service.ts apps/api/src/orders/weigh.service.ts apps/api/.eslintrc.js apps/api/package.json packages/shared/.eslintrc.js packages/shared/package.json packages/api-client/package.json README.md CLAUDE.md CHANGELOG.md
git add -u
git commit -m "fix(api): defensive org-scoping hardening, reconcile weigh.service.ts comments, add missing lint configs, correct api-client docs"
```

---

### Task 4: Add concurrency-race test coverage to corporate, referral, and ratings

**Files:**
- Modify: `apps/api/test/corporate-pricing.e2e-spec.ts` (confirm exact filename first — see Step 0)
- Modify: `apps/api/test/referral.e2e-spec.ts`
- Modify: `apps/api/test/ratings.e2e-spec.ts`

**Interfaces:** test-only task, no source changes.

**Root cause, re-verified during planning (correcting the original review's framing):** all three e2e spec files already exist with real happy-path/RBAC coverage — the original review's "no test coverage" claim was wrong for these three, matching the same mistake already caught twice in the prior round (credits, driver). What's genuinely missing, confirmed by grepping all three files for `Promise.all`/`concurrent` (zero matches in any): none of them test the concurrency-safety logic their own source code comments claim exists — `CreditsService`-adjacent `ReferralService.attributeReferral`/`ensureCode`'s P2002-race handling, `CorporateService.redeem`/`generateJoinCode`'s P2002-race handling, and whatever equivalent one-per-order/one-per-user guard `ratings` relies on for "a customer can only rate an order once."

- [ ] **Step 0: Confirm exact file/method names before writing anything**

Run:
```
grep -n "P2002\|catch.*Prisma" apps/api/src/referral/referral.service.ts apps/api/src/corporate/corporate.service.ts apps/api/src/ratings/ratings.service.ts
```
This tells you the EXACT method names and unique-constraint-race-handling code you're about to test — the plan's framing above (`attributeReferral`/`ensureCode`, `redeem`/`generateJoinCode`) is from the original review and may have drifted; verify against current source before writing the test bodies below, and adjust method/endpoint names to match what you actually find.

- [ ] **Step 1: Write the failing concurrency tests**

For **referral** (`apps/api/test/referral.e2e-spec.ts`), add a test firing the referral-attribution path (or whichever endpoint triggers `attributeReferral`/`ensureCode`) twice concurrently via `Promise.all` for the same referred user/code, then assert exactly one attribution/code row exists in the DB (not two) — mirror the shape of `orders.e2e-spec.ts:129-139`'s `'idempotency is concurrency-safe'` test (same `Promise.all` + single-DB-row-count-after pattern), adapted to referral's actual schema/endpoint.

For **corporate** (`apps/api/test/corporate-pricing.e2e-spec.ts`), add a test firing `generateJoinCode` (or the redeem path — whichever has the P2002 handling Step 0 found) twice concurrently for the same target, asserting exactly one row results.

For **ratings** (`apps/api/test/ratings.e2e-spec.ts`), add a test firing `POST /v1/orders/:id/rating` twice concurrently (`Promise.all`) for the SAME order/customer, asserting exactly one `Rating` row exists afterward (not two, and not a 500 from an unhandled unique-constraint collision) — this is the "a customer can only rate an order once" guarantee under a genuine race, not just a sequential 409-on-retry (which the file may already test).

- [ ] **Step 2: Run the tests to verify they fail (or flake)**

```
npm run test:e2e -- referral.e2e-spec.ts corporate-pricing.e2e-spec.ts ratings.e2e-spec.ts
```
Race conditions don't always fail on the first try — if a test passes immediately, re-run it 3-4 times to confirm whether the underlying guard is real (if it's ALREADY race-safe, that's a valid, good outcome — see Step 3) or just usually-not-triggered.

- [ ] **Step 3: If a test never fails no matter how many times you run it, that's a PASS, not a bug to force**

Unlike the previous plan's Task 1 (a genuine, confirmed-failing race), it's possible some or all of these three ARE already correctly race-safe (the source comments claim explicit P2002 handling, which — if Step 0 confirms it's real — should make these tests pass immediately and reliably). In that case: no source fix is needed for that specific one — the test itself, now passing and proving the guarantee, IS the deliverable. Do not modify source code to "make a test fail then pass" if the code was already correct; that would be manufacturing a fix for a non-bug. If ANY of the three genuinely fails (an unhandled 500, or two rows instead of one), fix it following the exact pattern already used elsewhere in that same service for the same race (e.g. if `CreditsService.redeemForOrder`'s `catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') { ... } }` pattern isn't actually applied at the specific site that's failing, apply that exact pattern there).

- [ ] **Step 4: Run the full api e2e suite once to confirm no regression**

```
npm run test:e2e
```

- [ ] **Step 5: Update CHANGELOG.md**

```
- HH:MM IST · **test(api): add concurrency-race coverage for referral, corporate join-codes, and ratings** — each module's source comments claimed P2002-race safety with nothing asserting it under an actual race; new tests fire the relevant mutation concurrently via Promise.all and assert exactly one row results. [Note any source fixes that were genuinely needed, or state all three were already race-safe.] → `apps/api/test/{referral,corporate-pricing,ratings}.e2e-spec.ts`[, any source files fixed]
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/test/referral.e2e-spec.ts apps/api/test/corporate-pricing.e2e-spec.ts apps/api/test/ratings.e2e-spec.ts CHANGELOG.md
git add -u   # in case Step 3 required a source fix
git commit -m "test(api): add concurrency-race coverage for referral attribution, corporate join-codes, and order ratings"
```

---

### Task 5: Migrate the web console's refresh token to an httpOnly cookie — API side

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Create: `apps/api/src/auth/refresh-cookie.ts`
- Modify: `apps/api/package.json` (add `cookie-parser` + `@types/cookie-parser`)
- Modify: `packages/shared/src/auth.ts` (`refreshSchema`)
- Test: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Produces: `setRefreshCookie(res: Response, token: string, ttlSeconds: number): void`, `clearRefreshCookie(res: Response): void`, `assertTrustedOrigin(req: Request, allowedOrigins: string[]): void`, `REFRESH_COOKIE_NAME` (exported constant) — all new, from `apps/api/src/auth/refresh-cookie.ts`.
- Consumes: unchanged `AuthService.verify`/`.refresh`/`.logout`, `CredentialAuthService.register`/`.loginEmail`/`.oauthSignIn`, `TokenService` — none of their internals change, only how the controller wires cookies around their existing `TokenPair`/`AuthResultView` return values.

**Root cause + design (read this before writing code — the "why," not just the "what"):** the web console's refresh token currently sits in `localStorage` (`apps/web/lib/token-store.ts`), a real XSS blast-radius. The original developer's own code comment explains why this wasn't done already: the shared `packages/api-client` transport is used by BOTH the web console AND three native Expo apps (customer/driver/owner), and forking that transport into a web-specific BFF felt like too big a change. **This plan does NOT fork the transport.** Instead: the SAME `POST /v1/auth/refresh` endpoint learns to accept the refresh token from EITHER the request body (unchanged — native apps keep working exactly as today, since React Native's fetch doesn't manage cookies the way a browser does, so a cookie sent to a native client is simply ignored) OR an httpOnly cookie (new — the web console never touches the raw token in JS again). Every token-issuing endpoint (`/verify`, `/login`, `/register`, `/oauth`, `/refresh`) additionally sets the cookie on its response; native apps ignore the `Set-Cookie` header (they have no cookie jar for this origin), so this is 100% additive and backward-compatible.

**Deployment topology this design accounts for (confirmed via `docs/DEPLOY-RAILWAY.md`):** the API and web console are on different Railway subdomains under `up.railway.app`, a Public-Suffix-List domain — meaning they are cross-**site**, not just cross-origin. This is why the cookie needs `SameSite=None; Secure` (not `Lax`/`Strict`, which would silently never be sent) and why CSRF needs an explicit Origin-header check (`SameSite=None` alone provides zero CSRF protection — see Step 3).

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/auth.e2e-spec.ts` (check this file exists — grep for it; it should, since `/v1/auth/*` is well-covered elsewhere in the suite already):

```typescript
import request from 'supertest'; // if not already imported

// ... inside the existing describe block, or a new one:

describe('httpOnly refresh cookie (web console hardening)', () => {
  const WEB_ORIGIN = 'https://web-production-ba508.up.railway.app'; // must match a real CORS_ALLOWED_ORIGINS entry in test env — check apps/api/.env / test setup for what's actually configured, adjust if different

  it('verify sets an httpOnly refresh cookie AND still returns the token in the body (native compat)', async () => {
    // ... send an OTP, verify it (reuse this file's existing OTP-request-and-verify helper if one exists)
    const res = await request(app.getHttpServer())
      .post('/v1/auth/verify')
      .set('Origin', WEB_ORIGIN)
      .send({ phone: SOME_SEEDED_PHONE, code: DEV_BYPASS_OR_REAL_CODE });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeTruthy(); // native apps still get it in the body
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie;
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/SameSite=None/i);
  });

  it('refresh works via the cookie ALONE, with no body token (the web path)', async () => {
    const agent = request.agent(app.getHttpServer()); // supertest agent = automatic cookie jar
    const verifyRes = await agent.post('/v1/auth/verify').set('Origin', WEB_ORIGIN).send({ phone: SOME_SEEDED_PHONE, code: DEV_BYPASS_OR_REAL_CODE }).expect(200);
    const refreshRes = await agent.post('/v1/auth/refresh').set('Origin', WEB_ORIGIN).send({}).expect(200); // EMPTY body
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.body.accessToken).not.toBe(verifyRes.body.accessToken); // genuinely rotated
  });

  it('refresh still works via the BODY alone, with no cookie (native app compat — the existing behavior, unchanged)', async () => {
    const verifyRes = await request(app.getHttpServer()).post('/v1/auth/verify').send({ phone: SOME_SEEDED_PHONE, code: DEV_BYPASS_OR_REAL_CODE }).expect(200);
    const refreshRes = await request(app.getHttpServer()).post('/v1/auth/refresh').send({ refreshToken: verifyRes.body.refreshToken }).expect(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
  });

  it('a refresh cookie from an untrusted Origin is rejected (CSRF defense)', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/v1/auth/verify').set('Origin', WEB_ORIGIN).send({ phone: SOME_SEEDED_PHONE, code: DEV_BYPASS_OR_REAL_CODE }).expect(200);
    await agent.post('/v1/auth/refresh').set('Origin', 'https://evil.example').send({}).expect(403);
  });

  it('logout clears the cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/v1/auth/verify').set('Origin', WEB_ORIGIN).send({ phone: SOME_SEEDED_PHONE, code: DEV_BYPASS_OR_REAL_CODE }).expect(200);
    const logoutRes = await agent.post('/v1/auth/logout').set('Origin', WEB_ORIGIN).set('Authorization', `Bearer ${/* accessToken from verify */''}`).send({}).expect(200);
    const setCookie = logoutRes.headers['set-cookie'];
    expect(Array.isArray(setCookie) ? setCookie.join(';') : setCookie).toMatch(/bb_refresh=;/); // cleared
  });
});
```

This is illustrative — you MUST adapt the exact phone/OTP-bypass mechanism, seeded fixtures, and Authorization-header wiring to match this file's ACTUAL existing helpers (read the whole file first; don't guess at a `SOME_SEEDED_PHONE` constant that doesn't exist). Check `.env`/`apps/api/.env`'s `OTP_DEV_BYPASS_CODE` and `CORS_ALLOWED_ORIGINS` — for these tests to run locally, `CORS_ALLOWED_ORIGINS` needs to include a test origin; if it's unset in the local `.env`, either set it for the test run or make the Origin-check test use whatever origin IS configured, and confirm with a NEGATIVE test (a truly-foreign origin) that the check has teeth regardless of what the positive-case origin is.

- [ ] **Step 2: Run the tests to verify they fail**

```
npm run test:e2e -- auth.e2e-spec.ts
```
Expected: FAIL — no cookie is set yet, refresh-via-cookie-alone returns 400/401 (refreshToken required by the current schema), the Origin check doesn't exist yet.

- [ ] **Step 3: Create the refresh-cookie helper**

Create `apps/api/src/auth/refresh-cookie.ts`:

```typescript
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AUTH_ERRORS } from '@blue-bee/shared';

/** Path-scoped so the cookie is never sent to non-auth routes. */
export const REFRESH_COOKIE_NAME = 'bb_refresh';
const COOKIE_PATH = '/v1/auth';

/**
 * Sets the web console's httpOnly refresh cookie. `SameSite=None` (not Lax/Strict) is required
 * because the API and web console are on different Railway subdomains under the PSL-listed
 * `up.railway.app` — they are cross-SITE, and Lax/Strict cookies are never sent cross-site even via
 * fetch/XHR. `Secure` is required by spec whenever SameSite=None is used, and is unconditional in
 * production; local dev (plain HTTP) falls back to Lax + non-Secure so cookie-based refresh is still
 * testable without HTTPS (see `assertTrustedOrigin` for the actual CSRF defense — SameSite alone does
 * NOT protect this cookie in production, since None disables that protection entirely by design).
 */
export function setRefreshCookie(res: Response, token: string, ttlSeconds: number): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: COOKIE_PATH,
    maxAge: ttlSeconds * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: COOKIE_PATH,
  });
}

/**
 * CSRF defense for the cookie-based refresh/logout path. `SameSite=None` means the browser WILL send
 * this cookie on a cross-site request — the classic "simple request" CSRF vector (a POST with no
 * custom headers can be sent by any origin and bypasses CORS preflight entirely; CORS only blocks the
 * ATTACKER'S PAGE from READING the response, not from causing the request's side effect). This check
 * closes that: reject outright unless the caller's Origin is one we trust. A request with NO Origin
 * header at all (native apps; most non-browser HTTP clients) is NOT rejected — this check exists only
 * to stop a BROWSER-based cross-site attack, and native requests were never subject to it.
 */
export function assertTrustedOrigin(req: Request, allowedOrigins: string[]): void {
  const origin = req.headers.origin;
  if (!origin) return; // no Origin header ⇒ not a browser cross-site request (native app, curl, etc.)
  if (!allowedOrigins.includes(origin)) {
    throw new ForbiddenException({ error: AUTH_ERRORS.FORBIDDEN_ROLE, message: 'Untrusted origin' });
  }
}
```

Check `AUTH_ERRORS` in `@blue-bee/shared` for whether `FORBIDDEN_ROLE` is the right existing error code to reuse here, or whether a more specific one already exists / should be added (e.g. `AUTH_ERRORS.UNTRUSTED_ORIGIN`) — if none fits, add one to `packages/shared/src/auth.ts`'s `AUTH_ERRORS` object following its existing naming convention, rather than overload an unrelated code.

- [ ] **Step 4: Make `refreshSchema` accept an optional token**

In `packages/shared/src/auth.ts`, change:
```typescript
export const refreshSchema = z.object({ refreshToken: z.string().min(20) });
```
to:
```typescript
export const refreshSchema = z.object({ refreshToken: z.string().min(20).optional() });
```
(matches `logoutSchema`'s existing pattern one line below it.)

- [ ] **Step 5: Wire cookies into `AuthController`**

In `apps/api/src/auth/auth.controller.ts`:

Add imports: `Res` to the `@nestjs/common` import list; `import type { Response } from 'express';` (alongside the existing `import type { Request } from 'express';`); `import { REFRESH_COOKIE_NAME, setRefreshCookie, clearRefreshCookie, assertTrustedOrigin } from './refresh-cookie';`.

Add a config injection for the allowed origins — check `apps/api/src/config/auth.config.ts` or wherever `CORS_ALLOWED_ORIGINS` is currently parsed (`main.ts` parses it inline; you may need to either inject `process.env.CORS_ALLOWED_ORIGINS` directly in the controller, matching `main.ts`'s exact parsing logic, `.split(',').map((o) => o.trim()).filter(Boolean)`, or — better — factor that parsing into a small exported helper both `main.ts` and this controller import, so the two never drift. Prefer the shared-helper approach if it's a small, clean extraction; if `main.ts`'s CORS setup is entangled enough that extracting it cleanly is more than a few lines, it's acceptable to duplicate the one-line `.split(',')...` parse in both places with a comment noting they must stay in sync).

Change `verify`, `login`, `register`, `oauth`, and `refresh` to accept `@Res({ passthrough: true }) res: Response` as an added parameter, and after obtaining the result (`TokenPair` directly for `verify`/`refresh`, or `.tokens` off `AuthResultView` for `register`/`login`/`oauth`), call `setRefreshCookie(res, pair.refreshToken, /* refresh TTL seconds — check AuthConfig for the exact field name, likely config.jwt.refreshTtlSeconds, injected via AUTH_CONFIG the same way TokenService does it */)` before returning. `@Res({ passthrough: true })` lets you still `return` the value normally — Nest serializes it as JSON exactly as before; passthrough mode only adds your manual response mutations (the cookie) alongside it.

Change `refresh` specifically: resolve the actual token as `body.refreshToken ?? req.cookies?.[REFRESH_COOKIE_NAME]`, call `assertTrustedOrigin(req, allowedOrigins)` FIRST (before touching any token, cookie or body), and throw a clear 400/401 if neither source has a token (don't let `this.auth.refresh(undefined, ...)` reach `TokenService.rotate` with an undefined token — check that call site's type and add an explicit guard: `if (!token) throw new UnauthorizedException(...)`).

Change `logout`: also call `assertTrustedOrigin(req, allowedOrigins)`, resolve `body.refreshToken ?? req.cookies?.[REFRESH_COOKIE_NAME]` the same way, call `clearRefreshCookie(res)` (add the `@Res({ passthrough: true })` param here too), and pass whichever token was resolved to `this.auth.logout(...)`.

- [ ] **Step 6: Wire `cookie-parser` in `main.ts`**

Add `cookie-parser` and `@types/cookie-parser` to `apps/api/package.json`'s `dependencies`/`devDependencies` (match the version ranges the rest of the file uses, e.g. `"cookie-parser": "^1.4.6"`), run `npm install` from the repo root, then in `apps/api/src/main.ts` add:
```typescript
import cookieParser from 'cookie-parser';
```
and, right after `const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });`:
```typescript
app.use(cookieParser());
```

Confirm the existing CORS block (`app.enableCors({ ... credentials: !allowAll, ... })`) already sets `credentials: true` whenever explicit origins are configured (it does, per the code read during planning — `credentials: !allowAll`) — no change needed there, but ADD `'Cookie'` is NOT needed in `allowedHeaders` (cookies aren't a custom header), just confirm `credentials: true` stays intact.

- [ ] **Step 7: Run the tests to verify they pass**

```
npm run test:e2e -- auth.e2e-spec.ts
```

- [ ] **Step 8: Run the full api e2e suite to confirm no regression**

```
npm run test:e2e
```
Pay special attention to any OTHER spec file that calls `/auth/verify`/`/auth/refresh`/`/auth/login` — confirm none of them break from the added `@Res` parameter or the now-optional `refreshToken` (a body WITHOUT `refreshToken` should still 400 on `/refresh` if no cookie is present either — re-check this doesn't silently start accepting garbage).

- [ ] **Step 9: Update CHANGELOG.md**

```
- HH:MM IST · **feat(auth): httpOnly refresh-token cookie for the web console** — `/v1/auth/{verify,login,register,oauth,refresh}` now ALSO set a `SameSite=None; Secure; HttpOnly` refresh cookie scoped to `/v1/auth`, alongside the unchanged JSON-body token (native apps ignore the cookie, zero behavior change for them). `/v1/auth/refresh` and `/logout` now accept the token via cookie OR body. An Origin allow-list check defends the cookie path against CSRF (SameSite=None provides none on its own, since the API and web console are cross-site Railway subdomains). → `apps/api/src/auth/{auth.controller,refresh-cookie}.ts`, `apps/api/src/main.ts`, `packages/shared/src/auth.ts`, `apps/api/test/auth.e2e-spec.ts`
```

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/auth/auth.controller.ts apps/api/src/auth/refresh-cookie.ts apps/api/src/main.ts apps/api/package.json package-lock.json packages/shared/src/auth.ts apps/api/test/auth.e2e-spec.ts CHANGELOG.md
git commit -m "feat(auth): add an httpOnly refresh-token cookie path for the web console, alongside the unchanged body-based path native apps use"
```

---

### Task 6: Migrate the web console's refresh token to an httpOnly cookie — Web side

**Depends on Task 5** (needs the API's cookie-issuing endpoints live).

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `apps/web/lib/token-store.ts`
- Modify: `apps/web/lib/token-store.test.ts`

**Interfaces:**
- Consumes: Task 5's cookie-issuing `/v1/auth/*` endpoints.
- Produces: `ApiClient`'s public methods are unchanged; `WebTokenStore` still implements the `TokenStore` interface from `packages/api-client/src/token-store.ts` unchanged (same 4 methods), just with different internals.

**Design:** `ApiClient.doRefresh()` currently bails out (`if (!refreshToken) return false;`) when the store holds no refresh token — which is exactly the state `WebTokenStore` will be in once it stops persisting one. Fix `doRefresh()` (and `request()`/`logout()`, which also need cookies to flow) to send `credentials: 'include'` on every fetch and to send an EMPTY body to `/auth/refresh` when the store has no token, instead of refusing to even try. This is a small, additive change to the ONE shared transport method — not a fork.

- [ ] **Step 1: Write the failing test**

In `packages/api-client/src/client.test.ts` (check this file's existing structure first — it likely mocks `global.fetch`), add a test asserting: (1) every `fetch` call made by `request()` includes `credentials: 'include'`, and (2) when `store.getRefresh()` resolves to `null`, `doRefresh()` (exercise it indirectly via a 401-then-retry scenario, matching this file's existing pattern for testing the refresh-retry flow) still calls `fetch('.../auth/refresh', ...)` with `credentials: 'include'` and a body of `{}` (not `undefined`, not throwing, not short-circuiting to `false` before even trying).

- [ ] **Step 2: Run the test to verify it fails**

```
npx jest client.test.ts --runInBand
```
(from `packages/api-client`) — Expected: FAIL, current code has no `credentials` option and bails out on a null refresh token.

- [ ] **Step 3: Update `ApiClient`'s transport**

In `packages/api-client/src/client.ts`:

In `request()` (~line 147-170), add `credentials: 'include'` to the `fetch()` call options object (alongside `method`, `headers`, `body`).

Replace `doRefresh()` (~line 182-197) with:

```typescript
  private async doRefresh(): Promise<boolean> {
    const refreshToken = await this.store.getRefresh();
    const res = await fetch(`${this.base}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(refreshToken ? { refreshToken } : {}),
    });
    if (!res.ok) {
      await this.store.clear(); // refresh reuse/expiry → force a fresh login
      return false;
    }
    const pair = (await res.json()) as TokenPair;
    await this.store.setTokens(pair.accessToken, pair.refreshToken);
    return true;
  }
```

(removed the `if (!refreshToken) return false;` early return — a null refresh token no longer means "can't refresh," it means "refresh via cookie instead.")

`logout()` (~line 126-133) already sends an empty body when there's no stored token (`body: refreshToken ? { refreshToken } : {}` via `this.request(...)`) — since Step in `request()` now adds `credentials: 'include'` globally, `logout()` needs no further change; the cookie will flow automatically and the server-side logout (Task 5) reads it when the body doesn't have one.

- [ ] **Step 4: Run the test to verify it passes**

```
npx jest client.test.ts --runInBand
```

- [ ] **Step 5: Run the full api-client suite**

```
npm test
```
(from `packages/api-client`)

- [ ] **Step 6: Simplify `WebTokenStore` — stop touching localStorage for the refresh token**

Replace `apps/web/lib/token-store.ts` entirely with:

```typescript
import type { TokenStore } from '@blue-bee/api-client';

/**
 * The web token store — implements the api-client `TokenStore` so the SAME proven transport
 * (single-flight 401→refresh→retry, problem+json→ApiError) runs in the browser unchanged.
 *
 * The access token lives in memory only (a closed tab drops it; disk XSS can't read it). The refresh
 * token is now an httpOnly cookie the SERVER sets and reads directly (see apps/api's
 * auth.controller.ts / refresh-cookie.ts) — this class never sees it, never stores it, and
 * `getRefresh()` always returns null (which `ApiClient.doRefresh()` now correctly treats as "refresh
 * via cookie" rather than "cannot refresh"). This closes the localStorage XSS exposure the previous
 * version explicitly traded off.
 */
export class WebTokenStore implements TokenStore {
  private access: string | null = null;

  async getAccess(): Promise<string | null> {
    return this.access;
  }

  async getRefresh(): Promise<string | null> {
    return null; // the httpOnly cookie carries this now — never exposed to JS
  }

  async setTokens(accessToken: string, _refreshToken: string): Promise<void> {
    this.access = accessToken;
    // refreshToken is intentionally ignored — the server already set it as an httpOnly cookie
    // on this same response; persisting it here would recreate the exact exposure we removed.
  }

  async clear(): Promise<void> {
    this.access = null;
    // no localStorage to clear — logout() (via ApiClient) hits /auth/logout, which clears the
    // server-side cookie (Task 5's clearRefreshCookie).
  }
}
```

- [ ] **Step 7: Update `apps/web/lib/token-store.test.ts`**

Read the existing test file first — it almost certainly asserts the OLD localStorage-writing behavior (`expect(localStorage.getItem(...)).toBe(...)`), which will now fail correctly (the whole point of this change). Rewrite its assertions to match the new contract: `getRefresh()` always resolves `null`; `setTokens()` updates `getAccess()` but writes nothing to `localStorage` (assert `localStorage.getItem('bb.console.refresh')` — or whatever the old key was — stays `null` after `setTokens()`); `clear()` resets `getAccess()` to `null`.

- [ ] **Step 8: Run the web test suite**

```
npx jest token-store --runInBand
```
(from `apps/web`), then the full suite: `npx jest --runInBand` (from `apps/web`).

- [ ] **Step 9: Manual verification note for the report (cannot be fully automated in this environment)**

Jest/supertest prove the mechanism works at the HTTP-and-cookie-jar level, but a REAL browser's `SameSite=None` cross-site cookie behavior (and whether Safari's ITP or another browser's tracking-prevention heuristics interfere) can only be fully confirmed against the actual deployed Railway origins, in a real browser, post-deploy. Note this explicitly in your report as the one thing that needs a founder/deployed-environment check before this is considered fully proven end-to-end — this mirrors how Increment 9's on-device GPS/push proof was split from its headless integration proof in this same codebase's own history.

- [ ] **Step 10: Update CHANGELOG.md**

```
- HH:MM IST · **fix(web): stop persisting the refresh token in localStorage** — `WebTokenStore` now relies entirely on the httpOnly cookie Task [N] added server-side; `getRefresh()` always returns null (which the shared `ApiClient.doRefresh()` now correctly treats as "use the cookie," not "cannot refresh"). Closes the XSS blast-radius the previous version explicitly traded off. Needs one real-browser check against the deployed Railway origins to confirm SameSite=None cross-site cookie delivery in production (mechanism fully proven via supertest's cookie-jar agent locally). → `packages/api-client/src/client.ts`, `apps/web/lib/token-store.ts`
```

- [ ] **Step 11: Commit**

```bash
git add packages/api-client/src/client.ts packages/api-client/src/client.test.ts apps/web/lib/token-store.ts apps/web/lib/token-store.test.ts CHANGELOG.md
git commit -m "fix(web): consume the httpOnly refresh cookie instead of persisting the token in localStorage"
```

---

### Task 7: Add a CI pipeline for the web console (and, cheaply, everything else)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:** none — CI config only.

**Root cause:** no `.github/` directory exists anywhere in the repo — nothing gates a merge on lint/typecheck/test passing, for any workspace, not just `apps/web` (the original review flagged web specifically, but the gap is repo-wide and costs nothing extra to close everywhere at once).

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  typecheck-and-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx prisma generate --schema apps/api/prisma/schema.prisma
      - run: npx turbo run typecheck
      - run: npx turbo run lint

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx prisma generate --schema apps/api/prisma/schema.prisma
      - run: npm run test:api-safe
      - run: npx jest --runInBand
        working-directory: apps/driver
      - run: npx jest --runInBand
        working-directory: apps/customer
      - run: npx jest --runInBand
        working-directory: apps/owner
      - run: npx jest --runInBand
        working-directory: apps/web
      - run: npx jest --runInBand
        working-directory: packages/api-client
      - run: npx jest --runInBand
        working-directory: packages/design-tokens
```

Deliberately excluded: `apps/api`'s e2e suite (needs live Postgres/PostGIS/TimescaleDB + Redis + MinIO — a real service-container CI job, out of scope for this task; note it as a follow-up in your report rather than attempting a full Docker Postgres-in-CI setup here, which is substantial enough to be its own task if wanted later). `packages/ui` — empty, nothing to test yet.

- [ ] **Step 2: Verify the workflow is syntactically valid**

```
npx js-yaml .github/workflows/ci.yml
```
(or any available YAML validator — if `js-yaml` isn't installed, `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` works equally well if Python is available; if neither is available, carefully re-read the file for indentation errors, GitHub Actions YAML is unforgiving).

- [ ] **Step 3: Confirm the commands referenced actually work locally, matching what CI will run**

```
npm ci
npx prisma generate --schema apps/api/prisma/schema.prisma
npx turbo run typecheck
npx turbo run lint
npm run test:api-safe
```
Run each from the repo root exactly as the workflow does. `npm ci` will reinstall `node_modules` from the lockfile — if this is disruptive in your current working environment, at minimum confirm `npx turbo run typecheck && npx turbo run lint` pass on the current install (already proven clean in the prior round's final review) and note in your report that a fresh `npm ci` wasn't independently re-verified if you skip it.

- [ ] **Step 4: Update CHANGELOG.md**

```
- HH:MM IST · **chore(ci): add a GitHub Actions pipeline** — typecheck + lint + unit tests across every workspace run on every PR and push to main. The API's e2e suite (needs live Postgres/Redis/MinIO) is deliberately deferred to a follow-up (service-container CI is a bigger task). → `.github/workflows/ci.yml`
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml CHANGELOG.md
git commit -m "chore(ci): add a GitHub Actions pipeline for typecheck, lint, and unit tests"
```

---

### Task 8: Type the weakly-typed web console view models

**Files:**
- Modify: `apps/web/lib/types.ts`

**Interfaces:**
- Produces: `QuoteView.lines`/`.adjustments`, `ItemView.measurements`, and `RouteStopOpsView.timeWindow` change from `any` to real types — any component destructuring these fields with an assumption that no longer typechecks will surface as a compile error (fix those call sites too, don't just silence the type and leave broken assumptions).

**Root cause:** three fields in `apps/web/lib/types.ts` are typed `any` (each with an `eslint-disable-next-line @typescript-eslint/no-explicit-any` comment, so this was a deliberate, acknowledged shortcut, not an oversight) — a backend shape change to any of them compiles cleanly here and fails silently at render time instead of at typecheck.

- [ ] **Step 1: Find the real shared types**

`RouteStopOpsView.timeWindow` (line 179) is the easy one — `apps/web/lib/types.ts` already defines `TimeWindowJson { start: string; end: string }` at line 27-30 in the SAME file, used elsewhere (`OrderDetail.scheduledPickupWindow`). Just change `timeWindow: any;` to `timeWindow: TimeWindowJson | null;` (confirm `null` is right by checking how the console actually renders this field — if it's always present, drop the `| null`).

For `ItemView.measurements`, check `packages/shared/src/orders.ts` for the `Measurements` type (`export type Measurements = z.infer<typeof measurementsSchema>` — found during planning) and its `measurementsSchema` definition (a few lines above). Import `Measurements` from `@blue-bee/shared` in `apps/web/lib/types.ts` and change `measurements: any;` to `measurements: Measurements | null;` (check whether the API ever returns `null`/`undefined` here for an unmeasured item — likely yes, since specialty items start unmeasured).

For `QuoteView.lines`/`.adjustments`, search `packages/shared/src/orders.ts` (and any sibling file it imports from) for the actual Quote line-item and adjustment shapes the API's `QuoteService`/`quote.controller.ts` DTOs use for a built quote (search for how `Quote.lines`/`Quote.adjustments` are populated in `apps/api/src/orders/quote.service.ts` — they're likely a `Prisma.JsonValue` on the DB side with an application-level shape defined somewhere in `packages/shared`, e.g. alongside `Upcharge` which was found during planning at `packages/shared/src/orders.ts:17-23`). If a proper `QuoteLine`/`QuoteAdjustment` type already exists in `@blue-bee/shared`, import and use it. If NONE exists anywhere (the shape was only ever implicitly defined by whatever `QuoteService.build` writes into the JSON column), define a minimal, accurate interface in `apps/web/lib/types.ts` itself based on reading `quote.service.ts`'s actual construction of these fields — do not guess a shape; read the code that produces the JSON and match it exactly. If the shape is genuinely too loosely-defined in the backend to type precisely without a larger backend change (e.g. it's truly free-form JSON with no consistent structure), it is acceptable to keep `unknown` (not `any` — `unknown` at least forces call sites to narrow before use) rather than fabricate a type that doesn't match reality; note this explicitly in your report rather than silently leaving `any`.

- [ ] **Step 2: Apply the type changes and fix any resulting compile errors**

```
npx tsc --noEmit
```
(from `apps/web`) — fix every new error this surfaces at call sites that destructure these fields (e.g. `AccountDetail.tsx`, `OrderDetail`-rendering components) with an assumption the new, accurate type now correctly flags as wrong or requiring a null-check.

- [ ] **Step 3: Run the web test suite**

```
npx jest --runInBand
```
(from `apps/web`) — expected: PASS, and if any test was implicitly relying on the old `any` hiding a real shape mismatch, it should now either still pass (if the test's fixture data was already shaped correctly) or reveal a genuine pre-existing test-data inaccuracy worth fixing.

- [ ] **Step 4: Remove the now-unneeded `eslint-disable` comments**

Delete the 3 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comments that no longer guard an `any` (if you kept `unknown` for the quote-lines case per Step 1's fallback, that field's disable comment can also be removed — `unknown` doesn't need it).

- [ ] **Step 5: Update CHANGELOG.md**

```
- HH:MM IST · **fix(web): type the console's weakly-typed view models** — `QuoteView.lines`/`.adjustments`, `ItemView.measurements`, and `RouteStopOpsView.timeWindow` were `any`; now typed against `@blue-bee/shared`'s real shapes (or `TimeWindowJson` already defined in the same file) so a backend shape change fails at typecheck instead of silently at render time. → `apps/web/lib/types.ts`[, any call sites fixed]
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/types.ts CHANGELOG.md
git add -u
git commit -m "fix(web): type the weakly-typed console view models against @blue-bee/shared"
```

---

### Task 9: Add test coverage for the Dispatch and Finance console entry screens

**Files:**
- Create: `apps/web/components/DispatchBoard.test.tsx`
- Create: `apps/web/components/FinanceHome.test.tsx`

**Interfaces:** test-only, no source changes (unless a genuine bug surfaces while writing the tests — if so, treat it like Task 4's Step 3: fix it following the codebase's existing conventions, don't leave a failing test in place).

**Root cause:** `apps/web/components/DispatchBoard.tsx` (route list/create + vehicle/driver/shift creation) and `apps/web/components/FinanceHome.tsx` (order-lookup + disputes list) are the entry points into two critical console flows, and neither has a direct test — only their drill-down pages (`RouteDetail.test.tsx`, `OrderBilling.test.tsx`) are tested.

- [ ] **Step 1: Read the components and their siblings' test patterns first**

Read `apps/web/components/DispatchBoard.tsx` and `apps/web/components/FinanceHome.tsx` in full, then read `apps/web/components/RouteDetail.test.tsx` and `apps/web/components/OrderBilling.test.tsx` (or `CustomerDetail.test.tsx`, already used as a reference pattern in the prior round for this exact codebase's mock/session conventions) to learn this codebase's exact test-mocking conventions: how `useSession()` is mocked, how the api-client's methods are stubbed with `jest.fn()`, how `@testing-library/react`'s `render`/`screen`/`fireEvent` (or `userEvent`) are used, and what RBAC/role fixtures (`me(...)` helper) look like.

- [ ] **Step 2: Write `DispatchBoard.test.tsx`**

Cover, at minimum: (1) the route list renders the routes returned by the mocked client call; (2) a user with `can.dispatch`/equivalent capability sees the create-route/create-vehicle/create-driver/create-shift controls, and a user without it doesn't (mirroring how `CustomerDetail.test.tsx` or another RBAC-aware test in this file set gates on role); (3) submitting the create-route (or whichever primary creation action the component exposes) form calls the corresponding client method with the expected arguments. Use real component behavior (render + interact + assert), not shallow snapshot tests.

- [ ] **Step 3: Write `FinanceHome.test.tsx`**

Cover, at minimum: (1) the order-lookup renders results from the mocked client call; (2) the disputes list renders; (3) whatever role-gating this screen has (check `lib/rbac.ts` for the capability it's gated behind) is asserted the same way as Step 2.

- [ ] **Step 4: Run the new tests**

```
npx jest DispatchBoard FinanceHome --runInBand
```
(from `apps/web`)

- [ ] **Step 5: Run the full web suite to confirm no interference**

```
npx jest --runInBand
```

- [ ] **Step 6: Update CHANGELOG.md**

```
- HH:MM IST · **test(web): cover the Dispatch and Finance console entry screens** — DispatchBoard and FinanceHome had no direct test (only their drill-down pages did); new tests cover rendering, RBAC gating, and the primary creation/lookup actions. → `apps/web/components/{DispatchBoard,FinanceHome}.test.tsx`
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/DispatchBoard.test.tsx apps/web/components/FinanceHome.test.tsx CHANGELOG.md
git commit -m "test(web): add coverage for the DispatchBoard and FinanceHome entry screens"
```

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** every item from the "never touched" list in the review follow-up conversation has a task, except the two explicitly-deferred items (packages/ui consolidation, broad 14-service unit-test sweep) and the oversized-component refactors (AccountDetail.tsx/CostCenters.tsx/ui.tsx) — those are pure maintainability items, not bugs, and are not included here; raise them as their own plan if wanted.
- **Task ordering:** Tasks 1-4 (API-side) and Tasks 7-9 (web-side, non-auth) are mutually independent and can run in any order. Task 5 must complete before Task 6 (interface dependency: the web side consumes the API's new cookie-issuing endpoints). Task 3's Step 3 (weigh.service.ts investigation) has a genuine open question this plan cannot resolve in advance — the implementer must investigate and report, not blindly apply a scripted fix.
- **Highest-risk task:** Task 5+6 (the auth cookie migration) touches every login path and the shared cross-app transport. Its design was chosen specifically to avoid forking that transport, but the implementer and reviewer should both scrutinize it harder than the other tasks — recommend the final whole-branch review (per subagent-driven-development) pay it the most attention, and recommend a real-browser smoke test against the deployed Railway origins before considering it fully done (Task 6 Step 9 already flags this).
- **Type consistency check:** `REFRESH_COOKIE_NAME` (Task 5) is referenced identically in `refresh-cookie.ts`, `auth.controller.ts`, and any test asserting `Set-Cookie` contents (Task 5's own tests) — confirm no drift. `setRefreshCookie`/`clearRefreshCookie`'s cookie options (`httpOnly`, `secure`, `sameSite`, `path`) must be IDENTICAL between the two functions, or `clearCookie` won't actually clear a cookie set with different options (a well-known Express/cookie gotcha) — the plan's own code above already keeps them matched; preserve that if you touch either function.
