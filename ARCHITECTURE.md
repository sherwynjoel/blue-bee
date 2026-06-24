# Architecture — Blue Bee

Condensed from **PRD §9 (data model)** and **§10 (system)**. The PRD is authoritative; this is the map.

## System shape (PRD §10.1)
Clients (RN apps + Next.js web) → **API gateway/BFF (NestJS)** → core services (orders, routes, production, accounts — one **modular monolith**) + **location/tracking gateway** + notification service + billing. Stores: **Postgres + PostGIS** (+ **Timescale** for `GpsPing`), **Redis** (live geo, cache, queues), **S3** (photos/POD). External: Google Maps, Stripe, Twilio, SendGrid, QuickBooks/Xero.

**Why a modular monolith (PRD §10.3):** one operator, hundreds of stops/day — ships faster, cheaper to run, easy to keep transactionally consistent (orders ↔ routes ↔ billing). The **tracking ingestion path** is the one component designed to scale out (stateless + Redis + pub/sub), so it can be peeled off first if needed.

## Lifecycles (PRD §5 — enums MUST match these)
- **Specialty job:** `REQUESTED → SCHEDULED_PICKUP → PICKUP_EN_ROUTE → PICKED_UP → INTAKE_INSPECTED → QUOTED → QUOTE_APPROVED → IN_CLEANING → QC → READY → SCHEDULED_DELIVERY → DELIVERY_EN_ROUTE → DELIVERED → INVOICED → CLOSED` (+ branches: quote declined, pre-existing damage flagged, on-hold, rewash, claim opened/resolved).
- **Care-home [Phase 2]:** facility linen (par/COG) stream + resident personal-clothing stream (garment↔resident, return-sort, lost&found).
- **Hotel [Phase 2]:** soil → production → pack-to-par → consolidated manifest → deliver → bill by weight/piece.
- **Shared logistics backbone:** `Route → Stop → Scan → POD`; stop status `PENDING → EN_ROUTE → ARRIVED → IN_PROGRESS → COMPLETED/FAILED/SKIPPED`. **This is what live tracking renders against.**

## Data model (PRD §9 — implement in Prisma)
Entity groups:
- **Identity/accounts:** Organization, User, Role/UserRole, Account, Site, CostCenter, Contact.
- **Catalog/contracts:** Service, LinenSKU, PriceList/PriceListItem, Contract, ParLevel, StandingOrder.
- **Orders/custody:** Order, OrderLine, Item, Tag, Resident, Inspection, Photo, Quote, CustodyEvent.
- **Production/linen:** Cart/Container, SoilIntake, ProductionBatch, PackEvent/LoadSheet, RewashReject, LostFoundItem.
- **Logistics/tracking:** Vehicle, Driver, Shift, Route, RouteStop, GpsPing, GeofenceEvent, ProofOfDelivery, Manifest.
- **Billing/comms/system:** Invoice, Payment, Subscription, CreditNote/Claim, Message, Notification, AuditLog, Device.

Every row carries `id (uuid)`, `org_id`, `created_at`, `updated_at`, `created_by`.

## Real-time tracking path (PRD §6.2)
Driver app emits **batched GPS pings** (adaptive duty cycle; faster near a stop, paused off-shift; offline queue) → **stateless ingestion** → **Redis geo** (last-known) + **Timescale** (history) → **Socket.IO** channels → customer (one vehicle, **token-scoped**) and owner + console (all org vehicles). Server recomputes **ETA per ping cluster** (Google Routes API); **geofence** events → notification service. The customer channel is scoped by a short-lived signed token to one vehicle for the active stop only. Degrade gracefully: if the live channel drops, fall back to polling last-known + the status timeline.

## Phase-1 data slice (specialty MVP)
Implement now: Organization/User/Role, Account/Site, Order/OrderLine/Item/Tag/Inspection/Photo/Quote/CustodyEvent, Vehicle/Driver/Shift/Route/RouteStop/GpsPing/GeofenceEvent/ProofOfDelivery, Invoice/Payment/Claim, Message/Notification/AuditLog/Device. Defer linen/resident/production tables to Phase 2 (you may model them but leave them unused).

## NFRs that shape the code (PRD §12)
Live location end-to-end < 3s p95; map updates ≥ every 30s within 5 km of a stop. API reads < 300ms / writes < 800ms p95. TLS everywhere + encryption at rest. **PCI handled by tokenizing through Stripe (no raw PAN).** JWT short-lived + RBAC row-scoping. PIPEDA / PHIPA-adjacent care for resident + location data. Retention: pings hot 7d → downsampled 90d; POD 24mo; financial 7y.
