import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { PhotoKind } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useFocusEffect, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { OrderDetail, ItemView } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { StatusTimeline } from '../components/StatusTimeline';
import { hasActiveStop, preexistingDamageItems, quoteActionability } from '../orders/quote';
import { statusLabel } from '../orders/timeline';
import { capturePhotoToOrder, MediaCaptureError, type CaptureSource } from '../media/capture';
import { money, orderRef, rangeText, shortDate } from '../format';

type Nav = NavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'OrderDetail'>;

/**
 * Order detail (PRD §7A) — the §5.1 timeline (server state), the quote with approve/decline, the
 * pre-existing-damage acknowledgement notice + photo, the order's signed photos + before/after
 * capture, and a "Track my truck" entry when there's an active stop. Everything renders from the
 * scoped GET /v1/orders/:id (the customer's own order).
 */
export function OrderDetailScreen({ navigation, route }: { navigation: Nav; route: Route }): React.ReactElement {
  const { orderId } = route.params;
  const { client } = useSession();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setOrder(await client.getOrder(orderId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load this order.');
    } finally {
      setLoading(false);
    }
  }, [client, orderId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onApprove = useCallback(async () => {
    setActing(true);
    setActionMsg(null);
    try {
      setOrder(await client.approveQuote(orderId));
      setActionMsg('Quote approved — we’ll start your cleaning.');
    } catch (e) {
      // 409 = the server's atomic claim moved (expired / already approved) → re-sync to truth.
      if (e instanceof ApiError && e.isConflict) {
        await load();
        setActionMsg(e.message || 'This quote changed; we’ve refreshed it.');
      } else {
        setActionMsg(e instanceof ApiError ? e.message : 'Could not approve the quote.');
      }
    } finally {
      setActing(false);
    }
  }, [client, orderId, load]);

  const onDecline = useCallback(async () => {
    setActing(true);
    setActionMsg(null);
    try {
      setOrder(await client.declineQuote(orderId));
      setActionMsg('Quote declined.');
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        await load();
        setActionMsg(e.message || 'This quote changed; we’ve refreshed it.');
      } else {
        setActionMsg(e instanceof ApiError ? e.message : 'Could not decline the quote.');
      }
    } finally {
      setActing(false);
    }
  }, [client, orderId, load]);

  const addPhoto = useCallback(
    async (itemId: string, kind: PhotoKind, source: CaptureSource) => {
      setActionMsg(null);
      try {
        const result = await capturePhotoToOrder(client, { orderId, itemId, kind }, source);
        if (result) {
          await load();
          setActionMsg('Photo added.');
        }
      } catch (e) {
        if (e instanceof MediaCaptureError) setActionMsg(e.message);
        else setActionMsg(e instanceof ApiError ? e.message : 'Could not add the photo.');
      }
    },
    [client, orderId, load],
  );

  const promptPhoto = useCallback(
    (itemId: string, kind: PhotoKind) => {
      Alert.alert('Add photo', `Add a ${kind.toLowerCase()} photo`, [
        { text: 'Take photo', onPress: () => void addPhoto(itemId, kind, 'camera') },
        { text: 'Choose from library', onPress: () => void addPhoto(itemId, kind, 'library') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [addPhoto],
  );

  if (loading) return <ActivityIndicator testID="detail-loading" style={styles.center} size="large" color="#1f6feb" />;
  if (error || !order)
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Order not found.'}</Text>
        <TouchableOpacity onPress={() => void load()}>
          <Text style={styles.link}>Try again</Text>
        </TouchableOpacity>
      </View>
    );

  const qa = quoteActionability(order);
  const damageItems = preexistingDamageItems(order);
  const showTrack = hasActiveStop(order);
  const est = order.totals?.estimateRange;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.ref}>{orderRef(order.id)}</Text>
        <Text style={styles.badge}>{statusLabel(order.status)}</Text>
      </View>
      <Text style={styles.sub}>Booked {shortDate(order.createdAt)}</Text>

      {showTrack ? (
        <TouchableOpacity testID="track-cta" style={styles.trackCta} onPress={() => navigation.navigate('Track', { orderId })}>
          <Text style={styles.trackCtaText}>🚚 Track my truck</Text>
        </TouchableOpacity>
      ) : null}

      <Card title="Progress">
        <StatusTimeline status={order.status} heldFrom={order.heldFrom} />
      </Card>

      {qa.quote ? (
        <Card title="Quote">
          <Row label="Subtotal" value={money(qa.quote.subtotal, order.totals?.currency)} />
          <Row label="Tax" value={money(qa.quote.tax, order.totals?.currency)} />
          <Row label="Total" value={money(qa.quote.total, order.totals?.currency)} bold />
          {qa.quote.expiresAt ? <Text style={styles.muted}>Valid until {shortDate(qa.quote.expiresAt)}</Text> : null}

          {qa.approved ? (
            <Text testID="quote-approved" style={styles.approved}>✓ Approved</Text>
          ) : qa.declined ? (
            <Text testID="quote-declined" style={styles.declined}>Declined</Text>
          ) : qa.actionable ? (
            <View style={styles.quoteActions}>
              {qa.expired ? <Text style={styles.warn}>This quote may have expired — we’ll confirm.</Text> : null}
              <TouchableOpacity
                testID="approve-quote"
                style={[styles.approveBtn, acting && styles.btnDisabled]}
                onPress={() => void onApprove()}
                disabled={acting}
              >
                {acting ? <ActivityIndicator color="#fff" /> : <Text style={styles.approveBtnText}>Approve quote</Text>}
              </TouchableOpacity>
              <TouchableOpacity testID="decline-quote" style={styles.declineBtn} onPress={() => void onDecline()} disabled={acting}>
                <Text style={styles.declineBtnText}>Decline</Text>
              </TouchableOpacity>
              <Text style={styles.muted}>No payment is taken now.</Text>
            </View>
          ) : null}
        </Card>
      ) : est ? (
        <Card title="Estimate">
          <Text style={styles.estimate}>{rangeText(est.low, est.high, est.currency)}</Text>
          <Text style={styles.muted}>{est.basis ?? 'Rough pre-intake estimate; final quote after measurement.'}</Text>
        </Card>
      ) : null}

      {damageItems.length > 0 ? (
        <Card title="Pre-existing condition">
          <Text testID="damage-notice" style={styles.warn}>
            We noted pre-existing damage during intake. Please review the photo below.
          </Text>
          {damageItems.map((it) => {
            const ack = it.inspections.find((ins) => ins.preexistingDamage);
            return (
              <View key={it.id} style={{ marginTop: 8 }}>
                <Text style={styles.muted}>
                  {it.kind} — {ack?.ackAt ? `acknowledged ${shortDate(ack.ackAt)}` : 'awaiting acknowledgement'}
                </Text>
                <PhotoRow item={it} />
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card title="Items & photos">
        {order.items.map((it) => (
          <View key={it.id} style={styles.itemBlock} testID={`item-${it.id}`}>
            <Text style={styles.itemTitle}>
              {it.kind} · {it.status}
            </Text>
            <PhotoRow item={it} />
            <View style={styles.photoActions}>
              <TouchableOpacity testID={`add-before-${it.id}`} style={styles.photoBtn} onPress={() => promptPhoto(it.id, PhotoKind.BEFORE)}>
                <Text style={styles.photoBtnText}>+ Before</Text>
              </TouchableOpacity>
              <TouchableOpacity testID={`add-after-${it.id}`} style={styles.photoBtn} onPress={() => promptPhoto(it.id, PhotoKind.AFTER)}>
                <Text style={styles.photoBtnText}>+ After</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </Card>

      {actionMsg ? (
        <Text testID="action-msg" style={styles.actionMsg}>
          {actionMsg}
        </Text>
      ) : null}
    </ScrollView>
  );
}

function PhotoRow({ item }: { item: ItemView }): React.ReactElement | null {
  const photos = item.photos.filter((p) => p.downloadUrl);
  if (photos.length === 0) return <Text style={styles.muted}>No photos yet.</Text>;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip}>
      {photos.map((p) => (
        <Image key={p.id} testID={`photo-${p.id}`} source={{ uri: p.downloadUrl! }} style={styles.photo} />
      ))}
    </ScrollView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }): React.ReactElement {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, bold && styles.kvBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f8fa' },
  content: { padding: 16, gap: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ref: { fontSize: 22, fontWeight: '700', color: '#1f2328' },
  badge: { fontSize: 14, color: '#0969da', fontWeight: '600' },
  sub: { color: '#57606a', marginBottom: 8 },
  trackCta: { backgroundColor: '#1a7f37', borderRadius: 10, padding: 14, alignItems: 'center', marginVertical: 8 },
  trackCtaText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#eaeef2' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#1f2328', marginBottom: 10 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  kvLabel: { color: '#57606a' },
  kvValue: { color: '#1f2328' },
  kvBold: { fontWeight: '700' },
  muted: { color: '#57606a', marginTop: 4 },
  estimate: { fontSize: 18, fontWeight: '700', color: '#1a7f37' },
  approved: { color: '#1a7f37', fontWeight: '700', marginTop: 10, fontSize: 16 },
  declined: { color: '#cf222e', fontWeight: '700', marginTop: 10, fontSize: 16 },
  warn: { color: '#9a6700' },
  quoteActions: { marginTop: 12, gap: 8 },
  approveBtn: { backgroundColor: '#1f883d', borderRadius: 8, padding: 14, alignItems: 'center' },
  approveBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  declineBtn: { borderWidth: 1, borderColor: '#cf222e', borderRadius: 8, padding: 12, alignItems: 'center' },
  declineBtnText: { color: '#cf222e', fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  itemBlock: { marginBottom: 14 },
  itemTitle: { fontWeight: '600', color: '#1f2328', marginBottom: 6 },
  photoStrip: { flexDirection: 'row', marginVertical: 6 },
  photo: { width: 90, height: 90, borderRadius: 8, marginRight: 8, backgroundColor: '#eaeef2' },
  photoActions: { flexDirection: 'row', gap: 8 },
  photoBtn: { borderWidth: 1, borderColor: '#1f6feb', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  photoBtnText: { color: '#1f6feb', fontWeight: '600' },
  actionMsg: { textAlign: 'center', color: '#1f2328', marginTop: 14, fontStyle: 'italic' },
  link: { color: '#1f6feb' },
  error: { color: '#b91c1c', textAlign: 'center' },
});
