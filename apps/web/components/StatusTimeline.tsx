'use client';

import React from 'react';
import type { OrderStatus } from '@blue-bee/shared';
import { buildTimeline } from '@/lib/order-status';

/** The §5.1 lifecycle rendered FROM SERVER STATE — done/current/upcoming, never invented. */
export function StatusTimeline({ status, heldFrom }: { status: OrderStatus; heldFrom?: OrderStatus | null }): React.ReactElement {
  const steps = buildTimeline(status, heldFrom);
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-3" data-testid="status-timeline">
      {steps.map((s, i) => (
        <li key={s.status} className="flex items-center gap-2">
          <span
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              s.state === 'done' ? 'bg-green-100 text-green-800' : s.state === 'current' ? 'bg-bb-blue text-white' : 'bg-gray-100 text-gray-400'
            }`}
            aria-current={s.state === 'current' ? 'step' : undefined}
          >
            {s.state === 'done' ? '✓' : i + 1}
          </span>
          <span className={`text-xs ${s.state === 'upcoming' ? 'text-gray-400' : 'text-bb-ink'}`}>{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
