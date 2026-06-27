'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, CreditCard, Receipt } from 'lucide-react';
import { ApiError } from '@blue-bee/api-client';
import type { InvoiceView, PaymentView, RefundView } from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { money, orderRef, shortDate } from '@/lib/format';
import { Button, Card, EmptyState, ErrorBox, Field, Input, KV, SkeletonText, StatusPill } from './ui';
import type { Tone } from './ui';
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

function paymentTone(status: string): Tone {
  return status === 'SUCCEEDED' ? 'green' : status === 'FAILED' ? 'red' : status === 'REFUNDED' ? 'amber' : 'neutral';
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
    <div className="space-y-6 animate-fade-up">
      <div className="space-y-2">
        <Link
          href={`/orders/${orderId}`}
          className="inline-flex items-center gap-1 rounded text-footnote text-secondary underline-offset-2 transition-colors duration-fast hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} /> Order {orderRef(orderId)}
        </Link>
        <h1 className="text-title1 text-ink">
          Billing · <span className="font-mono tabular-nums">{orderRef(orderId)}</span>
        </h1>
      </div>

      {(msg || err) && (
        <div>
          {err ? (
            <ErrorBox message={err} />
          ) : (
            <p className="flex items-center gap-2 rounded-card border border-hairline bg-success-tint p-3 text-footnote font-medium text-success-strong" role="status">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" strokeWidth={2} />
              {msg}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card
          title={
            <span className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-tertiary" aria-hidden="true" strokeWidth={2} /> Payment
            </span>
          }
        >
          {payment.loading ? (
            <SkeletonText lines={5} />
          ) : payment.error ? (
            <ErrorBox message={payment.error} onRetry={payment.reload} />
          ) : !payment.data ? (
            <EmptyState icon={<CreditCard className="h-5 w-5" strokeWidth={1.75} />} title="No payment yet" message="No payment on this order yet." />
          ) : (
            <PaymentBody payment={payment.data} refundAmount={refundAmount} setRefundAmount={setRefundAmount} onRefund={doRefund} busy={busy === 'refund'} />
          )}
        </Card>

        <Card
          title={
            <span className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-tertiary" aria-hidden="true" strokeWidth={2} /> Invoice / receipt
            </span>
          }
          actions={!invoice.data ? <Button onClick={() => void generateInvoice()} loading={busy === 'invoice'}>Generate</Button> : undefined}
        >
          {invoice.loading ? (
            <SkeletonText lines={5} />
          ) : invoice.error ? (
            <ErrorBox message={invoice.error} onRetry={invoice.reload} />
          ) : !invoice.data ? (
            <EmptyState icon={<Receipt className="h-5 w-5" strokeWidth={1.75} />} title="No invoice yet" message="No invoice yet. Generate one from the approved quote." />
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
    <div className="space-y-1">
      <KV label="Status" value={<StatusPill tone={paymentTone(payment.status)}>{payment.status}</StatusPill>} />
      <KV label="Amount" value={money(payment.amount, payment.currency)} mono />
      <KV label="Captured" value={money(payment.capturedAmount, payment.currency)} mono />
      <KV label="Refunded" value={money(payment.refundedAmount, payment.currency)} mono />
      <KV label="Refundable" value={money(bal.toFixed(2), payment.currency)} mono />
      {(payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') && bal > 0 && (
        <div className="mt-3 space-y-3 border-t border-hairline pt-4">
          <Field label="Refund amount (blank = full refund)">
            <Input type="number" step="any" min="0" max={bal} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder={`Up to $${bal.toFixed(2)}`} aria-label="Refund amount" className="font-mono tabular-nums" />
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
    <div className="space-y-1">
      <KV label="Number" value={<span className="font-mono tabular-nums">{invoice.number ?? '—'}</span>} />
      <KV label="Status" value={<StatusPill tone={invoice.status === 'PAID' ? 'green' : invoice.status === 'OVERDUE' ? 'red' : 'amber'}>{invoice.status}</StatusPill>} />
      <div className="my-2 space-y-1.5 border-y border-hairline py-3">
        {invoice.lines.map((l, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <span className="text-footnote text-secondary">{l.description}</span>
            <span className="font-mono tabular-nums text-subhead text-ink">{money(l.amount, invoice.currency)}</span>
          </div>
        ))}
      </div>
      <KV label="Subtotal" value={money(invoice.subtotal, invoice.currency)} mono />
      <KV label="Tax" value={money(invoice.tax, invoice.currency)} mono />
      <div className="flex items-center justify-between gap-4 border-t border-hairline pt-2">
        <span className="text-subhead font-semibold text-ink">Total</span>
        <span className="font-mono tabular-nums text-headline text-ink">{money(invoice.total, invoice.currency)}</span>
      </div>
      {invoice.paidAt && (
        <p className="flex items-center gap-1.5 pt-1 text-caption font-medium text-success-strong">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={2} /> Paid {shortDate(invoice.paidAt)}
        </p>
      )}
    </div>
  );
}
