# syntax=docker/dockerfile:1
# ─────────────────── Blue Bee Web Console — production image (Increment 14b) ───────────────────
# Monorepo-aware build for the Next.js 14 operator console (apps/web). Builds its workspace deps
# (@blue-bee/shared → @blue-bee/api-client) first, then `next build`. The API base URL is a
# NEXT_PUBLIC_* value, so it is INLINED AT BUILD TIME — passed as a build ARG (Railway exposes
# service variables to the Dockerfile build, so set NEXT_PUBLIC_API_BASE_URL = the deployed API URL
# BEFORE building this service). The console is client-rendered (no server-side API calls), so the
# browser calls the API cross-origin → the API must allow this origin via CORS_ALLOWED_ORIGINS.
#
#   BUILD CONTEXT = repo ROOT:  docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://<api>.up.railway.app -t bluebee-web .
#   On Railway: RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile, deploy from the repo root.

FROM node:20-slim AS base
WORKDIR /app
ENV CI=true

# ── deps: only the web + its workspace deps (root react/react-dom 18.2.0 override is load-bearing) ──
FROM base AS deps
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api-client/package.json packages/api-client/
COPY apps/web/package.json apps/web/
RUN npm ci \
  --workspace=@blue-bee/shared \
  --workspace=@blue-bee/api-client \
  --workspace=@blue-bee/web \
  --include-workspace-root

# ── build: compile the workspace deps, then `next build` with the API URL inlined ──
FROM deps AS build
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1
COPY packages/shared packages/shared
COPY packages/api-client packages/api-client
COPY apps/web apps/web
RUN npm run build --workspace=@blue-bee/shared \
  && npm run build --workspace=@blue-bee/api-client \
  && npm run build --workspace=@blue-bee/web

# ── runtime: `next start` on the platform-provided PORT ──
FROM build AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app/apps/web
# Next 14 `start` honours -p; Railway injects PORT. Default 3001 for a bare `docker run`.
CMD ["sh", "-c", "npx next start -p ${PORT:-3001} -H 0.0.0.0"]
