import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ItemKind, PricingUnit, type CustomerSite, type PickupSlot, type PickupSlotsResult, type ServiceCatalogItem } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { buildBookDto, newIdempotencyKey, slotToWindow, type DraftItem } from '../orders/booking';
import { rangeText } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, EmptyState, Text } from '../../components/ui';
import { CorporatePricingNote } from '../components/CorporatePricing';
import { PickupSlotPicker } from '../components/PickupSlotPicker';

/**
 * [Inc-36] Book — ONE service, ONE measure, one order.
 *
 * This screen is now reached ONLY from a Home service card, which always carries its backing `serviceId`
 * (every card has a rate service). It asks for the single measure that fits THAT service — kg / lb / sqft /
 * count, driven purely by the card's `PricingUnit` — shows a live rough estimate as you type, then takes an
 * address + pickup window and books.
 *
 * Deliberately GONE (this is the simplification): the item-type chips (RUG/CARPET/BLIND/…), the service chip
 * list, the dry-clean garment sub-catalog picker, and the "Add" staging step. One service = one order line.
 * A customer can no longer reach a general composer — landing here without a service is a dead end that sends
 * them back to the grid (see the guard below), so the complexity cannot be re-entered by a stray navigation.
 */
export function BookScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Book'>): React.ReactElement {
  const { client, me } = useSession();
  const { colors, space } = useTheme();
  const accountId = me?.user.accountIds[0];
  /** The tapped Home card. Its `serviceId` is what makes this screen focused — see the guard below. */
  const card = route?.params;
  const cardServiceId = card?.serviceId ?? null;

  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // [Inc-16] Server truth: if the user holds an active corporate membership, their booking prices on that
  // account. The badge is informational; pricing itself is resolved server-side at booking (never here).
  const [corpAccountName, setCorpAccountName] = useState<string | null>(null);

  /** The ONE measure. Its unit comes from the card (`PricingUnit`), never hardcoded per screen. */
  const [measure, setMeasure] = useState('');
  const [siteId, setSiteId] = useState<string | undefined>(undefined);

  // [Inc-28] The real pickup picker. `requestedDate` is the day the customer EXPLICITLY tapped (the fetch
  // input); when null the SERVER chooses the first bookable day. `pickupSlot` null ⇒ submit stays disabled —
  // there is no hard-coded fallback window.
  const [requestedDate, setRequestedDate] = useState<string | null>(null);
  const [pickupSlot, setPickupSlot] = useState<PickupSlot | null>(null);
  const [day, setDay] = useState<PickupSlotsResult | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsNonce, setSlotsNonce] = useState(0);
  const pickupDate = requestedDate ?? day?.date ?? null;

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // [Inc-19] Server-authoritative out-of-service-area (422) — a calm state, not a red crash.
  const [outOfArea, setOutOfArea] = useState<{ address: string | null } | null>(null);
  // Stable across retries → no double-booking on a timeout (server IdempotencyInterceptor).
  const idemKeyRef = useRef<string | null>(null);

  /**
   * [Inc-26] Load the address picker. The server returns ACTIVE sites with the account default first, so
   * `sites[0]` is the right pre-selection. `preselect` wins when we've just come back from AddressForm.
   */
  const loadSites = useCallback(
    async (preselect?: string): Promise<void> => {
      const st = await client.getSites();
      setSites(st.sites);
      setSiteId((current) => {
        if (preselect && st.sites.some((s) => s.id === preselect)) return preselect;
        if (current && st.sites.some((s) => s.id === current)) return current;
        return st.sites[0]?.id;
      });
    },
    [client],
  );

  /**
   * [Inc-28] Load the chosen day's pickup windows. BLOCKING (unlike the memberships read): it decides whether
   * a booking is possible at all, so a failure surfaces as a retryable error — never a window we invented.
   */
  useEffect(() => {
    if (loading) return undefined;
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);
    (async () => {
      try {
        const res = await client.getPickupSlots(requestedDate ?? undefined, siteId);
        if (cancelled) return;
        setDay(res);
        // Drop a selection the server no longer offers (the day changed, or the slot filled while composing).
        setPickupSlot((cur) => {
          if (!cur) return null;
          const fresh = res.slots.find((s) => s.label === cur.label && s.start === cur.start);
          return fresh && fresh.available ? fresh : null;
        });
      } catch (e) {
        if (!cancelled) setSlotsError(e instanceof ApiError ? e.message : 'Could not load pickup times.');
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, siteId, requestedDate, slotsNonce, loading]);

  useEffect(() => {
    (async () => {
      try {
        // `getServices()` carries the backing service's baseRate — the rate the live estimate multiplies.
        const [svc] = await Promise.all([client.getServices(), loadSites(card?.preselectSiteId)]);
        setServices(svc.services);
      } catch (e) {
        setLoadError(e instanceof ApiError ? e.message : 'Could not load the booking options.');
      } finally {
        setLoading(false);
      }
    })();
    // Non-blocking: any failure just hides the badge — booking is never blocked or faked.
    (async () => {
      try {
        const res = await client.listMyMemberships();
        const active = res.memberships.find((m) => m.status === 'ACTIVE');
        if (active) setCorpAccountName(active.accountName);
      } catch {
        // degrade silently — no membership badge
      }
    })();
  }, [client, loadSites, card?.preselectSiteId]);

  // [Inc-26] Re-read the address picker whenever Book regains focus (they may have just added an address).
  const firstFocus = useRef(true);
  const preselectSiteId = route?.params?.preselectSiteId;
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void loadSites(preselectSiteId).catch(() => undefined);
    });
    return unsubscribe;
  }, [navigation, loadSites, preselectSiteId]);

  // ── the single auto-staged line (no "Add" step: typing a measure IS the line) ──
  const measureValue = Number(measure);
  const hasMeasure = Number.isFinite(measureValue) && measureValue > 0;
  const backingService = services.find((s) => s.id === cardServiceId);
  const rate = backingService ? Number(backingService.baseRate) : 0;
  const estimate = hasMeasure && rate > 0 ? estimateRange(measureValue * rate) : null;

  const submit = useCallback(async () => {
    if (!accountId) {
      setSubmitError('Your account is not set up for booking yet.');
      return;
    }
    if (!cardServiceId || !hasMeasure || !pickupSlot) return; // the button is already disabled without these
    setSubmitting(true);
    setSubmitError(null);
    setOutOfArea(null);
    if (!idemKeyRef.current) idemKeyRef.current = newIdempotencyKey();
    // [Inc-19] Send the selected site's service point so the SERVER can geo-block (the app never decides).
    const selectedSite = sites.find((s) => s.id === siteId);
    // One service = ONE order line, carrying the entered measure. The authoritative quote is computed
    // server-side from what the DRIVER actually weighs/measures at pickup — this is only the booking intent.
    const items: DraftItem[] = [{ kind: card?.kind ?? ItemKind.GARMENT, serviceId: cardServiceId, estimatedMeasure: measureValue }];
    try {
      const dto = buildBookDto({
        accountId,
        siteId,
        items,
        pickupWindow: slotToWindow(pickupSlot),
        ...(selectedSite?.geo ? { serviceGeo: selectedSite.geo } : {}),
      });
      const order = await client.book(dto, idemKeyRef.current);
      idemKeyRef.current = null; // booked — a new attempt gets a fresh key
      navigation.replace('OrderDetail', { orderId: order.id });
    } catch (e) {
      if (e instanceof ApiError && e.isOutOfServiceArea) {
        setOutOfArea({ address: selectedSite?.address ?? null });
      } else {
        setSubmitError(e instanceof Error ? e.message : 'Could not book. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [accountId, cardServiceId, hasMeasure, measureValue, card?.kind, siteId, sites, pickupSlot, client, navigation]);

  /**
   * [Inc-36] The guard that keeps the general composer unreachable. Every Home card carries a backing service,
   * so this only fires on a stray/legacy navigation to Book with no service — and it sends them to the grid to
   * choose one rather than dropping them into a service picker.
   */
  if (!cardServiceId) {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <EmptyState
          testID="book-no-service"
          icon="grid"
          title="Choose a service"
          body="Pick a service from the grid and we’ll take it from there."
          actionLabel="Back to services"
          actionIcon="arrow-left"
          onAction={() => navigation.goBack()}
        />
      </View>
    );
  }

  if (loading)
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator testID="book-loading" size="large" color={colors.azure} />
        <Text variant="subhead" color="secondary" style={{ marginTop: 12 }}>
          Loading booking options…
        </Text>
      </View>
    );
  if (loadError)
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <Feather name="alert-circle" size={28} color={colors.danger} />
        <Text variant="headline" weight="600" center style={{ marginTop: 12 }}>
          {loadError}
        </Text>
      </View>
    );

  return (
    <ScrollView
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {corpAccountName ? <CorporatePricingNote accountName={corpAccountName} /> : null}

      {/* ── the ONE measure + the live estimate ── */}
      <Card title={card?.serviceName ? `Book ${card.serviceName}` : 'Book'}>
        <Text testID="book-measure-help" variant="footnote" color="secondary" style={styles.help}>
          {measureHelp(card?.unit)}
        </Text>

        <Text variant="subhead" weight="600" style={styles.sectionLabel}>
          {measureLabel(card?.unit)}
        </Text>
        <View style={[styles.measureField, { backgroundColor: colors.surface, borderColor: colors.hairline, borderRadius: 12 }]}>
          <TextInput
            testID="measure-input"
            value={measure}
            onChangeText={setMeasure}
            placeholder={measurePlaceholder(card?.unit)}
            placeholderTextColor={colors.textTertiary}
            keyboardType="decimal-pad"
            style={{ flex: 1, color: colors.text, fontSize: 17, paddingVertical: 13 }}
          />
          <Text variant="subhead" weight="600" color="secondary">
            {unitSuffix(card?.unit)}
          </Text>
        </View>

        {/* The estimate appears the moment a measure is typed — no "Add" tap. It is explicitly ROUGH: the
            binding quote is computed server-side from the weight/measure the driver captures at pickup. */}
        {estimate ? (
          <View style={[styles.estimateBox, { backgroundColor: colors.azureTint }]}>
            <View style={styles.estimateTop}>
              <Feather name="tag" size={15} color={colors.azure} />
              <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 6 }}>
                Rough estimate
              </Text>
            </View>
            <Text testID="estimate" variant="title3" weight="700" color="azure" tabular style={{ marginTop: 4 }}>
              {rangeText(estimate.low, estimate.high)}
            </Text>
            <Text testID="estimate-caveat" variant="footnote" color="secondary" style={{ marginTop: 2 }}>
              {estimateCaveat(card?.unit)}
            </Text>
          </View>
        ) : null}
      </Card>

      {/* ── address ── */}
      {sites.length === 0 ? (
        <Card title="Pickup & delivery address">
          <EmptyState
            testID="no-addresses"
            icon="map-pin"
            title="Add your address"
            body="We need somewhere to collect from before you can book a pickup."
            actionLabel="Add address"
            actionIcon="plus"
            onAction={() => navigation.navigate('AddressForm', { returnTo: 'Book' })}
          />
        </Card>
      ) : (
        <Card title="Pickup & delivery address">
          {sites.map((s) => {
            const on = siteId === s.id;
            return (
              <Pressable
                key={s.id}
                testID={`site-${s.id}`}
                onPress={() => setSiteId(s.id)}
                style={[
                  styles.siteRow,
                  { borderColor: on ? colors.azure : colors.hairline, backgroundColor: on ? colors.azureTint : colors.surface },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Feather name="map-pin" size={18} color={on ? colors.azure : colors.textTertiary} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text variant="subhead" weight="600">
                    {s.name}
                  </Text>
                  {s.address ? (
                    <Text variant="footnote" color="secondary" style={{ marginTop: 1 }}>
                      {s.address}
                    </Text>
                  ) : null}
                </View>
                {on ? <Feather name="check-circle" size={18} color={colors.azure} /> : null}
              </Pressable>
            );
          })}
          <Button
            testID="book-add-address"
            label="Add another address"
            icon="plus"
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => navigation.navigate('AddressForm', { returnTo: 'Book' })}
            style={{ marginTop: 10 }}
          />
        </Card>
      )}

      {/* ── pickup time ── */}
      <PickupSlotPicker
        date={pickupDate}
        day={day}
        loading={slotsLoading}
        error={slotsError}
        selectedLabel={pickupSlot?.label ?? null}
        onSelectDate={(d) => {
          setRequestedDate(d);
          setPickupSlot(null); // a slot belongs to its day
        }}
        onSelectSlot={setPickupSlot}
        onRetry={() => setSlotsNonce((n) => n + 1)}
      />

      {/* The button names whatever is still missing rather than failing at the server. */}
      <Button
        testID="submit-booking"
        label={
          !hasMeasure
            ? missingMeasureLabel(card?.unit)
            : !siteId
              ? 'Add an address to book'
              : !pickupSlot
                ? 'Choose a pickup time'
                : 'Book pickup'
        }
        icon="check"
        onPress={() => void submit()}
        busy={submitting}
        disabled={submitting || !hasMeasure || !siteId || !pickupSlot}
        style={{ marginTop: space.md }}
      />

      {outOfArea ? (
        <View testID="book-out-of-area" style={[styles.outOfAreaBox, { backgroundColor: colors.azureTint, borderColor: colors.hairline }]}>
          <Feather name="map-pin" size={18} color={colors.azure} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text variant="subhead" weight="600">
              We don’t serve this area yet
            </Text>
            <Text testID="book-out-of-area-body" variant="footnote" color="secondary" style={{ marginTop: 2 }}>
              {outOfArea.address
                ? `We’ve noted ${outOfArea.address} and will reach out when we expand to your area.`
                : 'We’ve noted your address and will reach out when we expand to your area.'}
            </Text>
          </View>
        </View>
      ) : null}

      {submitError ? (
        <View style={[styles.errorBox, { backgroundColor: colors.dangerTint }]}>
          <Text testID="book-error" variant="footnote" color="danger" center>
            {submitError}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

// ───────────────────────── unit-driven copy (never hardcoded per screen) ─────────────────────────
// Everything below is a pure function of the CARD's PricingUnit, which comes from the catalog. Adding a unit
// in the catalog changes these labels — no screen edit.

/** The measure the customer types is always in the BACKING SERVICE's own unit (a PER_LB card asks for lb). */
function measureLabel(unit: PricingUnit | undefined): string {
  switch (unit) {
    case PricingUnit.PER_KG:
      return 'About how much does your load weigh?';
    case PricingUnit.PER_LB:
      return 'About how much does your load weigh?';
    case PricingUnit.PER_MEASURE:
      return 'About how big is the area?';
    case PricingUnit.PER_ITEM:
    default:
      return 'How many items?';
  }
}
function unitSuffix(unit: PricingUnit | undefined): string {
  switch (unit) {
    case PricingUnit.PER_KG:
      return 'kg';
    case PricingUnit.PER_LB:
      return 'lb';
    case PricingUnit.PER_MEASURE:
      return 'sq ft';
    case PricingUnit.PER_ITEM:
    default:
      return 'items';
  }
}
function measurePlaceholder(unit: PricingUnit | undefined): string {
  switch (unit) {
    case PricingUnit.PER_KG:
      return 'e.g. 6';
    case PricingUnit.PER_LB:
      return 'e.g. 12';
    case PricingUnit.PER_MEASURE:
      return 'e.g. 40';
    case PricingUnit.PER_ITEM:
    default:
      return 'e.g. 5';
  }
}
function measureHelp(unit: PricingUnit | undefined): string {
  switch (unit) {
    case PricingUnit.PER_KG:
    case PricingUnit.PER_LB:
      return 'A rough number is fine — we weigh your load at pickup and the final price is based on that.';
    case PricingUnit.PER_MEASURE:
      return 'A rough size is fine — we measure at pickup and the final price is based on that.';
    case PricingUnit.PER_ITEM:
    default:
      return 'Tell us roughly how many items; we confirm the count at intake.';
  }
}
/** Honesty firewall: the estimate is never presented as a final or guaranteed price. */
function estimateCaveat(unit: PricingUnit | undefined): string {
  switch (unit) {
    case PricingUnit.PER_KG:
    case PricingUnit.PER_LB:
      return 'Final quote confirmed after we weigh your load at pickup.';
    case PricingUnit.PER_MEASURE:
      return 'Final quote confirmed after we measure at pickup.';
    case PricingUnit.PER_ITEM:
    default:
      return 'Final quote confirmed after we check your items at intake.';
  }
}
function missingMeasureLabel(unit: PricingUnit | undefined): string {
  switch (unit) {
    case PricingUnit.PER_KG:
    case PricingUnit.PER_LB:
      return 'Enter a weight to book';
    case PricingUnit.PER_MEASURE:
      return 'Enter a size to book';
    case PricingUnit.PER_ITEM:
    default:
      return 'Enter how many items to book';
  }
}

/** A rough pre-intake band around the client-side estimate. The binding quote is computed server-side. */
function estimateRange(amount: number): { low: string; high: string } {
  return { low: (amount * 0.9).toFixed(2), high: (amount * 1.15).toFixed(2) };
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  help: { marginBottom: 4 },
  sectionLabel: { marginTop: 14, marginBottom: 10 },
  measureField: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, minHeight: 52, gap: 8 },
  estimateBox: { borderRadius: 12, padding: 14, marginTop: 16 },
  estimateTop: { flexDirection: 'row', alignItems: 'center' },
  siteRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 8 },
  errorBox: { borderRadius: 12, padding: 12, marginTop: 12 },
  outOfAreaBox: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 12 },
});
