import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PaymentStatus, type InvoiceView, type PaymentView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { OrderDetail } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { usePresentPayment } from '../pay/use-payment-sheet';
import { isPayable, payAmount, pollPaymentConfirmed } from '../pay/payment-controller';
import { money, orderRef } from '../format';
import { useTheme } from '../../theme';
import { BeeMark, Button, Card, Divider, KeyValue, Text, fireHaptic } from '../../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'Pay'>;
type Phase = 'loading' | 'idle' | 'starting' | 'presenting' | 'confirming' | 'paid' | 'processing' | 'failed' | 'notpayable';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Pay surface (PRD §7A A5.1, Increment 12) — Stripe PaymentSheet for the approved order. The card
 * never touches our app/API; only the client secret crosses. The WEBHOOK confirms the payment, so
 * after the sheet succeeds we POLL the server until it's SUCCEEDED (then show the receipt) — never
 * "paid" on the client's say-so. Retry on failure; "processing" if the webhook hasn't landed yet.
 */
export function PayScreen({ navigation, route }: Props): React.ReactElement {
  const { orderId } = route.params;
  const { client } = useSession();
  const { colors, space } = useTheme();
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

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const order: OrderDetail = await client.getOrder(orderId);
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

  if (phase === 'loading')
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator testID="pay-loading" size="large" color={colors.azure} />
      </View>
    );

  const busy = phase === 'starting' || phase === 'presenting' || phase === 'confirming';

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      {phase === 'paid' ? (
        <View testID="receipt">
          <View style={styles.celebrate}>
            <View style={[styles.tick, { backgroundColor: colors.onSuccessTint }]}>
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
        <Card style={styles.statusCard}>
          <ActivityIndicator color={colors.warning} />
          <Text testID="pay-status" variant="subhead" color="warning" center style={{ marginTop: 12 }}>
            Payment received — we’re confirming it now. You’ll get a receipt shortly.
          </Text>
          <Button testID="refresh-button" label="Refresh" variant="outline" icon="refresh-cw" onPress={() => void load()} style={{ marginTop: 16 }} />
        </Card>
      ) : phase === 'notpayable' ? (
        <Card style={styles.statusCard}>
          <Feather name="clock" size={26} color={colors.textTertiary} />
          <Text testID="pay-status" variant="subhead" color="secondary" center style={{ marginTop: 10 }}>
            This order isn’t ready for payment yet.
          </Text>
        </Card>
      ) : (
        <View>
          <Card padding={20}>
            <Text variant="footnote" color="secondary">
              {orderRef(orderId)}
            </Text>
            <Text variant="caption" color="tertiary" style={{ marginTop: 12 }}>
              AMOUNT DUE
            </Text>
            {amount ? (
              <Text testID="pay-amount" variant="display" weight="700" tabular style={{ marginTop: 2 }}>
                {money(amount, currency)}
              </Text>
            ) : null}
            <Text variant="footnote" color="tertiary" style={{ marginTop: 2 }}>
              Includes HST.
            </Text>
          </Card>

          <Card style={{ marginTop: space.lg }}>
            {error ? (
              <View style={[styles.errorBox, { backgroundColor: colors.dangerTint }]}>
                <Feather name="alert-circle" size={16} color={colors.danger} />
                <Text testID="pay-error" variant="footnote" color="danger" style={{ marginLeft: 8, flex: 1 }}>
                  {error}
                </Text>
              </View>
            ) : null}

            <View style={styles.secureRow}>
              <Feather name="lock" size={16} color={colors.success} />
              <Text variant="footnote" color="secondary" style={{ marginLeft: 8, flex: 1 }}>
                Pay with card, Apple Pay, or Google Pay. Your card details never touch our servers.
              </Text>
            </View>

            <Button
              testID="pay-button"
              label={phase === 'failed' ? 'Try again' : `Pay ${amount ? money(amount, currency) : ''}`}
              icon={phase === 'failed' ? 'refresh-cw' : 'lock'}
              tone="azure"
              onPress={() => void pay()}
              busy={busy}
              disabled={busy}
              style={{ marginTop: space.md }}
            />
            {phase === 'confirming' ? (
              <Text testID="pay-status" variant="footnote" color="secondary" center style={{ marginTop: 10 }}>
                Confirming your payment…
              </Text>
            ) : null}
          </Card>

          <View style={styles.trustRow}>
            <BeeMark size={22} />
            <Text variant="caption" color="tertiary" style={{ marginLeft: 8 }}>
              Secured by Stripe · Blue Bee
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  celebrate: { alignItems: 'center', paddingTop: 24 },
  tick: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  statusCard: { alignItems: 'center', paddingVertical: 28 },
  errorBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, marginBottom: 12 },
  secureRow: { flexDirection: 'row', alignItems: 'center' },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20 },
});
