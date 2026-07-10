'use client';

import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '../ui';

/**
 * [Inc-24] Up/down reorder control.
 *
 * Deliberately NOT drag-and-drop: a DnD library would add an npm dependency (and root package-lock churn,
 * which the pending EAS build is sensitive to) for the same outcome. Arrows are keyboard-accessible and
 * directly testable; the server renumbers `sortOrder` 0..n-1 atomically, and the customer app reads that
 * same order. A missing handler (list edge) renders the button disabled.
 */
export function MoveControls({
  onUp,
  onDown,
  label,
  testIdPrefix,
}: {
  onUp?: () => void;
  onDown?: () => void;
  label: string;
  testIdPrefix: string;
}): React.ReactElement {
  return (
    <>
      <Button size="sm" variant="ghost" disabled={!onUp} onClick={onUp} aria-label={`Move ${label} up`} data-testid={`${testIdPrefix}-up`}>
        <ArrowUp className="h-4 w-4" strokeWidth={2} />
      </Button>
      <Button size="sm" variant="ghost" disabled={!onDown} onClick={onDown} aria-label={`Move ${label} down`} data-testid={`${testIdPrefix}-down`}>
        <ArrowDown className="h-4 w-4" strokeWidth={2} />
      </Button>
    </>
  );
}
