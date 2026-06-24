# START HERE — kick off the Blue Bee build with Claude Code

This is a **foundation only** — structure, configs, and docs are in place, but there is **no app code yet** and it is **not a git repo yet**. Open the folder in VS Code, then run the two prompts below in Claude Code, in order.

**Working folder — every prompt below operates here:** `/Volumes/Gowtham/Blue Bee`
Before you start: be on **Node 20** (`nvm use`) and have **Docker running**.

---

## Prompt 1 — create the git repo (run once, via CLI)

```
Work in this folder: /Volumes/Gowtham/Blue Bee

This folder is NOT a git repository yet. Create it with the git CLI:
  cd "/Volumes/Gowtham/Blue Bee"
  git init -b main
  git add -A
  git commit -m "chore: foundation scaffold"

Then run `git status` and `git log --oneline` and show me the output to confirm the repo exists with one commit. Do not add a remote or push anywhere yet.
```

---

## Prompt 2 — kick off the Phase-1 build

```
Work in this folder: /Volumes/Gowtham/Blue Bee  (the Blue Bee monorepo on the Gowtham drive)

You are building Blue Bee, a commercial laundry & specialty-cleaning operating system for the Greater Toronto Area. This folder holds the FOUNDATION ONLY (structure, root configs, docs) — no app code yet.

STEP 1 — Read these fully, in order, before writing anything:
  1. CLAUDE.md            (build rules + locked stack)
  2. docs/laundry-platform-PRD.md  (the authoritative spec, ~690 lines)
  3. ARCHITECTURE.md and BUILD-PLAN.md

STEP 2 — Confirm the git repo exists (Prompt 1). If `git status` errors, run: git init -b main && git add -A && git commit -m "chore: foundation scaffold".

STEP 3 — Summarize the plan back to me in ~10 lines: Phase-1 scope, build order, and anything you'd change. WAIT for my OK before scaffolding.

STEP 4 — After I confirm, build Phase 1 (specialty MVP) in the order from BUILD-PLAN.md. Begin with: `npm install`, `npm run infra:up`, then scaffold apps/api (NestJS) + packages/shared (lifecycle enums, DTOs, Zod validators) + the Prisma schema for the Phase-1 data slice. PAUSE for review once the API boots, the schema migrates, and a seeded demo order exists.

HARD RULES (see CLAUDE.md):
- Stack is locked: React Native + Expo, Next.js, NestJS, Postgres+PostGIS+Timescale, Redis, Socket.IO, Stripe, Google Maps. Flag before ANY deviation.
- Lifecycle enums must match PRD §5 exactly. `org_id` on every row; RBAC + row-scoping server-side. Custody/scan events are append-only.
- Use npm workspaces (not pnpm). Build Phase 1 ONLY — no linen/resident/RFID/consumer features yet.
- Never fabricate data, capacity, certifications, or claims.
- After every build increment, append a dated line to CHANGELOG.md (newest on top) — keep the build log current. Standing rule, not a one-time step.

Start with Step 1.
```

---

## After the API is up
Continue down the `BUILD-PLAN.md` checklist: **driver app** (this is what makes tracking real) → **customer app** → **owner app** → **web console** → **notifications**. Keep every surface importing `packages/shared` and `packages/api-client` so the contract stays single-sourced.

> **Prompt convention for this project:** every Claude Code prompt **opens by naming its working folder** — `/Volumes/Gowtham/Blue Bee`, or the specific `apps/<x>` sub-folder for a scoped task. Never a prompt without a target folder.
