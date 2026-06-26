'use client';

import React, { useState } from 'react';
import { OrderStatus, QuoteStatus, RoleType, type QuoteBuildDto } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '@/lib/session';
import { can, hasAnyRole } from '@/lib/rbac';
import { money, shortDate } from '@/lib/format';
import type { OrderDetail } from '@/lib/types';
import { Badge, Button, Field, Input } from '../ui';

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
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-bb-ink">Quote</h3>
          <Badge tone={quote.status === QuoteStatus.APPROVED ? 'green' : quote.status === QuoteStatus.DECLINED ? 'red' : 'amber'}>{quote.status}</Badge>
        </div>
        <Row label="Subtotal" value={money(quote.subtotal, order.totals?.currency)} />
        <Row label="Tax (HST)" value={money(quote.tax, order.totals?.currency)} />
        <Row label="Total" value={money(quote.total, order.totals?.currency)} bold />
        {quote.expiresAt && <p className="text-xs text-bb-sub">Valid until {shortDate(quote.expiresAt)}</p>}

        {isSent && hasAnyRole(me, [RoleType.OWNER]) && (
          <div className="flex gap-2 pt-2">
            <Button loading={busy === 'approve'} onClick={() => void act(() => client.approveQuote(order.id), 'approve')}>
              Approve (on behalf)
            </Button>
            <Button variant="danger" loading={busy === 'decline'} onClick={() => void act(() => client.declineQuote(order.id, { reason: 'declined at desk' }), 'decline')}>
              Decline
            </Button>
          </div>
        )}
        {isSent && <p className="text-xs text-bb-sub">Sent to the customer to approve in their app.</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  // ── generate a quote ──
  if (QUOTABLE.includes(status) && can.intake(me)) {
    return (
      <div className="space-y-3">
        <h3 className="font-semibold text-bb-ink">Generate quote</h3>
        <p className="text-xs text-bb-sub">Priced server-side from the rate card × measured values + HST.</p>
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
        {error && <p className="text-sm text-red-700">{error}</p>}
        <Button loading={busy === 'generate'} onClick={() => void generate()}>
          Generate &amp; send quote
        </Button>
      </div>
    );
  }

  return <p className="text-sm text-bb-sub">No quote yet — finish inspecting all items to enable quoting.</p>;
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }): React.ReactElement {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-bb-sub">{label}</span>
      <span className={bold ? 'font-bold text-bb-ink' : 'text-bb-ink'}>{value}</span>
    </div>
  );
}
