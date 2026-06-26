import React from 'react';
import { View } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../theme';
import { Button, Icon, Text } from '../components/kit';

/**
 * Shown when a signed-in principal is NOT an owner (RBAC gate, §17.3). The owner cockpit is the
 * owner's; ops/finance/customers use their own surfaces. The server also enforces this on every read
 * (a non-owner token → 403) — this is the friendly client mirror. Logout-even-offline stays available.
 */
export function NoAccessScreen(): React.ReactElement {
  const t = useTheme();
  const { logout, me } = useSession();
  return (
    <View testID="no-access" style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 16, backgroundColor: t.color.canvas }}>
      <View style={{ alignSelf: 'center', width: 72, height: 72, borderRadius: 36, backgroundColor: t.color.honeyTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="lock" size={30} color={t.color.honeyInk} />
      </View>
      <Text variant="title2" center>
        Owners only
      </Text>
      <Text variant="subhead" color={t.color.textMuted} center style={{ lineHeight: 22 }}>
        {me?.user.name ? `Signed in as ${me.user.name}. ` : ''}This account doesn&apos;t have owner access to Blue
        Bee. If that&apos;s a mistake, ask your admin to grant the owner role.
      </Text>
      <Button testID="signout" label="Sign out" onPress={() => void logout()} variant="secondary" icon="log-out" fullWidth style={{ marginTop: 8 }} />
    </View>
  );
}
