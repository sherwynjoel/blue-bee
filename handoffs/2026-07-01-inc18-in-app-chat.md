# Inc-18 — In-app chat (customer ↔ driver, per active order, time-boxed)

**Date:** 2026-07-01 · **Branch:** `feature/in-app-chat-inc18` off `main` (`ca8e2de`, the Inc-17 tip) · **feature commit `8c860fa`** (+ a bookkeeping commit) · **Single CC session.**
**Status:** built, all suites green, pushed. **NOT merged** — founder lands it (ff) + redeploys. `7d1fa47` untouched, no force-push.

> **Note on landing:** at session start `main` was still `aa204ee` (Inc-17 not yet landed). Per the prompt's gate I stopped and, on the founder's explicit "you land the 17 now", fast-forwarded `main` → `ca8e2de` (clean ff, no merge commit, pushed `origin/main`), then branched Inc-18 off it.

---

## What shipped

A text chat between the **customer** and the **currently-assigned driver**, **scoped to one order**, **live only during that order's active delivery window**, **read-only after the stop completes**. Real message rows, real WS delivery over the existing gateway, real RBAC. No stubs.

**The three hard pieces were reused, not rebuilt:**

1. **`Message` model (already existed, was 100% dormant — no prior consumer).** Inc-18 is its first consumer. Kept its shape (`thread_id`, `order_id`, `from_user`, `to_user`, `channel`, `body`, `sent_at`) — matches PRD §9.6 exactly. One thread per order: `thread_id = order_id` (deterministic).
2. **Socket.IO gateway (`/live/vehicle`).** Chat reuses the SAME gateway + the SAME short-lived signed channel token (`ChannelTokenService`, dedicated secret, HS256, `kind:'vehicle-tracking'`, ~10-min TTL) + the SAME authorize-by-construction room model as live tracking (PRD §6.2/§6.4). Added ONE new server-side room join (`orderRoom`) + ONE room-scoped emit (`publishChatMessage`). **No second socket path. No new token kind. No client subscribe.**
3. **Lifecycle enums + `selectActiveStop`.** The live/read-only rule keys off the real `RouteStopStatus` via the existing `selectActiveStop()` (workable route + non-terminal stop) — the SAME predicate that gates live tracking. Founder's chosen boundary: **chat is open whenever `selectActiveStop() !== null`** (stop ∈ {PENDING, EN_ROUTE, ARRIVED, IN_PROGRESS} on a workable route, with an assigned driver) → chat and the "track my truck" card open/close together.

**RBAC:** the thread is visible to EXACTLY the order's customer (an account member of `order.accountId`) + its assigned driver (resolved via `RouteStop.route.driverId`). A unified participant check lives in `ChatService.resolveThread`. Org-wide staff (OWNER/DISPATCHER/CSR) are excluded by the controller `@Roles` gate → owner/console chat visibility stays OUT (deferred). Non-participants get 404 (no existence leak); staff get 403.

**Real-time:** on send, the server persists the row then emits `chat:message` to the order room on `/live/vehicle`. Both the customer and the assigned driver (who each mint a channel token from `GET /v1/orders/:id/messages/channel` and connect to the same namespace) receive it live. REST history is the source of truth; the socket is an optimization (offline/degraded clients backfill via GET).

**Unread:** a real per-recipient count — `GET /v1/orders/:id/messages/unread` and the `unreadCount` on the list response; `POST /v1/orders/:id/messages/read` marks the caller's inbound messages read. In-app only.

**Customer app:** a `Chat` screen off `OrderDetailScreen` (a "Messages" card with an unread `Badge`, gated the same way as the track CTA), sender-aligned bubbles + timestamps, live incoming via the existing socket, composer disabled with a clear "chat closes after delivery" read-only state. Framework-agnostic `ChatController` (unit-tested) + `useOrderChat` hook, mirroring the `TrackingController`/`useVehicleTracking` pattern.

**Driver app:** a `Chat` screen off `StopScreen` ("Message customer"), same live socket (**added `socket.io-client`** — the driver app had none), **offline-first**: a durable `ChatOutbox` (persisted via `expo-file-system` — realises the cross-relaunch persistence `LocationOutbox` explicitly deferred) built on the `LocationOutbox` honest-flush contract. A message composed offline is **queued + persisted**, shown as *queued* (never "sent") until the server confirms, retried on foreground/interval/reconnect, and de-duped on retry via a stable idempotency key. A permanent rejection shows "couldn't send" — **delivery is never faked.**

## Migration

**`apps/api/prisma/migrations/20260701184705_in_app_chat_inc18/migration.sql`** — additive + reversible-safe:
- `ALTER TABLE "Message" ADD COLUMN "read_at" TIMESTAMP(3)` (nullable ⇒ existing rows = unread; the only field mutated after send).
- `CREATE INDEX "Message_order_id_idx"` (order-scoped reads/unread/mark-read).

No DROP, no data loss. **Migration count 16 → 17.** Applied locally via `prisma migrate deploy`; verified: `read_at` present (nullable), `Message_order_id_idx` present, `Message` had **0 rows** (dormant), **725 Orders / 26 Users intact**. The `order_id` FK is `ON DELETE SET NULL` (deleting an order never cascade-deletes chat). The standing NOTE about the deliberately-omitted ParLevel/LinenStock phantom-drift DROP INDEX lines is preserved.

## Files touched

**Shared (`packages/shared`):** `messaging.ts` (new — `sendMessageSchema`, `messagesQuerySchema`, `ChatMessageDto`, `MessageListResult`, `UnreadCountResult`, `MarkReadResult`, `ChatMessageEvent`, `CHAT_ERRORS`), `tracking.ts` (+`WS_EVENTS.CHAT_MESSAGE`), `index.ts`.
**API (`apps/api`):** `src/chat/` (new — `chat.service.ts`, `chat.controller.ts`, `chat.module.ts`), `src/realtime/realtime-publisher.service.ts` (+`orderRoom`, +`publishChatMessage`), `src/realtime/realtime.gateway.ts` (+order-room join), `src/app.module.ts` (+`ChatModule`), `prisma/schema.prisma` (+`Message.readAt`, +`@@index([orderId])`), the migration, `test/chat.e2e-spec.ts` (new).
**Customer (`apps/customer`):** `src/chat/` (new — `chat-controller.ts` + test, `useOrderChat.ts`), `src/screens/ChatScreen.tsx` (new), `src/api/customer-client.ts`, `src/navigation.ts`, `App.tsx`, `src/screens/OrderDetailScreen.tsx` (+chat entry & unread badge), `OrderDetailScreen.test.tsx` (mock).
**Driver (`apps/driver`):** `src/chat/` (new — `chat-outbox.ts` + test, `outbox-store.ts`, `file-outbox-store.ts`, `chat-controller.ts` + test, `useDriverChat.ts`), `src/screens/ChatScreen.tsx` (new), `src/api/client.ts`, `src/navigation.ts`, `App.tsx`, `src/screens/StopScreen.tsx` (+entry), `package.json` (+`socket.io-client`).

## Tests — exact titles + counts

**API e2e — new file `test/chat.e2e-spec.ts` (+7):**
1. RBAC: the customer and the assigned driver read the thread; an unassigned driver 404s and org staff are forbidden
2. send while active persists (201) and the driver receives it live on the SAME /live/vehicle channel
3. the driver can send and the customer receives it live (mirror direction)
4. after the stop completes the thread is read-only: POST 409, but history GET still works with open=false
5. unread is per-recipient and clears on mark-read; a sender never has unread for their own message
6. a message on one order never reaches a customer bound to a DIFFERENT order (order-room isolation)
7. a live-tracking token (org staff) can observe the vehicle but is NEVER added to the chat room  ← 6-lens fix regression

**API e2e total: 273 → 280** (26 → 27 specs). Full run **280/280 green** (one first-run flake in the pre-existing `orders` concurrent-approve test under full-suite load — passes 17/17 in isolation and clean on the authoritative re-run; not chat-related).

**Customer unit — new `src/chat/chat-controller.test.ts` (+5):** loads history (ascending) + open + marks read + connects socket · live `chat:message` appends & de-dupes by id · send merges the returned row (no echo dupe) · read-only ⇒ no socket + send no-op · loadOlder pages backward. **Customer total 91 → 96, all green.**

**Driver unit — new `src/chat/chat-outbox.test.ts` (+6) + `src/chat/chat-controller.test.ts` (+4) = +10:** outbox: enqueue persists queued-before-network · confirm only after server responds · transient failure stays queued + persisted + survives relaunch + syncs · retry reuses idempotency key · permanent rejection marks failed & not retried · drains in order. controller: loads+connects · send enqueues→flushes→merges · **offline: failed send stays queued (honest) then a reconnect flush syncs it** · read-only no-op. **Driver total 33 → 43, all green.**

**Other suites (unchanged by Inc-18, confirmed green):** API unit **221/221**, web **128/128**.

## No-stub sweep

```
grep -rnEi 'TODO|FIXME|stub|mock|placeholder|fake' <shipped chat paths>  (excluding *.test/*.spec + HTML placeholder=)
→ packages/shared/src/messaging.ts: "…there is NO push send here (a notification hook is intentionally deferred, not faked)."
→ apps/driver/src/screens/ChatScreen.tsx: "…delivery is never faked. The composer disables…"
```
Both hits are the words "not faked"/"never faked" in **documentation prose** describing what the code deliberately does NOT do — no actual stub/mock/placeholder/TODO in any shipped path.

## 6-lens adversarial QC (refute-by-default)

Ran as 6 independent read-only skeptics (one per lens), each instructed to DEFAULT TO REFUTED and try to break its lens against the shipped code (not the tests).

1. **Tenancy** — **BROKEN → FIXED.** The skeptic confirmed the REST surface is tight (every `Message`/order query carries an explicit `orgId` from the verified JWT; customer = account-membership; unassigned driver 404; org staff 403) — but caught a **real HIGH leak I had introduced**: the gateway joined the order chat room for EVERY `/live/vehicle` (vehicle-tracking) token, and the **tracking** endpoint (`GET /orders/:id/tracking`, which OWNER/DISPATCHER/CSR may call) mints such a token → org staff could receive live chat for any order. **Fix:** added a `chat:true` claim minted ONLY by the participant-gated chat channel endpoint; the gateway now joins the order room **only for a chat-authorized token**. A plain tracking token has `chat=false` → observes the vehicle, never the chat. Verified by new e2e #7 (staff tracking socket receives no chat; a real participant does) + realtime e2e still green (tracking unaffected). Also caught a **MEDIUM** (past-leg driver reads the thread) — **accepted + documented** (see below), because tightening it would break the required driver read-only-after-complete.
2. **Live-window gate** — **HOLDS.** Tried posting after COMPLETED/FAILED/SKIPPED, on CANCELLED/COMPLETED/PLANNED routes, forcing `open` true off a terminal/driverless stop, a past-driver posting on a later leg, a stale/cached gate, and an alternate write path bypassing the REST gate — all rejected 409, re-evaluated per request against fresh DB state; GET history always works. No findings.
3. **Socket auth** — **HOLDS.** `publishChatMessage` is strictly `.to(orderRoom)` on the VEHICLE namespace (grep confirmed zero namespace-wide/global emits in `apps/api/src`); the order room is derived from the VERIFIED token `order_id`; no client-subscribe path exists (only server-side joins); the fleet namespace never receives chat; token rides handshake auth only. No findings.
4. **Persistence / immutability** — **HOLDS.** The only `Message` writes are `create` (send) + `updateMany({ readAt })` (mark-read, where-scoped to `toUserId = caller` so no one can flip another user's read-state); no path mutates body/from/to/sent_at; the row is persisted BEFORE the emit; the migration is additive (nullable `read_at`, no DROP). No findings.
5. **Offline honesty** — **HOLDS.** An item leaves the queue ONLY after `await send` resolves; a transient failure stays `queued` + persisted (survives relaunch via `FileOutboxStore`); the UI renders queued/failed items as distinct (never a sent bubble); retries reuse the same `idempotencyKey` (server-deduped); real retry triggers (interval / foreground / reconnect). One **LOW** (cap eviction at 500+ queued could silently drop the oldest) — **FIXED**: eviction now removes terminal `failed` items first, never a still-queued message ahead of a failed one.
6. **No lifecycle corruption** — **HOLDS.** Enumerated every Prisma call reachable from chat: the only writes are `Message.create` + `Message.read_at` update; no `routeStop.update`/`order.update`/state-machine call; the channel mint and order-room join perform zero writes. No findings.

**Net:** 1 HIGH fixed, 1 LOW fixed, 1 MEDIUM accepted+documented; all fixes verified by re-running the affected suites.

## Deferred (Scope OUT) — stated clearly

- **Push notifications for new messages** — Expo Push/Twilio/SendGrid are a parked track. New-message signalling is **in-app only** (socket + unread count). No push send is faked; the notification hook is intentionally deferred (noted in `messaging.ts`).
- **Persistent / cross-order threads** — out. Per-active-order only.
- **Attachments / photos / voice** — out. Text only.
- **Owner / web-console visibility into chat** — out (a later moderation/audit surface). Enforced by the controller `@Roles` gate excluding org-wide staff.
- **Typing indicators / read receipts UX beyond the unread flag** — out.

## Known limitations (documented, MVP-acceptable)

- **Canonical customer user for unread.** The per-recipient unread badge tracks a **single canonical customer user** per order (the account's earliest account-scoped member — the residential customer; `createdBy` fallback only if none). For a multi-user B2B account a second member sees the full thread (GET is order-scoped) but their unread badge is 0. Exact for the residential one-user-per-account case. Revisit if B2B chat needs per-member unread.
- **Driver read access spans the order's assigned driver(s).** READ (history/unread) is granted to any driver assigned to *a* stop on the order, not strictly the currently-active-stop driver. This is **intentional** — it's what enables the required "driver read-only after the stop completes" (a strict active-stop-only check would 404 the driver the moment their stop goes terminal). Consequence on a rare multi-driver order (pickup driver A, delivery driver B on different routes): A retains read access to the thread including B's messages. **POST is correctly restricted to the currently-active-stop driver** (a past-leg driver gets 409). In practice pickup+delivery are usually the same driver. Tighten later if cross-driver read is a concern.
