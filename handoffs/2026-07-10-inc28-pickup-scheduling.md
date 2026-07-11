# Handoff — Inc-28: Pickup scheduling (availability + the real picker + the founder's control)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Branch:** `feature/s3-media-golive`
**Apps:** `apps/api` + `apps/customer` + `apps/web` · **Status:** ✅ Built, tested, **live-verified end-to-end** against real Postgres/PostGIS/Redis. **Not deployed** (founder's call).
**Continues:** Inc-26 saved addresses · Inc-27 customer-360. PRD §7A A2.1.

> **Read §1 and §7 first if you read nothing else.** §1 is a false premise in the brief that would have
> shipped a decorative picker. §7 is a real bug in `orders.service.ts` that I found, proved, and did **not**
> fix, because fixing it is a change every consumer sees.

---

## 1. ⚑ The brief's central claim was false: the chosen window never reached the truck

The brief said:

> *Downstream **consumes** windows already: `RouteStop.timeWindow`, the logistics **optimizer** sorts by
> `windowStartMs`, analytics measures on-time vs `windowEnd`. So a real chosen window flows end-to-end.*

It does not. There are exactly **two** places a `RouteStop` is ever created:

| | file | `timeWindow` source |
|---|---|---|
| generated orders | `recurring/standing-order-generation.service.ts:296` | the standing order's own `pickupWindow` ✅ |
| **the dispatcher** | `logistics/route.service.ts:115` | `dto.timeWindow ?? Prisma.JsonNull` — **never reads the order** ❌ |

So for a **customer-booked** order — the exact path this feature serves — the window died on the `Order` row.
`OptimizerService.windowStart()` returned `null`, so the stop sorted by distance only; `onTimePercent()`
discarded it as unmeasurable. A "real time-slot picker" on top of that is a **decorative** picker: a promise
the system does not keep. That is the thing the honesty firewall exists to prevent, so I stopped and asked.

**Founder authorised the fix.** `addStop` now inherits:

```ts
const timeWindow = dto.timeWindow ?? inheritedWindow(order, kind) ?? Prisma.JsonNull;
```

- An **explicit** `dto.timeWindow` still wins — a dispatcher moving a stop states a newer fact than the booking.
- `PICKUP`/`BOTH` inherit `scheduledPickupWindow`; `DELIVERY` inherits `scheduledDeliveryWindow`.
- `isStoredWindow()` validates the shape first. `OrdersService.book()` writes `Prisma.JsonNull` — a JSON
  `null` **literal** — for a windowless order, so an unguarded copy would hand the optimizer and the on-time
  KPI a window-shaped hole to parse.

### 1.1 ⚑ This broke a logistics e2e — which is the change *working*

`logistics.e2e-spec.ts`'s optimizer test asserted a pure-distance reorder, on the comment
`// no time windows → pure distance reorder`. But its `bookOrder()` **always** sent `pickupWindow: win()`.
It only passed because the stop silently dropped it. Window start is a **hard** ordering key ahead of
distance, and the three `bookOrder()` calls' windows differ by the milliseconds between them — enough to pin
the original sequence and hide the reorder entirely.

Fixed by making the test's stated intent **true** (book windowless orders), not by weakening the assertion.

---

## 2. Part C — the founder's control (built first, because config without a control is a stub)

The mid-brief instruction was right, and I verified the premise before building:

- `Organization.settings` had **zero readers** anywhere in the codebase (written at bootstrap, read nowhere).
- `Organization.billing_config` had **zero writers** — no endpoint, no script, no UI. `taxRate` is settable
  only at provisioning via `BOOTSTRAP_TAX_RATE`; **`minOrderCents` has a reader and no writer at all**.

So "founder-tunable, like the CAD rates" meant "editable with a SQL client". Now:

**`GET` / `PATCH /v1/admin/settings/schedule`** — OWNER-gated, org-scoped, audited.

- Stored at **`Organization.settings.schedule`**, *not* `billing_config.schedule` as the brief proposed.
  `settings` already carries `{region, currency, tz}`; operating hours are not a billing concern; and slot
  generation needs exactly that `tz`. This gives `settings` its first reader **and** its first writer.
- `PATCH` is a **full replacement** (a partial window list is ambiguous), merged so bootstrap's sibling keys
  survive. Rejects: overlapping windows, an inverted window, no windows, a duplicate label, a **zero cap**,
  a negative lead time, a non-integer horizon, an out-of-range weekday, closing all seven days.
- Audits `PICKUP_SCHEDULE_UPDATED` with `before`/`after` carrying `source`, so the log distinguishes *"the
  founder changed their hours"* from *"the founder set hours for the first time, replacing a default they
  never chose"*.

**Console:** a **Scheduling** card on `/admin` (OWNER-only, mirroring the server gate). It validates with
`orgScheduleSchema` — **the same Zod schema the API validates with** — so the console cannot come to disagree
with the endpoint about what a legal schedule is. The server re-validates regardless.

---

## 3. Part A — availability, honest by construction

**`GET /v1/availability/pickup-slots?date=YYYY-MM-DD&siteId=…`**, gated to the customer-side roles.

| Data fact | Naive render | What ships |
|---|---|---|
| No `maxPerSlot` configured | "3 left" / "Fully booked" | `capacityChecked: false`, `remaining: null` — the count query **does not run** |
| Cap set, slot at it | hide the slot | `available: false, reason: 'full', remaining: 0` — disabled, with the reason |
| Founder has saved no hours | present ours as theirs | `scheduleSource: 'default'` — the app prints a note, the console shows an amber badge |
| Window under way | "too soon to book" | `reason: 'past'` (see §4.2) |
| Configured closed day | an empty list | `closed: true` — a real answer, not an absence |
| Zero active service zones | "in your area" | nothing is claimed; nothing geo-blocks |
| Another account's `siteId` | 403 | **404** `availability.site_not_found` — a 403 would confirm it exists |

- **One schedule reader.** `common/org-schedule.ts` is shared by the availability endpoint and the admin
  console. Two readers is how the console comes to show hours the endpoint does not serve.
- **Capacity is a real count or nothing.** With a cap set, one `jsonb` overlap query per day buckets real
  orders in `REQUESTED | SCHEDULED_PICKUP | PICKUP_EN_ROUTE`. A collected order releases its slot; `ON_HOLD`
  never holds one (it has no committed pickup). Adjacent windows (`…12:00` / `12:00…`) do not overlap; a
  straddling order consumes capacity in **both**.
  - The `jsonb_typeof(scheduled_pickup_window) = 'object'` guard is load-bearing: `book()` writes
    `Prisma.JsonNull` (a JSON `null` literal, not SQL NULL), so `IS NOT NULL` alone would feed those rows to
    the `::timestamptz` cast.
- **`maxPerSlot: null` is the default and is deliberate.** Blue Bee has no measured per-slot truck capacity.
  Shipping a number would invent scarcity.
- **The zone seam is a method, not a fake column.** `resolveScheduleForSite()` is where per-zone hours drop
  in. `ServiceZone` has no hours/capacity column today, so it returns the org schedule unchanged. I did not
  add one — the repo already carries exactly that ghost: **`Site.serviceWindows`, seeded in five places and
  read nowhere.**

---

## 4. DST, and two bugs found on the way

### 4.1 The wall-clock conversion was already wrong, and only one file had it

`owner/owner-kpi.ts` privately owned the codebase's only wall-clock↔UTC conversion. It is now
`common/tz.ts`, shared with slot generation, and `businessDayStart` is implemented on top of it — because
the booked window and the on-time KPI **must** agree on what "9am in Toronto" means.

Its single-pass conversion read the zone offset at `now`, not at the resolved instant. On the spring-forward
day (2026-03-08) "09:00 Toronto" resolved with the EST offset still in force at 09:00 **UTC** and came back
an hour late. `zonedWallTimeToUtc()` runs two passes; `tz.spec.ts` pins `2026-03-08 09:00 → 13:00Z`, not
`14:00Z`. The customer would have been told 9am and the driver routed for 10am.

### 4.2 ⚑ A semantic bug my own unit test caught

With `leadTimeHours: 0`, a window that had **started but not ended** was reported `reason: 'lead_time'` —
"we need more notice", when no notice is required. The rule is now stated on the window's **start**:

- `'past'` — the start has passed. Under way, or over; to a customer the same fact.
- `'lead_time'` — the start is still ahead, but sooner than the lead. A policy the app can explain.
- At zero lead, `'lead_time'` is **unreachable**, which is what "no notice required" should mean.

---

## 5. Part B — the picker

**`tomorrowMorningWindow()` is deleted.** It fabricated tomorrow 09:00–12:00 on the *device's* calendar,
behind one Switch, with no reference to the org's hours, timezone, lead time, or capacity.

- The **day strip is the server's `bookableDates`**. The app never computes which days are open; a phone in
  another timezone would otherwise offer a Sunday the plant is shut.
- **`PickupSlot` carries `startLocal`/`endLocal`** (the founder's `HH:MM`) beside the ISO instants, and the
  app renders *those*. A customer in Vancouver must see "9:00 AM", not their phone's arithmetically-true and
  operationally-useless "6:00 AM" — and Hermes' partial `Intl` cannot be trusted with a `timeZone` on
  Android anyway. `format.ts`'s new helpers are pure string/index math.
- An unavailable slot is **disabled and says why**, from the server's `reason`. Never hidden.
- A `remaining` count renders **only** when `capacityChecked` is true. `remaining: null` means *no cap is
  configured*, not "a low number we happen not to know".
- A fully-booked or closed day says so. **Submit is blocked until a real slot is chosen**, and a guard in
  `submit()` means no future refactor of the button-label logic can smuggle a booking through with a
  fabricated window.
- The availability read is **blocking** (unlike the memberships/dryclean reads, which degrade to a hidden
  badge) and gated on the address load, so it fires **once**, with the resolved `siteId`.

---

## 6. Tests

| Suite | Before | After |
|---|---|---|
| api unit | 277 | **338** (+61: `tz.spec`, `org-schedule.spec`, `pickup-slots.spec`) |
| api e2e | 368 | **411 / 411**, 32 suites (+43 `pickup-slots.e2e-spec.ts`) |
| web | 178 | **204** (+26 `SchedulingCard.test.tsx` + AdminHome) |
| customer | 144 | **173** (+29: picker, `format`, `booking`) |

`tsc` clean across **all seven** packages (shared · api-client · api · web · customer · driver · owner).

The full api e2e suite was run **twice back-to-back, 411/411 both times**, to prove the new spec's teardown
and its `Organization.settings` snapshot/restore leave no residue for the next run.

`pickup-slots.e2e-spec.ts` uses `f8000000-…` ids and `SLOTS E2E` names, torn down in `beforeAll` **and**
`afterAll`, and restores ORG1's `settings` exactly (every other spec resolves the default schedule from it).
Note: its `PICKUP_SCHEDULE_UPDATED` audit rows persist in the dev DB — `AuditLog` is append-only by trigger,
as with every other audited e2e in this repo.

---

## 7. ⚑ Found, proved, NOT fixed: `Order.items` has no deterministic order

`ORDER_INCLUDE` in `orders.service.ts` gives `lines`, `inspections`, `photos`, `custodyEvents`, `quotes` and
`routeStops` an explicit `orderBy`. **`items` has none.** Postgres therefore returns them in heap order. And
the whole booking runs in one transaction, so every `Item.createdAt` is the same transaction timestamp —
there is no tiebreak to fall back on either.

`weigh.e2e-spec.ts` mapped measurements to items **by index**, on the comment *"Book preserves item order"*.
It does not. When my spec's `Item` deletions changed the heap layout, one MIXED order came back rug-first:
the rug's `{ sqft: 40 }` was applied to the wash-and-fold garment, the rug's `FROM_MEASURED` line had no
measure, and `quotes.build` **correctly** refused to price it (422). Those tests had been passing on the luck
of physical row order.

**I fixed the test** (map by `kind`; return ids in request order). **I did not fix the include**, because:

- Two reads of the same order can list its items differently **today**, on every surface — the customer app's
  order detail, the console, the driver's manifest. That is a real product bug.
- The obvious patch, `orderBy: [{createdAt:'asc'},{id:'asc'}]`, is **stable but arbitrary**: the timestamps
  tie, so it degenerates to uuid order, which is not booking order. It would shuffle every existing surface
  and could break specs that index into `items` and currently pass by luck.
- The honest fix is an explicit ordinal on `Item` (a `seq`/`position` column written at book time). That is a
  migration plus a backfill plus a sweep of every consumer — **its own increment.**

**Recommend doing it next.** Say the word and I'll scope it.

---

## 8. Live verification (localhost:3111 against the real dev DB, then fully reverted)

Booted on `:3111` because another agent's (stale) API holds `:3000`; that instance was never touched.

```
1.  OWNER  GET  /v1/admin/settings/schedule   → source: "default"  (Morning/Afternoon/Evening, maxPerSlot: null)
2.  Priya  GET  /v1/availability/pickup-slots → 11:09 EDT: Morning past (started) · Afternoon lead_time
                                                (51 min out, 2 h required) · Evening available
                                                09:00 EDT == 13:00Z ✓ (DST resolved server-side)
3.  RBAC:  owner → 403 on customer availability · anon → 401
           priya → 403 on GET and PATCH /admin/settings/schedule
5.  PATCH  overlapping windows → 400 "windows overlap: A (09:00–13:00) and B (12:00–15:00)"
6.  PATCH  maxPerSlot: 0       → 400 "maxPerSlot: Number must be greater than or equal to 1"   (0 ≠ "no cap")
7.  PATCH  Early bird 07:00–10:00 + Evening 17:00–20:00, lead 1 h, horizon 4 d, cap 1, closed Sun → source: "org"
8.  Priya  GET  ?date=2026-07-13 → scheduleSource: "org", capacityChecked: true, remaining: 1 each
9.  Priya  GET  ?date=2026-07-12 → closed: true, slots: []      (Sunday)
10. Priya  GET  ?date=2026-07-16 → 400 availability.date_out_of_range   (horizon is 4 days)
11. Priya  POST /v1/orders with the offered "Early bird" slot
           → order.scheduledPickupWindow == exactly the offered instants
           → the slot re-reads as  available: false, remaining: 0, reason: "full"
           → "Evening" stays  available: true, remaining: 1
12. DISPATCHER POST /v1/routes/:id/stops  { orderId }   ← no timeWindow
           → stop.timeWindow == {"start":"2026-07-13T11:00:00.000Z","end":"2026-07-13T14:00:00.000Z"}
             ***the customer's chosen window, on the stop the driver runs.*** Before Inc-28: null.
13. OWNER  GET /v1/admin/audit-logs → exactly ONE PICKUP_SCHEDULE_UPDATED, actor "Demo Owner",
                                      before.source: default → after.source: org
```

**Cleaned up:** order + items + tags + lines + route + stop deleted; `settings` restored to
`{"tz":"America/Toronto","region":"GTA","currency":"CAD"}`; `GET /admin/settings/schedule` back to
`source: "default"`. The other agent's `:3000` API is still up and untouched.

---

## 9. Deploy + the open founder input

**Not deployed.** `railway up` (api + web) and the next EAS build are the founder's call — the brief's
boundary. The console card reaches prod on the next **web** deploy; the picker reaches phones on the next
**EAS** build. Both are safe to batch with the next customer-app slice.

**⚑ Founder input (still open, non-blocking):**

1. **The real Blue Bee pickup operating hours.** Until they are saved, customers are offered the documented
   default — **Morning 09:00–12:00 · Afternoon 12:00–15:00 · Evening 15:00–18:00, 7-day horizon, 2 h
   notice** — and every surface labels it as a default (`scheduleSource: 'default'`, the app's note, the
   console's amber badge). No fake hours ship.
2. **Whether to enforce a per-slot capacity cap now.** Default is **no cap**: every defined slot is available,
   `remaining` is `null`, and nothing is marked full. The counting machinery is real and tested — set
   `maxPerSlot` in the console and it engages immediately.

Both are now set from **Admin → Scheduling**, not a SQL client.

---

## 10. Follow-ups

1. **§7 — give `Order.items` a deterministic order.** A real bug on every surface. Needs an ordinal column,
   a backfill, and a consumer sweep. Recommend next.
2. **Booking-time slot enforcement.** `POST /v1/orders` still accepts any `pickupWindow`. The availability
   endpoint reports a full slot, but a racing or hostile client can still book it. Worth adding a
   server-side re-check **when a cap is configured** (today none is, so nothing is enforceable yet).
3. **Zone-level hours/capacity.** The seam (`resolveScheduleForSite`) exists and is documented. It needs a
   real `ServiceZone` schedule column — and a founder who wants different hours per zone.
4. **`Site.serviceWindows`** — a `Json` column seeded in five places and read nowhere. Delete it, or give it
   a meaning. It is what a stub looks like after a year.
5. **`recurring-schedule.ts` builds standing-order windows as UTC wall-clock**, with a comment admitting the
   Toronto mapping is "a documented follow-on (not faked here)". `common/tz.ts` now makes that a small fix.
6. **Deploy + EAS rebuild**, batched with the next customer-app slice.
