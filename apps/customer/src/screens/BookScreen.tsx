import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ItemKind, type CustomerSite, type ServiceCatalogItem } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { buildBookDto, newIdempotencyKey, tomorrowMorningWindow, type DraftItem } from '../orders/booking';
import { rangeText } from '../format';

const ITEM_KINDS: ItemKind[] = [ItemKind.RUG, ItemKind.CARPET, ItemKind.BLIND, ItemKind.UPHOLSTERY, ItemKind.GARMENT];

/** Book a specialty job (PRD §7A A2.1): pick service + items + site + pickup window → POST /v1/orders. */
export function BookScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Book'>): React.ReactElement {
  const { client, me } = useSession();
  const accountId = me?.user.accountIds[0];

  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  }, [client]);

  const addItem = useCallback(() => {
    if (!serviceId) return;
    const m = Number(measure);
    setItems((prev) => [...prev, { kind, serviceId, estimatedMeasure: Number.isFinite(m) && m > 0 ? m : undefined }]);
    setMeasure('');
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

  if (loading) return <ActivityIndicator testID="book-loading" style={styles.center} size="large" color="#1f6feb" />;
  if (loadError)
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{loadError}</Text>
      </View>
    );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.section}>Item type</Text>
      <View style={styles.chips}>
        {ITEM_KINDS.map((k) => (
          <TouchableOpacity
            key={k}
            testID={`kind-${k}`}
            style={[styles.chip, kind === k && styles.chipOn]}
            onPress={() => setKind(k)}
          >
            <Text style={[styles.chipText, kind === k && styles.chipTextOn]}>{titleCase(k)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>Service</Text>
      <View style={styles.chips}>
        {services.map((s) => (
          <TouchableOpacity
            key={s.id}
            testID={`service-${s.id}`}
            style={[styles.chip, serviceId === s.id && styles.chipOn]}
            onPress={() => setServiceId(s.id)}
          >
            <Text style={[styles.chipText, serviceId === s.id && styles.chipTextOn]}>{s.name}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>Approx. size {selectedService ? `(${selectedService.unit.toLowerCase()})` : ''}</Text>
      <TextInput
        testID="measure-input"
        style={styles.input}
        value={measure}
        onChangeText={setMeasure}
        placeholder="e.g. 40"
        keyboardType="decimal-pad"
      />

      <TouchableOpacity testID="add-item" style={styles.secondaryBtn} onPress={addItem} disabled={!serviceId}>
        <Text style={styles.secondaryBtnText}>+ Add item</Text>
      </TouchableOpacity>

      {items.length > 0 ? (
        <View style={styles.itemsBox}>
          <Text style={styles.section}>Items to book</Text>
          {items.map((it, i) => (
            <View key={i} style={styles.itemRow} testID={`draft-item-${i}`}>
              <Text style={styles.itemText}>
                {titleCase(it.kind)} · {serviceName(it.serviceId)}
                {it.estimatedMeasure ? ` · ~${it.estimatedMeasure}` : ''}
              </Text>
              <TouchableOpacity onPress={() => setItems((p) => p.filter((_, idx) => idx !== i))}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            </View>
          ))}
          {estimate ? (
            <Text testID="estimate" style={styles.estimate}>
              Rough estimate: {rangeText(estimate.low, estimate.high)} — final quote after measurement
            </Text>
          ) : null}
        </View>
      ) : null}

      {sites.length > 0 ? (
        <>
          <Text style={styles.section}>Pickup / delivery address</Text>
          {sites.map((s) => (
            <TouchableOpacity
              key={s.id}
              testID={`site-${s.id}`}
              style={[styles.siteRow, siteId === s.id && styles.siteRowOn]}
              onPress={() => setSiteId(s.id)}
            >
              <Text style={styles.siteName}>{s.name}</Text>
              {s.address ? <Text style={styles.siteAddr}>{s.address}</Text> : null}
            </TouchableOpacity>
          ))}
        </>
      ) : null}

      <View style={styles.switchRow}>
        <Text style={styles.section}>Schedule a pickup window (tomorrow AM)</Text>
        <Switch testID="schedule-toggle" value={schedulePickup} onValueChange={setSchedulePickup} />
      </View>

      <TouchableOpacity
        testID="submit-booking"
        style={[styles.primaryBtn, (submitting || items.length === 0) && styles.btnDisabled]}
        onPress={() => void submit()}
        disabled={submitting || items.length === 0}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Book {items.length} item(s)</Text>}
      </TouchableOpacity>

      {submitError ? (
        <Text testID="book-error" style={styles.error}>
          {submitError}
        </Text>
      ) : null}
    </ScrollView>
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
  container: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  section: { fontSize: 15, fontWeight: '600', color: '#1f2328', marginTop: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#d0d7de', borderRadius: 16, paddingVertical: 8, paddingHorizontal: 14 },
  chipOn: { backgroundColor: '#1f6feb', borderColor: '#1f6feb' },
  chipText: { color: '#1f2328' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, padding: 12, fontSize: 16 },
  secondaryBtn: { borderWidth: 1, borderColor: '#1f6feb', borderRadius: 8, padding: 12, alignItems: 'center', marginTop: 8 },
  secondaryBtnText: { color: '#1f6feb', fontWeight: '600' },
  itemsBox: { backgroundColor: '#f6f8fa', borderRadius: 10, padding: 12, marginTop: 8 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  itemText: { color: '#1f2328', flex: 1 },
  removeText: { color: '#b91c1c' },
  estimate: { marginTop: 8, color: '#1a7f37', fontWeight: '600' },
  siteRow: { borderWidth: 1, borderColor: '#d0d7de', borderRadius: 8, padding: 12, marginTop: 6 },
  siteRowOn: { borderColor: '#1f6feb', backgroundColor: '#ddf4ff' },
  siteName: { fontWeight: '600', color: '#1f2328' },
  siteAddr: { color: '#57606a', marginTop: 2 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  primaryBtn: { backgroundColor: '#1f6feb', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 20 },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  error: { color: '#b91c1c', marginTop: 12, textAlign: 'center' },
});
