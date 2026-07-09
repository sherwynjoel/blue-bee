-- Increment 20 — Service-category presentation fields for the customer Home service grid.
-- ADDITIVE ONLY: three new columns on ServiceCategory to drive the reference-style service cards
-- (icon → title → description → feature tags → "from" price). All nullable or array-defaulted, so every
-- existing category row is untouched (description NULL, features '{}', icon NULL). No DROP, no
-- NOT-NULL-without-default, no data loss — existing catalog/booking/order flows keep working.
--
--   description : the card sub-line (founder-editable via /catalog admin)
--   features    : the tag chips (e.g. {"DRY CLEAN","PRESS","ON HANGERS"})
--   icon        : a semantic key the app maps to an icon + tint (not a raw asset path)

-- AlterTable: ServiceCategory — presentation fields (all defaulted/nullable ⇒ existing rows unaffected).
ALTER TABLE "ServiceCategory" ADD COLUMN     "description" TEXT,
ADD COLUMN     "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "icon" TEXT;
