'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ApiError } from '@blue-bee/api-client';
import type { InvoiceView, PaymentView, RefundView } from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, money, orderRef, shortDate } from '@/lib/format';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Loading } from './ui';
import { RequireCapability } from './AppShell';

export function OrderBilling({ orderId }: { orderId: string }): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.finance(me)}>
      <OrderBillingInner orderId={orderId} />
    </RequireCapability>
  );
}

function refundable(p: PaymentView): number {
  return Math.max(0, Number(p.capturedAmount) - Number(p.refundedAmount));
}

function OrderBillingInner({ orderId }: { orderId: string }): React.ReactElement {
  const { client } = useSession();
  const payment = useAsync(() => client.getPayment(orderId), [orderId]);
  const invoice = useAsync(() => client.getInvoice(orderId), [orderId]);

  const [refundAmount, setRefundAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const generateInvoice = async (): Promise<void> => {
    setBusy('invoice');
    setErr(null);
    setMsg(null);
    try {
      await client.generateInvoice(orderId);
      invoice.reload();
      setMsg('Invoice generated.');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not generate the invoice.');
    } finally {
      setBusy(null);
    }
  };

  const doRefund = async (p: PaymentView): Promise<void> => {
    setErr(null);
    setMsg(null);
    let amount: number | undefined;
    if (refundAmount.trim() !== '') {
      amount = Number(refundAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setErr('Refund amount must be a positive number.');
        return;
      }
      if (amount > refundable(p)) {
        setErr(`Refund exceeds the refundable balance ($${refundable(p).toFixed(2)}).`);
        return;
      }
    }
    setBusy('refund');
    try {
      const r: RefundView = await client.refundPayment(p.id, amount !== undefined ? { amount } : {});
      setMsg(`Refund of ${money(r.amount, r.currency)} initiated (${r.status}).`);
      setRefundAmount('');
      payment.reload();
    } catch (e) {
      // 422 (refund > captured) / 409 = server authority → surface it.
      setErr(e instanceof ApiError ? e.message : 'Refund failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/orders/${orderId}`} className="text-sm text-bb-sub hover:underline">
          ← Order {orderRef(orderId)}
        </Link>
        <h1 className="mt-1 text-2xl font-bold text-bb-ink">Billing · {orderRef(orderId)}</h1>
      </div>

      {(msg || err) && <div>{err ? <ErrorBox message={err} /> : <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{msg}</p>}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Payment">
          {payment.loading ? (
            <Loading />
          ) : payment.error ? (
            <ErrorBox message={payment.error} onRetry={payment.reload} />
          ) : !payment.data ? (
            <EmptyState message="No payment on this order yet." />
          ) : (
            <PaymentBody payment={payment.data} refundAmount={refundAmount} setRefundAmount={setRefundAmount} onRefund={doRefund} busy={busy === 'refund'} />
          )}
        </Card>

        <Card title="Invoice / receipt" actions={!invoice.data ? <Button onClick={() => void generateInvoice()} loading={busy === 'invoice'}>Generate</Button> : undefined}>
          {invoice.loading ? (
            <Loading />
          ) : invoice.error ? (
            <ErrorBox message={invoice.error} onRetry={invoice.reload} />
          ) : !invoice.data ? (
            <EmptyState message="No invoice yet. Generate one from the approved quote." />
          ) : (
            <InvoiceBody invoice={invoice.data} />
          )}
        </Card>
      </div>
    </div>
  );
}

function PaymentBody({ payment, refundAmount, setRefundAmount, onRefund, busy }: { payment: PaymentView; refundAmount: string; setRefundAmount: (s: string) => void; onRefund: (p: PaymentView) => void; busy: boolean }): React.ReactElement {
  const bal = refundable(payment);
  return (
    <div className="space-y-2 text-sm">
      <Row label="Status" value={<Badge tone={payment.status === 'SUCCEEDED' ? 'green' : payment.status === 'FAILED' ? 'red' : payment.status === 'REFUNDED' ? 'amber' : 'neutral'}>{payment.status}</Badge>} />
      <Row label="Amount" value={money(payment.amount, payment.currency)} />
      <Row label="Captured" value={money(payment.capturedAmount, payment.currency)} />
      <Row label="Refunded" value={money(payment.refundedAmount, payment.currency)} />
      <Row label="Refundable" value={money(bal.toFixed(2), payment.currency)} />
      {(payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') && bal > 0 && (
        <div className="mt-3 space-y-2 border-t border-bb-line pt-3">
          <Field label="Refund amount (blank = full refund)">
            <Input type="number" step="any" min="0" max={bal} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={`Up to $${bal.toFixed(2)}`} aria-label="Refund amount" />
          </Field>
          <Button variant="danger" onClick={() => onRefund(payment)} loading={busy}>
            Issue refund
          </Button>
        </div>
      )}
    </div>
  );
}

function InvoiceBody({ invoice }: { invoice: InvoiceView }): React.ReactElement {
  return (
    <div className="space-y-2 text-sm">
      <Row label="Number" value={invoice.number ?? '—'} />
      <Row label="Status" value={<Badge tone={invoice.status === 'PAID' ? 'green' : invoice.status === 'OVERDUE' ? 'red' : 'amber'}>{invoice.status}</Badge>} />
      <div className="border-y border-bb-line py-2">
        {invoice.lines.map((l, i) => (
          <div key={i} className="flex justify-between">
            <span className="text-bb-sub">{l.description}</span>
            <span className="text-bb-ink">{money(l.amount, invoice.currency)}</span>
          </div>
        ))}
      </div>
      <Row label="Subtotal" value={money(invoice.subtotal, invoice.currency)} />
      <Row label="Tax" value={money(invoice.tax, invoice.currency)} />
      <Row label="Total" value={money(invoice.total, invoice.currency)} bold />
      {invoice.paidAt && <p className="text-xs text-green-700">Paid {shortDate(invoice.paidAt)}</p>}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: React.ReactNode; bold?: boolean }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-bb-sub">{label}</span>
      <span className={bold ? 'font-bold text-bb-ink' : 'text-bb-ink'}>{value}</span>
    </div>
  );
}
