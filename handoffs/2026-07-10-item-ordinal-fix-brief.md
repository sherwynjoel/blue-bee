# Brief — deterministic order-item ordering (add an ordinal column to `Item`)

**Date:** 2026-07-10 · **Working folder:** `/Volumes/Gowtham/Blue Bee` · **App:** `apps/api` (+ any surface that lists items)
**From:** planning/QC chat · **For:** Claude Code. Founder decision: fix this **before** more Tier-2 features.
**Rules:** no stubs · additive migration · honesty firewall (don't claim to recover an order that was never stored) · `org_id` intact · TS strict · full e2e green · log `CHANGELOG.md` + dated handoff.

## The bug (confirmed by independent audit, Inc-28)
`ORDER_INCLUDE`/`FULL_INCLUDE.items` (`orders.service.ts:56`) includes `items` with **no `orderBy`**, and `Item` (`schema.prisma:797`) has **no ordinal/position column**. So an order's items come back in Postgres **heap order**, and since all items in a booking share one transaction `createdAt`, there's no tiebreak — **two reads can list the same order's items differently, on every surface** (customer, console, driver). Index-based consumers (quote build, the weigh measurement→item mapping) can then bind a value to the wrong line — CC's own test caught a rug's `sqft` landing on a garment, which `quotes.build` correctly refused to price. This is a correctness/mispricing risk, not cosmetic.

## Fix

**1. Schema + migration (additive).**
- Add `sortOrder Int` (0-based) to `Item`.
- **Backfill existing rows deterministically**, per order: `ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY created_at, id) - 1`. 
- **Honesty note (put in the handoff, not just code):** this *imposes* a stable order; it does **not** recover an original ordering that was never stored. That's acceptable — already-priced orders keep their stored quotes (no re-price), and the value is determinism from here on. Do not describe the backfill as "restoring" the real order.
- Confirm `Item` carries **no append-only trigger** (the backfill `UPDATE` must be permitted; append-only guards are on custody/weight/audit, not `Item` — verify before writing the migration).

**2. Write path.**
- On booking (`orders.service.ts` `book()` item creation), set `sortOrder` = each item's index in the submitted items array (the booker's intended order). 
- Any other `Item`-creation path (e.g. intake add-item) sets a correct trailing `sortOrder` (max+1 within the order). Grep for every `item.create`/`createMany`.

**3. Read path.**
- Add `orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }]` to the `items` include in `ORDER_INCLUDE`/`FULL_INCLUDE` **and** every place items are queried separately. Grep all `items:` reads so no surface is missed.

**4. Consumers.**
- Verify the previously index-fragile consumers now rely on the stable order: quote build, the weigh measurement→item mapping, and the customer/console/driver item lists. The tests that were "passing on luck of heap order" should now pass deterministically **without** weakening their assertions.

## Verify (proof)
- Migration applies + backfills; every existing order's items get a contiguous `sortOrder`.
- New booking: items persist in submitted order; a re-read returns identical order.
- A test asserting **item order is stable across two reads** of the same order.
- The weigh/quote index-based specs pass deterministically. api `tsc` + **full e2e green** (≥411).
- Live (after deploy): re-read an order twice → identical item order.

## Deploy
Additive column + backfill run via the boot-time `prisma migrate deploy` on the next `railway up` — **not** manual DB surgery, so it's inside the normal deploy path you authorize. Can batch with the Inc-28 deploy or ship right after.

**Optional tidy (separate, low priority):** the pre-existing customer lint failures on `ChatScreen.tsx` + `OrderDetailScreen.tsx` (unmodified from HEAD, flagged in Inc-28) — fix if convenient; not part of this increment.

**Boundary:** the planning chat doesn't run `railway up` or touch DB credentials — CC executes and shows the verification.
