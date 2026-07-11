# Brief — Tier-2 Step 2: pickup scheduling (real time-slot picker)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **Apps:** `apps/api` + `apps/customer`
**From:** planning/QC chat · **For:** Claude Code. Continues the customer-app Tier-2 order (Step 1 addresses ✅ live; customer-360 ✅ live).
**Rules:** no stubs · honesty firewall (no fabricated availability/scarcity) · `org_id` + row-scoping · TS strict · tests + live verify · log `CHANGELOG.md` + dated handoff.

## What already exists (verified — don't rebuild)
- The order **stores** the requested window: `orders.service.ts:208` writes `scheduledPickupWindow` from `dto.pickupWindow` (a shared `TimeWindow`), and `intake.service.ts:52` updates it.
- Downstream **consumes** windows already: `RouteStop.timeWindow`, the logistics **optimizer** sorts by `windowStartMs`, analytics measures on-time vs `windowEnd`. So a real chosen window flows end-to-end.
- **Missing:** any availability/slot/capacity/operating-hours concept (grep confirms none), and a real customer picker. `apps/customer/src/orders/booking.ts:61` `tomorrowMorningWindow()` hard-codes tomorrow 9am–12pm, toggled by a single Switch in `BookScreen`.

## Part A — Availability endpoint (API, new, config-driven + honest)
- **`GET /v1/availability/pickup-slots?date=YYYY-MM-DD&siteId=…`** — customer-scoped, org-scoped. Returns the day's bookable slots: `[{ start, end, available: boolean, remaining?: number }]`.
- **Slots = operating-hours windows from config**, not hard-coded in the handler. Read from **`Organization.settings.schedule`** (NOT `billing_config` — that's pricing/tax, read by PricingService; scheduling isn't billing). `settings` already holds `{region, currency, tz: 'America/Toronto'}` written at bootstrap and read nowhere yet — slot generation needs exactly that `tz` to compute local windows, so schedule co-locates with it correctly (and gives `settings` its first reader). Use a **documented default** if `schedule` is unset — same pattern as CAD rates: real, founder-tunable, clearly-labeled default. Proposed default (founder confirms real hours): **Morning 09:00–12:00 · Afternoon 12:00–15:00 · Evening 15:00–18:00**, next **7 days**, **min 2-hour lead time**, and skip closed days if configured.
- **Capacity — real, never decorative.** Mark a slot unavailable only from a real count: existing orders whose `scheduledPickupWindow` overlaps the slot vs a configurable `maxPerSlot`. **If no cap is configured, all defined slots are `available: true`** — do NOT fabricate scarcity. Structure so a cap drops in later.
- **Zone-aware hook, not zone-block.** If the site's `service-zone` later defines hours/capacity, use them; with **zero active zones today** it falls back to the org default (consistent with Step 1's honest "coverage not checked"). Don't geo-block while no real zones exist.
- Exclude past + sub-lead-time slots. Row-scope to the caller's own site.

## Part B — Customer picker (BookScreen)
- Replace the "Tomorrow morning window" Switch + `tomorrowMorningWindow()` with a real **date (next 7 days) → time-slot** picker fed by the endpoint. Full/past slots render disabled. The chosen slot becomes `pickupWindow` on the booking DTO.
- **Honest empty/loading/error states:** if a day has no available slots, say so — never silently fall back to a fabricated window. Block submit until a valid slot is selected.
- `customer-client.ts`: add `getPickupSlots(date, siteId)`.

## Part C — Owner-dashboard control for the schedule (so it's operable, not DB-only)
**Verified gap:** there is NO console control to set operating hours / capacity / org settings today — `settings` + `billing_config` are bootstrap-written and edited nowhere; only catalog rates and service zones are founder-editable. Shipping A+B without this makes the picker un-tunable by the founder = a stub of the control. So this increment includes it:
- **API:** `PATCH /v1/admin/settings/schedule` — OWNER-gated, org-scoped, audited — writes `Organization.settings.schedule = { windows: [{label,start,end}], leadTimeHours, horizonDays, maxPerSlot|null, closedDays }`. Validate (start<end, no overlapping windows, sane ranges). The availability endpoint (Part A) reads exactly this. Also expose `GET` of the current schedule for the editor to load.
- **Web console:** a **"Scheduling"** settings card (add to the Admin page, or a small Settings section) — edit the windows, lead time, horizon, and per-slot cap; Save → PATCH. Reuse the `/catalog` rate-editor + `ServiceZones` patterns. Tests.
- **Honesty:** the availability endpoint serves whatever the founder saved; the documented default applies only until the founder saves real hours. No fake hours ship.

## Verify (proof, no stubs)
- API: slots for a date return config-driven windows; past + sub-lead-time excluded; a capacity-full slot (with a cap set) returns `available:false`; another customer's `siteId` → 404/403 per convention; unit + `pickup-slots.e2e`.
- Customer: pick date+slot → book → the order's `scheduledPickupWindow` equals the chosen window; past/full slots unselectable; empty-day state shown; screen tests. `tsc` clean across api + customer.
- End-to-end sanity: the chosen window reaches `RouteStop.timeWindow` / the optimizer (already wired) — spot-check.

## Deploy + open input
- Deploy: batch with the next customer-app slice or ship after verify; the screen reaches phones on the next EAS build (batch a rebuild across steps).
- **Founder input (non-blocking):** the real Blue Bee pickup **operating hours** + whether to enforce a per-slot **capacity cap** now. CC builds config-driven with the labeled default above; founder sets real hours/caps in config (like CAD rates) — no fake hours ship.
- Boundary: the planning chat doesn't run `railway up` or touch DB credentials — CC executes and shows the verification.
