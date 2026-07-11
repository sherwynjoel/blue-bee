import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ItemKind, PricingUnit, type CustomerSite, type DrycleanCatalogView, type PickupSlot, type PickupSlotsResult, type ServiceCatalogItem } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { buildBookDto, newIdempotencyKey, slotToWindow, type DraftItem } from '../orders/booking';
import { rangeText } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, EmptyState, Text, fireHaptic } from '../../components/ui';
import { CorporatePricingNote } from '../components/CorporatePricing';
import { DrycleanPicker } from '../components/DrycleanPicker';
import { PickupSlotPicker } from '../components/PickupSlotPicker';

const ITEM_KINDS: ItemKind[] = [ItemKind.RUG, ItemKind.CARPET, ItemKind.BLIND, ItemKind.UPHOLSTERY, ItemKind.GARMENT];

const KIND_ICON: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  [ItemKind.RUG]: 'square',
  [ItemKind.CARPET]: 'grid',
  [ItemKind.BLIND]: 'sliders',
  [ItemKind.UPHOLSTERY]: 'inbox',
  [ItemKind.GARMENT]: 'shopping-bag',
};

/** Book a specialty job (PRD §7A A2.1): pick service + items + site + pickup window → POST /v1/orders. */
export function BookScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Book'>): React.ReactElement {
  const { client, me } = useSession();
  const { colors, space } = useTheme();
  const accountId = me?.user.accountIds[0];
  // [Inc-23] Optional card context from a tapped Home service card — pre-selects the card's backing service.
  const card = route?.params;

  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // [Inc-16] Server truth: if the user holds an active corporate membership, their booking prices on that
  // account. The badge is informational; pricing itself is resolved server-side at booking (never here).
  // A building match (no membership) can't be known pre-booking — it surfaces on the order after booking.
  const [corpAccountName, setCorpAccountName] = useState<string | null>(null);
  // [Inc-17] The visual dry-clean catalog (server-resolved prices). Non-blocking: if it fails to load, the
  // specialty composer still books normally — the picker simply doesn't render.
  const [dryclean, setDryclean] = useState<DrycleanCatalogView | null>(null);

  // Composer for the current item + the staged item list. Seed from the tapped card when present.
  const [kind, setKind] = useState<ItemKind>(card?.kind ?? ItemKind.RUG);
  const [serviceId, setServiceId] = useState<string | null>(card?.serviceId ?? null);
  const [measure, setMeasure] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [siteId, setSiteId] = useState<string | undefined>(undefined);

  // [Inc-28] The real pickup picker.
  //
  // `requestedDate` is the day the customer EXPLICITLY tapped, and nothing else — it is the fetch input, so
  // it must not be written from a response, or the load effect would re-trigger itself. When it is null the
  // SERVER chooses the first bookable day and names it in `day.date`. The day actually on screen is derived
  // from the two (`pickupDate` below), never stored a third time.
  //
  // `pickupSlot` is the window the customer chose on that day. Null ⇒ nothing is scheduled and submit stays
  // disabled: there is no hard-coded fallback window any more.
  const [requestedDate, setRequestedDate] = useState<string | null>(null);
  const [pickupSlot, setPickupSlot] = useState<PickupSlot | null>(null);
  const [day, setDay] = useState<PickupSlotsResult | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  /** Bumped to force a re-fetch (the picker's "Try again"). */
  const [slotsNonce, setSlotsNonce] = useState(0);
  /** Highlight the tapped day immediately, then fall back to whichever day the server answered with. */
  const pickupDate = requestedDate ?? day?.date ?? null;

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // [Inc-19] Set when the server (authoritative) blocks the booking as out-of-service-area (422). A calm
  // informational state, distinct from the red submitError box.
  const [outOfArea, setOutOfArea] = useState<{ address: string | null } | null>(null);
  // Stable across retries → no double-booking on a timeout (server IdempotencyInterceptor).
  const idemKeyRef = useRef<string | null>(null);

  /**
   * [Inc-26] Load the address picker. The server returns ACTIVE sites with the account default first, so
   * `sites[0]` is the right pre-selection. `preselect` wins when we've just come back from AddressForm
   * having saved a new address; otherwise we keep the current choice if it still exists (it may have been
   * removed on the Addresses screen while we were away).
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
   * [Inc-28] Load the chosen day's pickup windows. Re-runs when the customer taps a different day, when they
   * switch address (a site's service zone may one day carry its own hours — the server owns that seam), and
   * on an explicit retry.
   *
   * BLOCKING, unlike the memberships/dryclean reads below. Those degrade to a hidden badge; this one decides
   * whether a booking is possible at all, so a failure surfaces as an error the customer can retry — never
   * as a silent fallback to a window we invented.
   *
   * Gated on the initial load so it fires ONCE, with the resolved `siteId`, rather than firing immediately
   * against `undefined` and again the moment the address list arrives.
   */
  useEffect(() => {
    if (loading) return undefined; // wait for sites, so the first read already knows the address
    let cancelled = false;
    setSlotsLoading(true);
    setSlotsError(null);
    (async () => {
      try {
        const res = await client.getPickupSlots(requestedDate ?? undefined, siteId);
        if (cancelled) return;
        setDay(res);
        // Drop a selection the server no longer offers — the day changed under us, or the slot filled while
        // the customer was composing their items. Re-point at the fresh object so `remaining` stays current.
        setPickupSlot((cur) => {
          if (!cur) return null;
          const fresh = res.slots.find((s) => s.label === cur.label && s.start === cur.start);
          return fresh && fresh.available ? fresh : null;
        });
      } catch (e) {
        // Keep the last good `day` so the date strip survives one bad day and the customer can tap another.
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
        const [svc] = await Promise.all([client.getServices(), loadSites(card?.preselectSiteId)]);
        setServices(svc.services);
        // Keep the card's pre-selected service; otherwise default to the first service.
        if (!card?.serviceId && svc.services[0]) setServiceId(svc.services[0].id);
      } catch (e) {
        setLoadError(e instanceof ApiError ? e.message : 'Could not load the booking options.');
      } finally {
        setLoading(false);
      }
    })();
    // Separate, non-blocking: any failure just hides the badge — booking is never blocked or faked.
    (async () => {
      try {
        const res = await client.listMyMemberships();
        const active = res.memberships.find((m) => m.status === 'ACTIVE');
        if (active) setCorpAccountName(active.accountName);
      } catch {
        // degrade silently — no membership badge
      }
    })();
    // The visual dry-clean catalog (server-resolved prices) — non-blocking; a failure just hides the picker.
    (async () => {
      try {
        setDryclean(await client.getDrycleanCatalog());
      } catch {
        // degrade silently — the specialty composer still books
      }
    })();
  }, [client]);

  // [Inc-26] Re-read the picker whenever Book regains focus — the customer may have just added an address
  // (AddressForm hands the new id back as `preselectSiteId`) or removed one. Uses the navigation prop's
  // `focus` event rather than `useFocusEffect`, which needs a NavigationContainer in the React tree and so
  // cannot run in a plain screen unit test. The first focus fires right after mount, which the effect above
  // already covered, so it is skipped.
  const firstFocus = useRef(true);
  const preselectSiteId = route?.params?.preselectSiteId;
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      // A failure here leaves the previous picker on screen; the mount path owns the error state.
      void loadSites(preselectSiteId).catch(() => undefined);
    });
    return unsubscribe;
  }, [navigation, loadSites, preselectSiteId]);

  // [Inc-17] Catalog selections feed the SAME draft-item list (unit ITEM, one line per garment type, qty in
  // estimatedMeasure) — no parallel cart. The picker's +/- adds/removes one unit of a catalog serviceId.
  const catalogQtyFor = useCallback((sid: string) => items.find((i) => i.serviceId === sid)?.estimatedMeasure ?? 0, [items]);
  const addCatalog = useCallback((sid: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.serviceId === sid);
      const cur = idx >= 0 ? prev[idx] : undefined;
      if (cur) {
        const next = [...prev];
        next[idx] = { ...cur, estimatedMeasure: (cur.estimatedMeasure ?? 0) + 1 };
        return next;
      }
      return [...prev, { kind: ItemKind.GARMENT, serviceId: sid, estimatedMeasure: 1 }];
    });
  }, []);
  const removeCatalog = useCallback((sid: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.serviceId === sid);
      const cur = idx >= 0 ? prev[idx] : undefined;
      if (!cur) return prev;
      const qty = (cur.estimatedMeasure ?? 0) - 1;
      if (qty <= 0) return prev.filter((_, i) => i !== idx);
      const next = [...prev];
      next[idx] = { ...cur, estimatedMeasure: qty };
      return next;
    });
  }, []);

  const addItem = useCallback(() => {
    if (!serviceId) return;
    const m = Number(measure);
    setItems((prev) => [...prev, { kind, serviceId, estimatedMeasure: Number.isFinite(m) && m > 0 ? m : undefined }]);
    setMeasure('');
    fireHaptic('success');
  }, [kind, serviceId, measure]);

  const submit = useCallback(async () => {
    if (!accountId) {
      setSubmitError('Your account is not set up for booking yet.');
      return;
    }
    // [Inc-28] A booking carries the window the SERVER offered and the customer picked. The button is already
    // disabled without one; this guard means no future refactor of the label logic can smuggle a booking
    // through with a fabricated window.
    if (!pickupSlot) {
      setSubmitError('Choose a pickup time first.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setOutOfArea(null);
    if (!idemKeyRef.current) idemKeyRef.current = newIdempotencyKey();
    // [Inc-19] Send the selected site's service point so the SERVER can geo-block (the app never decides).
    const selectedSite = sites.find((s) => s.id === siteId);
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
      // [Inc-19] Out of service area (422): a calm, server-driven "we don't serve here yet" state — NOT a red
      // crash. The server already captured the address as demand; we surface only what the 422 confirms (we do
      // not invent a "you're on the list" promise). Keep the idempotency key for other errors so a retry de-dupes.
      if (e instanceof ApiError && e.isOutOfServiceArea) {
        setOutOfArea({ address: selectedSite?.address ?? null });
      } else {
        setSubmitError(e instanceof Error ? e.message : 'Could not book. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [accountId, siteId, sites, items, pickupSlot, client, navigation]);

  const catalogById = new Map((dryclean?.categories ?? []).flatMap((c) => c.items).map((i) => [i.id, i]));
  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? catalogById.get(id)?.name ?? id.slice(0, 8);
  const selectedService = services.find((s) => s.id === serviceId);
  const rateFor = (id: string): number => {
    const svc = services.find((s) => s.id === id);
    if (svc) return Number(svc.baseRate);
    return Number(catalogById.get(id)?.price ?? 0);
  };
  const estimate = estimateRange(items, rateFor);

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

      <Card title={card?.serviceName ? `Book ${card.serviceName}` : 'What needs cleaning?'}>
        {card?.serviceName ? (
          // [Inc-23] Focused card booking — the service is chosen (from the tapped Home card); the customer
          // just adds the size/count. The full item-type + service pickers are for the general composer.
          <Text testID="book-card-service" variant="footnote" color="secondary" style={styles.help}>
            {cardSizeHelp(card.unit)}
          </Text>
        ) : (
          <>
            <Text variant="footnote" color="secondary" style={styles.help}>
              Pick an item type and the service for it.
            </Text>
            <View style={styles.chips}>
              {ITEM_KINDS.map((k) => (
                <Chip key={k} testID={`kind-${k}`} label={titleCase(k)} icon={KIND_ICON[k]} selected={kind === k} onPress={() => setKind(k)} />
              ))}
            </View>

            <Text variant="subhead" weight="600" style={styles.sectionLabel}>
              Service
            </Text>
            <View style={styles.chips}>
              {services.map((s) => (
                <Chip key={s.id} testID={`service-${s.id}`} label={s.name} selected={serviceId === s.id} onPress={() => setServiceId(s.id)} />
              ))}
            </View>
          </>
        )}

        <Text variant="subhead" weight="600" style={styles.sectionLabel}>
          {card?.unit ? cardSizeLabel(card.unit) : `Approx. size ${selectedService ? `(${selectedService.unit.toLowerCase()})` : ''}`}
        </Text>
        <View style={styles.measureRow}>
          <View
            style={[
              styles.measureField,
              { backgroundColor: colors.surface, borderColor: colors.hairline, borderRadius: 12 },
            ]}
          >
            <MeasureInput value={measure} onChangeText={setMeasure} />
          </View>
          <Button testID="add-item" label="Add" icon="plus" variant="outline" size="md" onPress={addItem} disabled={!serviceId} fullWidth={false} haptic="none" />
        </View>
      </Card>

      {/* The dry-clean garment picker is for the general composer (or the Dry Cleaning drill-in), not a focused card book. */}
      {!card?.serviceId && dryclean ? <DrycleanPicker catalog={dryclean} qtyFor={catalogQtyFor} onAdd={addCatalog} onRemove={removeCatalog} /> : null}

      {items.length > 0 ? (
        <Card title={`Items to book (${items.length})`}>
          {items.map((it, i) => (
            <View key={i} testID={`draft-item-${i}`} style={[styles.itemRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }]}>
              <View style={[styles.itemIcon, { backgroundColor: colors.azureTint }]}>
                <Feather name={KIND_ICON[it.kind] ?? 'box'} size={16} color={colors.azure} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="subhead" weight="500">
                  {titleCase(it.kind)} · {serviceName(it.serviceId)}
                </Text>
                {it.estimatedMeasure ? (
                  <Text variant="footnote" color="secondary">
                    ~{it.estimatedMeasure} {selectedService?.unit.toLowerCase() ?? ''}
                  </Text>
                ) : null}
              </View>
              <Pressable onPress={() => setItems((p) => p.filter((_, idx) => idx !== i))} hitSlop={14} accessibilityLabel="Remove item">
                <Feather name="x" size={18} color={colors.textTertiary} />
              </Pressable>
            </View>
          ))}
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
              <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
                Final quote confirmed after measurement at the plant.
              </Text>
            </View>
          ) : null}
        </Card>
      ) : null}

      {/* [Inc-26] A customer with no saved address used to see NOTHING here (the card was hidden), leaving
          them unable to book and with no way to add one. Now the zero-state IS the call to action. */}
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
                onPress={() => {
                  fireHaptic('selection');
                  setSiteId(s.id);
                }}
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

      {/* [Inc-28] The real picker: the org's saved windows for a day the server says is bookable. */}
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

      {/* [Inc-26] A booking without a `siteId` has nowhere to collect from; [Inc-28] one without a chosen slot
          has no time. The button names whichever is missing rather than failing at the server — and, unlike
          the Switch it replaced, it can no longer send a window nobody agreed to. */}
      <Button
        testID="submit-booking"
        label={
          items.length === 0
            ? 'Add an item to book'
            : !siteId
              ? 'Add an address to book'
              : !pickupSlot
                ? 'Choose a pickup time'
                : `Book ${items.length} item${items.length > 1 ? 's' : ''}`
        }
        icon="check"
        onPress={() => void submit()}
        busy={submitting}
        disabled={submitting || items.length === 0 || !siteId || !pickupSlot}
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

/** A selectable Daylight chip. */
function Chip({
  label,
  icon,
  selected,
  onPress,
  testID,
}: {
  label: string;
  icon?: React.ComponentProps<typeof Feather>['name'];
  selected: boolean;
  onPress: () => void;
  testID?: string;
}): React.ReactElement {
  const { colors, radius } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        fireHaptic('selection');
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          borderRadius: radius.pill,
          backgroundColor: selected ? colors.azure : colors.surface,
          borderColor: selected ? colors.azure : colors.hairline,
        },
      ]}
    >
      {icon ? <Feather name={icon} size={15} color={selected ? colors.onAzure : colors.textSecondary} style={{ marginRight: 6 }} /> : null}
      <Text variant="subhead" weight={selected ? '600' : '500'} style={{ color: selected ? colors.onAzure : colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The size input — kept as a host TextInput carrying testID="measure-input" (test contract). */
function MeasureInput({ value, onChangeText }: { value: string; onChangeText: (t: string) => void }): React.ReactElement {
  const { colors, type } = useTheme();
  return (
    <TextInput
      testID="measure-input"
      value={value}
      onChangeText={onChangeText}
      placeholder="e.g. 40"
      placeholderTextColor={colors.textTertiary}
      keyboardType="decimal-pad"
      style={{ flex: 1, color: colors.text, fontSize: type.body.fontSize, paddingVertical: 13 }}
    />
  );
}

/** Rough pre-intake estimate range from the staged items × the catalog base rates (±client preview). */
/** Rough pre-intake preview from staged items × a rate lookup (specialty base OR the server-resolved
 *  catalog price). The final quote is computed server-side (this is a client-side estimate only). */
function estimateRange(items: DraftItem[], rateOf: (serviceId: string) => number): { low: string; high: string } | null {
  let cents = 0;
  let any = false;
  for (const it of items) {
    if (!it.estimatedMeasure) continue;
    cents += Math.round(it.estimatedMeasure * rateOf(it.serviceId) * 100);
    any = true;
  }
  if (!any) return null;
  return { low: ((cents / 100) * 0.9).toFixed(2), high: ((cents / 100) * 1.15).toFixed(2) };
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/**
 * [Inc-23] Size input label for a focused card booking, by the card's pricing unit. The value becomes the
 * line's `estimatedMeasure`, which is always expressed in the BACKING SERVICE's own unit — so a PER_LB card
 * asks for pounds [Inc-24] even though the plant/driver scale captures kilograms.
 */
function cardSizeLabel(unit: PricingUnit | undefined): string {
  switch (unit) {
    case PricingUnit.PER_KG:
      return 'Approx. weight (kg) — optional';
    case PricingUnit.PER_LB:
      return 'Approx. weight (lb) — optional';
    case PricingUnit.PER_ITEM:
      return 'How many items?';
    case PricingUnit.PER_MEASURE:
    default:
      return 'Approx. size';
  }
}
/** [Inc-23] Helper copy under a focused card booking, by the card's pricing unit. */
function cardSizeHelp(unit: PricingUnit | undefined): string {
  switch (unit) {
    case PricingUnit.PER_KG:
    case PricingUnit.PER_LB:
      return 'We weigh your load at pickup — an estimate here is optional.';
    case PricingUnit.PER_ITEM:
      return 'Add how many items you’re sending; we confirm at intake.';
    case PricingUnit.PER_MEASURE:
    default:
      return 'Add a rough size; the final price is confirmed after we measure at pickup.';
  }
}

const styles = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  help: { marginBottom: 12 },
  sectionLabel: { marginTop: 18, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 16, borderWidth: 1.5 },
  measureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  measureField: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, minHeight: 50 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  itemIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  estimateBox: { borderRadius: 12, padding: 14, marginTop: 14 },
  estimateTop: { flexDirection: 'row', alignItems: 'center' },
  siteRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 12, padding: 14, marginBottom: 8 },
  errorBox: { borderRadius: 12, padding: 12, marginTop: 12 },
  outOfAreaBox: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 12 },
});
