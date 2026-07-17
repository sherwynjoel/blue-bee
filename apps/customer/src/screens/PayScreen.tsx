import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PaymentStatus, QuoteStatus, type InvoiceView, type PaymentView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { OrderDetail } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { usePresentPayment } from '../pay/use-payment-sheet';
import { isPayable, payAmount, pollPaymentConfirmed } from '../pay/payment-controller';
import { money, orderRef, shortDate, shortTime } from '../format';
import { useTheme } from '../../theme';
import { BeeMark, Button, Card, Divider, IconBadge, KeyValue, SkeletonCard, Stepper, Text, fireHaptic } from '../../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'Pay'>;
type Phase = 'loading' | 'idle' | 'starting' | 'presenting' | 'confirming' | 'paid' | 'processing' | 'failed' | 'notpayable';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A real, human label for the order's service line — never a guess at pricing, just the known category. */
const VERTICAL_LABEL: Record<string, string> = {
  SPECIALTY: 'Specialty cleaning',
  LINEN: 'Linen service',
  WASHFOLD: 'Wash & fold',
};

/** Mirrors payAmount()'s precedence (the approved quote's own figures, else the order's totals) so the
 *  subtotal/tax breakdown always agrees with the total already shown for `amount`. Never invented. */
function payBreakdown(order: OrderDetail): { subtotal: string | null; tax: string | null } {
  const approved = order.quotes.find((q) => q.status === QuoteStatus.APPROVED);
  if (approved) return { subtotal: approved.subtotal, tax: approved.tax };
  return { subtotal: order.totals?.subtotal ?? null, tax: order.totals?.tax ?? null };
}

/**
 * Pay surface (PRD §7A A5.1, Increment 12) — Stripe PaymentSheet for the approved order. The card
 * never touches our app/API; only the client secret crosses. The WEBHOOK confirms the payment, so
 * after the sheet succeeds we POLL the server until it's SUCCEEDED (then show the receipt) — never
 * "paid" on the client's say-so. Retry on failure; "processing" if the webhook hasn't landed yet.
 *
 * [Royal restyle] Schedule · Payment · Review stepper, an honest order-summary card (service + pickup
 * window from the loaded order, price breakdown from the same approved-quote/totals precedence as the
 * amount actually charged), a "Secure & encrypted" trust card, and a fixed-bottom Pay CTA. The Stripe
 * flow, every client.* call, and all four states below are unchanged — this is presentation only.
 */
export function PayScreen({ navigation, route }: Props): React.ReactElement {
  const { orderId } = route.params;
  const { client } = useSession();
  const { colors, space, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  const present = usePresentPayment();
  const [phase, setPhase] = useState<Phase>('loading');
  const [amount, setAmount] = useState<string | null>(null);
  // [Inc-37] What the customer's credit covered, and the bill before it — so the screen can show the maths.
  const [creditApplied, setCreditApplied] = useState<string | null>(null);
  const [orderTotal, setOrderTotal] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>('CAD');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<InvoiceView | null>(null);
  const [payment, setPayment] = useState<PaymentView | null>(null);
  // [Royal restyle] The loaded order itself, purely so the summary card can show the real service +
  // pickup window + price breakdown. Nothing new is fetched — this just keeps what `load()` already reads.
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const order: OrderDetail = await client.getOrder(orderId);
      setOrderDetail(order);
      const existing = await client.getPayment(orderId);
      setAmount(payAmount(order));
      setCurrency(order.totals?.currency ?? 'CAD');
      if (existing?.status === PaymentStatus.SUCCEEDED || order.totals?.paymentStatus === 'PAID') {
        setPayment(existing);
        setReceipt(await client.getInvoice(orderId));
        setPhase('paid');
      } else if (!isPayable(order)) {
        setPhase('notpayable');
      } else {
        setPhase('idle');
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this order.');
      setPhase('failed');
    }
  }, [client, orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pay = useCallback(async (): Promise<void> => {
    setError(null);
    setPhase('starting');
    try {
      const intent = await client.createPaymentIntent(orderId);
      setAmount(intent.amount);
      setCurrency(intent.currency);
      setCreditApplied(intent.creditApplied);
      setOrderTotal(intent.orderTotal);

      /**
       * [Inc-37] The customer's CREDIT covered the whole bill — the server already settled the order (there is
       * no charge to make, so there is no Stripe intent and no client secret). Opening PaymentSheet here would
       * be a $0 charge and would fail. Skip straight to the confirmed state and show the receipt.
       */
      if (intent.clientSecret == null) {
        setPhase('confirming');
        setPayment(await client.getPayment(orderId));
        setReceipt(await client.getInvoice(orderId));
        fireHaptic('success');
        setPhase('paid');
        return;
      }

      setPhase('presenting');
      const result = await present({ clientSecret: intent.clientSecret, amountLabel: intent.amount });
      if (result.outcome === 'canceled') {
        setPhase('idle');
        return;
      }
      if (result.outcome === 'failed') {
        setError(result.error ?? 'Your payment could not be completed.');
        setPhase('failed');
        return;
      }
      // The SDK confirmed the card — now wait for the WEBHOOK (source of truth) to mark it paid.
      setPhase('confirming');
      const confirmed = await pollPaymentConfirmed(() => client.getPayment(orderId), delay);
      if (confirmed?.status === PaymentStatus.SUCCEEDED) {
        setPayment(confirmed);
        setReceipt(await client.getInvoice(orderId));
        fireHaptic('success');
        setPhase('paid');
      } else if (confirmed?.status === PaymentStatus.FAILED) {
        setError('Your payment could not be completed. Please try again.');
        setPhase('failed');
      } else {
        setPhase('processing'); // confirmed by Stripe, webhook not in yet
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start payment.');
      setPhase('failed');
    }
  }, [client, orderId, present]);

  const header = (
    <View style={{ paddingHorizontal: 20, paddingTop: insets.top + 16 }}>
      <Stepper testID="pay-stepper" steps={['Schedule', 'Payment', 'Review']} current={1} />
    </View>
  );

  if (phase === 'loading')
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="pay-loading">
        {header}
        <View style={{ padding: 20, gap: 14 }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );

  const busy = phase === 'starting' || phase === 'presenting' || phase === 'confirming';
  const showPayBar = phase !== 'paid' && phase !== 'processing' && phase !== 'notpayable';
  const serviceLabel = orderDetail ? (VERTICAL_LABEL[orderDetail.vertical] ?? orderDetail.vertical) : null;
  const pickup = orderDetail?.scheduledPickupWindow ?? null;
  const breakdown = orderDetail ? payBreakdown(orderDetail) : { subtotal: null, tax: null };
  const hasBreakdownLines = !!(breakdown.subtotal || breakdown.tax);

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView
        style={{ backgroundColor: colors.canvas }}
        contentContainerStyle={{ paddingBottom: showPayBar ? 160 : space.huge }}
        showsVerticalScrollIndicator={false}
      >
        {header}

        {phase === 'paid' ? (
          <View testID="receipt" style={styles.section}>
            <View style={styles.celebrate}>
              <View style={[styles.tick, { backgroundColor: colors.success }, elevation.e2]}>
                <Feather name="check" size={34} color="#FFFFFF" />
              </View>
              <Text variant="title2" weight="700" center style={{ marginTop: 16 }}>
                Payment complete
              </Text>
              <Text variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
                Thanks — a receipt for {orderRef(orderId)} is below.
              </Text>
            </View>

            <Card title="Receipt" style={{ marginTop: space.xl }}>
              {receipt?.lines.map((l, i) => (
                <KeyValue key={i} label={l.description} value={money(l.amount, currency)} />
              ))}
              {/* [Inc-37] Show the maths when credit was used: what the order cost, what the credit covered, and
                  what the card actually paid. Only rendered when credit was genuinely applied. */}
              {creditApplied && creditApplied !== '0.00' ? (
                <>
                  <Divider spacing={8} />
                  {orderTotal ? <KeyValue label="Order total" value={money(orderTotal, currency)} /> : null}
                  <KeyValue testID="pay-credit-applied" label="Credit applied" value={`− ${money(creditApplied, currency)}`} />
                  <KeyValue
                    testID="pay-card-charged"
                    label={amount === '0.00' ? 'Charged to card' : 'Paid by card'}
                    value={money(amount ?? '0', currency)}
                  />
                </>
              ) : null}
              <Divider spacing={8} />
              <KeyValue label="Total paid" value={money(receipt?.total ?? payment?.amount ?? amount ?? '0', currency)} total />
            </Card>

            <Button testID="done-button" label="Done" variant="outline" tone="neutral" icon="check" onPress={() => navigation.goBack()} style={{ marginTop: space.lg }} />
          </View>
        ) : phase === 'processing' ? (
          <View style={styles.section}>
            <Card style={styles.statusCard}>
              <IconBadge icon="clock" tone="warning" size={48} circle />
              <ActivityIndicator color={colors.warning} style={{ marginTop: 14 }} />
              <Text testID="pay-status" variant="subhead" color="warning" center style={{ marginTop: 12 }}>
                Payment received — we’re confirming it now. You’ll get a receipt shortly.
              </Text>
              <Button testID="refresh-button" label="Refresh" variant="outline" icon="refresh-cw" onPress={() => void load()} style={{ marginTop: 16 }} />
            </Card>
          </View>
        ) : phase === 'notpayable' ? (
          <View style={styles.section}>
            <Card style={styles.statusCard}>
              <IconBadge icon="clock" tone="neutral" size={48} circle />
              <Text testID="pay-status" variant="subhead" color="secondary" center style={{ marginTop: 14 }}>
                This order isn’t ready for payment yet.
              </Text>
            </Card>
          </View>
        ) : (
          <View style={styles.section}>
            {/* ─── Order summary — the real loaded order: service, pickup window (if any), then the
                same subtotal/tax/total precedence that produces `amount` below. ─── */}
            <Card title="Order summary" style={{ marginTop: space.lg }}>
              <View style={styles.summaryRow}>
                <IconBadge icon="shopping-bag" tone="azure" size={36} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="subhead" weight="600">
                    {serviceLabel ?? 'Your order'}
                  </Text>
                  <Text variant="caption" color="tertiary" mono style={{ marginTop: 1 }}>
                    {orderRef(orderId)}
                  </Text>
                </View>
              </View>

              {pickup ? (
                <View style={[styles.summaryRow, { marginTop: 14 }]}>
                  <IconBadge icon="calendar" tone="honey" size={36} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text variant="caption" color="tertiary">
                      PICKUP WINDOW
                    </Text>
                    <Text variant="subhead" weight="600" style={{ marginTop: 1 }}>
                      {shortDate(pickup.start)} · {shortTime(pickup.start)} – {shortTime(pickup.end)}
                    </Text>
                  </View>
                </View>
              ) : null}

              {breakdown.subtotal || breakdown.tax || amount ? <Divider spacing={14} /> : null}
              {breakdown.subtotal ? <KeyValue label="Subtotal" value={money(breakdown.subtotal, currency)} /> : null}
              {breakdown.tax ? <KeyValue label="Taxes & fees" value={money(breakdown.tax, currency)} /> : null}
              {amount ? (
                <>
                  {hasBreakdownLines ? <Divider spacing={10} /> : null}
                  <KeyValue testID="pay-amount" label="Total due" value={money(amount, currency)} total />
                </>
              ) : null}
            </Card>

            {/* ─── Trust banner ─── */}
            <Card style={[styles.trustCard, { marginTop: space.lg }]}>
              <IconBadge icon="shield" tone="success" size={44} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text variant="subhead" weight="700">
                  Secure & encrypted
                </Text>
                <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
                  Pay with card, Apple Pay, or Google Pay. Your card details are encrypted and never touch our servers.
                </Text>
              </View>
            </Card>

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: colors.dangerTint, marginTop: space.lg }]}>
                <Feather name="alert-circle" size={16} color={colors.danger} />
                <Text testID="pay-error" variant="footnote" color="danger" style={{ marginLeft: 8, flex: 1 }}>
                  {error}
                </Text>
              </View>
            ) : null}

            <View style={styles.trustRow}>
              <BeeMark size={22} />
              <Text variant="caption" color="tertiary" style={{ marginLeft: 8 }}>
                Secured by Stripe · Royal Dry Cleaning & Laundry
              </Text>
            </View>
          </View>
        )}
      </ScrollView>

      {showPayBar ? (
        <View
          style={[
            styles.bar,
            { backgroundColor: colors.surface, borderTopColor: colors.hairline, paddingBottom: Math.max(insets.bottom, space.lg) },
            elevation.sheet,
          ]}
        >
          <Button
            testID="pay-button"
            label={phase === 'failed' ? 'Try again' : `Pay ${amount ? money(amount, currency) : ''}`}
            icon={phase === 'failed' ? 'refresh-cw' : 'lock'}
            tone="azure"
            onPress={() => void pay()}
            busy={busy}
            disabled={busy}
          />
          {phase === 'confirming' ? (
            <Text testID="pay-status" variant="footnote" color="secondary" center style={{ marginTop: 10 }}>
              Confirming your payment…
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  section: { paddingHorizontal: 20 },
  celebrate: { alignItems: 'center', paddingTop: 24 },
  tick: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  statusCard: { alignItems: 'center', paddingVertical: 28, marginTop: 16 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  trustCard: { flexDirection: 'row', alignItems: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12 },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
});
