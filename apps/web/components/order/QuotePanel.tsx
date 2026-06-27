'use client';

import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { OrderStatus, QuoteStatus, RoleType, type QuoteBuildDto } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { can, hasAnyRole } from '@/lib/rbac';
import { money, shortDate } from '@/lib/format';
import type { OrderDetail } from '@/lib/types';
import { Badge, Button, Field, Input, KV } from '../ui';

const QUOTABLE: OrderStatus[] = [OrderStatus.INTAKE_INSPECTED, OrderStatus.DAMAGE_PREEXISTING_FLAGGED];

/** Quote workstation (Increment 13) — generate (server-side rate-card math), adjust (audited), send;
 *  ops approve/decline. All math is server-side; the panel only submits + renders. */
export function QuotePanel({ order, onChanged }: { order: OrderDetail; onChanged: (o: OrderDetail) => void }): React.ReactElement {
  const { client, me } = useSession();
  const quote = order.quotes[0] ?? null;
  const status = order.status;

  const [expiresInDays, setExpiresInDays] = useState('14');
  const [adjReason, setAdjReason] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<OrderDetail>, key: string): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      onChanged(await fn());
    } catch (err) {
      // 409/422 = server authority (illegal transition / expired quote) → surface it.
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  const generate = async (): Promise<void> => {
    const days = Number(expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      setError('Expiry must be 1–365 days.');
      return;
    }
    const dto: QuoteBuildDto = { upcharges: [], expiresInDays: days };
    if (adjReason.trim() && adjAmount.trim()) {
      const amt = Number(adjAmount);
      if (!Number.isFinite(amt)) {
        setError('Adjustment amount must be a number.');
        return;
      }
      dto.manualAdjustment = { reason: adjReason.trim(), amount: amt };
    }
    await act(async () => (await client.buildQuote(order.id, dto)).order, 'generate');
  };

  // ── existing quote ──
  if (quote && quote.status !== QuoteStatus.DRAFT) {
    const isSent = quote.status === QuoteStatus.SENT && status === OrderStatus.QUOTED;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-end">
          <Badge tone={quote.status === QuoteStatus.APPROVED ? 'green' : quote.status === QuoteStatus.DECLINED ? 'red' : 'amber'}>{quote.status}</Badge>
        </div>
        <div className="rounded-card bg-subtle p-3">
          <KV label="Subtotal" value={money(quote.subtotal, order.totals?.currency)} mono />
          <KV label="Tax (HST)" value={money(quote.tax, order.totals?.currency)} mono />
          <div className="mt-1 border-t border-hairline pt-1">
            <div className="flex items-center justify-between gap-4 py-1.5">
              <span className="text-subhead font-semibold text-ink">Total</span>
              <span className="font-mono text-headline font-semibold tabular-nums text-ink">{money(quote.total, order.totals?.currency)}</span>
            </div>
          </div>
        </div>
        {quote.expiresAt && <p className="text-caption text-tertiary">Valid until {shortDate(quote.expiresAt)}</p>}

        {isSent && hasAnyRole(me, [RoleType.OWNER]) && (
          <div className="flex gap-2 pt-1">
            <Button loading={busy === 'approve'} onClick={() => void act(() => client.approveQuote(order.id), 'approve')}>
              Approve (on behalf)
            </Button>
            <Button variant="danger" loading={busy === 'decline'} onClick={() => void act(() => client.declineQuote(order.id, { reason: 'declined at desk' }), 'decline')}>
              Decline
            </Button>
          </div>
        )}
        {isSent && <p className="text-caption text-tertiary">Sent to the customer to approve in their app.</p>}
        {error && <p className="text-footnote font-medium text-danger">{error}</p>}
      </div>
    );
  }

  // ── generate a quote ──
  if (QUOTABLE.includes(status) && can.intake(me)) {
    return (
      <div className="space-y-3">
        <p className="text-footnote text-secondary">Priced server-side from the rate card × measured values + HST.</p>
        <Field label="Quote valid for (days)">
          <Input type="number" min="1" max="365" value={expiresInDays} onChange={(e) => setExpiresInDays(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Manual adjustment reason (optional)">
            <Input value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="e.g. loyalty credit" />
          </Field>
          <Field label="Adjustment amount (±$)">
            <Input type="number" step="any" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="-10" />
          </Field>
        </div>
        {error && <p className="text-footnote font-medium text-danger">{error}</p>}
        <Button loading={busy === 'generate'} onClick={() => void generate()}>
          {busy !== 'generate' && <Send className="h-4 w-4" aria-hidden="true" />} Generate &amp; send quote
        </Button>
      </div>
    );
  }

  return <p className="text-subhead text-secondary">No quote yet — finish inspecting all items to enable quoting.</p>;
}
