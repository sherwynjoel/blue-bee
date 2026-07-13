'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ArrowLeft, CheckCircle2, Download } from 'lucide-react';
import { ApiError } from '@blue-bee/api-client';
import type { PaymentIntentResponse } from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { money, shortDate } from '@/lib/format';
import { Button, Card, EmptyState, ErrorBox, KV, Modal, Skeleton, SkeletonText, StatusPill, Table, Td, Th, useToast } from './ui';
import { invoiceTone } from './PortalInvoices';

/** The Stripe pay panel touches `window` (Stripe.js) — load it browser-only (no SSR), like FleetMap. */
const PortalPayPanel = dynamic(() => import('./PortalPayPanel'), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full rounded-card border border-hairline" />,
});

/** Browser-only file download from an in-memory blob (SSR-safe; no-op without a DOM). */
function triggerDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The account customer's invoice detail — lines, the cost-centre split, Download PDF, and Pay. */
export function PortalInvoiceDetail({ invoiceId }: { invoiceId: string }): React.ReactElement {
  const { client } = useSession();
  const toast = useToast();
  const invoice = useAsync(() => client.getInvoiceById(invoiceId), [invoiceId]);

  const [downloading, setDownloading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);
  const [confirming, setConfirming] = useState(false);

  const inv = invoice.data;
  const payable = inv != null && (inv.status === 'ISSUED' || inv.status === 'OVERDUE');

  const onDownload = async (): Promise<void> => {
    setDownloading(true);
    try {
      const { blob, filename } = await client.downloadInvoiceStatement(invoiceId);
      triggerDownload(blob, filename);
    } catch (e) {
      toast({ tone: 'error', title: 'Download failed', description: e instanceof ApiError ? e.message : 'Could not download the statement.' });
    } finally {
      setDownloading(false);
    }
  };

  const onPay = async (): Promise<void> => {
    setStarting(true);
    setPayErr(null);
    try {
      // Amount is computed server-side (the invoice total incl. HST); the body carries no money. A stable
      // idempotency key makes a double-click / retry replay the same intent (the server also serializes).
      const resp = await client.payInvoice(invoiceId, {}, `inv-pay-${invoiceId}`);
      setIntent(resp);
    } catch (e) {
      setPayErr(e instanceof ApiError ? e.message : 'Could not start payment.');
    } finally {
      setStarting(false);
    }
  };

  /** REST is truth: after a card confirm, poll the invoice until the SIGNED webhook flips it PAID. */
  const pollUntilPaid = async (): Promise<boolean> => {
    setConfirming(true);
    try {
      for (let i = 0; i < 40; i++) {
        const v = await client.getInvoiceById(invoiceId);
        if (v.status === 'PAID') {
          invoice.reload();
          return true;
        }
        await sleep(1500);
      }
      return false;
    } finally {
      setConfirming(false);
    }
  };

  const onConfirmed = async (): Promise<void> => {
    const paid = await pollUntilPaid();
    setIntent(null);
    if (paid) toast({ tone: 'success', title: 'Payment received', description: 'Your invoice is now marked paid.' });
    else toast({ tone: 'info', title: 'Payment submitted', description: 'We’ll mark the invoice paid once the bank confirms.' });
  };

  const closePay = (): void => {
    setIntent(null);
    invoice.reload();
  };

  return (
    <div className="space-y-5 animate-fade-up">
      <Link
        href="/portal"
        className="inline-flex items-center gap-1.5 rounded text-footnote font-medium text-secondary hover:text-ink focus-visible:outline-none focus-visible:shadow-focus"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All invoices
      </Link>

      {inv?.status === 'PAID' && (
        <div role="status" className="flex items-center gap-3 rounded-card border border-success bg-success-tint p-4 text-footnote text-success-strong">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <span>
            Paid{inv.paidAt ? ` on ${shortDate(inv.paidAt)}` : ''} — this invoice is your receipt; download the PDF for your records.
          </span>
        </div>
      )}

      {/* ── Header ── */}
      <Card
        title={inv ? (inv.number ?? `Invoice #${inv.id.slice(0, 8)}`) : 'Invoice'}
        actions={
          inv ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void onDownload()} loading={downloading}>
                <Download className="h-4 w-4" aria-hidden="true" /> Download PDF
              </Button>
              {payable && (
                <Button size="sm" onClick={() => void onPay()} loading={starting}>
                  Pay {money(inv.total, inv.currency)}
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {invoice.loading ? (
          <SkeletonText lines={4} />
        ) : invoice.error ? (
          <ErrorBox message={invoice.error} onRetry={invoice.reload} />
        ) : !inv ? (
          <EmptyState title="Not found" message="This invoice doesn’t exist or isn’t on your account." />
        ) : (
          <div className="space-y-1">
            <KV label="Status" value={<StatusPill tone={invoiceTone(inv.status)}>{inv.status}</StatusPill>} />
            <KV label="Issued" value={shortDate(inv.issuedAt)} />
            <KV label="Due" value={shortDate(inv.dueAt)} />
            {inv.paidAt && <KV label="Paid" value={shortDate(inv.paidAt)} />}
            {payErr && (
              <div className="pt-3">
                <ErrorBox message={payErr} />
              </div>
            )}
          </div>
        )}
      </Card>

      {/* ── Line items + totals ── */}
      {inv && (
        <Card title="Line items">
          <div className="space-y-1.5">
            {inv.lines.length === 0 ? (
              <p className="text-footnote text-secondary">No line items.</p>
            ) : (
              inv.lines.map((l, i) => (
                <div key={i} className="flex items-baseline justify-between gap-4">
                  <span className="text-footnote text-secondary">
                    {l.description}
                    {l.quantity > 1 ? ` ×${l.quantity}` : ''}
                  </span>
                  <span className="font-mono text-subhead tabular-nums text-ink">{money(l.amount, inv.currency)}</span>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 border-t border-hairline pt-3">
            <KV label="Subtotal" value={money(inv.subtotal, inv.currency)} mono />
            <KV label="HST (13%)" value={money(inv.tax, inv.currency)} mono />
            <div className="mt-1 flex items-center justify-between gap-4 border-t border-hairline pt-2">
              <span className="text-subhead font-semibold text-ink">Total</span>
              <span className="font-mono text-headline tabular-nums text-ink">{money(inv.total, inv.currency)}</span>
            </div>
          </div>
        </Card>
      )}

      {/* ── Cost-centre split (only when the invoice carries one) ── */}
      {inv && inv.costCenterBreakdown.length > 0 && (
        <Card title="Cost-centre split" subtitle="Charges grouped by building cost centre — reconciles to the invoice total.">
          <Table>
            <thead>
              <tr>
                <Th>Cost centre</Th>
                <Th numeric>Subtotal</Th>
                <Th numeric>HST</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {inv.costCenterBreakdown.map((b) => (
                <tr key={`${b.costCenterId ?? 'unassigned'}-${b.code}`} data-testid={`cc-${b.code}`}>
                  <Td>
                    <span className="font-semibold text-ink">{b.code}</span>
                    <span className="ml-2 text-caption text-secondary">{b.name}</span>
                  </Td>
                  <Td numeric>{money(b.subtotal, inv.currency)}</Td>
                  <Td numeric>{money(b.tax, inv.currency)}</Td>
                  <Td numeric>{money(b.total, inv.currency)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-hairline">
                <Td className="font-semibold text-ink">Total</Td>
                <Td numeric className="font-semibold">{money(inv.subtotal, inv.currency)}</Td>
                <Td numeric className="font-semibold">{money(inv.tax, inv.currency)}</Td>
                <Td numeric className="font-semibold">{money(inv.total, inv.currency)}</Td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}

      {/* ── Pay surface (Stripe PaymentElement, browser-only) ── */}
      {/* [Inc-37] `clientSecret` is nullable now (a CUSTOMER order can be fully covered by credit). A B2B
          invoice never is, but gate on it rather than assert — no secret, no pay panel. */}
      {inv && intent?.clientSecret && (
        <Modal title={`Pay ${money(inv.total, inv.currency)}`} onClose={closePay}>
          <PortalPayPanel
            clientSecret={intent.clientSecret}
            publishableKey={intent.publishableKey}
            amountLabel={money(inv.total, inv.currency)}
            confirming={confirming}
            onConfirmed={onConfirmed}
            onRefresh={() => invoice.reload()}
            onCancel={closePay}
          />
        </Modal>
      )}
    </div>
  );
}
