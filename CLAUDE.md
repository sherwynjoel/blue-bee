# CLAUDE.md — Blue Bee build guide (read this first)

Blue Bee is a **commercial laundry & specialty-cleaning operating system for the Greater Toronto Area**. This file orients you (Claude Code) before you write anything. The full, authoritative spec is **`docs/laundry-platform-PRD.md`** (v1.0, ~690 lines) — read it in full before building. This file only summarizes it and sets the rules.

## What we're building
Four client surfaces on one backend (PRD §1, §4):
1. **Customer app** (iOS/Android/Web) — book, quote-approve, track the truck live, before/after photos, pay.
2. **Owner app** (iOS/Android) — live fleet map, today's numbers, approvals, exceptions feed.
3. **Driver app** (iOS/Android, offline-first) — route, scan, proof-of-delivery, background GPS. This is the GPS/scan source that makes all tracking real.
4. **Web console** (browser) — orders, dispatch/fleet, production, accounts/contracts, billing, analytics, admin.

Three verticals, built in this order (PRD §2, §5): **specialty cleaning** (rugs/carpets/blinds/upholstery) first → **care-home linen + resident clothing** → **hotels**.

## Locked tech stack (PRD §10.2 — do not substitute without flagging it first)
- **Mobile** (customer, owner, driver): **React Native + Expo**, TypeScript. One codebase → iOS + Android. (This is the "one app, both platforms" requirement.)
- **Web** (console + customer web): **Next.js** (React) + TypeScript + Tailwind.
- **Backend**: **NestJS** (Node + TS), **modular monolith**. REST + **WebSocket (Socket.IO)** for live.
- **DB**: **PostgreSQL + PostGIS**, **TimescaleDB** for `GpsPing` history. **Redis** for live last-known location, cache, and queues (BullMQ).
- **ORM**: **Prisma** — model the schema from PRD §9.
- **Payments**: Stripe. **Maps/ETA/routing**: Google Maps Platform. **Notifications**: Twilio (SMS), SendGrid (email), Expo Push (FCM/APNs).
- **Infra**: Docker locally (`infra/docker-compose.yml`); AWS later (PRD §10.2).

## Monorepo layout (npm workspaces + Turborepo)
```
apps/customer   apps/owner   apps/driver   — React Native + Expo
apps/web                                    — Next.js (console + customer web)
apps/api                                    — NestJS (modular monolith)
packages/shared                             — TS types + lifecycle enums + Zod schemas (imported by all)
packages/ui                                 — shared design system
packages/api-client                         — typed API client (generated from OpenAPI)
infra                                       — docker-compose, IaC
docs                                        — PRD, visual blueprint, market index
```
**Package manager: npm workspaces** (chosen over pnpm to avoid symlink issues — this repo lives on an external drive). Orchestrate with **Turborepo**: `npm run dev | build | lint | test | typecheck`.

## Non-negotiable conventions
- **Lifecycle enums match the PRD exactly** (PRD §5 state machines). Don't invent statuses; the API transitions in §11 must match the enums in §9.
- **`org_id` on every row** (PRD §8.1) — single-tenant now, multi-tenant-ready later. Enforce **RBAC + row-scoping server-side** (PRD §3.3, §17.3).
- **Custody/scan events are append-only** (PRD §8.2, §8.6). Never mutate a `CustodyEvent`.
- **Chain of custody is the product.** Every tracked physical item gets a `Tag`; every scan writes a `CustodyEvent` (who/where/when/stage). This is the timeline customers and owners see.
- **Offline-first** for driver + plant surfaces (PRD §8.6): local queue + sync; **stop status is authoritative over raw GPS**.
- **Privacy** (PRD §12.2): location emits **only during an active shift**, consent-gated, with a visible "sharing on" indicator; a customer's live channel is scoped by a **short-lived signed token to exactly one vehicle for the active stop**; resident data (care homes) is least-privilege + audited.
- **Honesty firewall:** never fabricate capacity, counts, certifications, or claims — in code, seed data, or copy. High-value liability is explicit (intake photos + acknowledged pre-existing damage + the claims object).
- **TypeScript strict** everywhere; share types via `packages/shared` — never redefine an enum in two places.
- **API conventions** (PRD §11.1): versioned (`/v1`), idempotency keys on mutations, cursor pagination, problem+json errors, OpenAPI published for app teams.

## Build order — Phase 1 MVP (specialty). Full checklist in `BUILD-PLAN.md`
Anchor first: digitize the specialty trade end-to-end (**book → track → custody → deliver → bill**) with the **Route → Stop → Scan → POD + live tracking** backbone that Phase 2 (care homes/hotels) reuses. Do **not** build Phase 2/3 features yet (resident clothing, par/linen, RFID, consumer wash-fold) — the data model leaves room; the MVP ignores them (PRD §14.1).

Suggested sequence: `infra:up` → `apps/api` (Nest → Prisma schema from §9 Phase-1 slice → auth → orders → routes/stops → tracking gateway → billing → notifications) → `packages/shared` (enums/DTOs/validators, written alongside the API) → `apps/driver` → `apps/customer` → `apps/owner` → `apps/web`.

## House rules
- **Read `docs/laundry-platform-PRD.md` end to end first**, then `ARCHITECTURE.md` and `BUILD-PLAN.md`.
- **This isn't a git repo yet — create it first via the CLI:** `git init -b main && git add -A && git commit -m "chore: foundation scaffold"` (this is `START-HERE.md` Prompt 1).
- **Every Claude Code prompt names its working folder** — `/Volumes/Gowtham/Blue Bee`, or the specific `apps/<x>` sub-folder for a scoped task. Never a prompt without a target folder.
- Keep secrets in `.env` (copy from `.env.example`); never commit real keys.
- The folder name has a space ("Blue Bee") and sits on an external APFS drive — quote paths in scripts.
- Build **Phase 1 only**. If you believe something needs a stack deviation, say so before doing it.
- **Log every build.** After each build increment (a feature, module, migration, or fix), append a dated line to `CHANGELOG.md` (newest on top). Non-negotiable — it's the honest record of what shipped. Material milestones also roll up to the founder's master log at `Projects/CHANGELOG.md` under the tag `[BLUE BEE]`.
