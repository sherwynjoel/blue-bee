import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSession } from '../session/SessionProvider';

/**
 * Shown when a signed-in principal is NOT an owner (RBAC gate, §17.3). The owner cockpit is the
 * owner's; ops/finance/customers use their own surfaces. The server also enforces this on every read
 * (a non-owner token → 403) — this is the friendly client mirror. Logout-even-offline stays available.
 */
export function NoAccessScreen(): React.ReactElement {
  const { logout, me } = useSession();
  return (
    <View style={styles.container} testID="no-access">
      <Text style={styles.title}>Owners only</Text>
      <Text style={styles.body}>
        {me?.user.name ? `Signed in as ${me.user.name}. ` : ''}This account doesn&apos;t have owner access to Blue
        Bee. If that&apos;s a mistake, ask your admin to grant the owner role.
      </Text>
      <TouchableOpacity style={styles.button} onPress={() => void logout()} testID="signout">
        <Text style={styles.buttonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#fff', gap: 14 },
  title: { fontSize: 24, fontWeight: '700', color: '#1f2937', textAlign: 'center' },
  body: { fontSize: 15, color: '#57606a', textAlign: 'center', lineHeight: 22 },
  button: { borderWidth: 1, borderColor: '#1f6feb', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#1f6feb', fontWeight: '600', fontSize: 16 },
});
