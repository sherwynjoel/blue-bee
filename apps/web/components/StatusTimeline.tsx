'use client';

import React from 'react';
import { Check } from 'lucide-react';
import type { OrderStatus } from '@blue-bee/shared';
import { buildTimeline } from '@/lib/order-status';
import { cn } from './ui';

/**
 * The §5.1 lifecycle rendered FROM SERVER STATE — done / current / upcoming, never
 * invented. The signature Daylight vertical stepper: a continuous rail with filled
 * "done" nodes, a pulsing "current" node, and quiet "upcoming" nodes.
 */
export function StatusTimeline({ status, heldFrom }: { status: OrderStatus; heldFrom?: OrderStatus | null }): React.ReactElement {
  const steps = buildTimeline(status, heldFrom);
  return (
    <ol className="relative" data-testid="status-timeline">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const done = s.state === 'done';
        const current = s.state === 'current';
        return (
          <li key={s.status} className="relative flex gap-3 pb-4 last:pb-0">
            {/* connector rail (skip after the last node) */}
            {!last && (
              <span
                aria-hidden="true"
                className={cn('absolute left-[11px] top-6 h-[calc(100%-1.0rem)] w-0.5 rounded-full', done ? 'bg-primary' : 'bg-hairline')}
              />
            )}
            {/* node */}
            <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center">
              {current && <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[color:var(--ring)] animate-pulse-ring" />}
              <span
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border-2 transition',
                  done && 'border-primary bg-primary text-primary-fg',
                  current && 'border-primary bg-surface text-primary shadow-focus',
                  s.state === 'upcoming' && 'border-hairline bg-surface text-tertiary',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" /> : <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />}
              </span>
            </span>
            <span
              className={cn(
                'pt-0.5 text-footnote',
                current ? 'font-semibold text-ink' : done ? 'text-secondary' : 'text-tertiary',
              )}
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
