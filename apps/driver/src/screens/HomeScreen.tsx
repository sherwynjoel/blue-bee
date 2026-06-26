import React, { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ShiftStatus } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { SharingIndicator } from '../components/SharingIndicator';
import { ApiError } from '../api/problem';
import type { HomeProps } from '../navigation';

/**
 * "My shift" home — the driver starts/ends their shift (the GPS gate), sees the sharing indicator,
 * and jumps to the route. Location streams ONLY while the shift is ACTIVE (enforced in the tracker).
 */
export function HomeScreen({ navigation }: HomeProps): React.ReactElement {
  const { me, assignment, sharingLocation, startShift, endShift, logout, refreshAssignment } = useSession();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const shift = assignment?.shift ?? null;
  const route = assignment?.route ?? null;
  const isActive = shift?.status === ShiftStatus.ACTIVE;

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      await refreshAssignment();
    } catch (e) {
      Alert.alert('Refresh failed', e instanceof ApiError ? e.message : 'Please try again.');
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleShift(): Promise<void> {
    if (!shift) return;
    setBusy(true);
    try {
      if (isActive) await endShift(shift.id);
      else await startShift(shift.id);
    } catch (e) {
      Alert.alert('Shift', e instanceof ApiError ? e.message : 'Could not change the shift.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.flex}>
      <SharingIndicator visible={sharingLocation} />
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={styles.hello}>Hi {me?.user.name ?? 'driver'}</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Today's shift</Text>
          {shift ? (
            <>
              <Row label="Vehicle" value={shift.vehicleLabel ?? shift.vehicleId.slice(0, 8)} />
              <Row label="Status" value={shift.status} />
              <TouchableOpacity
                testID="toggle-shift"
                style={[styles.button, isActive ? styles.danger : styles.primary, busy && styles.disabled]}
                onPress={toggleShift}
                disabled={busy}
              >
                <Text style={styles.buttonText}>{isActive ? 'End shift' : 'Start shift'}</Text>
              </TouchableOpacity>
              {!isActive ? <Text style={styles.hint}>Starting your shift turns on location sharing.</Text> : null}
            </>
          ) : (
            <Text style={styles.empty}>No shift assigned yet. Pull to refresh.</Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>My route today</Text>
          {route ? (
            <>
              <Text style={styles.routeMeta}>
                {route.stops.length} stop{route.stops.length === 1 ? '' : 's'} · {route.status}
              </Text>
              <TouchableOpacity testID="open-route" style={[styles.button, styles.primary]} onPress={() => navigation.navigate('Route')}>
                <Text style={styles.buttonText}>View route &amp; stops</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.empty}>No route assigned yet.</Text>
          )}
        </View>

        <TouchableOpacity testID="settings" style={styles.settings} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.settingsText}>Settings</Text>
        </TouchableOpacity>

        <TouchableOpacity testID="logout" style={styles.logout} onPress={() => void logout()}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#f3f4f6' },
  content: { padding: 16, gap: 16 },
  hello: { fontSize: 22, fontWeight: '700', color: '#111827' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#374151' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  rowLabel: { color: '#6b7280' },
  rowValue: { color: '#111827', fontWeight: '600' },
  routeMeta: { color: '#374151' },
  button: { borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  primary: { backgroundColor: '#1f6feb' },
  danger: { backgroundColor: '#b91c1c' },
  disabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  hint: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  empty: { color: '#6b7280' },
  settings: { padding: 12, alignItems: 'center' },
  settingsText: { color: '#1f6feb', fontWeight: '600' },
  logout: { padding: 12, alignItems: 'center' },
  logoutText: { color: '#b91c1c', fontWeight: '600' },
});
