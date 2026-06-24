# Build plan — Blue Bee

Phasing follows **PRD §14** (anchor → institutional → scale → optional). **Build Phase 1 only now.**

## Phase 1 — Digitize the anchor (specialty) · MVP (~0–4 months)
**Goal (PRD §14):** real specialty GMV flowing end-to-end with live tracking + chain of custody.
**Scope:** Customer app+web (book, quote-approve, live tracking, pay, photos) · Web console (orders, intake/inspection/quote, cleaning stages, QC, basic routes + dispatch, live fleet) · Owner app (live fleet, today, approvals, exceptions) · Driver app (route, scan, POD, background GPS, offline) · Stripe payments · push/SMS/email · RBAC/audit.

### Phase-1 first-sprint checklist (suggested order)
- [ ] 0. `git init`; `npm install`; `npm run infra:up` (Postgres + PostGIS + Timescale, Redis).
- [ ] 1. **apps/api** — NestJS scaffold: config, health check, OpenAPI, `/v1` versioning, problem+json errors.
- [ ] 2. **packages/shared** — lifecycle enums (PRD §5), core DTO types, Zod validators. Imported by every app.
- [ ] 3. **DB** — Prisma schema for the Phase-1 slice (see ARCHITECTURE.md), migrations, seeded demo org/tenant.
- [ ] 4. **Auth** — phone OTP + JWT (access/refresh), social sign-in; RBAC guards + row-scoping (PRD §8.1, §17.3).
- [ ] 5. **Orders / specialty** — book → intake/inspection (condition photos, measurement) → quote engine → approve/decline (PRD §5.1, §7A/§7B).
- [ ] 6. **Logistics** — Route / RouteStop, dispatch + assign driver/vehicle, publish to driver; stop state machine (PRD §5.4).
- [ ] 7. **Tracking gateway** — batched location ingestion, Redis geo, Socket.IO channels, server ETA + geofence, token-scoped customer channel (PRD §6.2).
- [ ] 8. **apps/driver** — route list + map, scan/tally vs expected, POD (geo photo + signature), background GPS, offline queue (PRD §7D, §8.6).
- [ ] 9. **apps/customer** — book + quote-approve + "track my truck" + Stripe pay + before/after photos (PRD §7A).
- [ ] 10. **apps/owner** — live fleet map, today dashboard, approvals, exceptions feed (PRD §7C).
- [ ] 11. **apps/web** — console: order board (kanban by lifecycle) + intake workstation + route builder/live fleet (PRD §7B).
- [ ] 12. **Notifications** — event→channel matrix (PRD §17.2): push/SMS/email from the lifecycle + geofence engine.
- [ ] 13. **Analytics seed + audit log**; check against the MVP cut-line (PRD §14.1).

**Exit criteria:** a specialty job goes **book → track → custody → deliver → bill** with live tracking, on real iOS + Android devices.

## Phase 2 — Institutional linen: care homes + hotels (~4–10 months)
Contracts / par / standing orders · recurring route auto-generation · soil intake (weight/count) · pack-to-par + load sheets + manifests · **resident personal-clothing tracking + lost&found** · cost-center billing · B2B portal · batch invoicing + accounting sync. (PRD §14.)

## Phase 3 — Scale & hardening (~10–16 months)
RFID linen pooling · full production/plant module · BI suite · FR localization · SSO · advanced route optimization.

## Phase 4 — Optional expansion, validate first (16 months+)
Consumer wash-&-fold · laundromat machine-booking · multi-operator marketplace.

## Explicitly NOT in MVP (PRD §14.1)
RFID · full plant module · resident-clothing (early P2) · cost-center billing · consumer wash-fold · machine-booking · marketplace · WhatsApp · FR.

## Open questions to resolve early (PRD §15)
1. Billing base — "10% of what?" (net-new vs existing anchor volume). 2. Resident-clothing liability model. 3. RFID timing (does a flagship hotel demand it at signing?). 4. Own fleet only vs 3PL overflow. 5. QBO vs Xero first. 6. FR timing for institutional RFPs.
