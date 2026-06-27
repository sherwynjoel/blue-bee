'use client';

import React, { useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { Info } from 'lucide-react';
import { Button, ErrorBox, Spinner } from './ui';

interface PayPanelProps {
  clientSecret: string;
  publishableKey: string | null;
  amountLabel: string;
  confirming: boolean;
  /** Called after a successful card confirm — the parent polls the invoice until the webhook flips PAID. */
  onConfirmed: () => Promise<void> | void;
  /** Re-fetch the invoice (used by the no-Stripe-config fallback to catch a webhook-confirmed payment). */
  onRefresh: () => void;
  onCancel: () => void;
}

/** True only for a REAL Stripe client secret (the local no-network provider can't drive Stripe Elements). */
function isRealStripeSecret(cs: string): boolean {
  return cs.includes('_secret_') && !cs.startsWith('pi_local');
}

function isDark(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/**
 * The B2B portal pay surface — Stripe's PaymentElement driven by the invoice's PaymentIntent
 * `clientSecret` (the card NEVER touches our API; only the client secret crosses). On confirm we DO
 * NOT trust the client result — the parent polls the invoice until the SIGNED webhook flips it PAID
 * (REST is truth, like the residential flow). When no real Stripe test-mode key is configured (the
 * local no-network provider / the founder's credentialed run is parked), we render an honest note
 * instead of faking a charge — the PaymentIntent is real and the webhook still confirms PAID.
 */
export default function PortalPayPanel({
  clientSecret,
  publishableKey,
  amountLabel,
  confirming,
  onConfirmed,
  onRefresh,
  onCancel,
}: PayPanelProps): React.ReactElement {
  const stripePromise = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [publishableKey]);

  if (!publishableKey || !stripePromise || !isRealStripeSecret(clientSecret)) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3 rounded-card border border-hairline bg-subtle p-4 text-footnote text-secondary">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <div className="space-y-1.5">
            <p className="font-semibold text-ink">Secure card entry</p>
            <p>
              A PaymentIntent for <span className="font-mono tabular-nums text-ink">{amountLabel}</span> has been created. Card entry uses
              Stripe’s PaymentElement and requires a Stripe test-mode key (configured in the live test environment). The invoice is marked
              paid only when Stripe’s signature-verified webhook confirms the charge.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Close
          </Button>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            Refresh status
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance: { theme: isDark() ? 'night' : 'stripe' } }}>
      <PayForm amountLabel={amountLabel} confirming={confirming} onConfirmed={onConfirmed} onCancel={onCancel} />
    </Elements>
  );
}

function PayForm({
  amountLabel,
  confirming,
  onConfirmed,
  onCancel,
}: {
  amountLabel: string;
  confirming: boolean;
  onConfirmed: () => Promise<void> | void;
  onCancel: () => void;
}): React.ReactElement {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!stripe || !elements) return;
    setBusy(true);
    setErr(null);
    // Confirm the card with Stripe directly; we don't redirect, and we never trust this result to
    // settle the invoice — the webhook does. confirmPayment validates the PaymentElement first.
    const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (error) {
      setErr(error.message ?? 'Payment could not be completed. Please check your card details.');
      setBusy(false);
      return;
    }
    await onConfirmed();
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <PaymentElement />
      {err && <ErrorBox message={err} />}
      {confirming && (
        <p className="flex items-center gap-2 text-footnote text-secondary">
          <Spinner small /> Confirming your payment…
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy || confirming}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void submit()} loading={busy || confirming} disabled={!stripe}>
          Pay {amountLabel}
        </Button>
      </div>
    </div>
  );
}
