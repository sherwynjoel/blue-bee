import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { MembershipView } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../../theme';
import { Badge, Button, Card, Input, Text, fireHaptic } from '../../components/ui';

/**
 * Corporate pricing (Inc-16 — the customer-app surface for Inc-15's engine). Two pieces:
 *   • `CorporatePricingNote` — a small, read-only "Corporate pricing — [Account]" indicator the booking +
 *     order screens show when an order is priced on a corporate account. The NAME is always SERVER TRUTH
 *     (a redeemed membership, or the order's resolved pricing account) — the app never computes pricing.
 *   • `CorporatePricingSection` — the Settings card: lists the user's own active memberships and lets them
 *     redeem a join code (POST /v1/corporate/redeem). Idempotent; a bad/expired code is a server 400 →
 *     a clean inline error. A failed memberships load degrades silently (the rest of Settings still works).
 */

/** The read-only corporate-pricing indicator. `accountName` must come from the server. */
export function CorporatePricingNote({
  accountName,
  testID = 'corp-pricing-note',
  style,
}: {
  accountName: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={[styles.note, { backgroundColor: colors.azureTint }, style]}>
      <Feather name="award" size={15} color={colors.azure} />
      <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 6, flex: 1 }}>
        Corporate pricing — {accountName}
      </Text>
    </View>
  );
}

/** Settings card: the user's active memberships + a join-code redeem field. */
export function CorporatePricingSection(): React.ReactElement {
  const { client } = useSession();
  const { colors } = useTheme();
  const [memberships, setMemberships] = useState<MembershipView[]>([]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await client.listMyMemberships();
      setMemberships(res.memberships.filter((m) => m.status === 'ACTIVE'));
    } catch {
      // Degrade silently — corporate pricing is additive; never block Settings on this read.
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = useCallback(async (): Promise<void> => {
    const c = code.trim();
    if (!c) return;
    setBusy(true);
    setError(null);
    setJoined(null);
    try {
      const res = await client.redeemJoinCode({ code: c }); // idempotent server-side
      setJoined(res.accountName);
      setCode('');
      fireHaptic('success');
      await load();
    } catch (e) {
      // 400 invalid / expired code (server authority) → a clean inline error, never a crash or a fake join.
      setError(e instanceof ApiError ? e.message : 'That code could not be applied. Check it and try again.');
    } finally {
      setBusy(false);
    }
  }, [code, client, load]);

  const hasMemberships = memberships.length > 0;

  return (
    <Card title="Corporate pricing" testID="corp-section" style={styles.card}>
      {hasMemberships ? (
        <View style={{ gap: 8 }}>
          {memberships.map((m) => (
            <View key={m.id} testID={`corp-membership-${m.accountId}`} style={[styles.appliedRow, { backgroundColor: colors.azureTint }]}>
              <Feather name="award" size={16} color={colors.azure} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text variant="subhead" weight="600">
                  {m.accountName}
                </Text>
                <Text variant="footnote" color="secondary">
                  Your orders are priced on this account.
                </Text>
              </View>
              <Badge label="Applied" tone="success" />
            </View>
          ))}
        </View>
      ) : (
        <Text variant="footnote" color="secondary">
          Have a corporate or building code? Enter it to get your organization’s pricing.
        </Text>
      )}

      <Input
        testID="corp-code-input"
        label={hasMemberships ? 'Add another code' : 'Join code'}
        value={code}
        onChangeText={(t) => {
          setCode(t);
          setError(null);
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="e.g. MAPLELOFT"
        icon="key"
        containerStyle={{ marginTop: 12 }}
      />
      <Button
        testID="corp-apply"
        label="Apply code"
        icon="check"
        onPress={() => void apply()}
        busy={busy}
        disabled={busy || code.trim().length === 0}
        style={{ marginTop: 12 }}
        haptic="none"
      />

      {error ? (
        <View style={[styles.msgRow, { backgroundColor: colors.dangerTint }]}>
          <Feather name="alert-circle" size={16} color={colors.danger} />
          <Text testID="corp-error" variant="footnote" color="danger" style={{ marginLeft: 8, flex: 1 }}>
            {error}
          </Text>
        </View>
      ) : joined ? (
        <View style={[styles.msgRow, { backgroundColor: colors.successTint }]}>
          <Feather name="check-circle" size={16} color={colors.success} />
          <Text testID="corp-success" variant="footnote" color="success" weight="600" style={{ marginLeft: 8, flex: 1 }}>
            You’re on {joined} pricing.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 24 },
  note: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  appliedRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12 },
  msgRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, marginTop: 12 },
});
