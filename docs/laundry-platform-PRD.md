# Cascade — Commercial Laundry & Specialty-Cleaning Operating System
### Product Requirements Document (Build Spec) · v1.0

> **Working codename:** "Cascade" (rename at will).
> **Prepared:** June 2026 · **Geography:** Greater Toronto Area (GTA), Canada · **Currency:** CAD
> **Companion artifacts:** `laundry-platform-blueprint.html` (interactive visual blueprint), and the prior market analysis (`laundry-market-dashboard.html`, `sources-and-assumptions.md`).
> **Audience:** Engineering, design, and product. This document is written to be **built from** — every feature carries user stories and acceptance criteria, and §9–§11 give the data model, architecture, and API surface a team (or an AI coding agent) can implement directly.

---

## 0. How to read this document

This PRD specifies a **vertical operating system** for a commercial laundry / specialty-cleaning business in the GTA, plus the customer-facing and owner-facing apps that sit on top of it. It deliberately follows the strategic verdict of the prior market analysis: **lead with the high-ticket specialty trade and recurring institutional linen, not consumer "Uber for laundry."**

The system ships as **four client surfaces** against **one backend**:

| Surface | Platforms | Who uses it | Maps to your ask |
|---|---|---|---|
| **A · Customer app** | iOS, Android, Web | Residential specialty customers + B2B account staff (care-home & hotel housekeeping/ops) | "app for the customer" |
| **B · Web console** | Web (browser) | Owner, dispatcher, CSR, plant/production, finance | "app for the web" |
| **C · Owner app** | iOS, Android | The owner / GM — live fleet tracking, approvals, daily numbers | "app for the owner" |
| **D · Driver app** | iOS, Android | Route drivers | *Operationally required:* it is the GPS source that makes vehicle tracking real |

You asked for three apps (customer, web, owner). The **driver app is the fourth, non-optional surface**: live "track the truck" tracking only exists if a driver device is emitting GPS and scanning carts. It is small and focused, and it is what powers the two tracking experiences you specified (customers tracking the inbound pickup truck; the owner tracking outbound trucks).

Reading paths:
- **Product / exec:** §1, §2, §5, §6, §14, §15.
- **Design:** §4, §5, §6, §7.
- **Engineering:** §6, §7, §9, §10, §11, §12.

---

## 1. Product vision & strategy

### 1.1 One-line vision
**Cascade is the operating system and customer layer for the GTA specialty-cleaning and institutional-linen trade — it turns opaque, phone-and-paper laundry operations into a tracked, scheduled, billed, and measurable service, for both the business that runs it and the customers it serves.**

### 1.2 Why this shape (carried from the market analysis)
The market work concluded "laundry" is really four businesses, and that the fundable one is the trade the anchor already lives in. This product therefore optimizes for the two durable segments and explicitly defers the graveyard:

- **Anchor (build first):** Specialty cleaning — rugs, carpets, blinds, upholstery, drapery. High ticket, low frequency, deeply fragmented, quote-based. The most software-starved and the easiest to win because the anchor already supplies it.
- **Expansion (build second):** Institutional B2B linen — **care / nursing homes** and **hotels** (the two commercial verticals in scope). Recurring contracts, weekly-to-daily routes, the real recurring-revenue engine ($13K–$110K/account/yr per the analysis).
- **Deferred (designed-for, not built first):** Consumer wash-&-fold (subscription-first, later) and laundromat machine-booking (a SaaS wedge). The data model leaves room for both; the MVP ignores them.

### 1.3 Product principles
1. **Tracking is the wedge, not a feature.** Every job and every truck is locatable in real time. Transparency is how we beat opaque incumbents (Cintas/Aramark-style contracts) and nervous high-value-rug customers.
2. **One backend, many surfaces.** Customer, owner, dispatcher, plant, driver all read/write the same order and route objects. No parallel spreadsheets.
3. **Chain of custody end to end.** Every item (a $4,000 silk rug, a resident's cardigan, a hotel duvet) is tagged, scanned, photographed, and accounted for from pickup to return. This kills the #1 trust-killer in the trade: lost and damaged goods.
4. **Vertical-aware, not generic.** A rug is not a linen cart is not a resident's blouse. The system models three genuinely different workflows rather than forcing one.
5. **Offline-tolerant field ops.** Drivers and intake staff work in basements, loading docks, and dead zones. The driver and plant apps must function offline and sync.
6. **Honest by construction.** No invented capacity, certifications, or counts. Liability on high-value items is explicit (inspection + condition photos + signed terms), not hidden.

### 1.4 Success metrics (north-star + supporting)
- **North star:** Tracked GMV flowing through the platform per month (orders + routed linen value with a live chain of custody).
- **Operational:** On-time pickup/delivery %, items-lost rate (target < 0.3% for B2B linen, vs industry 15–20% loss the analysis cites for untracked hotel linen), average quote→approval time, route stops/hour.
- **Commercial:** Active B2B contracts, specialty jobs/week, repeat rate, revenue per route.
- **Trust:** Damage-claim rate and resolution time; customer CSAT on delivery.

---

## 2. Scope — the three commercial verticals

The product centres on three commercial customer types. Consumer/residential is supported only where it overlaps the specialty anchor (a homeowner getting a rug cleaned), and full consumer wash-&-fold is out of MVP scope.

### 2.1 Vertical 1 — Specialty cleaning ("Carpets")
**Customers:** Homeowners, interior designers, property managers, offices, retailers — anyone with rugs, wall-to-wall carpet, window blinds, drapery, or upholstery.
**Item-centric.** Each physical item is individually tagged, inspected, measured, quoted, cleaned through stages, QC'd, and returned with before/after evidence.
**Economics:** High ticket ($55–$640/job), low frequency (~1–2×/yr), high margin, acquisition-heavy. Damage liability is real and must be managed.
**Why first:** The anchor already runs this; it is the most fragmented and least digitized segment; it proves the software with real GMV.

### 2.2 Vertical 2 — Care / nursing homes ("Nursery")
> Confirmed scope: **old-age / nursing / long-term-care & retirement homes** (not childcare).

**Customers:** LTC homes, retirement residences, memory-care facilities.
**Two distinct linen streams in one account:**
1. **Facility linen** — bed sheets, towels, blankets, gowns. Usually a **rental/par-level** or **customer-owned-goods (COG)** model: soiled linen collected by cart/weight, processed, returned to par. Infection-control segregation matters (soiled vs clean handled separately).
2. **Residents' personal clothing** — individually owned garments that **must come back to the right resident**. This is the trade's hardest, most reputation-sensitive problem. Each garment is tagged to a resident (heat-seal barcode or RFID), sorted on return, and lost items are tracked and reconciled. Labels carry resident name + room; dignity and accuracy both matter.
**Cadence:** Daily or several times weekly, fixed routes.
**Economics:** Recurring contract, $4K–$9K/account/mo. Cost-center billing (by wing/floor/funding line) is often required.

### 2.3 Vertical 3 — Hotels ("Hotels")
**Customers:** Hotels, motels, boutique properties, B&Bs (and adjacent: serviced apartments, Airbnb turnover companies as a later add).
**Stream:** Sheets, towels, F&B/banquet linen (tablecloths, napkins). Rental or COG. High volume, occupancy-driven, often daily.
**Workflow:** Soil collected by weight/pieces/carts → production → packed to par with container tickets & consolidated manifests → routed → delivered against load sheet. RFID linen pooling reduces shrinkage (industry: 6+ PAR down to 3–4, loss 15–20% down to 3–5% with RFID + forecasting).
**Economics:** $1.5K–$28K/account/mo; production-linked billing (by weight/piece).

### 2.4 In scope (MVP + near term)
Scheduling & recurring routes · pickup & drop-off · **live vehicle tracking (customer + owner)** · item/cart chain-of-custody (barcode/QR now, RFID-ready) · inspection/condition photos/measurement/quote/approval (specialty) · soil intake & par-level replenishment (linen) · resident personal-clothing tracking (care homes) · production status · proof of delivery (photo + signature) · invoicing & payments (one-off, contract, par/weight/piece) · notifications (SMS/push/email) · roles & permissions · analytics dashboards · customer self-service portal/app.

### 2.5 Out of scope (explicitly deferred)
Full consumer on-demand wash-&-fold marketplace · laundromat machine-booking/IoT reservation · gig-driver crowd network · in-plant machine/IoT control (washer programming) · uniform-rental as a primary vertical (data model leaves room) · multi-city/multi-tenant marketplace federation (architecture leaves room — see §10.6). These are roadmap, not MVP.

---

## 3. Personas & roles

### 3.1 External personas
- **Rita — Residential specialty customer.** Wants a $90 rug cleaned, hates not knowing when the truck comes or whether her heirloom will be damaged. Needs: easy booking, a firm quote, live truck ETA, before/after photos, simple payment.
- **David — Designer / property manager.** Multiple addresses, multiple items, wants itemized quotes and one invoice. Needs: multi-site, multi-item orders, approvals, account billing.
- **Sandra — Care-home laundry/housekeeping manager.** Runs linen for 120 residents; her nightmare is lost personal clothing and running out of clean sheets. Needs: par visibility, soiled-cart pickup confirmation, resident-clothing reconciliation, cost-center reporting, a reliable schedule, proof of every delivery.
- **Marcus — Hotel housekeeping / ops director.** Occupancy spikes, needs linen on time, hates shrinkage and surprise charges. Needs: par by item, manifests, live delivery ETA, weight/piece transparency, exception reporting.

### 3.2 Internal personas
- **Owner / GM (Gowtham-type anchor owner).** Wants to see, from his phone, every truck on the road, today's money, and anything on fire. Approves quotes/claims above a threshold.
- **Dispatcher / Route manager.** Builds and optimizes routes, assigns drivers/vehicles, handles exceptions live.
- **CSR / Account manager.** Books jobs, answers customers, manages contracts and par levels.
- **Plant / Production operator.** Receives soil, weighs/counts, scans items into stages, flags rewash/reject/damage, marks ready.
- **Driver.** Runs the route, scans carts/items, captures POD, chats with customer.
- **Finance / Admin.** Invoicing, payments, AR, cost-center exports, accounting sync.

### 3.3 Role → permission summary (full matrix in §17.3)
Roles are **org-scoped RBAC**: `OWNER`, `DISPATCHER`, `CSR`, `PLANT_OP`, `DRIVER`, `FINANCE`, plus customer-side `ACCOUNT_ADMIN`, `ACCOUNT_STAFF`, `RESIDENTIAL_CUSTOMER`. Owner = superset; finance = billing + read; driver = own routes only; account-admin manages their own sites/users/standing orders, never other tenants' data.

---

## 4. The four client surfaces

### 4.1 Surface A — Customer app (iOS, Android, Web)
The customer's window into the service. Two modes behind one login:
- **Residential / specialty mode:** book a job, get a quote, approve it, **track the pickup truck live**, view before/after photos, pay, rate.
- **B2B account mode:** for care-home and hotel staff — see scheduled routes, confirm soiled-cart pickups, view par levels and pending deliveries, **track the delivery truck live**, see manifests & invoices, raise exceptions (missing item, extra pickup, resident clothing query), manage standing orders.

Built as one codebase (React Native) for iOS + Android, with a responsive web build (Next.js) sharing the design system and API. The web version doubles as the public booking site.

### 4.2 Surface B — Web console (browser)
The operational brain. Role-gated modules:
- **Orders & jobs** (specialty lifecycle, inspections, quotes).
- **Routes & dispatch** (build/optimize routes, assign driver+vehicle, live fleet map, exceptions).
- **Production / plant** (soil intake, weigh/count, stage scanning, rewash/reject, ready).
- **Accounts & contracts** (customers, sites, cost centers, par levels, rate cards, standing orders).
- **Billing & finance** (invoices, payments, AR, cost-center exports, accounting sync).
- **Catalog & pricing** (services, linen SKUs, price lists).
- **Analytics** (operational + commercial dashboards).
- **Admin** (users, roles, devices, vehicles, notification templates, audit log).

### 4.3 Surface C — Owner app (iOS, Android)
A focused executive cockpit — deliberately *not* the full console on a phone:
- **Live fleet map:** every outbound vehicle, its route, stop progress, ETAs, and exceptions, in real time.
- **Today:** GMV, jobs in/out, on-time %, money collected, alerts.
- **Approvals:** quotes/claims/credits above a configurable threshold, one-tap approve/deny.
- **Exceptions feed:** missed pickups, late routes, damage claims, failed deliveries, low par.
- **Drill-through:** tap a truck → see its stops; tap a job → see its chain of custody.

### 4.4 Surface D — Driver app (iOS, Android)
The field app and **the GPS/scan source for all tracking**. Offline-first.
- **My route today:** optimized stop sequence on a map, turn-by-turn handoff to native maps.
- **At each stop:** pickup (scan/tally carts, bags, or tagged items vs expected), or delivery (validate carts/items against system load sheet, scan to confirm right customer).
- **Proof of delivery:** geo-tagged, time-stamped photo and/or customer digital signature on the manifest/invoice.
- **Background location:** emits GPS pings on a duty cycle while on an active route (consent-gated, only while shift active).
- **Comms:** two-way chat/SMS with the customer; "on my way" / "arriving" auto-triggers; receive live route changes; "skip" handling (customer can decline today's stop → auto-removed from manifest).
- **Take payment** at the door (optional), capture notes/exceptions.

---

## 5. End-to-end workflows (the spine)

Each vertical is a distinct lifecycle. These state machines are normative — the `status` enums in §9 and the API transitions in §11 must match them exactly.

### 5.1 Specialty job lifecycle (rugs / carpets / blinds / upholstery)

```
REQUESTED → SCHEDULED_PICKUP → PICKUP_EN_ROUTE → PICKED_UP → INTAKE_INSPECTED
   → QUOTED → QUOTE_APPROVED → IN_CLEANING → QC → READY
   → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED → INVOICED → CLOSED

Branches:
  QUOTED → QUOTE_DECLINED → (return item) → CLOSED_NO_WORK
  INTAKE_INSPECTED → DAMAGE_PREEXISTING_FLAGGED (photo + customer ack) → continues
  any → ON_HOLD (reason) → resumes
  IN_CLEANING → REWASH → IN_CLEANING
  DELIVERED → CLAIM_OPENED → CLAIM_RESOLVED
  QUOTE_APPROVED → QUOTED (re-quote on a plant re-weigh / re-measure, pre-cleaning — added 2026-07-10, Inc-23 P5)
```

**Re-quote branch (Inc-23 P5, 2026-07-10).** Before cleaning starts, a plant re-weigh (or re-measure) can change the authoritative measure of an already-approved order. `QUOTE_APPROVED → QUOTED` re-opens the quote: a **FIXED** line (per-kg / per-item) re-prices at the published rate (+ minimum-order floor) and **auto-re-approves** (audited "re-priced on plant re-weigh") — the customer + dashboard see the new number live; a **FROM_MEASURED** specialty line re-opens as a **SENT** quote for customer re-approval. It is a pre-cleaning correction only; the forward path `QUOTE_APPROVED → IN_CLEANING` is unchanged. No new status was invented — the edge reuses the existing `QUOTED`/`QUOTE_APPROVED` states.

**Narrative.** Customer books (app/web/phone) → CSR or auto schedules a pickup window → driver dispatched, **customer tracks the truck** → at door, driver tags each item (QR), takes intake condition photos, notes pre-existing damage (customer acknowledges in-app or on device) → items arrive at plant, measured (sq ft for rugs/carpet; pieces for blinds) → **quote generated** (rate card × measure × service) → customer approves in app (push + SMS) → cleaning stages (dusting/wash/dry/finish) scanned per item → QC + before/after photos → ready → delivery scheduled → **customer tracks delivery truck** → delivered with POD → invoice → paid → closed. Damage/claim is a first-class branch with photo evidence and owner approval.

### 5.2 Care-home linen + personal-clothing lifecycle

Two linked sub-flows on one recurring route:

```
A) FACILITY LINEN (rental/par or COG)
CONTRACT_ACTIVE → ROUTE_SCHEDULED(recurring) → SOIL_PICKUP(scan carts, capture weight/count)
   → SOIL_INTAKE(plant: weigh, segregate, reconcile) → PRODUCTION
   → PACK_TO_PAR(load sheet vs par) → DISPATCH → DELIVERY_EN_ROUTE
   → DELIVERED(scan carts, POD) → BILLED(par/weight/piece) → RECONCILED

B) RESIDENT PERSONAL CLOTHING
GARMENT_ENROLLED(tag↔resident) → SOIL_PICKUP(by resident bag/room)
   → INTAKE_SORT(scan to resident) → WASH → RETURN_SORT(scan → resident bin)
   → DELIVERED_TO_RESIDENT → [if unscanned/odd item] LOST_FOUND_POOL → RECONCILE
```

**Narrative.** Standing recurring route (e.g. Mon/Wed/Fri 7am). Driver collects soiled-linen carts and resident-clothing bags per wing; scans carts (count/weight) and confirms pickup → **care-home staff and owner both see the truck and the pickup confirmation**. At plant, facility linen is weighed, segregated (infection control), processed, packed back to each wing's par with a load sheet; resident garments are scanned to each resident, washed, return-sorted to a resident bin, any unmatched item drops into a lost & found pool for reconciliation. Clean linen + sorted personal clothing delivered, scanned per cart/resident, POD captured. Billing runs by par/weight/piece with **cost-center splits** (by wing/floor/funding line). Lost-garment rate is a tracked KPI surfaced to the account.

### 5.3 Hotel linen lifecycle

```
CONTRACT_ACTIVE → ROUTE_SCHEDULED → SOIL_PICKUP(weight/pieces/carts)
   → SOIL_INTAKE(reconcile) → PRODUCTION → PACK_TO_PAR(container tickets)
   → CONSOLIDATED_MANIFEST → DISPATCH → DELIVERY_EN_ROUTE
   → DELIVERED(scan carts vs manifest, POD) → BILLED(weight/piece) → RECONCILED
```

**Narrative.** Same logistics backbone as care homes minus the per-resident stream. Occupancy-driven volume; production-linked billing by weight/piece; RFID linen pooling (Phase 3) for shrinkage control; consolidated manifests and container tickets per property. Hotel ops tracks the inbound clean-linen truck and sees expected vs delivered counts live.

### 5.4 Shared logistics sub-workflow (powers tracking)
All three verticals share one **Route → Stop → Scan → POD** backbone, which is what the live tracking renders against. A route has ordered stops; each stop is a pickup and/or delivery tied to an order or a recurring contract; each stop transitions `PENDING → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED/FAILED/SKIPPED`; the driver app emits GPS + stop events; customer and owner subscribe to the live feed (§6).

---

## 6. Live tracking & logistics (the explicit requirement)

This is the headline capability you called out: **customers track the inbound pickup vehicle; the owner tracks outbound vehicles; plus scheduling, pickup, and drop.** Specified in full here.

### 6.1 Two tracking experiences

**(a) Customer-facing "track my truck" (inbound pickup AND outbound delivery)**
- A live map showing the assigned vehicle's real-time position, the customer's location/site, and a dynamic **ETA**.
- Status timeline: *Scheduled → Driver assigned → On the way → Arriving (≤X min) → Arrived → Completed*, with push/SMS at each transition.
- Driver card: name, photo, vehicle, masked-number call + in-app chat; "skip today" for recurring B2B stops.
- Shareable read-only tracking link (web) for staff without the app.
- Geofence-driven "arriving" alert when the truck enters a configurable radius (e.g. 800 m / 5 min ETA).

**(b) Owner/dispatcher fleet tracking (all outbound vehicles)**
- One map, every active vehicle, colour-coded by status/route, with live breadcrumbs.
- Per-vehicle: current stop, stops done/remaining, on-time vs plan, next ETA, driver, load.
- Exception surfacing: stalled vehicle, off-route, late stop, failed delivery, long dwell.
- Replay: historical breadcrumb playback for any route/day (disputes, coaching, audits).

### 6.2 Tracking architecture (normative)

```
[Driver app] --(GPS ping every 5–15s while ARRIVED-distance shrinking; 30–60s on highway;
                adaptive duty cycle; batched + compressed; offline queue)-->
[Ingestion API / location gateway] --> [Live location store: Redis geo + last-known]
   --> [Realtime channel: WebSocket/Socket.IO or managed pub/sub (Ably/Pusher)]
        --> Customer app/web (only the one vehicle on their active order; token-scoped)
        --> Owner app + Web console (all org vehicles)
[Routes/Directions/ETA: Google Maps Platform Routes API or Mapbox]
   --> server-side ETA recompute on each ping cluster; geofence evaluation → events → notifications
[Breadcrumb history: time-series table (PostGIS / Timescale) for replay & audit]
```

Key decisions:
- **Battery & cost:** adaptive ping frequency (faster near a stop, slower on long legs, paused when stationary/off-shift); batch + compress; never track outside an active shift (privacy + battery).
- **Privacy scoping:** a customer's live channel is **scoped by a short-lived signed token to exactly one vehicle for the duration of their active stop** — they never see other customers or the full fleet. Owners/dispatchers see all org vehicles. Driver location is only emitted on-duty, with explicit consent and a visible "you are sharing location" indicator.
- **ETA:** server-computed from current position → next stop via Routes API, refreshed on ping clusters, smoothed to avoid jitter; surfaced as a range.
- **Offline:** pings queue locally and flush on reconnect; stop events are the source of truth even if GPS dropped.
- **Maps provider:** Google Maps Platform (Routes, Directions, Distance Matrix, Geocoding) recommended for Canadian coverage & route quality; Mapbox is the swap-in alternative (cheaper at scale, better custom styling). Route **optimization** uses Google Route Optimization / Mapbox Optimization, with an integration seam for Onfleet / Routific / Tookan (the same engines CleanCloud and Cents integrate) if we choose to outsource dispatch.

### 6.3 Scheduling, pickup & drop (the "normal" logistics)
- **One-off scheduling** (specialty): customer or CSR picks a pickup window; capacity/zone rules prevent over-booking; geofenced service zones decide feasibility (à la Fieldd's drawn service areas / Cents geofencing).
- **Recurring scheduling** (B2B): standing routes (e.g. care home Mon/Wed/Fri) auto-generate stops; holiday/skip handling; per-site service windows.
- **Route building:** dispatcher groups stops → optimizes sequence (time windows, vehicle capacity, traffic) → assigns driver + vehicle → publishes to driver app.
- **Pickup:** driver scans/tallies carts/bags/items vs expected; discrepancies flagged on the spot; SMS to customer "picked up N carts at HH:MM."
- **Drop-off:** driver validates load against system-generated load sheet (prevents wrong/missing linen), scans at the door, captures **geo-tagged time-stamped photo and/or signature**; system emails signed POD.
- **Exceptions:** missed/failed stop (reason codes), customer-not-available, partial pickup, extra/ad-hoc pickup, redelivery.

### 6.4 Tracking — user stories & acceptance criteria
- **US-T1 (Customer):** *As Rita, I can see my pickup truck on a live map with an ETA so I'm not waiting blind.*
  - **AC:** Given my order is `PICKUP_EN_ROUTE`, when I open the order, then I see the vehicle moving on a map, an ETA range, and a status timeline; the position updates at least every 30s while the truck is within 5 km; I receive a push + SMS when the truck is ~5 min away and again on arrival; I never see any other vehicle or customer.
- **US-T2 (Care-home/Hotel staff):** *As Sandra, I can track the inbound clean-linen delivery and see expected vs delivered cart counts.*
  - **AC:** For an active delivery stop, I see live vehicle position + ETA, the manifest (expected carts/par), and on completion the scanned delivered counts with any shortfall flagged; a shareable link works without the app.
- **US-T3 (Owner):** *As the owner, I can see every truck currently out and instantly spot anything late or off-route.*
  - **AC:** The fleet map shows all on-shift vehicles with live position, route progress, and on-time status; late/off-route/stalled vehicles are visually flagged and pushed to my exceptions feed; I can tap any vehicle to see its stops and any stop's chain of custody; I can replay today's breadcrumbs.
- **US-T4 (Driver):** *As a driver, my location and scans flow automatically without extra taps, and work offline.*
  - **AC:** While my shift is active, location emits in the background per the duty cycle with a visible sharing indicator; scans and POD captured offline are queued and synced on reconnect; stop status is authoritative over raw GPS.
- **US-T5 (Privacy):** location is emitted only during an active shift, with consent; customer channels are cryptographically scoped to one vehicle for the active stop window only; breadcrumb history is access-controlled and retained per the policy in §12.4.

---

## 7. Feature requirements by surface

Format: **Epic → user stories with acceptance criteria (AC)**. Priority tags: **[MVP]**, **[P2]** (expansion), **[P3]** (later). IDs are stable references for tickets.

### 7A. Customer app (iOS, Android, Web)

**Epic A1 — Onboarding & accounts [MVP]**
- **A1.1** Sign up / log in (email, phone OTP, Apple/Google sign-in). **AC:** new residential user can register and book in < 2 min; B2B user is invited by their `ACCOUNT_ADMIN` and inherits the account's sites.
- **A1.2** Profile, saved addresses/sites, saved payment methods (tokenized). **AC:** address autocomplete (Geocoding); card stored via Stripe token, never raw PAN.
- **A1.3** Account modes: residential vs B2B account context switch. **AC:** B2B staff see their org's sites, contracts, routes; residential users see only their own orders.

**Epic A2 — Booking & quotes [MVP]**
- **A2.1** Book a specialty job: choose service(s) (rug, carpet, blinds, upholstery), add items (with photos), pick pickup window, address. **AC:** customer can add N items each with type + photo + notes; sees an *estimate range* before confirming (final quote after intake); chooses an available window constrained by zone/capacity.
- **A2.2** Receive & approve quote. **AC:** when status `QUOTED`, customer gets push+SMS+email with itemized quote (per-item measure × rate, taxes); one-tap **Approve** or **Decline**; approval transitions to `QUOTE_APPROVED` and authorizes payment; decline schedules a return.
- **A2.3** B2B order/standing-order requests: extra pickup, change par, add a one-off. **AC:** account staff can raise an ad-hoc pickup or par change request that lands in dispatcher queue.

**Epic A3 — Live tracking [MVP]** — see §6.4 (US-T1, US-T2). Track pickup & delivery, ETA, driver card, share link, skip-today for B2B.

**Epic A4 — Chain of custody & evidence [MVP]**
- **A4.1** Item timeline: each tagged item's journey (intake → cleaning stages → QC → ready → delivered) with timestamps. **AC:** customer sees per-item status and **before/after photos**; B2B sees cart-level counts & manifests.
- **A4.2** Resident clothing view (care-home account) [P2]. **AC:** account staff can look up a resident and see garments enrolled, in-process, returned, and any in lost & found.

**Epic A5 — Billing & payments [MVP]**
- **A5.1** Pay for a job (card/Apple Pay/Google Pay); auto-charge on approval or on delivery per setting. **AC:** PCI-compliant; receipt issued; tip optional.
- **A5.2** B2B invoices & statements [P2]. **AC:** account admin views/pays invoices, downloads PDF, sees cost-center breakdown; supports ACH/pre-authorized debit and auto-pay.

**Epic A6 — Comms, support & ratings [MVP]**
- **A6.1** In-app chat/SMS with driver/CSR; notification preferences. **AC:** two-way thread per order; masked phone numbers.
- **A6.2** Raise an exception/claim (missing item, damage) with photos. **AC:** creates a claim tied to the order/item; customer can track claim status.
- **A6.3** Rate & review post-delivery. **AC:** prompt after `DELIVERED`; CSAT captured.

### 7B. Web console (Owner / Dispatcher / CSR / Plant / Finance)

**Epic B1 — Orders & specialty job management [MVP]**
- **B1.1** Order board (kanban by lifecycle state) + list/search/filter. **AC:** CSR can find any order by customer, item tag, address, status; bulk actions for scheduling.
- **B1.2** Intake & inspection workstation. **AC:** plant op scans/creates item tag, captures condition photos, records measurements (rug sq ft, carpet area, blind count), flags pre-existing damage; system computes quote from rate card.
- **B1.3** Quote builder & send. **AC:** itemized quote auto-calculated, manually adjustable with reason, sent to customer; approval/decline tracked; expiry.
- **B1.4** Cleaning-stage tracking + QC + before/after capture; rewash/reject flags. **AC:** each item scanned through stages; QC checklist; before/after photos required before `READY`.

**Epic B2 — Routes, dispatch & live fleet [MVP]**
- **B2.1** Route builder + optimizer. **AC:** dispatcher groups stops, sets time windows & vehicle, runs optimizer (sequence + ETA), publishes to driver app; recurring routes auto-generate from contracts.
- **B2.2** Live fleet map + exceptions (see §6.1b). **AC:** all vehicles live; late/off-route/stalled flagged; reassign a stop to another driver in < 3 taps; push change to driver in real time.
- **B2.3** Driver & vehicle management, shifts. **AC:** assign drivers to vehicles/routes (permanent or per-day); see on-shift status; breadcrumb replay.

**Epic B3 — Production / plant [MVP for counts; P2 for full]**
- **B3.1** Soil intake: weigh/count by cart/bag, per customer/cost-center, segregate soiled/clean. **AC:** intake reconciles against pickup scan; discrepancies flagged.
- **B3.2** Par-level packing & load sheets. **AC:** system generates pack-to-par load sheet per site/cost-center; packed quantities scanned; container tickets & consolidated manifests produced.
- **B3.3** Resident-clothing sort station (care home) [P2]. **AC:** scan garment → resident bin; unmatched → lost & found; reconciliation report per route.
- **B3.4** Rewash / reject / reclaim / discard tracking [P2]. **AC:** flagged items routed back or written off with reason; loss metrics updated.

**Epic B4 — Accounts, contracts, catalog & pricing [MVP]**
- **B4.1** Customer/account/site/cost-center hierarchy. **AC:** an account (e.g. a hotel group) has multiple sites; a care home has wings/floors as cost centers.
- **B4.2** Contracts: rental vs COG, par levels, rate cards, billing model (par/weight/piece/fixed/mixed), term, standing orders. **AC:** contract drives auto-route generation and billing.
- **B4.3** Catalog: specialty services + linen SKUs + price lists per segment. **AC:** multiple price lists; per-account overrides.

**Epic B5 — Billing & finance [MVP basic; P2 full]**
- **B5.1** Invoice generation (one-off, contract, par/weight/piece), batch invoicing, taxes (GST/HST). **AC:** invoices auto-calc from delivered/par data + additional charges (replacements, rejects, losses); batch-invoice a month in one action.
- **B5.2** Payments, AR aging, auto-pay, cost-center exports, accounting sync (QuickBooks/Xero). **AC:** payments reconcile to invoices; CSV/accounting export with cost-center splits.

**Epic B6 — Analytics & admin [MVP basic]**
- **B6.1** Operational + commercial dashboards (see §13). **AC:** on-time %, loss rate, GMV, route efficiency, AR.
- **B6.2** Admin: users/roles, vehicles/devices, notification templates, audit log. **AC:** every state change is attributable to a user (staff accountability); full audit trail.

### 7C. Owner app (iOS, Android) [MVP]

- **C1 Live fleet** — all outbound vehicles, route progress, ETAs, exceptions (§6.1b). **AC:** matches console fleet data in real time on a phone.
- **C2 Today dashboard** — GMV, jobs in/out, on-time %, collected $, low-par alerts. **AC:** single glanceable screen, auto-refresh.
- **C3 Approvals** — quotes/claims/credits above threshold; one-tap approve/deny with note. **AC:** approving unblocks the order instantly; logged.
- **C4 Exceptions feed** — missed pickups, late routes, damage claims, failed deliveries. **AC:** push notifications; tap to drill into the underlying object.
- **C5 Drill-through** — truck → stops → order → item chain of custody. **AC:** read-only deep links into the same objects as the console.

### 7D. Driver app (iOS, Android) [MVP]

- **D1 My route** — optimized stop list + map, hand off to native nav. **AC:** stops in sequence with windows; offline-available.
- **D2 Pickup** — scan/tally carts/bags/tagged items vs expected; flag discrepancy. **AC:** count validated against order/contract; "picked up" SMS auto-sent.
- **D3 Delivery** — validate load vs system load sheet; scan at door; **POD photo (geo-tagged, timestamped) and/or signature**. **AC:** cannot complete delivery without scan + POD; signed POD emailed.
- **D4 Background location & status** — emit GPS on duty cycle; stop status transitions (§5.4). **AC:** per §6.2; visible sharing indicator; offline queue.
- **D5 Comms & exceptions** — chat/SMS with customer; reason-coded failed/skip; ad-hoc pickup; take payment (optional). **AC:** "skip" removes recurring stop from today's manifest; exceptions reach dispatcher live.

---

## 8. Cross-cutting capabilities

### 8.1 Identity, tenancy & RBAC
Single tenant (one operating business) for MVP, but **org_id stamped on every row** so the same schema federates to multi-tenant marketplace later (§10.6). Auth via JWT (access + refresh), phone OTP, social sign-in; SSO (SAML/OIDC) for large B2B accounts [P3]. RBAC per §3.3 + §17.3, enforced at API and row level (account staff scoped to their `account_id`/`site_id`).

### 8.2 Chain of custody, tagging & RFID
- **Item identity:** every tracked physical thing gets a `Tag` — QR/barcode now (cheap, camera-scannable, heat-seal labels for garments à la CleanCloud), **RFID-ready** for linen pooling (Phase 3; UHF, 100+ reads/sec through a portal).
- **Specialty:** one tag per item (rug, blind set, sofa), bound to the order, photographed at intake.
- **Care-home garments:** one durable tag per garment, bound to a `Resident`; heat-seal barcode (name + room on the human-readable label) now, RFID later.
- **Linen pooling:** carts/containers tagged; individual linens optionally RFID-tagged in Phase 3 for par accuracy and shrinkage control.
- Every scan writes a `CustodyEvent` (who/where/when/stage), forming the timeline customers and owners see.

### 8.3 Inspection, measurement, quoting & claims
- Structured inspection (condition codes, stain/damage flags, pre-existing-damage acknowledgement) with required photos.
- Measurement capture (sq ft, dimensions, piece count) feeding the quote engine.
- Quote engine: `service × measure × rate-card (+ upcharges, taxes)`; per-account overrides; expiry; audit of manual adjustments.
- **Claims/liability:** first-class object (damage/loss), photo evidence, owner approval, credit/refund, linked to the item's intake photos — the honest defense against high-value-rug disputes flagged as a risk in the market analysis.

### 8.4 Billing & payments
- Models: one-off, contract recurring, **par-level**, **by weight**, **by piece**, fixed, mixed; additional charges (replacement, reject, loss, rush).
- Batch invoicing; taxes (GST/HST Ontario); cost-center splits; statements; AR aging; auto-pay (card + pre-authorized debit/ACH).
- Provider: **Stripe** (cards, wallets, saved tokens, subscriptions/Billing, ACH/PAD, Connect-ready for future marketplace payouts). Accounting sync: QuickBooks Online + Xero.

### 8.5 Notifications
Channels: **Push (FCM/APNs), SMS (Twilio), Email (SendGrid/SES), WhatsApp [P2]**. Event-driven from the lifecycle/geofence engine. Per-user preferences & quiet hours. Templated, localized (EN/FR for Canada [P2]). Full event→channel matrix in §17.2.

### 8.6 Offline & sync (field surfaces)
Driver and plant apps are **offline-first**: local store (SQLite/WatermelonDB or Realm) + mutation queue + conflict resolution (last-write-wins on scalar fields, append-only for custody/scan events). Stop status and scans sync on reconnect; GPS pings batch-flush. Clear offline UI state.

### 8.7 Search, audit & accountability
Global search (orders, items, accounts, residents, invoices). **Every state-changing action is attributed to a user** (staff accountability, à la CleanCloud) and written to an immutable audit log. Custody and POD events are tamper-evident.

---

## 9. Data model

Relational core (PostgreSQL + PostGIS). All rows carry `id (uuid)`, `org_id`, `created_at`, `updated_at`, `created_by`. Below: key entities, notable fields, relationships. Enums match the §5 lifecycles exactly.

### 9.1 Identity & accounts
- **Organization** `(id, name, settings, billing_config)` — the operating business (tenant root).
- **User** `(id, org_id, name, email, phone, auth_providers[], status)`.
- **Role / UserRole** `(user_id, role enum, scope: org|account|site)` — RBAC.
- **Account** `(id, org_id, type: residential|business, name, billing_terms)` — a B2B customer (hotel group, care-home operator) or a residential customer.
- **Site** `(id, account_id, name, address, geo POINT, service_windows)` — a physical property (a hotel, a care-home building).
- **CostCenter** `(id, site_id, name)` — wing/floor/funding line for split billing.
- **Contact** `(id, account_id|site_id, name, role, phone, email, notification_prefs)`.

### 9.2 Catalog, contracts & pricing
- **Service** `(id, vertical: specialty|linen|washfold, name, unit: sqft|piece|lb|item, base_rate)`.
- **LinenSKU** `(id, name, category, unit, rfid_class)` — sheet, towel, duvet, napkin, gown.
- **PriceList / PriceListItem** `(id, name; service_id|sku_id, rate, account_override?)`.
- **Contract** `(id, account_id, model: rental|cog, billing_basis: par|weight|piece|fixed|mixed, term, status)`.
- **ParLevel** `(id, contract_id, cost_center_id?, sku_id, par_qty, reorder_rule)`.
- **StandingOrder** `(id, contract_id, schedule RRULE, items[])` — recurring route generator.

### 9.3 Orders, items & custody
- **Order** `(id, org_id, account_id, site_id?, vertical, type: job|route_stop_order, status enum[§5], scheduled_pickup_window, scheduled_delivery_window, totals)`.
- **OrderLine** `(id, order_id, service_id|sku_id, qty, measure, rate, amount)`.
- **Item** `(id, order_id, tag_id, kind: rug|carpet|blind|upholstery|garment|linen, resident_id?, status, measurements jsonb)`.
- **Tag** `(id, code, type: qr|barcode|rfid, bound_to: item|cart|container|resident, active)`.
- **Resident** `(id, site_id, cost_center_id, name, room, status)` — care-home personal-clothing owner.
- **Inspection** `(id, item_id, condition_codes[], notes, preexisting_damage bool, ack_by, ack_at)`.
- **Photo** `(id, item_id|order_id|pod_id, kind: intake|before|after|pod|claim, url, geo, taken_at)`.
- **Quote** `(id, order_id, lines[], subtotal, tax, total, status: draft|sent|approved|declined|expired, expires_at, approved_by, approved_at)`.
- **CustodyEvent** `(id, item_id|cart_id, stage, actor_id, geo, device_id, occurred_at)` — append-only.

### 9.4 Production & linen
- **Cart / Container** `(id, tag_id, type: soil|clean, capacity, current_site_id)`.
- **SoilIntake** `(id, order_id|route_stop_id, weight, piece_count, cart_count, cost_center_id, reconciled bool)`.
- **ProductionBatch** `(id, intake_id, stage, machine?, started_at, finished_at, operator_id)`.
- **PackEvent / LoadSheet** `(id, route_stop_id, site_id, expected_qty, packed_qty, container_ticket)`.
- **RewashReject** `(id, item_id|batch_id, reason, action: rewash|reject|reclaim|discard)`.
- **LostFoundItem** `(id, tag_id?, found_at_site, candidate_resident_id?, status)`.

### 9.5 Logistics & tracking
- **Vehicle** `(id, org_id, label, capacity, plate, status)`.
- **Driver** `(id, user_id, license, default_vehicle_id)`.
- **Shift** `(id, driver_id, vehicle_id, started_at, ended_at, status)` — location only emits during an active shift.
- **Route** `(id, org_id, date, driver_id, vehicle_id, status, optimized bool)`.
- **RouteStop** `(id, route_id, seq, account_id, site_id, order_id?|contract_id?, kind: pickup|delivery|both, time_window, status: pending|en_route|arrived|in_progress|completed|failed|skipped, eta, arrived_at, completed_at)`.
- **GpsPing** `(id, shift_id, vehicle_id, geo POINT, speed, heading, recorded_at)` — time-series (PostGIS/Timescale); powers live + replay.
- **GeofenceEvent** `(id, route_stop_id, type: approaching|arrived|departed, occurred_at)` — triggers notifications.
- **ProofOfDelivery** `(id, route_stop_id, photo_id?, signature_url?, captured_by, geo, captured_at)`.
- **Manifest** `(id, route_id|route_stop_id, lines[], generated_at)`.

### 9.6 Billing, comms & system
- **Invoice** `(id, account_id, period, lines[], subtotal, tax, total, status, cost_center_breakdown jsonb)`.
- **Payment** `(id, invoice_id|order_id, method, amount, stripe_ref, status)`; **Subscription** (washfold P3); **CreditNote / Claim** `(id, order_id|item_id, type: damage|loss|service, amount, status, approved_by, evidence_photo_ids[])`.
- **Message** `(id, thread_id, order_id, from_user, to_user, channel, body, sent_at)`.
- **Notification** `(id, user_id, event_type, channel, payload, status)`.
- **AuditLog** `(id, actor_id, entity, entity_id, action, before, after, at)` — immutable.
- **Device** `(id, user_id, push_token, platform, last_seen)`.

### 9.7 Key relationships (text ERD)
`Organization 1—* Account 1—* Site 1—* CostCenter`; `Account 1—* Contract 1—* ParLevel/StandingOrder`; `Order 1—* OrderLine`, `Order 1—* Item 1—1 Tag`, `Item *—1 Resident`; `Route 1—* RouteStop *—1 Order|Contract`; `Shift 1—* GpsPing`; `RouteStop 1—1 ProofOfDelivery`; `Item 1—* CustodyEvent`. (Visual ERD in the HTML blueprint, §Data Model tab.)

---

## 10. System architecture & tech stack

### 10.1 High-level
```
                 ┌──────────────────────── Clients ────────────────────────┐
   Customer (RN: iOS/Android) · Customer Web (Next.js) · Owner (RN) · Driver (RN, offline-first) · Web Console (Next.js)
                 └───────────────┬──────────────────────────┬──────────────┘
                                 │ REST/GraphQL + WebSocket  │
                         ┌───────▼───────────────────────────▼────────┐
                         │  API Gateway / BFF (NestJS, Node + TS)      │
                         │  Auth · RBAC · validation · rate limiting   │
                         └───┬───────────┬───────────┬─────────────┬───┘
        ┌────────────────────▼──┐ ┌──────▼──────┐ ┌──▼──────────┐ ┌▼───────────────┐
        │ Core services         │ │ Location/   │ │ Notification│ │ Billing/        │
        │ orders, routes,       │ │ tracking    │ │ service     │ │ payments        │
        │ production, accounts  │ │ gateway     │ │ (push/SMS/  │ │ (Stripe, tax,   │
        │ (modular monolith)    │ │ (geo, ETA,  │ │  email)     │ │  accounting)    │
        └───────┬───────────────┘ │  geofence)  │ └─────────────┘ └─────────────────┘
                │                  └──────┬──────┘
   ┌────────────▼─────────┐   ┌───────────▼──────────┐   ┌─────────────────────────┐
   │ PostgreSQL + PostGIS │   │ Redis (geo live +    │   │ Object storage (S3):     │
   │ (+ Timescale for     │   │ cache + queues) +    │   │ photos, POD, signatures  │
   │  GpsPing history)    │   │ realtime pub/sub     │   │                          │
   └──────────────────────┘   └──────────────────────┘   └─────────────────────────┘
   External: Google Maps Platform (Routes/Directions/Distance Matrix/Geocoding) · Stripe ·
   Twilio · SendGrid/SES · QuickBooks/Xero · (optional) Onfleet/Routific dispatch · RFID readers (P3)
```

### 10.2 Recommended stack (with rationale)
- **Mobile (Customer, Owner, Driver):** **React Native + Expo**, TypeScript. One codebase → iOS + Android (your explicit requirement); shares types & validation with the web/BFF; mature background-geolocation + maps libraries. *Alternative:* Flutter (excellent performance; separate language). Pick RN for code/skill sharing with web.
- **Web (Console + Customer web):** **Next.js (React) + TypeScript**, Tailwind + a component library; server components for the data-heavy console.
- **Backend:** **NestJS (Node + TypeScript)** as a **modular monolith** (clear module boundaries: orders, routes, tracking, production, billing) — fast to build and operate at this stage, split to services only if scale demands. REST for CRUD + **WebSocket** (Socket.IO) for live; optional GraphQL BFF for the console.
- **DB:** **PostgreSQL + PostGIS** (geo queries, service zones, nearest-vehicle), **Timescale** extension for `GpsPing` history; **Redis** for live last-known location, caching, and job queues (BullMQ).
- **Realtime:** Socket.IO self-hosted now; **Ably/Pusher** as managed swap-in if connection scale grows.
- **Maps/routing:** **Google Maps Platform** (Canadian coverage, Routes API for ETA, Route Optimization); Mapbox as cost-optimized alternative; integration seam for Onfleet/Routific/Tookan dispatch.
- **Payments:** **Stripe** (+ Stripe Tax, Billing, Connect-ready). **Notifications:** Twilio (SMS/WhatsApp), Expo Push→FCM/APNs, SendGrid/SES (email).
- **Infra/DevOps:** Cloud-agnostic containers; **AWS** baseline (ECS/Fargate or EKS, RDS Postgres, ElastiCache Redis, S3, CloudFront) — matches your existing AWS+Railway pattern; IaC (Terraform); CI/CD (GitHub Actions); observability (OpenTelemetry → Datadog/Grafana); error tracking (Sentry).

### 10.3 Why a modular monolith (not microservices) now
At launch volume (one operator, hundreds of stops/day) a well-modularized monolith ships faster, is cheaper to run, and is easier to keep transactionally consistent (orders↔routes↔billing). The location/tracking path is the one component designed to scale independently (stateless ingestion + Redis + pub/sub), so it can be peeled off first if needed.

### 10.4 Real-time location path (detail)
Stateless **location-ingestion** endpoints accept batched pings → write last-known to Redis geo + append to Timescale → publish to per-vehicle channels → fan out to scoped subscribers. ETA & geofence evaluation run on ping clusters, emitting events to the notification service. Backpressure: drop-to-sample under load (keep last-known fresh, thin the history).

### 10.5 Environments & release
Dev → Staging → Prod; feature-flagged rollout; additive/reversible migrations only; blue-green or rolling deploys; seeded demo tenant for sales/QA.

### 10.6 Forward-compatibility (deferred, not built)
`org_id` everywhere + Stripe Connect-readiness means the same codebase can later become a **multi-operator marketplace** (the analysis's national-scale vision) without a rewrite. Consumer wash-&-fold reuses Order/Route/Tracking; machine-booking would add a `Machine`/`Reservation` module behind a flag. None of this is in MVP.

---

## 11. API surface & integrations

### 11.1 Representative REST endpoints (illustrative, not exhaustive)
```
AUTH        POST /auth/otp · POST /auth/verify · POST /auth/refresh
CUSTOMER    GET  /me · GET /accounts/:id/sites · POST /orders (book job)
            GET  /orders/:id · POST /orders/:id/quote:approve|decline
            GET  /orders/:id/tracking            → live channel token + last-known
            GET  /orders/:id/items/:itemId/timeline (custody + photos)
            POST /orders/:id/claims
B2B         GET  /contracts/:id/par · POST /contracts/:id/extra-pickup
            POST /routes-stops/:id/skip          (skip today)
            GET  /accounts/:id/invoices
DISPATCH    POST /routes · POST /routes/:id/optimize · POST /routes/:id/publish
            PATCH /route-stops/:id (reassign/resequence)
            GET  /fleet/live                      → all vehicles (owner/dispatch scope)
PRODUCTION  POST /soil-intake · POST /items/:id/scan {stage} · POST /pack-events
            POST /items/:id/inspection · POST /items/:id/photos
DRIVER      POST /shifts:start|end
            POST /locations:batch                 (ping ingestion)
            POST /route-stops/:id:arrive|start|complete|fail
            POST /route-stops/:id/pod (photo/signature)
BILLING     POST /invoices:generate · POST /invoices:batch · POST /payments
            GET  /exports/cost-centers.csv · POST /accounting/sync
REALTIME    WS /live/vehicle/:token (customer, scoped) · WS /live/fleet (org, owner/dispatch)
WEBHOOKS    Stripe (payments) · Twilio (delivery receipts) · accounting callbacks
```
API conventions: versioned (`/v1`), idempotency keys on mutations, cursor pagination, problem+json errors, RBAC + row-scoping enforced server-side, rate-limited, OpenAPI spec published for app teams.

### 11.2 Integrations
| Capability | Provider (recommended) | Alternative / notes |
|---|---|---|
| Maps, ETA, geocoding | Google Maps Platform | Mapbox |
| Route optimization | Google Route Optimization | Onfleet / Routific / Tookan (seam) |
| Payments | Stripe (cards, wallets, ACH/PAD, Billing) | — |
| SMS / WhatsApp | Twilio | MessageBird |
| Email | SendGrid | AWS SES |
| Push | Expo Push → FCM/APNs | native FCM/APNs |
| Accounting | QuickBooks Online, Xero | CSV export |
| Label/garment printing | Zebra (heat-seal barcode), thermal receipt | — |
| RFID (Phase 3) | UHF readers/portals (e.g. Zebra/Impinj) | — |
| Object storage / CDN | AWS S3 + CloudFront | — |
| Error/observability | Sentry, OpenTelemetry → Datadog | Grafana stack |

---

## 12. Non-functional requirements

### 12.1 Security
TLS everywhere; encryption at rest (DB, S3); secrets in a vault/KMS; PCI-DSS handled by tokenizing through Stripe (no raw PAN on our servers); JWT with short-lived access tokens; RBAC + row-level scoping; staff PIN/lockout on shared devices; signed, expiring URLs for photos/POD; tamper-evident audit + custody logs; mobile cert pinning; pen-test before B2B go-live.

### 12.2 Privacy & compliance (Canada)
- **PIPEDA** (federal) governs personal data; Ontario care-home data may engage **PHIPA**-adjacent expectations — minimize, encrypt, and access-control resident data; signed data-processing terms with B2B accounts.
- Resident personal info (name/room/garments) is sensitive: least-privilege access, audit every read, retention limits.
- Location data: consent-gated, shift-scoped, retention policy (§12.4); driver visible "sharing on" indicator.
- Consent records, data-export & deletion (DSAR) tooling.

### 12.3 Performance & reliability
- Live location end-to-end latency < 3s p95; map updates ≥ every 30s within 5 km of a stop.
- API p95 < 300ms for reads, < 800ms for writes; booking flow usable on 3G.
- Targets: 99.9% API uptime; graceful degradation (if live channel drops, fall back to polling last-known + status timeline).
- Throughput design point: hundreds of vehicles, tens of thousands of pings/min, comfortably; horizontally scalable ingestion.

### 12.4 Data retention
Live pings: hot 7 days (full resolution) → downsampled breadcrumbs 90 days → purge/aggregate. POD photos/signatures retained per contract & legal (default 24 months). Audit & financial records per Canadian tax/retention law (7 years).

### 12.5 Offline, accessibility, i18n
Driver/plant offline-first (§8.6). WCAG 2.1 AA for customer & console (older care-home staff, accessibility expectations). EN at launch; **FR (Canada) [P2]**; multi-language framework from day one. Large-tap targets and high-contrast mode on field apps (gloves, sunlight, loading docks).

---

## 13. Analytics & KPIs

**Operational dashboard:** on-time pickup/delivery %, route adherence, stops/hour, avg dwell, failed/skip rate, items-lost rate, rewash/reject rate, par stockout incidents, plant throughput (PPOH).
**Commercial dashboard:** tracked GMV, active contracts, jobs/week, repeat rate, revenue/route, AR aging, quote→approval conversion & time, CSAT, damage-claim rate & resolution time.
**Per-account (B2B) scorecard:** loss rate, on-time %, monthly spend, cost-center split — *this is also a customer-facing trust artifact* (the transparency wedge vs opaque incumbents).
Event tracking instrumented from day one (product analytics) so the deferred consumer phase can be underwritten with real frequency/CAC data (the analysis's weakest inputs).

---

## 14. MVP scope & release roadmap

Sequenced to the market analysis GTM (anchor first, then institutional, defer consumer).

### Phase 1 — Digitize the anchor (specialty) · ~0–4 months → MVP
Customer app+web (book, quote-approve, **live tracking**, pay, photos) · Web console (orders, intake/inspection/quote, cleaning stages, QC, basic routes+dispatch, **live fleet**) · Owner app (live fleet, today, approvals, exceptions) · Driver app (route, scan, POD, background GPS, offline) · payments (Stripe) · notifications (push/SMS/email) · RBAC/audit. **Exit:** real specialty GMV flowing with end-to-end tracking and chain of custody.

### Phase 2 — Institutional linen: care homes + hotels · ~4–10 months
Contracts/par/standing orders · recurring route auto-generation · soil intake (weight/count) · pack-to-par + load sheets + manifests · **resident personal-clothing tracking + lost&found** (care homes) · cost-center billing · B2B portal (par, manifests, invoices, exceptions) · batch invoicing + accounting sync. **Exit:** recurring contract revenue with proof-of-delivery and per-account loss/on-time scorecards.

### Phase 3 — Scale & hardening · ~10–16 months
RFID linen pooling · full production/plant module + rewash/reject/reclaim · BI suite · FR localization · SSO for enterprise accounts · advanced route optimization · uniform/mat-rental adjacency (data model already supports).

### Phase 4 — Optional expansion (validate first) · 16 months+
Consumer wash-&-fold (subscription-first, dense core) · laundromat machine-booking SaaS wedge · multi-operator marketplace / multi-city (the national-scale vision). Each gated on Phase 1–3 traction and explicit validation.

### 14.1 MVP cut line (what is NOT in v1)
RFID · full plant module · resident-clothing (moves to early P2) · cost-center billing · ~~consumer wash-fold~~ (revised — see §14.2: transactional wash services pulled into v1 on 2026-07-10; subscription-first consumer remains Phase 4) · machine-booking · marketplace · WhatsApp · FR. v1 proves: **book → track → custody → deliver → bill** for specialty (plus transactional wash), with the logistics backbone reused by P2.

### 14.2 Decision — transactional wash services pulled into v1 (2026-07-10)
**Founder decision (Gowtham):** add **Wash & Fold** (per-kg) and **Wash & Iron** (per-item) as published-price, pay-per-order services in v1, alongside the specialty menu (Dry Cleaning, Ironing, Rug, Carpet, Upholstery, Blinds). Rationale: the customer app is a Laundryheap-style service menu, and a published-price wash line makes the app coherent for everyday customers. These are priced **transparently** (weight/count × the founder-set CAD rate + minimum-order floor), **not quoted**.

**Scope guard (what is NOT changing):** this covers the *transactional* wash service only. The Phase-4 deferral of **subscription-first consumer, laundromat machine-booking, and marketplace** still stands (§14 Phase 4, §15) — no consumer subscription, no "Uber for laundry" framing in v1.

**Build:** Inc-21 (catalog service menu) + Inc-22 (weight→price, hybrid gate) on branch `feature/s3-media-golive` (`5d65ae4`, `3649576`). Pricing ships with `priceFrom = NULL` and no backing rate until the founder enters real CAD rates in the console `/catalog` editor (honesty firewall — no invented price ships). Weight = the measure for wash; it slots into the existing `INTAKE_INSPECTED → QUOTED → QUOTE_APPROVED` lifecycle (no new statuses).

---

## 15. Risks, assumptions & open questions

**Product/strategy risks**
- **Consumer economics are a graveyard** — keep it deferred and subscription-first (per analysis). Do not let the "Uber for laundry" framing creep into MVP.
- **Damage/loss liability** on high-value rugs and resident clothing is the trust make-or-break — mitigated by mandatory intake photos, acknowledged pre-existing damage, and the claims object, but legally review terms of service.
- **Single-anchor concentration** — the platform should onboard a second specialty supplier early to avoid one-customer dependence.

**Technical risks**
- Background GPS reliability across iOS/Android OS versions (battery, OS throttling) — budget real device-matrix testing; degrade gracefully.
- Offline sync conflicts in plant/driver apps — keep custody/scan events append-only.
- Route-optimization quality & maps cost at scale — start managed, keep the dispatch seam.

**Open questions to resolve before/early in build**
1. **"10% of what?"** (carried from the analysis) — does platform revenue/the build model apply to net-new only or the anchor's existing volume? Affects billing config & incentives, not the architecture, but decide it.
2. Care-home **resident-clothing liability** model — who owns loss risk; needed for claims rules.
3. RFID timing — is Phase 3 soon enough, or does a flagship hotel demand it at signing?
4. Do we run our **own fleet only**, or also integrate a gig/3PL network (Onfleet/DoorDash-style) for overflow? (Architecture supports both.)
5. Accounting system of record (QBO vs Xero) for the anchor — drives which sync ships first.
6. FR (Quebec/federal) — needed for some institutional RFPs; confirm timing.

**Assumptions:** GTA/Canada, CAD, Ontario GST/HST; one operating business at launch; drivers are employees (not gig) in MVP; smartphones provided to drivers; B2B accounts will share site/resident data under signed terms.

---

## 16. Competitor benchmark — what we borrow, what we beat

Researched live (June 2026). We deliberately borrow proven mechanics and win on **vertical depth + end-to-end tracking/chain-of-custody across all three commercial verticals in one system** — something the consumer tools and the linen tools each only half-do.

| Capability | CleanCloud | Cents | Starchup | LinenTech (B2B linen) | Specialty tools (Ruggy/ARMS/Fieldd) | **Cascade** |
|---|---|---|---|---|---|---|
| Customer mobile app + live driver tracking | ✓ | ✓ | ✓ | partial (SMS + portal) | partial | **✓ all verticals** |
| Owner live fleet map | partial | ✓ | ✓ | ✓ (manager app) | ✗ | **✓ + exceptions/replay** |
| Driver app: scan, load-sheet validate, geo-POD | ✓ | ✓ | ✓ | ✓ | partial | **✓** |
| Route optimization + geofencing | ✓ (Onfleet/Routific) | ✓ | ✓ | ✓ | partial | **✓ (+ seam)** |
| Specialty intake: per-item tag, inspection, condition photos, sq-ft measure, before/after, quote | ✗ | ✗ | ✗ | ✗ | ✓ | **✓** |
| Linen par levels, soil intake, pack-to-par, manifests, cost-center billing | ✗ | ✗ | ✗ | ✓ | ✗ | **✓** |
| Care-home **resident personal-clothing** tracking + lost&found | ✗ | ✗ | ✗ | partial (uniform/wearer) | ✗ | **✓** |
| RFID linen pooling | ✗ | ✗ | ✗ | ✓ | ✗ | **✓ (P3)** |
| Billing models: par / weight / piece / one-off / batch | partial | partial | partial | ✓ | partial | **✓** |
| All three verticals in ONE system | ✗ | ✗ | ✗ | linen only | specialty only | **✓ (the wedge)** |

**Borrowed mechanics:** heat-seal barcode garment labels, photos-of-garments, rack location, staff accountability (CleanCloud); own-fleet-or-network dispatch, geofencing, AI assist (Cents); two-way SMS + "skip text" (Starchup); par-level/soil-intake/load-sheet-validation/geo-tagged POD/cost-center billing/RFID (LinenTech); QR rug intake, before/after, auto-quote, drawn service zones (Ruggy/ARMS/Fieldd).

**Sources (live, June 2026):** CleanCloud features & pickup/delivery & driver app; Cents pickup-&-delivery + driver app; Starchup delivery software/driver app; LinenTech routes/linen-tracking/RFID/billing/healthcare/hospitality pages; Ruggy, Area Rug Management System (Centrum Force), Fieldd, CleanGuru; nursing-home clothing-labeling & RFID (SimSort) guidance. Full URLs in the chat "Sources" list accompanying this deliverable.

---

## 17. Appendix

### 17.1 Glossary
**Par level** — target stock of a linen SKU kept at a customer site; replenished each cycle. **COG** — customer-owned goods (we clean, don't own). **Rental/hire** — we own the linen, bill by par/usage. **Soil intake** — receiving & counting dirty linen. **Load sheet / manifest** — system list of what should be on the truck for a stop; validated at delivery. **POD** — proof of delivery (geo-tagged photo and/or signature). **Custody event** — a scan recording an item's stage/handler/place/time. **Cost center** — sub-unit of a site (wing/floor) for split billing. **PPOH** — pounds processed per operator hour. **Chain of custody** — the unbroken, evidenced record of an item from pickup to return.

### 17.2 Notification event → channel matrix (core)
| Event | Customer | Owner | Driver |
|---|---|---|---|
| Booking confirmed | Push+SMS+Email | — | — |
| Driver assigned / en route | Push+SMS | — | route push |
| Truck ~5 min away (geofence) | Push+SMS | — | — |
| Picked up (N carts/items) | Push+SMS | (exception only) | — |
| Quote ready | Push+SMS+Email | (if > threshold) | — |
| Quote approved/declined | — | feed | — |
| Ready for delivery | Push+SMS | — | route push |
| Delivered + POD | Push+Email(POD) | — | — |
| Late/failed/off-route | (delay notice) | Push (exception) | alert |
| Low par / stockout risk | account Push | Push | — |
| Damage/claim opened | status | approval Push | — |
| Invoice issued | Email | — | — |

### 17.3 Permissions matrix (summary)
| Capability | OWNER | DISPATCH | CSR | PLANT | DRIVER | FINANCE | ACCT_ADMIN | ACCT_STAFF | RESIDENTIAL |
|---|---|---|---|---|---|---|---|---|---|
| View all orders | ✓ | ✓ | ✓ | ✓(plant) | own stops | ✓(read) | own acct | own acct | own |
| Build/assign routes | ✓ | ✓ | — | — | — | — | — | — | — |
| Live fleet (all vehicles) | ✓ | ✓ | view | — | — | — | — | — | — |
| Track my truck (scoped) | ✓ | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ |
| Intake/inspect/quote | ✓ | — | ✓ | ✓ | — | — | — | — | — |
| Approve quote/claim > threshold | ✓ | — | — | — | — | — | — | — | — |
| Soil intake / pack / production | ✓ | — | — | ✓ | — | — | — | — | — |
| Driver scan / POD | ✓ | — | — | — | ✓ | — | — | — | — |
| Invoicing / payments / exports | ✓ | — | view | — | — | ✓ | pay own | — | pay own |
| Manage contracts/par | ✓ | — | ✓ | — | — | — | request | — | — |
| Admin (users/roles/devices) | ✓ | — | — | — | — | — | own acct users | — | — |

### 17.4 Document control
v1.0 · June 2026 · companion to `laundry-platform-blueprint.html`. Change log maintained on revision. Decision-grade build spec; figures and benchmarks carried from the prior market analysis and live competitor research (June 2026).

*End of PRD.*

