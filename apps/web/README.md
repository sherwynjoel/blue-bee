# apps/web — Web console + customer web (Next.js)

The operational brain (role-gated) and the public booking site. PRD §4.2, §7B.

**Console modules (MVP first):** Orders & jobs (kanban by lifecycle) · Routes & dispatch + live fleet · Intake/inspection workstation. *Then* production · accounts/contracts · billing · analytics · admin.

**Stack:** Next.js (App Router) + TS + Tailwind + a component library · server components for the data-heavy console · Socket.IO client for the live fleet map.

**First:** `npx create-next-app@latest . --ts --tailwind --app`.
