import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { io } from 'socket.io-client';
import { PhotoKind, WS_EVENTS, WS_NAMESPACES, type OrderWeightView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useFocusEffect, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import { API_BASE_URL } from '../config';
import type { OrderDetail, ItemView } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { StatusTimeline } from '../components/StatusTimeline';
import { CorporatePricingNote } from '../components/CorporatePricing';
import { StarRating } from '../components/StarRating';
import { hasActiveStop, preexistingDamageItems, quoteActionability } from '../orders/quote';
import { isRateable } from '../orders/rating';
import { capturePhotoToOrder, MediaCaptureError, type CaptureSource } from '../media/capture';
import { money, orderRef, rangeText, shortDate } from '../format';
import { useTheme } from '../../theme';
import { Badge, Button, Card, KeyValue, Divider, IconBadge, Sheet, SkeletonCard, StatusPill, Text, fireHaptic } from '../../components/ui';

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
  const { colors, space } = useTheme();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [weight, setWeight] = useState<OrderWeightView | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionTone, setActionTone] = useState<'success' | 'danger' | 'neutral'>('neutral');
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [photoSheet, setPhotoSheet] = useState<{ itemId: string; kind: PhotoKind } | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  const flash = (msg: string, tone: 'success' | 'danger' | 'neutral' = 'neutral') => {
    setActionMsg(msg);
    setActionTone(tone);
  };

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setOrder(await client.getOrder(orderId));
      // Best-effort chat unread for the badge; never blocks the order render.
      void client
        .getUnreadCount(orderId)
        .then((r) => setUnread(r.unreadCount))
        .catch(() => undefined);
      // [Inc-23 P4] Best-effort authoritative weight for the "Weighed X kg → $Y" line; never blocks.
      void client
        .getOrderWeight(orderId)
        .then(setWeight)
        .catch(() => undefined);
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

  // [Inc-23 P4] Live weight over the §12.2 token-scoped customer channel: when a driver approves a weigh at
  // an ACTIVE stop (→ a short-lived channel token), the order room pushes a `weight` event and we re-read so
  // "Weighed X kg → $Y" updates without a manual refresh. No token (e.g. a plant weigh with no active stop)
  // → the focus refetch stays the source of truth. The socket only listens; it never emits.
  useEffect(() => {
    let socket: ReturnType<typeof io> | null = null;
    let cancelled = false;
    void (async () => {
      try {
        // The ORDER-ROOM channel (same token the chat uses) — the gateway joins the order room for it, and
        // `weight` is emitted to the order room. The tracking token only joins vehicle/stop rooms, so it
        // would NOT receive order-level weight pushes.
        const channel = await client.getMessagesChannel(orderId);
        if (cancelled || !channel.channelToken) return;
        socket = io(`${API_BASE_URL}${WS_NAMESPACES.VEHICLE}`, { transports: ['websocket'], auth: { token: channel.channelToken }, reconnection: true, forceNew: true });
        socket.on(WS_EVENTS.WEIGHT, () => void load());
      } catch {
        // no active channel — the focus refetch covers it
      }
    })();
    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, [client, orderId, load]);

  const onApprove = useCallback(async () => {
    setActing(true);
    setActionMsg(null);
    fireHaptic('medium');
    try {
      setOrder(await client.approveQuote(orderId));
      fireHaptic('success');
      flash('Quote approved — we’ll start your cleaning.', 'success');
    } catch (e) {
      // 409 = the server's atomic claim moved (expired / already approved) → re-sync to truth.
      if (e instanceof ApiError && e.isConflict) {
        await load();
        flash(e.message || 'This quote changed; we’ve refreshed it.', 'neutral');
      } else {
        flash(e instanceof ApiError ? e.message : 'Could not approve the quote.', 'danger');
      }
    } finally {
      setActing(false);
    }
  }, [client, orderId, load]);

  const onDecline = useCallback(async () => {
    setDeclineOpen(false);
    setActing(true);
    setActionMsg(null);
    try {
      setOrder(await client.declineQuote(orderId));
      fireHaptic('warning');
      flash('Quote declined.', 'neutral');
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        await load();
        flash(e.message || 'This quote changed; we’ve refreshed it.', 'neutral');
      } else {
        flash(e instanceof ApiError ? e.message : 'Could not decline the quote.', 'danger');
      }
    } finally {
      setActing(false);
    }
  }, [client, orderId, load]);

  const addPhoto = useCallback(
    async (itemId: string, kind: PhotoKind, source: CaptureSource) => {
      setActionMsg(null);
      setUploadingFor(itemId);
      try {
        const result = await capturePhotoToOrder(client, { orderId, itemId, kind }, source);
        if (result) {
          await load();
          fireHaptic('success');
          flash('Photo added.', 'success');
        }
      } catch (e) {
        if (e instanceof MediaCaptureError) flash(e.message, 'danger');
        else flash(e instanceof ApiError ? e.message : 'Could not add the photo.', 'danger');
      } finally {
        setUploadingFor(null);
      }
    },
    [client, orderId, load],
  );

  if (loading)
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="detail-loading">
        <View style={styles.loadingContent}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  if (error || !order)
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <Card style={styles.stateCard}>
          <IconBadge icon="alert-circle" tone="danger" size={48} />
          <Text variant="headline" weight="600" center style={{ marginTop: 14 }}>
            {error ?? 'Order not found.'}
          </Text>
          <Button testID="detail-retry" label="Try again" variant="outline" icon="refresh-cw" onPress={() => void load()} fullWidth={false} style={{ marginTop: 16 }} />
        </Card>
      </View>
    );

  const qa = quoteActionability(order);
  const damageItems = preexistingDamageItems(order);
  const showTrack = hasActiveStop(order);
  const est = order.totals?.estimateRange;

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.headerRow}>
        <View>
          <Text variant="title2" weight="700" mono>
            {orderRef(order.id)}
          </Text>
          <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
            Booked {shortDate(order.createdAt)}
          </Text>
        </View>
        <StatusPill status={order.status} />
      </View>

      {order.pricingAccount?.name ? <CorporatePricingNote accountName={order.pricingAccount.name} /> : null}

      {showTrack ? (
        <Pressable
          testID="track-cta"
          onPress={() => navigation.navigate('Track', { orderId })}
          accessibilityRole="button"
          accessibilityLabel="Track my truck"
        >
          <Card style={[styles.trackCta, { backgroundColor: colors.azure, borderColor: colors.azure }]}>
            <View style={styles.trackIcon}>
              <Feather name="truck" size={20} color={colors.onAzure} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="headline" weight="700" style={{ color: colors.onAzure }}>
                Track my truck
              </Text>
              <Text variant="footnote" style={{ color: colors.onAzure, opacity: 0.85, marginTop: 1 }}>
                Live location & ETA
              </Text>
            </View>
            <Feather name="chevron-right" size={22} color={colors.onAzure} />
          </Card>
        </Pressable>
      ) : null}

      <Pressable
        testID="chat-cta"
        onPress={() => navigation.navigate('Chat', { orderId })}
        accessibilityRole="button"
        accessibilityLabel={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
      >
        <Card style={styles.chatCta}>
          <IconBadge icon="message-circle" tone="azure" size={40} />
          <View style={{ flex: 1 }}>
            <Text variant="headline" weight="700">
              Messages
            </Text>
            <Text variant="footnote" color="secondary" style={{ marginTop: 1 }}>
              {showTrack ? 'Chat with your driver' : 'View your conversation'}
            </Text>
          </View>
          {unread > 0 ? <Badge testID="chat-unread" label={String(unread)} tone="azure" /> : <Feather name="chevron-right" size={22} color={colors.textTertiary} />}
        </Card>
      </Pressable>

      <Card title="Progress">
        <StatusTimeline status={order.status} heldFrom={order.heldFrom} />
      </Card>

      {/* [Inc-32] Post-delivery rating. Once the order is delivered-or-later: the submitted score read-only,
          or a "Rate this order" CTA into the Rate screen (server stays the authority on eligibility). */}
      {isRateable(order) ? (
        order.rating ? (
          <Card title="Your rating">
            <View style={styles.ratingRow}>
              <StarRating value={order.rating.score} size={22} testID="order-rating-stars" />
              <Text testID="order-rating-score" variant="subhead" weight="700" tabular>
                {order.rating.score}/5
              </Text>
            </View>
            {order.rating.comment ? (
              <Text testID="order-rating-comment" variant="footnote" color="secondary" style={{ marginTop: 6 }}>
                “{order.rating.comment}”
              </Text>
            ) : null}
            {order.rating.editable ? (
              <Button
                testID="edit-rating"
                label="Edit rating"
                icon="edit-2"
                variant="outline"
                size="sm"
                fullWidth={false}
                onPress={() => navigation.navigate('Rate', { orderId })}
                style={{ marginTop: 10 }}
              />
            ) : null}
          </Card>
        ) : (
          <Pressable testID="rate-cta" onPress={() => navigation.navigate('Rate', { orderId })} accessibilityRole="button" accessibilityLabel="Rate this order">
            <Card style={styles.chatCta}>
              <IconBadge icon="star" tone="honey" size={40} />
              <View style={{ flex: 1 }}>
                <Text variant="headline" weight="700">
                  Rate this order
                </Text>
                <Text variant="footnote" color="secondary" style={{ marginTop: 1 }}>
                  Your order was delivered — how did we do?
                </Text>
              </View>
              <Feather name="chevron-right" size={22} color={colors.textTertiary} />
            </Card>
          </Pressable>
        )
      ) : null}

      {/* [Inc-23 P4] The live "Weighed X kg → $Y" line for weight-priced (FIXED) services. No fake numbers:
          a pending state until a real weight exists; the specialty (FROM_MEASURED) quote card below handles
          approve/decline. Updates live off the §12.2 channel when a driver approves at an active stop. */}
      {weight && (weight.authoritativeWeightKg || weight.customerEstimate != null) ? (
        <Card title="Weight">
          {weight.authoritativeWeightKg ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text testID="order-weighed" variant="title3" weight="700" tabular>
                  Weighed {weight.authoritativeWeightKg} kg
                </Text>
                {weight.authoritativeWeighPoint ? <Badge label={weight.authoritativeWeighPoint} tone="azure" /> : null}
              </View>
              {order.totals?.total ? (
                <Text testID="order-weighed-price" variant="subhead" color="secondary" style={{ marginTop: 4 }}>
                  → {money(order.totals.total, order.totals?.currency)}
                </Text>
              ) : (
                <Text variant="footnote" color="tertiary" style={{ marginTop: 4 }}>
                  Pricing your order…
                </Text>
              )}
            </>
          ) : (
            <Text testID="order-weight-pending" variant="subhead" color="secondary">
              Weighing pending{weight.customerEstimate != null ? ` — you estimated ~${weight.customerEstimate} kg` : ''}.
            </Text>
          )}
        </Card>
      ) : null}

      {qa.quote ? (
        <Card title="Quote" titleAccessory={qa.approved ? <Badge label="Approved" tone="success" /> : qa.declined ? <Badge label="Declined" tone="danger" /> : qa.actionable ? <Badge label="Action needed" tone="honey" /> : undefined}>
          <KeyValue label="Subtotal" value={money(qa.quote.subtotal, order.totals?.currency)} />
          <KeyValue label="Tax (HST)" value={money(qa.quote.tax, order.totals?.currency)} />
          <Divider spacing={8} />
          <KeyValue label="Total" value={money(qa.quote.total, order.totals?.currency)} total />
          {qa.quote.expiresAt ? (
            <Text variant="footnote" color="tertiary" style={{ marginTop: 6 }}>
              Valid until {shortDate(qa.quote.expiresAt)}
            </Text>
          ) : null}

          {qa.approved ? (
            <View style={{ marginTop: space.md }}>
              <View style={styles.approvedRow}>
                <Feather name="check-circle" size={18} color={colors.success} />
                <Text testID="quote-approved" variant="subhead" weight="600" color="success" style={{ marginLeft: 6 }}>
                  Approved
                </Text>
              </View>
              {order.totals?.paymentStatus === 'PAID' ? (
                <View style={[styles.paidRow, { backgroundColor: colors.successTint }]}>
                  <Feather name="check-circle" size={18} color={colors.success} />
                  <Text testID="paid-badge" variant="subhead" weight="700" color="success" style={{ marginLeft: 6 }}>
                    Paid
                  </Text>
                </View>
              ) : order.totals?.paymentStatus === 'REFUNDED' ? (
                <Text testID="refunded-badge" variant="subhead" color="secondary" style={{ marginTop: 8 }}>
                  Refunded
                </Text>
              ) : order.totals?.paymentStatus === 'PARTIALLY_REFUNDED' ? (
                <Text testID="refunded-badge" variant="subhead" color="secondary" style={{ marginTop: 8 }}>
                  Partially refunded
                </Text>
              ) : (
                <Button
                  testID="pay-cta"
                  label={`Pay ${money(qa.quote.total, order.totals?.currency)}`}
                  icon="credit-card"
                  tone="azure"
                  onPress={() => navigation.navigate('Pay', { orderId })}
                  style={{ marginTop: space.md }}
                />
              )}
            </View>
          ) : qa.declined ? (
            <View style={styles.approvedRow}>
              <Feather name="x-circle" size={18} color={colors.danger} />
              <Text testID="quote-declined" variant="subhead" weight="600" color="danger" style={{ marginLeft: 6 }}>
                Declined
              </Text>
            </View>
          ) : qa.actionable ? (
            <View style={{ marginTop: space.md, gap: 10 }}>
              {qa.expired ? (
                <Text variant="footnote" color="warning">
                  This quote may have expired — we’ll confirm.
                </Text>
              ) : null}
              <Button testID="approve-quote" label="Approve quote" icon="check" tone="azure" onPress={() => void onApprove()} busy={acting} disabled={acting} haptic="none" />
              <Button testID="decline-quote" label="Decline" tone="danger" variant="outline" onPress={() => setDeclineOpen(true)} disabled={acting} haptic="none" />
              <Text variant="footnote" color="tertiary" center>
                You can pay after approving.
              </Text>
            </View>
          ) : null}
        </Card>
      ) : est ? (
        <Card title="Estimate">
          <Text variant="title2" weight="700" color="azure" tabular>
            {rangeText(est.low, est.high, est.currency)}
          </Text>
          <Text variant="footnote" color="secondary" style={{ marginTop: 4 }}>
            {est.basis ?? 'Rough pre-intake estimate; final quote after measurement.'}
          </Text>
        </Card>
      ) : null}

      {damageItems.length > 0 ? (
        <Card title="Pre-existing condition" titleAccessory={<IconBadge icon="info" tone="warning" size={30} />}>
          <View style={[styles.damageNotice, { backgroundColor: colors.warningTint }]}>
            <Text testID="damage-notice" variant="footnote" color="warning" style={{ lineHeight: 19 }}>
              We noted some pre-existing wear during intake — nothing caused by us. Please review the photo below so we’re on the same page.
            </Text>
          </View>
          {damageItems.map((it) => {
            const ack = it.inspections.find((ins) => ins.preexistingDamage);
            return (
              <View key={it.id} style={{ marginTop: 12 }}>
                <Text variant="footnote" color="secondary">
                  {it.kind} — {ack?.ackAt ? `acknowledged ${shortDate(ack.ackAt)}` : 'awaiting acknowledgement'}
                </Text>
                <PhotoRow item={it} onZoom={setZoom} />
              </View>
            );
          })}
        </Card>
      ) : null}

      <Card title="Items & photos">
        {order.items.map((it, i) => (
          <View
            key={it.id}
            testID={`item-${it.id}`}
            style={[styles.itemBlock, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline, paddingTop: 14 }]}
          >
            <View style={styles.itemHead}>
              <View style={styles.itemHeadLeft}>
                <IconBadge icon="package" tone="neutral" size={32} />
                <Text variant="subhead" weight="600" style={{ marginLeft: 10 }}>
                  {it.kind}
                </Text>
              </View>
              <Badge label={it.status.replace(/_/g, ' ').toLowerCase()} tone="neutral" />
            </View>
            <PhotoRow item={it} onZoom={setZoom} />
            {uploadingFor === it.id ? (
              <View style={styles.uploading}>
                <ActivityIndicator color={colors.azure} />
                <Text variant="footnote" color="secondary" style={{ marginLeft: 8 }}>
                  Uploading photo…
                </Text>
              </View>
            ) : (
              <View style={styles.photoActions}>
                <Button testID={`add-before-${it.id}`} label="Before" icon="camera" variant="outline" size="sm" fullWidth={false} onPress={() => setPhotoSheet({ itemId: it.id, kind: PhotoKind.BEFORE })} haptic="selection" />
                <Button testID={`add-after-${it.id}`} label="After" icon="camera" variant="outline" size="sm" fullWidth={false} onPress={() => setPhotoSheet({ itemId: it.id, kind: PhotoKind.AFTER })} haptic="selection" />
              </View>
            )}
          </View>
        ))}
      </Card>

      {actionMsg ? (
        <View
          style={[
            styles.actionMsgBox,
            { backgroundColor: actionTone === 'success' ? colors.successTint : actionTone === 'danger' ? colors.dangerTint : colors.subtle },
          ]}
        >
          <Feather
            name={actionTone === 'success' ? 'check-circle' : actionTone === 'danger' ? 'alert-circle' : 'info'}
            size={16}
            color={actionTone === 'success' ? colors.success : actionTone === 'danger' ? colors.danger : colors.textSecondary}
          />
          <Text
            testID="action-msg"
            variant="footnote"
            color={actionTone === 'success' ? 'success' : actionTone === 'danger' ? 'danger' : 'secondary'}
            style={{ marginLeft: 8, flex: 1 }}
          >
            {actionMsg}
          </Text>
        </View>
      ) : null}

      {/* Photo source picker */}
      <Sheet visible={!!photoSheet} onClose={() => setPhotoSheet(null)} title={`Add a ${photoSheet?.kind?.toLowerCase() ?? ''} photo`}>
        <Button
          label="Take a photo"
          icon="camera"
          onPress={() => {
            const t = photoSheet;
            setPhotoSheet(null);
            if (t) void addPhoto(t.itemId, t.kind, 'camera');
          }}
          style={{ marginBottom: 10 }}
        />
        <Button
          label="Choose from library"
          icon="image"
          variant="outline"
          onPress={() => {
            const t = photoSheet;
            setPhotoSheet(null);
            if (t) void addPhoto(t.itemId, t.kind, 'library');
          }}
        />
      </Sheet>

      {/* Decline confirmation */}
      <Sheet visible={declineOpen} onClose={() => setDeclineOpen(false)} title="Decline this quote?">
        <Text variant="subhead" color="secondary" style={{ marginBottom: 16 }}>
          We won’t start the cleaning. You can always book again later.
        </Text>
        <Button label="Decline quote" tone="danger" icon="x" onPress={() => void onDecline()} style={{ marginBottom: 10 }} />
        <Button label="Keep my quote" variant="ghost" tone="neutral" onPress={() => setDeclineOpen(false)} haptic="selection" />
      </Sheet>

      {/* Tap-to-zoom lightbox */}
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)} statusBarTranslucent>
        <Pressable style={styles.lightbox} onPress={() => setZoom(null)} accessibilityLabel="Close photo">
          {zoom ? <Image source={{ uri: zoom }} style={styles.lightboxImg} resizeMode="contain" /> : null}
          <View style={styles.lightboxClose}>
            <Feather name="x" size={24} color="#FFFFFF" />
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function PhotoRow({ item, onZoom }: { item: ItemView; onZoom: (uri: string) => void }): React.ReactElement {
  const { colors } = useTheme();
  const photos = item.photos.filter((p) => p.downloadUrl);
  if (photos.length === 0)
    return (
      <Text variant="footnote" color="tertiary" style={{ marginTop: 8 }}>
        No photos yet.
      </Text>
    );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoStrip} contentContainerStyle={{ gap: 8 }}>
      {photos.map((p) => (
        <Pressable key={p.id} onPress={() => onZoom(p.downloadUrl!)} accessibilityLabel={`${p.kind.toLowerCase()} photo`}>
          <Image testID={`photo-${p.id}`} source={{ uri: p.downloadUrl! }} style={[styles.photo, { backgroundColor: colors.subtle }]} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loadingContent: { padding: 20, gap: 14 },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  stateCard: { alignItems: 'center', paddingVertical: 28, width: '100%' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  trackCta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trackIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  chatCta: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  approvedRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  paidRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, marginTop: 10 },
  damageNotice: { borderRadius: 12, padding: 12 },
  itemBlock: { marginBottom: 14 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  itemHeadLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  photoStrip: { marginVertical: 8 },
  photo: { width: 96, height: 96, borderRadius: 12 },
  photoActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  uploading: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  actionMsgBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12 },
  lightbox: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  lightboxImg: { width: '92%', height: '80%' },
  lightboxClose: { position: 'absolute', top: 56, right: 24 },
});
