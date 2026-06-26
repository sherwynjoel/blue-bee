# Blue Bee — MVP Cut-Line Reconciliation (PRD §14.1)

**Increment 16 · closes Phase 1.** This is the documented reconciliation the build plan calls for: a
pass confirming the Phase-1 spine — **book → track → custody → deliver → bill** — is built end-to-end
for specialty, and that every PRD §14.1 *deferred* item is **modeled-for but NOT built or faked**
(the honesty firewall). Nothing below is aspirational: each "shipped" row names where it lives.

> PRD §14.1 (verbatim): *"RFID · full plant module · resident-clothing (moves to early P2) · cost-center
> billing · consumer wash-fold · machine-booking · marketplace · WhatsApp · FR. v1 proves: book → track
> → custody → deliver → bill for specialty, with the logistics backbone reused by P2."*

---

## A. The Phase-1 spine — shipped & proven end-to-end

| Stage | Shipped? | Where (module / surface) | Proof |
|---|---|---|---|
| **Book** | ✅ | `apps/api/src/orders` (`POST /v1/orders` → intake → quote → approve/decline, §5.1 state machine); customer app (book + quote-approve); console order board + intake/quote (Inc 13) | orders e2e (book→QUOTED→approve); console screenshots `03-orders-board`, `04-order-detail` |
| **Track** | ✅ | `tracking` (GPS ingestion + Redis last-known + TimescaleDB history), `realtime` (Socket.IO scoped channels + signed per-vehicle customer token), in-house ETA + geofence (Inc 7); console **live fleet** + owner app fleet; customer **track-my-truck** | tracking/realtime/eta e2e; fleet screenshot `07-fleet` (GTA map + vehicles) |
| **Custody** | ✅ | append-only `CustodyEvent` (DB trigger blocks UPDATE/DELETE), intake/inspection (`orders/intake.service`), `Tag`/`Item` + QR, before/after photos (`media`, real S3/MinIO uploads, Inc 10) | custody rows written through the §5.1/§5.4 machines; order detail shows the inspected item + tag |
| **Deliver** | ✅ | `logistics` (`Route`/`RouteStop` §5.4 state machine, dispatch, in-house sequencer/optimizer, manifests), `driver` duty-loop (`/v1/driver/*`, scan/POD/offline, Inc 9), `ProofOfDelivery` | logistics + driver e2e; dispatch/route screenshots `05`, `06` |
| **Bill** | ✅ | `payments` (Stripe via the `LocalPaymentProvider` seam, `Invoice`/`InvoiceLine`, `Payment`, `Refund`, `Dispute`, HST tax, Inc 12); finance console | payments e2e; finance screenshot `09` (SUCCEEDED payment + PAID invoice) |

### Cross-cutting Phase-1 capabilities (also shipped)
| Capability | Where | Proof |
|---|---|---|
| **Identity, RBAC & tenancy** | `auth` (phone-OTP, JWT access+refresh rotation+reuse-detection), 9-role RBAC (§3.3/§17.3), `scopedPrisma` row-scoping (every row carries `org_id`) | auth + scoping e2e |
| **Audit & accountability (§8.7)** | immutable `AuditLog` (DB trigger) written from auth + the order/route/payment machines; **admin audit-log viewer (Inc 16)** | admin e2e (mutation → AuditLog → viewer) |
| **Admin (Epic B6.2)** | `apps/api/src/admin` (users/roles, devices, driver→vehicle assignment, read-only notification-config + audit-log viewers; OWNER-gated, every mutation audited); console `admin` page | admin e2e (11 tests) |
| **Notifications (§8.5)** | `notifications` engine (event→channel matrix, push/SMS/email transports, quiet-hours, retry) | notifications e2e |
| **Analytics (Epic B6.1)** | `apps/api/src/analytics` (operational + commercial + per-account scorecard, honesty-firewalled); console analytics page (Inc 15) | analytics e2e (13 tests); screenshots `10`, `11` |
| **Productionized** | Railway: custom PostGIS+Timescale Postgres, Redis, API + console over HTTPS (Inc 14b); `docs/DEPLOY-RAILWAY.md` | live `/v1/health` 200 |

---

## B. The §14.1 cut line — deferred items, NOT built (correct)

Each row is **deliberately not built** for v1. "Modeled-for" = the schema/seam already accommodates it
(so Phase 2/3 is additive, not a rewrite) — but **no logic, UI, or data is faked**.

| Deferred item (§14.1) | Status | Modeled-for (seam present, unbuilt) | Faked anywhere? |
|---|---|---|---|
| **RFID** (linen pooling) | ❌ not built | `TagType.RFID` enum value exists on `Tag`; no RFID read/pooling logic | No |
| **Full plant module** (production workstations, rewash/reject/reclaim/discard — B3.4) | ❌ not built | `CustodyStage` covers WASH/DRY/FINISH/QC; `Item.status`; custody events written — but no production workstation module or rewash/reject workflow | No — analytics `rewashRate` is computed from the real `OrderStatus.REWASH` snapshot and explicitly scoped; reject/reclaim is flagged deferred |
| **Resident-clothing** tracking + lost&found (care homes — B3.3, early P2) | ❌ not built | `TagBinding.RESIDENT`, `ItemKind.GARMENT` enums exist; no sort-station / lost&found / reconciliation | No |
| **Cost-center billing** | ❌ not built | `Invoice.costCenterBreakdown` Json column (default `{}`); `Account`→`Site` hierarchy — but no cost-center split logic/UI | No — analytics + scorecard `costCenterSplit` returns `unavailable_in_phase_1` (never a fake 0) |
| **Consumer wash-&-fold** (B2C subscription) | ❌ not built | `ServiceVertical.WASHFOLD` / `OrderVertical.WASHFOLD` / `ServiceUnit.LB` enums exist; no consumer subscription/onboarding flow | No |
| **Machine-booking** (laundromat SaaS wedge — Phase 4) | ❌ not built | Not modeled (intentionally — gated on validation) | No |
| **Marketplace / multi-operator / multi-city** | ❌ not built | `org_id` stamped on **every** row → multi-tenant federation is additive (§10.6); runs single-tenant now | No |
| **WhatsApp** channel | ❌ not built | `CommsChannel` = PUSH/SMS/EMAIL/IN_APP; WhatsApp is a future channel add to the transport seam | No |
| **FR localization** | ❌ not built | Notification templates are EN-only (`notification-templates.ts`: "EN only this phase; FR is P2"); no i18n layer | No |

### Other deliberate Phase-1 allowances (documented, not hidden)
- **Stripe runs test-mode** (no live key → the deterministic `LocalPaymentProvider`); the webhook path is real. A live key upgrades it (Inc 12 / runbook).
- **Notification providers** (SendGrid/Expo/Twilio) run local/sandbox transports until real creds are set (Inc 8 / runbook).
- **Editable notification templates** — templates are static EN code-config; the admin surface ships a **read-only viewer** (no fake editor). A DB-backed template editor is a later-phase add.

---

## C. Verdict

**Phase 1 is COMPLETE (Increments 1–16).** The specialty spine **book → track → custody → deliver → bill**
is built and proven end-to-end with RBAC + an immutable audit trail; analytics and the admin surface
close Epic B6; and the logistics/tracking backbone is structured for Phase-2 reuse (care homes / hotels).
Every §14.1 cut-line item is unbuilt-by-design and unfaked. The next track (condos/institutional, Phase 2)
is scoped separately.
