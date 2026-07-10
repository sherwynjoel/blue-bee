'use client';

import React from 'react';
import { isCatalogIconKey } from '@blue-bee/shared';
import { CATALOG_ICON_GLYPHS, CATALOG_ICON_LABELS, ICON_KEYS } from '@/lib/catalog-icons';
import { Field, Select } from '../ui';

/** The picker's empty option — persists as `null` (no icon; the app falls back to its default glyph). */
const NONE = '';

/**
 * [Inc-24] Icon picker — replaces the old free-text "Icon key" input. The options are the canonical keys the
 * customer app actually supports (`CATALOG_ICON_KEYS` in packages/shared), so the console can no longer save
 * a key the app cannot render. Persistence is unchanged: the value is still the plain icon-key string.
 *
 * A legacy row may already hold an unknown key. Rather than silently wiping it, it is surfaced as an
 * "(unsupported)" option so the founder sees it and can pick a real one — nothing changes behind their back.
 */
export function IconPicker({
  value,
  onChange,
  label = 'Icon',
  ariaLabel,
  testId,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  ariaLabel: string;
  testId?: string;
  className?: string;
}): React.ReactElement {
  const current = value.trim();
  const known = current === NONE || isCatalogIconKey(current);
  const Glyph = isCatalogIconKey(current) ? CATALOG_ICON_GLYPHS[current] : null;

  return (
    <Field label={label} helper="Only icons the customer app can render." className={className}>
      <div className="flex items-center gap-2">
        <Select value={current} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel} data-testid={testId} className="min-w-0 flex-1">
          <option value={NONE}>— None —</option>
          {ICON_KEYS.map((k) => (
            <option key={k} value={k}>
              {CATALOG_ICON_LABELS[k]} ({k})
            </option>
          ))}
          {/* Keep an unknown legacy value selectable so saving the form can't silently drop it. */}
          {!known && <option value={current}>{current} (unsupported)</option>}
        </Select>
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn border border-hairline bg-subtle text-secondary"
          data-testid={testId ? `${testId}-preview` : undefined}
          title={known && current !== NONE ? current : 'No icon'}
        >
          {Glyph ? <Glyph className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" /> : <span className="text-footnote text-tertiary">—</span>}
        </span>
      </div>
    </Field>
  );
}
