import React from 'react';
import { View } from 'react-native';
import { useSession } from '../session/SessionProvider';
import { Button, Text, useTheme } from '@blue-bee/ui';
import { Icon } from '../components/kit';

/**
 * Shown when a signed-in principal is NOT an owner (RBAC gate, §17.3). The owner cockpit is the
 * owner's; ops/finance/customers use their own surfaces. The server also enforces this on every read
 * (a non-owner token → 403) — this is the friendly client mirror. Logout-even-offline stays available.
 */
export function NoAccessScreen(): React.ReactElement {
  const t = useTheme();
  const { logout, me } = useSession();
  return (
    <View testID="no-access" style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 16, backgroundColor: t.colors.canvas }}>
      <View style={{ alignSelf: 'center', width: 72, height: 72, borderRadius: 36, backgroundColor: t.colors.honeyTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="lock" size={30} color={t.colors.onHoneyTint} />
      </View>
      <Text variant="title2" center>
        Owners only
      </Text>
      <Text variant="subhead" color={t.colors.textSecondary} center style={{ lineHeight: 22 }}>
        {me?.user.name ? `Signed in as ${me.user.name}. ` : ''}This account doesn&apos;t have owner access to Blue
        Bee. If that&apos;s a mistake, ask your admin to grant the owner role.
      </Text>
      <Button testID="signout" label="Sign out" onPress={() => void logout()} tone="neutral" variant="outline" size="md" icon="log-out" fullWidth style={{ marginTop: 8 }} />
    </View>
  );
}
