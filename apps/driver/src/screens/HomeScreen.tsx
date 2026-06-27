import React, { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { ShiftStatus } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { SharingIndicator } from '../components/SharingIndicator';
import { ApiError } from '../api/problem';
import { useTheme } from '../theme';
import { Badge, Button, Card, Field, Screen, Text, useToast } from '../components/kit';
import { haptics } from '../components/haptics';
import type { HomeProps } from '../navigation';

/**
 * "My shift" home — the driver starts/ends their shift (the GPS gate), sees the sharing indicator,
 * and jumps to the route. Location streams ONLY while the shift is ACTIVE (enforced in the tracker).
 */
export function HomeScreen({ navigation }: HomeProps): React.ReactElement {
  const t = useTheme();
  const { me, assignment, sharingLocation, startShift, endShift, logout, refreshAssignment } = useSession();
  const { toast, node: toastNode } = useToast();
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
      toast(e instanceof ApiError ? e.message : 'Could not refresh. Pull again.', 'danger');
    } finally {
      setRefreshing(false);
    }
  }

  async function toggleShift(): Promise<void> {
    if (!shift) return;
    setBusy(true);
    try {
      if (isActive) {
        await endShift(shift.id);
        haptics.warning();
        toast('Shift ended · location sharing off', 'neutral');
      } else {
        await startShift(shift.id);
        haptics.success();
        toast('Shift started · sharing your location', 'success');
      }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not change the shift.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.color.canvas }}>
      <SharingIndicator visible={sharingLocation} />
      <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color.azure} />}>
        <Text variant="title1" style={{ marginBottom: t.spacing.lg }}>
          Hi {me?.user.name ?? 'driver'}
        </Text>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.spacing.sm }}>
            <Text variant="headline">Today&apos;s shift</Text>
            {shift ? <Badge tone={isActive ? 'success' : 'neutral'} dot={isActive}>{isActive ? 'Active' : shift.status}</Badge> : null}
          </View>
          {shift ? (
            <>
              <Field label="Vehicle" value={shift.vehicleLabel ?? shift.vehicleId.slice(0, 8)} mono />
              <View style={{ height: t.spacing.md }} />
              <Button
                testID="toggle-shift"
                label={isActive ? 'End shift' : 'Start shift'}
                onPress={() => void toggleShift()}
                busy={busy}
                variant={isActive ? 'danger' : 'primary'}
                size="lg"
                icon={isActive ? 'square' : 'play'}
                haptic="none"
                fullWidth
              />
              {!isActive ? (
                <Text variant="footnote" color={t.color.textMuted} style={{ marginTop: t.spacing.sm }}>
                  Starting your shift turns on location sharing.
                </Text>
              ) : null}
            </>
          ) : (
            <Text variant="subhead" color={t.color.textMuted}>
              No shift assigned yet. Pull to refresh.
            </Text>
          )}
        </Card>

        <View style={{ height: t.spacing.lg }} />

        <Card>
          <Text variant="headline" style={{ marginBottom: t.spacing.sm }}>
            My route today
          </Text>
          {route ? (
            <>
              <Text variant="subhead" color={t.color.textMuted} style={{ marginBottom: t.spacing.md }}>
                {route.stops.length} stop{route.stops.length === 1 ? '' : 's'} · {route.status}
              </Text>
              <Button testID="open-route" label="View route & stops" onPress={() => navigation.navigate('Route')} icon="map" iconRight="arrow-right" fullWidth />
            </>
          ) : (
            <Text variant="subhead" color={t.color.textMuted}>
              No route assigned yet.
            </Text>
          )}
        </Card>

        <View style={{ height: t.spacing.xl }} />

        <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
          <View style={{ flex: 1 }}>
            <Button testID="settings" label="Settings" onPress={() => navigation.navigate('Settings')} variant="secondary" icon="settings" fullWidth />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="logout" label="Sign out" onPress={() => void logout()} variant="ghost" icon="log-out" fullWidth />
          </View>
        </View>
      </Screen>
      {toastNode}
    </View>
  );
}
