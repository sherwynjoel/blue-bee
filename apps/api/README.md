# apps/api — Blue Bee API (NestJS)

The backend: a **modular monolith**, REST + **Socket.IO**. PRD §10, §11.

**Phase-1 modules:** auth · accounts · orders (specialty) · routes/dispatch · tracking gateway · billing (Stripe) · notifications · audit. *(Phase 2 adds contracts/par, production, residents.)*

**Stack:** NestJS + TS · Prisma (Postgres/PostGIS/Timescale) · Redis + BullMQ · Socket.IO · Stripe · Google Maps · Twilio/SendGrid/Expo Push.

**First steps**
1. `npx @nestjs/cli new . --skip-git --package-manager npm` (scaffold into this folder).
2. Add Prisma; model the Phase-1 schema from PRD §9 / ARCHITECTURE.md.
3. Read config from the root `.env` (see `.env.example`).
4. Enforce: `/v1` versioning, OpenAPI, problem+json errors, idempotency keys on mutations.

**Rules:** lifecycle enums come from `packages/shared` (PRD §5) — import, never redefine. `org_id` + RBAC row-scoping on everything.
