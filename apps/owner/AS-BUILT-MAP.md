# Owner app (Increment 14a) — as-built map (what each screen calls, before coding)

Working folder: `/Volumes/Gowtham/Blue Bee`. Branch: `inc14-owner-app` (off `main` `2b6371c`). The owner
app mostly **consumes proven APIs**; only **three thin additive OWNER-scoped reads** are new. No schema change.

## PRD §4.3/§7C owner-cockpit surfaces → what they call
| Screen | PRD | Reads (role) | Actions (reused) |
|---|---|---|---|
| Shell + auth + RBAC | — | `POST /auth/otp`, `POST /auth/verify`, `GET /me`, `POST /auth/logout` (any authed); gate to an **OWNER** role grant, else no-access | `useAuthSession` (reused 1:1) |
| **C1 Live fleet** | §7C C1 | `GET /fleet/live` (OWNER/DISP/CSR) + `WS /live/fleet` (access JWT in `handshake.auth.token`; events `position`/`eta`/`geofence`). **REST is truth; WS optimizes; degrade→poll 15s.** | — (read-only) |
| **C2 Today dashboard** | §7C C2 | **NEW** `GET /owner/today` (OWNER) — server aggregates orders/payments/stops | — |
| **C3 Approvals** | §7C C3 | **NEW** `GET /owner/approvals` (OWNER) — pending `QUOTED` orders | `POST /orders/:id/quote:approve` / `:decline` (OWNER). **409 → re-sync (server authoritative).** |
| **C4 Exceptions feed** | §7C C4 | **NEW** `GET /owner/exceptions` (OWNER) — failed/skipped stops + held orders + open disputes + failed payments | deep-link to `GET /orders/:id` / `GET /routes/:id` |
| **C5 Drill-through** | §7C C5 | `GET /orders/:id`, `GET /routes/:id`, `GET /routes` (OWNER/DISP/CSR) — truck → route → stops → order → chain of custody | — (read-only) |
| **Push** | §17.2 | `POST /device-tokens` on login, `DELETE /device-tokens` on logout (any authed). Tapped push (`data{orderId,type}`) → `OrderDetail` (scoped; the read 404s cross-org). | — |

## Flagged GAPS (confirmed by the as-built map; the reason the thin OwnerModule exists)
- **No today-KPIs endpoint** → `GET /owner/today` aggregates server-side (orders today, active, completed today, pending approvals, open exceptions, GMV approved today, collected today, on-time %). No client business logic.
- **No aggregated exceptions feed** → `GET /owner/exceptions` normalizes failed/skipped stops (last 7d) + `ON_HOLD` orders + `OPEN`/`UNDER_REVIEW` disputes + `FAILED` payments (last 7d), each with deep-link targets.
- **No pending-approvals list** → `GET /owner/approvals` lists `QUOTED` orders (the as-built supports **quote** approvals only).
- **No threshold / claims / credits approval objects** in the as-built (§4.3 mentions "quotes/claims/credits above a threshold"; only generic quote approve/decline exists, no threshold gate). The owner app surfaces **pending quote approvals** — what is actually supported — and does not invent a claims/credits/threshold workflow.
- **Low-par alerts** are Phase-2 (linen) — modeled-for, not built (honesty firewall).
- **Owner dispute push**: disputes already dispatch to OWNER/FINANCE staff (`resolveOrgStaffRecipients`) but only via EMAIL. Inc 14a adds **PUSH** to the `PAYMENT_DISPUTE` matrix so a registered owner device receives it (deep-link `data{orderId,type}` already exists). On-device arrival = the founder's run.

## Reused seam (no reinvention)
`packages/api-client` `ApiClient` (single-flight 401→refresh→retry, problem+json→ApiError, device-tokens) +
`useAuthSession` (login / logout-even-offline / hydrate); native `SecureTokenStore` (expo-secure-store); the
customer RN **WS-degrade controller** + `react-native-maps`; the web **FleetBoard** REST+WS merge; the Inc-8
push engine + `expo-notifications`. `OwnerApiClient extends ApiClient` lives app-local (like Driver/Customer).

## Backend additive footprint (minimal, merge-clean vs 14b)
- `packages/shared/src/owner.ts` (+ barrel export) — DTOs only.
- `apps/api/src/owner/{owner.controller,owner.service,owner.module}.ts` — OWNER-gated, `scopedPrisma` org-scoped, read-only, no schema change.
- `apps/api/src/app.module.ts` — one additive `OwnerModule` import (the only shared-file touchpoint with 14b besides the lockfile).
- `apps/api/src/config/notifications.config.ts` (+ template/test) — add PUSH to `PAYMENT_DISPUTE` default channels.
- `apps/api/test/owner.e2e-spec.ts` — locks the three reads + RBAC + org-scoping.
- Root `package.json` workspaces glob is `apps/*` → **no root edit** to add `apps/owner`.
