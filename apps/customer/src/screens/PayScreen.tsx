import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PaymentStatus, QuoteStatus, type InvoiceView, type PaymentView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { ItemView, OrderDetail } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { usePresentPayment } from '../pay/use-payment-sheet';
import { isPayable, payAmount, pollPaymentConfirmed } from '../pay/payment-controller';
import { money, orderRef, shortDate, shortTime } from '../format';
import { useTheme, usePressScale } from '../../theme';
import { Button, Card, Divider, IconBadge, KeyValue, SkeletonCard, Stepper, Text, fireHaptic } from '../../components/ui';

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
 * [Royal restyle] The order's real per-item measure (weight in kg, or a piece count) — read from
 * whatever the server actually persisted on `item.measurements`. Summed across items; the FIRST unit
 * kind found wins (kg beats a piece count, matching how weight-priced verticals are booked). Returns
 * null the moment nothing measurable is present, so the row is simply omitted — never an invented "~0".
 */
function orderMeasure(items: ItemView[]): { value: string; caption: string } | null {
  let kg = 0;
  let pieces = 0;
  for (const item of items) {
    const m = item.measurements as Record<string, unknown> | null | undefined;
    if (!m) continue;
    const weight = typeof m.weightKg === 'number' ? m.weightKg : null;
    if (weight != null && weight > 0) {
      kg += weight;
      continue;
    }
    const measure = typeof m.estimatedMeasure === 'number' ? m.estimatedMeasure : null;
    if (measure != null && measure > 0) pieces += measure;
  }
  if (kg > 0) return { value: `~ ${kg % 1 === 0 ? kg : kg.toFixed(1)} kg`, caption: 'Estimated' };
  if (pieces > 0) return { value: String(pieces), caption: pieces === 1 ? 'item' : 'items' };
  return null;
}

/** The small "pencil + Edit" affordance used across the Order summary card. Real destinations only —
 *  no dead links — so every use below is wired to an actual nav target. */
function EditLink({ onPress, testID }: { onPress: () => void; testID?: string }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        fireHaptic('selection');
        onPress();
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Edit"
      style={styles.editLink}
    >
      <Feather name="edit-2" size={13} color={colors.azure} />
      <Text variant="subhead" weight="600" color="azure" style={{ marginLeft: 5 }}>
        Edit
      </Text>
    </Pressable>
  );
}

/** A tinted-chip + title header shared by the Order summary / Payment methods / Promo code cards. */
function CardHeader({
  icon,
  title,
  right,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  right?: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.cardHeaderRow}>
      <View style={styles.cardHeaderLeft}>
        <IconBadge icon={icon} tone="azure" size={34} />
        <Text variant="headline" weight="700" style={{ marginLeft: 10 }}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

/**
 * The fixed-bottom "Pay $X.XX →" CTA. A local trailing-arrow variant of the shared Button (which only
 * supports a LEADING icon) so the bar matches the reference pixel-for-pixel; same press-scale + haptic
 * feel as Button, same testID/disabled/busy contract the pay flow already relies on.
 */
function PayBar({
  label,
  onPress,
  busy,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  disabled: boolean;
  testID: string;
}): React.ReactElement {
  const { colors, radius } = useTheme();
  const press = usePressScale(!disabled);
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (disabled) return;
        fireHaptic('light');
        onPress();
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      accessibilityLabel={label}
    >
      <Animated.View
        style={[
          styles.payBar,
          { backgroundColor: colors.azure, borderRadius: radius.button, opacity: disabled ? 0.5 : 1, transform: press.transform },
        ]}
      >
        {busy ? (
          <ActivityIndicator color={colors.onAzure} />
        ) : (
          <>
            <Text variant="headline" weight="700" style={{ color: colors.onAzure }}>
              {label}
            </Text>
            <Feather name="arrow-right" size={19} color={colors.onAzure} style={{ marginLeft: 10 }} />
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Pay surface (PRD §7A A5.1, Increment 12) — Stripe PaymentSheet for the approved order. The card
 * never touches our app/API; only the client secret crosses. The WEBHOOK confirms the payment, so
 * after the sheet succeeds we POLL the server until it's SUCCEEDED (then show the receipt) — never
 * "paid" on the client's say-so. Retry on failure; "processing" if the webhook hasn't landed yet.
 *
 * [Royal restyle] Schedule · Payment · Review stepper; an "Order summary" card (service + estimate +
 * price, pickup address, pickup window, subtotal/tax, a highlighted total bar); a "Payment methods" card
 * (Track 2 has no saved cards yet — a single dashed row opens the real PaymentSheet); a "Promo code" card
 * (Track 2 — an honest, tappable "Coming soon" row, never a fake discount); a "Secure & encrypted" trust
 * card; a fixed-bottom Pay CTA. The Stripe flow, every client.* call, and all states below are unchanged —
 * this is presentation only.
 */
export function PayScreen({ navigation, route }: Props): React.ReactElement {
  const { orderId } = route.params;
  const { client } = useSession();
  const { colors, space, radius, elevation } = useTheme();
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
  const measure = orderDetail ? orderMeasure(orderDetail.items) : null;
  const editSchedule = (): void => navigation.goBack();
  const editAddress = (): void => navigation.navigate('AddressForm', { siteId: orderDetail?.siteId ?? undefined });
  const promoComingSoon = (): void => {
    fireHaptic('light');
    Alert.alert('Promo codes', 'Promo codes are coming soon — you’ll be able to apply one here.');
  };

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
            {/* ─── Order summary — the real loaded order: service (+ real measure, if the server captured
                one), pickup address, pickup window, then the same subtotal/tax/total precedence that
                produces `amount` below. ─── */}
            <Card style={{ marginTop: space.lg }}>
              <CardHeader icon="briefcase" title="Order summary" right={<EditLink testID="edit-schedule" onPress={editSchedule} />} />

              <View style={styles.summaryRow}>
                <IconBadge icon="shopping-bag" tone="azure" size={36} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="subhead" weight="700">
                    Service
                  </Text>
                  <Text variant="footnote" color="secondary" style={{ marginTop: 1 }}>
                    {serviceLabel ?? 'Your order'}
                  </Text>
                </View>
                {measure ? (
                  <View style={styles.measureCol}>
                    <Text variant="subhead" weight="700" tabular>
                      {measure.value}
                    </Text>
                    <Text variant="caption" color="tertiary">
                      {measure.caption}
                    </Text>
                  </View>
                ) : null}
                <Text variant="headline" weight="700">
                  {money(breakdown.subtotal ?? amount, currency)}
                </Text>
              </View>

              <View style={[styles.summaryRow, { marginTop: 16 }]}>
                <IconBadge icon="map-pin" tone="azure" size={36} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="subhead" weight="700">
                    Pickup address
                  </Text>
                  <Text variant="footnote" color="secondary" style={{ marginTop: 1 }} numberOfLines={1}>
                    {orderDetail?.siteId ? 'Saved on your account' : 'No address on file'}
                  </Text>
                </View>
                {orderDetail?.siteId ? <EditLink testID="edit-address" onPress={editAddress} /> : null}
              </View>

              {pickup ? (
                <View style={[styles.summaryRow, { marginTop: 16 }]}>
                  <IconBadge icon="calendar" tone="azure" size={36} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text variant="subhead" weight="700">
                      Pickup window
                    </Text>
                    <Text variant="footnote" color="secondary" style={{ marginTop: 1 }}>
                      {shortDate(pickup.start)} · {shortTime(pickup.start)} – {shortTime(pickup.end)}
                    </Text>
                  </View>
                  <EditLink testID="edit-pickup-window" onPress={editSchedule} />
                </View>
              ) : null}

              <Divider spacing={16} />
              <KeyValue label="Subtotal" value={money(breakdown.subtotal, currency)} />
              <KeyValue
                testID="pay-tax-info"
                label="Taxes & fees"
                value={money(breakdown.tax, currency)}
              />

              <View style={[styles.totalBar, { backgroundColor: colors.azureTint, borderRadius: radius.input, marginTop: 14 }]}>
                <Text variant="headline" weight="700">
                  Total
                </Text>
                <Text testID="pay-amount" variant="title3" weight="700" color="azure" tabular>
                  {money(amount, currency)}
                </Text>
              </View>
            </Card>

            {/* ─── Payment methods — Track 2 has no saved cards yet. One honest, dashed "add / use a card"
                row that opens the real Stripe PaymentSheet (the same flow as the Pay button below); never a
                fabricated Visa/Mastercard/Amex row. ─── */}
            <Card style={{ marginTop: space.lg }}>
              <CardHeader icon="credit-card" title="Payment methods" />
              <Pressable
                testID="payment-method-row"
                onPress={() => {
                  if (busy || phase === 'failed') return;
                  fireHaptic('light');
                  void pay();
                }}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Add or use a card"
                style={[styles.addCardRow, { borderColor: colors.azure, opacity: busy ? 0.5 : 1 }]}
              >
                <Feather name="plus" size={18} color={colors.azure} />
                <Text variant="subhead" weight="600" color="azure" style={{ marginLeft: 8 }}>
                  Add / use a card
                </Text>
              </Pressable>
            </Card>

            {/* ─── Promo code — Track 2 has no promo backend yet. An honest, tappable "Coming soon" row —
                never a fake discount applied. ─── */}
            <Pressable testID="promo-code-row" onPress={promoComingSoon} accessibilityRole="button">
              <Card style={{ marginTop: space.lg }}>
                <View style={styles.promoRow}>
                  <View style={styles.cardHeaderLeft}>
                    <IconBadge icon="tag" tone="azure" size={34} />
                    <Text variant="headline" weight="700" style={{ marginLeft: 10 }}>
                      Promo code
                    </Text>
                  </View>
                  <View style={styles.promoRight}>
                    <Text variant="subhead" weight="600" color="tertiary">
                      Coming soon
                    </Text>
                    <Feather name="chevron-right" size={18} color={colors.textTertiary} style={{ marginLeft: 4 }} />
                  </View>
                </View>
              </Card>
            </Pressable>

            {/* ─── Trust banner ─── */}
            <Card style={[styles.trustCard, { backgroundColor: colors.successTint, borderColor: colors.successTint, marginTop: space.lg }]}>
              <IconBadge icon="shield" tone="success" size={44} />
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Text variant="subhead" weight="700">
                  Secure & encrypted
                </Text>
                <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
                  Your payment info is encrypted and processed securely by Stripe — it never touches our servers.
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
          <PayBar
            testID="pay-button"
            label={phase === 'failed' ? 'Try again' : `Pay ${amount ? money(amount, currency) : ''}`}
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
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center' },
  editLink: { flexDirection: 'row', alignItems: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  measureCol: { alignItems: 'center', marginHorizontal: 12, minWidth: 44 },
  totalBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  addCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 14,
  },
  promoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  promoRight: { flexDirection: 'row', alignItems: 'center' },
  trustCard: { flexDirection: 'row', alignItems: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  payBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 54, paddingHorizontal: 20 },
});
