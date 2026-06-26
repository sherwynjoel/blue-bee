# syntax=docker/dockerfile:1
# ───────────────────────── Blue Bee API — production image (Increment 14b) ─────────────────────────
# Monorepo-aware multi-stage build for the NestJS modular monolith (apps/api). It installs only the
# API's workspace subtree (skips the Expo/Next app deps), builds its workspace deps
# (@blue-bee/shared → @blue-bee/api-client) first, then generates the Prisma client IN-IMAGE so the
# query-engine binary matches THIS runtime (Debian/openssl-3 → `debian-openssl-3.0.x`), and finally
# runs `prisma migrate deploy` as the release step before booting `node dist/main.js`.
#
#   BUILD CONTEXT = repo ROOT (the workspaces live above apps/api):
#     docker build -f apps/api/Dockerfile -t bluebee-api .
#   On Railway: set RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile, deploy from the repo root.
#
# Node 20 (root package.json engines: ">=20 <21"). Working folder on the founder's drive: "/Volumes/Gowtham/Blue Bee".

FROM node:20-slim AS base
# OpenSSL + CA certs: Prisma's native engine needs libssl; TLS to Postgres/Redis/Stripe/S3 needs the CA bundle.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV CI=true

# ── deps: install ONLY the API + its workspace deps (root lockfile, but skip the Expo/Next app deps) ──
FROM base AS deps
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
RUN npm ci \
  --workspace=@blue-bee/shared \
  --workspace=@blue-bee/api-client \
  --workspace=@blue-bee/api \
  --include-workspace-root

# ── build: compile shared → api-client → api (the api build script runs `prisma generate` first) ──
FROM deps AS build
COPY packages/shared packages/shared
COPY packages/api-client packages/api-client
COPY apps/api apps/api
RUN npm run build --workspace=@blue-bee/shared \
  && npm run build --workspace=@blue-bee/api-client \
  && npm run build --workspace=@blue-bee/api

# ── runtime: the built dist + the (already-generated) node_modules incl. the Prisma CLI for migrate ──
FROM base AS runtime
# Secure default: a bare `docker run` boots as production (the Inc-2 SMS guard then refuses console SMS).
# Railway overrides this at runtime (the pilot runs NODE_ENV=staging — see docs/DEPLOY-RAILWAY.md).
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/turbo.json ./turbo.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/api-client/package.json ./packages/api-client/package.json
COPY --from=build /app/packages/api-client/dist ./packages/api-client/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
WORKDIR /app/apps/api
# Release + start: apply the 9 migrations against the live Postgres (idempotent; already-applied are
# skipped) then boot. `migrate deploy` is the production-safe migrator — no drift detection prompts,
# no `db push`. DATABASE_URL / REDIS_URL / secrets are injected by Railway. PORT is honoured by main.ts.
# The bounded retry absorbs the ~1–3s after a container start before Railway's private network (the
# IPv6 mesh to postgres.railway.internal) becomes routable — migrate would otherwise P1001 on boot.
# NOTE: keep the API at a single replica so two boots never race the migrator (see the runbook).
CMD ["sh", "-c", "n=0; until npx prisma migrate deploy; do n=$((n+1)); if [ \"$n\" -ge 15 ]; then echo 'migrate deploy: giving up after '$n' attempts'; exit 1; fi; echo 'migrate deploy retry '$n' — waiting for DB / Railway private network...'; sleep 3; done; node dist/main.js"]
