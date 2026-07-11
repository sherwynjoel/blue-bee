import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError } from '@blue-bee/api-client';
import type { ReferralView, ReferralsView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { shortDate } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, EmptyState, SkeletonCard, Text, fireHaptic } from '../../components/ui';

/**
 * [Inc-34] Refer tab — invite friends to Blue Bee with my personal code, and see who joined via it.
 *
 * HONESTY FIREWALL: no reward is wired anywhere yet, so this screen invites and tracks WITHOUT stating or
 * implying any reward — no "earn/get $X", no credit balance, no bonus, no unbacked promise. It shows the
 * code, a native Share action, and the joined-friends list/count. When a reward ledger is built later, the
 * copy and the grant become real together.
 */
export function ReferScreen(): React.ReactElement {
  const { client } = useSession();
  const { colors, space } = useTheme();

  const [referral, setReferral] = useState<ReferralView | null>(null);
  const [referrals, setReferrals] = useState<ReferralsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [r, rs] = await Promise.all([client.getReferral(), client.getReferrals()]);
      setReferral(r);
      setReferrals(rs);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your invite.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const onShare = useCallback(async (): Promise<void> => {
    if (!referral) return;
    fireHaptic('selection');
    // Invite copy — friendly, reward-free. Includes the deep link only when the server actually has one.
    const message = referral.shareUrl
      ? `Join me on Blue Bee for laundry & specialty cleaning — use my code ${referral.code}: ${referral.shareUrl}`
      : `Join me on Blue Bee for laundry & specialty cleaning — use my invite code ${referral.code} when you sign up.`;
    try {
      await Share.share({ message });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  }, [referral]);

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="refer-loading">
        <View style={{ padding: 20, gap: 16 }}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </View>
    );
  }

  if (error || !referral || !referrals) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <Card style={styles.stateCard}>
          <Feather name="wifi-off" size={26} color={colors.textTertiary} />
          <Text variant="headline" weight="600" center style={{ marginTop: 10 }}>
            Couldn’t load your invite
          </Text>
          <Text variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
            {error ?? 'Please try again.'}
          </Text>
          <Button testID="refer-retry" label="Try again" icon="refresh-cw" variant="outline" onPress={() => void load()} fullWidth={false} style={{ marginTop: 16 }} />
        </Card>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.canvas }}
      contentContainerStyle={{ padding: 20, paddingBottom: space.huge }}
      showsVerticalScrollIndicator={false}
    >
      {/* Invite card — code + share. No reward stated or implied. */}
      <Card>
        <View style={styles.head}>
          <View style={[styles.iconCircle, { backgroundColor: colors.azureTint }]}>
            <Feather name="user-plus" size={20} color={colors.azure} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text variant="headline" weight="700">
              Invite friends to Blue Bee
            </Text>
            <Text variant="footnote" color="secondary" style={{ marginTop: 2, lineHeight: 18 }}>
              Share your personal code. When a friend signs up with it, you’ll see them below.
            </Text>
          </View>
        </View>

        <View style={[styles.codeBox, { backgroundColor: colors.subtle, borderColor: colors.hairline }]}>
          <Text variant="caption" color="tertiary">
            YOUR INVITE CODE
          </Text>
          <Text testID="refer-code" variant="title1" weight="700" mono style={{ marginTop: 4, letterSpacing: 2 }}>
            {referral.code}
          </Text>
        </View>

        <Button testID="refer-share" label="Share invite" icon="share-2" onPress={() => void onShare()} style={{ marginTop: 16 }} haptic="medium" />
      </Card>

      {/* Joined list — who came in via my code. */}
      <Card style={{ marginTop: space.lg }}>
        <Text variant="headline" weight="700">
          Friends who joined
          <Text testID="refer-joined-count" variant="headline" weight="700" color="secondary">
            {`  ${referrals.count}`}
          </Text>
        </Text>

        {referrals.joiners.length === 0 ? (
          <View style={{ marginTop: 8 }}>
            <EmptyState
              testID="refer-empty"
              icon="users"
              title="No one’s joined yet"
              body="Share your code to invite friends to Blue Bee."
            />
          </View>
        ) : (
          <View style={{ marginTop: 8 }}>
            {referrals.joiners.map((j) => (
              <View key={j.userId} testID={`refer-joiner-${j.userId}`} style={[styles.joinerRow, { borderTopColor: colors.hairline }]}>
                <View style={[styles.avatar, { backgroundColor: colors.azureTint }]}>
                  <Text variant="subhead" weight="700" color="azure">
                    {j.name.trim()?.[0]?.toUpperCase() ?? '?'}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text variant="subhead" weight="600">
                    {j.name}
                  </Text>
                  <Text variant="caption" color="tertiary" style={{ marginTop: 1 }}>
                    Joined {shortDate(j.joinedAt)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  stateCard: { marginHorizontal: 20, marginTop: 24, alignItems: 'center', paddingVertical: 28 },
  head: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  codeBox: { marginTop: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center' },
  joinerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
