import { CATALOG_ICON_KEYS, type CatalogIconKey } from '@blue-bee/shared';
import { Armchair, Blinds, Droplets, Feather, Grid3x3, Layers, Shirt, Sparkles, Square, Wind, type LucideIcon } from 'lucide-react';

/**
 * [Inc-24] The console's preview glyph for each canonical catalog icon key.
 *
 * `CATALOG_ICON_KEYS` (packages/shared) is the SINGLE SOURCE OF TRUTH for which keys exist — the customer
 * app maps the same keys to Feather glyphs (HomeScreen `CATEGORY_ICONS`). Because this is typed as a
 * `Record<CatalogIconKey, …>`, adding a key in shared breaks this file's typecheck until it is mapped here,
 * so the console picker and the app can never drift apart.
 *
 * The glyphs are the console's own (lucide) — only the KEY is shared, never the icon asset.
 */
export const CATALOG_ICON_GLYPHS: Record<CatalogIconKey, LucideIcon> = {
  'wash-fold': Droplets,
  'wash-iron': Sparkles,
  'dry-clean': Wind,
  iron: Feather,
  delicates: Feather,
  rug: Square,
  carpet: Grid3x3,
  sofa: Armchair,
  blinds: Blinds,
  shirts: Shirt,
  outerwear: Layers,
  formalwear: Shirt,
};

/** Human labels for the picker (the persisted value is always the key itself). */
export const CATALOG_ICON_LABELS: Record<CatalogIconKey, string> = {
  'wash-fold': 'Wash & fold',
  'wash-iron': 'Wash & iron',
  'dry-clean': 'Dry cleaning',
  iron: 'Ironing',
  delicates: 'Delicates',
  rug: 'Rug',
  carpet: 'Carpet',
  sofa: 'Upholstery / sofa',
  blinds: 'Blinds',
  shirts: 'Shirts',
  outerwear: 'Outerwear',
  formalwear: 'Formalwear',
};

export const ICON_KEYS = CATALOG_ICON_KEYS;
