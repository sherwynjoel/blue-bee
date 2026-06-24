# packages/shared — shared types, enums, validation

The contract **every** app imports. Single source of truth for cross-cutting types.

**Contains:** lifecycle enums (PRD §5 — order/route/stop statuses), DTO types, Zod schemas, shared constants (roles, realtime channel names, notification event types).

**Rule:** never redefine an enum or DTO elsewhere — import it from here.
