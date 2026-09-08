# Blue Bee

Commercial laundry & specialty-cleaning **operating system** for the Greater Toronto Area. One backend, four client surfaces, three verticals (specialty cleaning, care-home linen, hotels). **Live truck tracking** and **end-to-end chain of custody** are the wedge.

> **Status: Phase-1 MVP built and iterating** (39+ increments as of 2026-09-08) — auth, orders, logistics/tracking, payments, notifications, and all four client surfaces exist and are tested. See `CHANGELOG.md` for the build log and `handoffs/` for the latest developer handover before making changes.

## Surfaces
- **Customer app** (iOS/Android/Web) — book, quote-approve, track the truck, pay, view before/after photos.
- **Owner app** (iOS/Android) — live fleet, today's numbers, approvals, exceptions.
- **Driver app** (iOS/Android) — route, scan, proof-of-delivery, background GPS (offline-first).
- **Web console** (browser) — orders, dispatch, production, accounts, billing, analytics.

## Stack
React Native + Expo (mobile) · Next.js (web) · NestJS modular monolith (API) · PostgreSQL + PostGIS + TimescaleDB · Redis · Socket.IO · Stripe · Google Maps Platform · Twilio / SendGrid / Expo Push. Rationale in PRD §10.

## Layout
| Path | What |
|---|---|
| `apps/customer`, `apps/owner`, `apps/driver` | React Native + Expo apps |
| `apps/web` | Next.js console + customer web |
| `apps/api` | NestJS API (modular monolith) |
| `packages/shared` | Shared types, lifecycle enums, Zod schemas |
| `packages/ui` | Shared design system |
| `packages/api-client` | Typed API client |
| `infra` | docker-compose + IaC |
| `docs` | PRD, visual blueprint, market index |

## Quick start
1. Node 20 (`nvm use`), then `npm install`.
2. `npm run infra:up` — local Postgres (PostGIS + Timescale) + Redis via Docker.
3. Follow `START-HERE.md` to scaffold Phase 1.

## Docs
- **`docs/laundry-platform-PRD.md`** — full build spec (v1.0). **Start here.**
- `docs/laundry-platform-blueprint.html` — interactive visual blueprint.
- `docs/index.html` — prior market-analysis dashboard.
- `ARCHITECTURE.md` · `BUILD-PLAN.md` · `CLAUDE.md`.
