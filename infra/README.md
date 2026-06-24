# infra — local dev + IaC

**`docker-compose.yml`** runs local **Postgres (PostGIS + TimescaleDB)** + **Redis**.
- Start: `npm run infra:up` (from repo root) · Stop: `npm run infra:down`.
- Postgres: `localhost:5432`, db/user/pass `bluebee`. Redis: `localhost:6379`. (Matches `.env.example`.)
- Postgres is built from **`Dockerfile.postgres`** (PostGIS 16 base + TimescaleDB apt package, stock postgres entrypoint). We do **not** use `timescale/timescaledb-ha` because Prisma fails to connect to it with a spurious `P1010 "denied access"` on every connection (confirmed not a privilege issue — raw psql works, and Prisma connects fine to a vanilla postgres entrypoint). **Do not revert to the `-ha` image** — it breaks the ORM. Same locked stack (PG16 + PostGIS + TimescaleDB), Prisma-compatible image.

**Later (PRD §10.2):** Terraform for AWS (ECS/Fargate or EKS · RDS Postgres · ElastiCache Redis · S3 · CloudFront) · CI/CD (GitHub Actions) · observability (OpenTelemetry → Datadog/Grafana) · Sentry.
