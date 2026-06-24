# Blue Bee — CHANGELOG (build log)

The running record of every build on Blue Bee. **Update this after every build — one dated line per change, newest on top.** This is the detail log that lives with the code; material milestones also roll up to the founder's master log at `Projects/CHANGELOG.md` under the tag `[BLUE BEE]`.

Format:

```
## YYYY-MM-DD
- HH:MM IST · what changed · → files/areas touched
```

---

## 2026-06-24
- 12:12 IST · **Foundation scaffolded (pre-code).** Monorepo skeleton created on the external Gowtham drive: `apps/{customer,owner,driver,web,api}`, `packages/{shared,ui,api-client}`, `infra/`, `docs/`. Root configs: npm-workspaces `package.json` + Turborepo, `tsconfig.base.json`, `.env.example` (all PRD §11.2 integrations), `.gitignore`, `infra/docker-compose.yml` (Postgres + PostGIS + Timescale, Redis). Planning docs moved into `docs/` (PRD `.md` + `.docx`, blueprint, market `index.html`). Orientation written: `CLAUDE.md`, `ARCHITECTURE.md`, `BUILD-PLAN.md`, `START-HERE.md` (Claude Code kickoff prompt). Stack locked: React Native + Expo (one codebase, iOS + Android), Next.js, NestJS modular monolith, Postgres/PostGIS/Timescale, Redis, Socket.IO, Stripe, Google Maps. No app code yet — `git init` is Claude Code's first step. → whole repo
