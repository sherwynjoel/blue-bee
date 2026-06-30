import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ItemKind, type CustomerSite, type ServiceCatalogItem } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { buildBookDto, newIdempotencyKey, tomorrowMorningWindow, type DraftItem } from '../orders/booking';
import { rangeText } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, Text, fireHaptic } from '../../components/ui';
import { CorporatePricingNote } from '../components/CorporatePricing';

const ITEM_KINDS: ItemKind[] = [ItemKind.RUG, ItemKind.CARPET, ItemKind.BLIND, ItemKind.UPHOLSTERY, ItemKind.GARMENT];

const KIND_ICON: Record<string, React.ComponentProps<typeof Feather>['name']> = {
  [ItemKind.RUG]: 'square',
  [ItemKind.CARPET]: 'grid',
  [ItemKind.BLIND]: 'sliders',
  [ItemKind.UPHOLSTERY]: 'inbox',
  [ItemKind.GARMENT]: 'shopping-bag',
};

/** Book a specialty job (PRD §7A A2.1): pick service + items + site + pickup window → POST /v1/orders. */
export function BookScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Book'>): React.ReactElement {
  const { client, me } = useSession();
  const { colors, space } = useTheme();
  const accountId = me?.user.accountIds[0];

  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // [Inc-16] Server truth: if the user holds an active corporate membership, their booking prices on that
  // account. The badge is informational; pricing itself is resolved server-side at booking (never here).
  // A building match (no membership) can't be known pre-booking — it surfaces on the order after booking.
  const [corpAccountName, setCorpAccountName] = useState<string | null>(null);

  // Composer for the current item + the staged item list.
  const [kind, setKind] = useState<ItemKind>(ItemKind.RUG);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [measure, setMeasure] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [siteId, setSiteId] = useState<string | undefined>(undefined);
  const [schedulePickup, setSchedulePickup] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Stable across retries → no double-booking on a timeout (server IdempotencyInterceptor).
  const idemKeyRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [svc, st] = await Promise.all([client.getServices(), client.getSites()]);
        setServices(svc.services);
        setSites(st.sites);
        if (svc.services[0]) setServiceId(svc.services[0].id);
        if (st.sites[0]) setSiteId(st.sites[0].id);
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
  }, [client]);

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
    setSubmitting(true);
    setSubmitError(null);
    if (!idemKeyRef.current) idemKeyRef.current = newIdempotencyKey();
    try {
      const dto = buildBookDto({
        accountId,
        siteId,
        items,
        pickupWindow: schedulePickup ? tomorrowMorningWindow() : undefined,
      });
      const order = await client.book(dto, idemKeyRef.current);
      idemKeyRef.current = null; // booked — a new attempt gets a fresh key
      navigation.replace('OrderDetail', { orderId: order.id });
    } catch (e) {
      // Keep the SAME idempotency key so a retry de-dupes server-side (no double order).
      setSubmitError(e instanceof Error ? e.message : 'Could not book. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [accountId, siteId, items, schedulePickup, client, navigation]);

  const serviceName = (id: string) => services.find((s) => s.id === id)?.name ?? id.slice(0, 8);
  const selectedService = services.find((s) => s.id === serviceId);
  const estimate = estimateRange(items, services);

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

      <Card title="What needs cleaning?">
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

        <Text variant="subhead" weight="600" style={styles.sectionLabel}>
          Approx. size {selectedService ? `(${selectedService.unit.toLowerCase()})` : ''}
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

      {sites.length > 0 ? (
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
        </Card>
      ) : null}

      <Card>
        <View style={styles.switchRow}>
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text variant="subhead" weight="600">
              Schedule a pickup
            </Text>
            <Text variant="footnote" color="secondary" style={{ marginTop: 1 }}>
              Tomorrow morning window.
            </Text>
          </View>
          <Switch
            testID="schedule-toggle"
            value={schedulePickup}
            onValueChange={(v) => {
              fireHaptic('selection');
              setSchedulePickup(v);
            }}
            trackColor={{ true: colors.azure, false: colors.hairline }}
            thumbColor="#FFFFFF"
            ios_backgroundColor={colors.hairline}
          />
        </View>
      </Card>

      <Button
        testID="submit-booking"
        label={items.length > 0 ? `Book ${items.length} item${items.length > 1 ? 's' : ''}` : 'Add an item to book'}
        icon="check"
        onPress={() => void submit()}
        busy={submitting}
        disabled={submitting || items.length === 0}
        style={{ marginTop: space.md }}
      />

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
function estimateRange(items: DraftItem[], services: ServiceCatalogItem[]): { low: string; high: string } | null {
  let cents = 0;
  let any = false;
  for (const it of items) {
    if (!it.estimatedMeasure) continue;
    const rate = Number(services.find((s) => s.id === it.serviceId)?.baseRate ?? 0);
    cents += Math.round(it.estimatedMeasure * rate * 100);
    any = true;
  }
  if (!any) return null;
  return { low: ((cents / 100) * 0.9).toFixed(2), high: ((cents / 100) * 1.15).toFixed(2) };
}

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  errorBox: { borderRadius: 12, padding: 12, marginTop: 12 },
});
