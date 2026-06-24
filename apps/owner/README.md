# apps/owner — Owner app (React Native + Expo)

An executive cockpit — deliberately **not** the full console on a phone. PRD §4.3, §7C.

**MVP:** live fleet map (all outbound vehicles + exceptions) · Today dashboard (GMV, jobs in/out, on-time %, collected $) · approvals (quotes/claims/credits above threshold, one-tap) · exceptions feed · drill-through (truck → stops → order → chain of custody).

**Stack:** Expo + RN + TS · Socket.IO client for the live fleet feed.

**First:** `npx create-expo-app@latest . -t expo-template-blank-typescript`.
