import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError } from '@blue-bee/api-client';
import { useFocusEffect, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { useSession } from '../session/SessionProvider';
import type { OrderDetail } from '../api/types';
import type { RootStackParamList } from '../navigation';
import { isRateable } from '../orders/rating';
import { orderRef, shortDate } from '../format';
import { StarRating } from '../components/StarRating';
import { useTheme } from '../../theme';
import { Button, Card, Hero, IconBadge, Text, fireHaptic } from '../../components/ui';

type Nav = NavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Rate'>;

const STAR_WORDS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];

/**
 * [Inc-32] Rate a delivered order (PRD A6.3) — a 1–5 star score + an optional comment. The server is the
 * authority: eligibility (delivered-or-later), ownership, and one-per-order are enforced there, so this
 * screen only offers what the loaded order allows and surfaces the server's 4xx honestly. An already-rated
 * order shows the score read-only (with an Edit affordance while the original submitter is inside the
 * edit window); a new one shows the form.
 *
 * [Royal restyle] A gold star-hero band (IconBadge + order ref, matching the Track/Dashboard brand-header
 * motif) once the order is loaded, then a soft-elevated Card for whichever of the four states applies —
 * the not-yet-rateable notice, the interactive form, or the read-only submitted score. Every client call,
 * testID and state below is unchanged from Inc-32; this pass is presentation only.
 */
export function RateScreen({ navigation, route }: { navigation: Nav; route: Route }): React.ReactElement {
  const { orderId } = route.params;
  const { client, me } = useSession();
  const { colors, space, type } = useTheme();

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const o = await client.getOrder(orderId);
      setOrder(o);
      // Prefill from an existing rating (edit flow); otherwise a blank form.
      if (o.rating) {
        setScore(o.rating.score);
        setComment(o.rating.comment ?? '');
      }
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not load this order.');
    } finally {
      setLoading(false);
    }
  }, [client, orderId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const existing = order?.rating ?? null;
  const mineAndEditable = !!existing && existing.editable && existing.submittedByUserId === me?.user.userId;
  // Show the form to CREATE (no rating yet) or to EDIT your own within the window; otherwise read-only.
  const showForm = !!order && isRateable(order) && (!existing || mineAndEditable);

  const submit = useCallback(async (): Promise<void> => {
    if (score < 1) return;
    setSubmitting(true);
    setError(null);
    fireHaptic('medium');
    const body = { score, comment: comment.trim() ? comment.trim() : undefined };
    try {
      if (existing) {
        await client.updateRating(orderId, { score, comment: comment.trim() ? comment.trim() : null });
      } else {
        await client.submitRating(orderId, body, `rate-${orderId}`);
      }
      fireHaptic('success');
      navigation.goBack(); // OrderDetail re-reads on focus and shows the submitted score read-only
    } catch (e) {
      // 409 = already rated (a concurrent submit / a stale form) → tell the customer plainly.
      if (e instanceof ApiError && e.isConflict) setError('This order has already been rated.');
      else setError(e instanceof ApiError ? e.message : 'Could not submit your rating.');
    } finally {
      setSubmitting(false);
    }
  }, [client, orderId, score, comment, existing, navigation]);

  if (loading)
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <ActivityIndicator testID="rate-loading" size="large" color={colors.azure} />
      </View>
    );
  if (loadError || !order)
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        <IconBadge icon="alert-circle" tone="danger" size={48} circle />
        <Text variant="headline" weight="600" center style={{ marginTop: 14 }}>
          {loadError ?? 'Order not found.'}
        </Text>
        <Button label="Try again" variant="outline" icon="refresh-cw" onPress={() => void load()} fullWidth={false} style={{ marginTop: 16 }} />
      </View>
    );

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Hero testID="rate-hero">
        <View style={styles.heroRow}>
          <IconBadge icon="star" tone="honey" size={44} />
          <View style={{ marginLeft: 12, flex: 1 }}>
            <Text variant="title3" weight="700" mono>
              {orderRef(order.id)}
            </Text>
            <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
              Delivered {shortDate(order.updatedAt)}
            </Text>
          </View>
        </View>
      </Hero>

      {!isRateable(order) ? (
        <Card testID="rate-not-yet" style={[styles.stateCard, { marginTop: space.lg }]}>
          <IconBadge icon="clock" tone="neutral" size={44} circle />
          <Text variant="headline" weight="600" center style={{ marginTop: 14 }}>
            Not ready to rate
          </Text>
          <Text variant="subhead" color="secondary" center style={{ marginTop: 6 }}>
            You can rate this order once it’s been delivered.
          </Text>
        </Card>
      ) : showForm ? (
        <Card title={existing ? 'Update your rating' : 'How did we do?'} style={{ marginTop: space.lg }}>
          <View style={styles.starsRow}>
            <StarRating value={score} onChange={setScore} size={38} testID="rate-stars" />
          </View>
          <Text testID="rate-word" variant="subhead" weight="600" center color={score > 0 ? 'primary' : 'tertiary'} style={{ marginTop: 10 }}>
            {score > 0 ? STAR_WORDS[score] : 'Tap a star'}
          </Text>

          <Text variant="footnote" weight="500" color="secondary" style={{ marginTop: space.lg, marginBottom: 8 }}>
            Comment (optional)
          </Text>
          <View style={[styles.commentBox, { borderColor: colors.hairline, backgroundColor: colors.subtle }]}>
            <TextInput
              testID="rate-comment"
              value={comment}
              onChangeText={setComment}
              placeholder="Tell us how it went…"
              placeholderTextColor={colors.textTertiary}
              multiline
              maxLength={1000}
              style={{ color: colors.text, fontSize: type.body.fontSize, minHeight: 84, textAlignVertical: 'top' }}
            />
          </View>

          {error ? (
            <View style={[styles.errorBox, { backgroundColor: colors.dangerTint }]}>
              <Feather name="alert-circle" size={16} color={colors.danger} />
              <Text testID="rate-error" variant="footnote" color="danger" style={{ marginLeft: 8, flex: 1 }}>
                {error}
              </Text>
            </View>
          ) : null}

          <Button
            testID="rate-submit"
            label={existing ? 'Update rating' : 'Submit rating'}
            icon="star"
            tone="azure"
            onPress={() => void submit()}
            busy={submitting}
            disabled={submitting || score < 1}
            haptic="none"
            style={{ marginTop: space.lg }}
          />
        </Card>
      ) : existing ? (
        <Card style={[styles.stateCard, { marginTop: space.lg }]}>
          <IconBadge icon="star" tone="honey" size={48} circle />
          <Text variant="headline" weight="700" center style={{ marginTop: 14 }}>
            Your rating
          </Text>
          <View style={[styles.starsRow, { marginTop: 12 }]}>
            <StarRating value={existing.score} size={30} testID="rate-readonly-stars" />
          </View>
          <Text testID="rate-readonly-score" variant="title3" weight="700" center tabular style={{ marginTop: 8 }}>
            {existing.score}/5
          </Text>
          {existing.comment ? (
            <View style={[styles.quoteBox, { backgroundColor: colors.subtle }]}>
              <Text testID="rate-readonly-comment" variant="subhead" color="secondary" center style={{ fontStyle: 'italic' }}>
                “{existing.comment}”
              </Text>
            </View>
          ) : null}
          <Text variant="footnote" color="tertiary" center style={{ marginTop: 12 }}>
            {existing.editable ? 'Thanks for your feedback.' : 'This rating can no longer be changed.'}
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  stateCard: { alignItems: 'center', paddingVertical: 28 },
  starsRow: { alignItems: 'center', marginTop: 6 },
  commentBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12 },
  errorBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, marginTop: 14 },
  quoteBox: { marginTop: 12, borderRadius: 12, padding: 14, alignSelf: 'stretch' },
});
