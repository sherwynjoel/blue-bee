import { useCallback } from 'react';
import { useStripe } from '@stripe/stripe-react-native';

export type SheetOutcome = 'paid' | 'canceled' | 'failed';
export interface PresentResult {
  outcome: SheetOutcome;
  error?: string;
}

/**
 * Thin wrapper over Stripe's REAL PaymentSheet (Increment 12) — the card is collected + confirmed by
 * Stripe's native sheet; only the `clientSecret` crosses from our API (PCI SAQ-A: no card data ever
 * reaches our app or server). Returns a normalized outcome so the screen + the pure pay-controller
 * stay SDK-agnostic and testable. A successful sheet means Stripe confirmed the card — the WEBHOOK,
 * not this, is the source of truth, so the caller then polls the server payment.
 */
export function usePresentPayment(): (args: { clientSecret: string; merchantName?: string; amountLabel?: string }) => Promise<PresentResult> {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  return useCallback(
    async ({ clientSecret, merchantName }) => {
      const init = await initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: merchantName ?? 'Blue Bee',
        allowsDelayedPaymentMethods: false,
      });
      if (init.error) return { outcome: 'failed', error: init.error.message };
      const present = await presentPaymentSheet();
      if (present.error) {
        const canceled = present.error.code === 'Canceled';
        return { outcome: canceled ? 'canceled' : 'failed', error: present.error.message };
      }
      return { outcome: 'paid' };
    },
    [initPaymentSheet, presentPaymentSheet],
  );
}
