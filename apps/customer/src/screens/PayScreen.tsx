import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PaymentStatus, type InvoiceView, type PaymentView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { OrderDetail } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { usePresentPayment } from '../pay/use-payment-sheet';
import { isPayable, payAmount, pollPaymentConfirmed } from '../pay/payment-controller';
import { money, orderRef } from '../format';

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
  const present = usePresentPayment();
  const [phase, setPhase] = useState<Phase>('loading');
  const [amount, setAmount] = useState<string | null>(null);
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

  if (phase === 'loading') return <ActivityIndicator testID="pay-loading" style={styles.center} size="large" color="#1f6feb" />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.ref}>{orderRef(orderId)}</Text>
      {amount ? <Text testID="pay-amount" style={styles.amount}>{money(amount, currency)}</Text> : null}

      {phase === 'paid' ? (
        <View testID="receipt" style={styles.card}>
          <Text style={styles.paidBadge}>✓ Paid</Text>
          <Text style={styles.cardTitle}>Receipt</Text>
          {receipt?.lines.map((l, i) => (
            <View key={i} style={styles.kv}>
              <Text style={styles.kvLabel}>{l.description}</Text>
              <Text style={styles.kvValue}>{money(l.amount, currency)}</Text>
            </View>
          ))}
          <View style={styles.kv}>
            <Text style={[styles.kvLabel, styles.bold]}>Total paid</Text>
            <Text style={[styles.kvValue, styles.bold]}>{money(receipt?.total ?? payment?.amount ?? amount ?? '0', currency)}</Text>
          </View>
          <TouchableOpacity testID="done-button" style={styles.secondaryBtn} onPress={() => navigation.goBack()}>
            <Text style={styles.secondaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : phase === 'processing' ? (
        <View style={styles.card}>
          <Text testID="pay-status" style={styles.processing}>Payment received — we’re confirming it now. You’ll get a receipt shortly.</Text>
          <TouchableOpacity testID="refresh-button" style={styles.secondaryBtn} onPress={() => void load()}>
            <Text style={styles.secondaryBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : phase === 'notpayable' ? (
        <Text testID="pay-status" style={styles.muted}>This order isn’t ready for payment.</Text>
      ) : (
        <View style={styles.card}>
          {error ? <Text testID="pay-error" style={styles.error}>{error}</Text> : null}
          <Text style={styles.muted}>Pay securely with card, Apple Pay, or Google Pay. Your card details never touch our servers.</Text>
          <TouchableOpacity
            testID="pay-button"
            style={[styles.payBtn, (phase === 'starting' || phase === 'presenting' || phase === 'confirming') && styles.btnDisabled]}
            onPress={() => void pay()}
            disabled={phase === 'starting' || phase === 'presenting' || phase === 'confirming'}
          >
            {phase === 'starting' || phase === 'presenting' || phase === 'confirming' ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.payBtnText}>{phase === 'failed' ? 'Try again' : `Pay ${amount ? money(amount, currency) : ''}`}</Text>
            )}
          </TouchableOpacity>
          {phase === 'confirming' ? <Text testID="pay-status" style={styles.muted}>Confirming your payment…</Text> : null}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  content: { padding: 16, gap: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ref: { fontSize: 16, color: '#57606a' },
  amount: { fontSize: 32, fontWeight: '800', color: '#1f2328', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#eaeef2', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1f2328' },
  paidBadge: { color: '#1a7f37', fontWeight: '800', fontSize: 20 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  kvLabel: { color: '#57606a' },
  kvValue: { color: '#1f2328' },
  bold: { fontWeight: '700', color: '#1f2328' },
  muted: { color: '#57606a' },
  processing: { color: '#9a6700', fontSize: 15 },
  payBtn: { backgroundColor: '#1f883d', borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 4 },
  payBtnText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  btnDisabled: { opacity: 0.6 },
  secondaryBtn: { borderWidth: 1, borderColor: '#1f6feb', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { color: '#1f6feb', fontWeight: '600' },
  error: { color: '#b91c1c' },
});
