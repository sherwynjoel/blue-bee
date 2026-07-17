import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ApiError } from '@blue-bee/api-client';
import type { ReferralView, ReferralsView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { shortDate } from '../format';
import { useTheme } from '../../theme';
import { Button, Card, EmptyState, Hero, IconBadge, SkeletonCard, Text, fireHaptic } from '../../components/ui';

/**
 * [Inc-34] Refer tab — invite friends to Royal Dry Cleaning & Laundry with my personal code, and see
 * who joined via it. [Royal restyle] Hero band carries the invite code + Share CTA; the joined list
 * below follows the Dashboard "section header + Card padding=0 hairline rows" pattern. Data/refetch
 * wiring, testIDs and states are unchanged from Inc-34.
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
      ? `Join me on Royal Dry Cleaning & Laundry for laundry & specialty cleaning — use my code ${referral.code}: ${referral.shareUrl}`
      : `Join me on Royal Dry Cleaning & Laundry for laundry & specialty cleaning — use my invite code ${referral.code} when you sign up.`;
    try {
      await Share.share({ message });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  }, [referral]);

  // Static brand head (icon + title/subtitle) — no remote data, safe to show in every state.
  const heroHead = (
    <View style={styles.head}>
      <IconBadge icon="gift" tone="honey" size={40} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text variant="title2" weight="700">
          Invite friends to Royal Dry Cleaning & Laundry
        </Text>
        <Text variant="subhead" color="secondary" style={{ marginTop: 4, lineHeight: 20 }}>
          Share your code. When a friend signs up with it, you’ll see them below.
        </Text>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]} testID="refer-loading">
        <View style={{ padding: 20 }}>
          <Hero testID="refer-hero">{heroHead}</Hero>
          <View style={{ marginTop: space.lg, gap: 16 }}>
            <SkeletonCard />
            <SkeletonCard />
          </View>
        </View>
      </View>
    );
  }

  if (error || !referral || !referrals) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <View style={{ padding: 20 }}>
          <Hero testID="refer-hero">{heroHead}</Hero>
        </View>
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
      {/* Invite hero — code + share. No reward stated or implied. */}
      <Hero testID="refer-hero">
        {heroHead}

        <View style={[styles.codeBox, { backgroundColor: colors.surface, borderColor: colors.hairline }]}>
          <Text variant="caption" color="tertiary">
            YOUR INVITE CODE
          </Text>
          <Text testID="refer-code" variant="title1" weight="700" mono style={{ marginTop: 4, letterSpacing: 2 }}>
            {referral.code}
          </Text>
        </View>

        <Button testID="refer-share" label="Share invite" icon="share-2" onPress={() => void onShare()} style={{ marginTop: 16 }} haptic="medium" />
      </Hero>

      {/* Joined list — who came in via my code. */}
      <View style={{ marginTop: space.xxl }}>
        <View style={styles.sectionHead}>
          <Text variant="title3" weight="700">
            Friends who joined
          </Text>
          <Text testID="refer-joined-count" variant="subhead" weight="700" color="secondary">
            {referrals.count}
          </Text>
        </View>

        {referrals.joiners.length === 0 ? (
          <Card>
            <EmptyState
              testID="refer-empty"
              icon="users"
              title="No one’s joined yet"
              body="Share your code to invite friends to Royal Dry Cleaning & Laundry."
            />
          </Card>
        ) : (
          <Card padding={0}>
            {referrals.joiners.map((j, i) => (
              <View
                key={j.userId}
                testID={`refer-joiner-${j.userId}`}
                style={[styles.joinerRow, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }]}
              >
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
          </Card>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  stateCard: { marginHorizontal: 20, marginTop: 8, alignItems: 'center', paddingVertical: 28 },
  head: { flexDirection: 'row', alignItems: 'center' },
  codeBox: { marginTop: 16, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  joinerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
