# infra — local dev + IaC

**`docker-compose.yml`** runs local **Postgres (PostGIS + TimescaleDB)** + **Redis**.
- Start: `npm run infra:up` (from repo root) · Stop: `npm run infra:down`.
- Postgres: `localhost:5432`, db/user/pass `bluebee`. Redis: `localhost:6379`. (Matches `.env.example`.)

**Later (PRD §10.2):** Terraform for AWS (ECS/Fargate or EKS · RDS Postgres · ElastiCache Redis · S3 · CloudFront) · CI/CD (GitHub Actions) · observability (OpenTelemetry → Datadog/Grafana) · Sentry.
