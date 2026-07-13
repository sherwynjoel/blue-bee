# Inc-38 — FIX: the founder's dry-clean garments never reached the app

**Date:** 2026-07-13 · **Status:** built, fully verified, **DEPLOYED to staging** (api `020beb2` · web `80f682b`) · **Trigger:** founder report

> *"I have added a shirt… that shirt should also reflect in the dry cleaning. Right now I have Shirt as a category and also Pant. Why is it not reflected in the app? Even if I refresh it."*

---

## 1. What was actually wrong

**Not a refresh bug. Not a console bug. The app had stopped asking.**

`GET /v1/catalog/dryclean` was returning the founder's garments, correctly priced, the entire time:

| Category | Garment | Price |
|---|---|---|
| Shirts | Shirt | **$5.00** |
| Shirts | Coat | **$15.00** |
| Outerwear | Pant | **$7.00** |

**Inc-36** — "simplify booking: remove the item-type picker, the service picker, the garment sub-catalog" — deleted `DrycleanPicker.tsx` and stopped calling `getDrycleanCatalog()`. The client method survived, called by nothing. No amount of refreshing could surface those garments: **there was no code path that looked for them.**

## 2. The deeper defect it was hiding

The Dry Cleaning card is a flat `PER_ITEM` rate. So the app asked *"how many items?"* and multiplied by one price — meaning **a $15 coat and a $5 shirt would have been charged identically**, and the founder's per-garment prices could never reach a customer.

The console was letting the founder set prices the app was structurally incapable of honouring. That is the exact class of "console says one thing, app does another" failure the honesty firewall exists to prevent, and it would have shipped silently.

Dry cleaning is priced **per garment**. That's the industry norm, and it's what the founder was entering.

## 3. The fix — the catalog decides the flow, not the code

`HomeServiceCardView` gains **`garmentCount`**: how many bookable garments (active per-ITEM services) the founder has nested under that card, computed server-side.

- `garmentCount > 0` → Book **drills into the garment picker**. Each garment is its own order line, at its own price.
- `garmentCount === 0` → the Inc-36 **one-measure** flow (kg / lb / sqft / count), unchanged.

**The app never checks for the words "dry cleaning".** Nest garments under any card in the console and that card drills in; remove them and it reverts to one measure. The founder's catalog is the source of truth — no hardcoded special case for one service.

`GET /v1/catalog/dryclean?cardId=` now **scopes the picker to the tapped card**. Previously it returned *every* nested category in the org, so the day a second card got garments, one card's picker would have shown the other's garments. That was a latent bug, not a hypothetical.

Booking uses the **exact contract the pre-Inc-36 picker used** — one line per garment type, `serviceId` = the garment's own service, quantity in `estimatedMeasure`. **The server quote path was never touched**, which is why this is app-side + one additive field, not a re-architecture.

## 4. Honesty

A per-garment card with **no garments listed yet** says exactly that — *"No garments listed yet. This service is priced per garment and the list is still being set up."* It does **not** fall back to a measure box, which would charge a coat like a shirt at a rate the customer never agreed to. There is a test for this.

## 5. Proof

| Gate | Result |
|---|---|
| typecheck | **10/10** |
| lint | **6/6** |
| api unit | **338/338** |
| customer | **223/223** (+14) |
| driver | **49/49** |
| web | **215/215** |
| **api e2e (fresh seeded DB)** | **466/466 · 38/38 suites** |

New customer tests: the garments render at *their own* prices with no measure box · **2 shirts + 1 coat = $25.00**, not 3 × a flat rate · booking sends one line per garment carrying each garment's own service (and never the card's flat service) · removing the last of a garment drops its line (no zero-qty ghost) · an empty per-garment card never falls back to a measure box · a non-garment card still uses one-measure and never fetches garments at all.

New api e2e: the Home card reports its `garmentCount`, the picker is scoped to that card (every returned category is its child), the advertised count equals what the picker can actually book, and a card with no garments returns an empty picker rather than another card's.

### A note on two red e2e runs
Two earlier full runs showed 12 and 2 failures. **Both were `beforeAll`/test TIMEOUTS, not assertions** — caused by leaked `jest-worker` processes from unit suites I ran concurrently with the e2e (load average 5.65). Killing them and re-running on a clean box: **466/466**. Recorded here so nobody re-diagnoses it as a flaky product.

## 6. Founder to-do

- **Re-file two garments:** **Coat** currently sits under *Shirts*, and **Pant** under *Outerwear*. Harmless, but the customer's drill-in will read oddly.
- Consider setting the Dry Cleaning card's `priceFrom` to the lowest garment price ($5.00) so the grid can honestly say *"from $5.00"* instead of *"Get a quote"*.

## 7. Deploy (done, 2026-07-13)

**api `020beb2` + web `80f682b` → staging.** Post-deploy smoke, live:

- `GET /v1/catalog/home` → **Dry Cleaning `garmentCount: 3`**, every other card `0`. That flag is the *entire* trigger for the drill-in, so this is the assertion that matters.
- `GET /v1/catalog/dryclean?cardId=<dry-cleaning>` → **Shirt $5.00 · Coat $15.00 · Pant $7.00** (the founder's real prices, corporate-resolved).
- `GET /v1/catalog/dryclean?cardId=<wash-and-fold>` → **0 categories** — a card with no garments returns an empty picker, never another card's.

**No EAS build and no OTA were needed.** The founder views the app through the Expo dev client, so Metro serves the JS straight from this repo; a reload picks up the garment picker. An `eas update` is only required to refresh a standalone APK — and it is *not* a free action here: the OTA bundle bakes in `EXPO_PUBLIC_API_BASE_URL`, which has silently fallen back to localhost on this project before (fixed for builds in `f2c52b9`). Fire it deliberately, with the env set, or not at all.

## 8. Also shipped alongside — the console price box

The founder: *"can you fix the (box) before the Save — I don't even know what that is, it's too small."*

That box was the **item price field**, and the bug was not cosmetic. `Input`'s base class starts with `w-full`, `cn()` is a plain join (no `tailwind-merge`), and Tailwind emits `w-full` **after** the numeric width scale — so `<Input className="w-24" />` never got 24. It stretched to full width, then the Save / Deactivate / arrow buttons crushed it into a sliver. The `$15.00` was in the box; there was no room to render it. **Six inputs across the console** were passing widths that never applied.

Fixed in the primitive (`ui.tsx`): the control yields its default `w-full` whenever a caller states a width — all six call sites fixed, no dependency added. And `CatalogAdmin`'s field now says **"Price"**, shows the **`$`**, and is wide enough to read. Money you cannot see is money you cannot trust. web **216/216**.
