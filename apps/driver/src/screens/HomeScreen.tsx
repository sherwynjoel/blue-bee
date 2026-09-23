import { humanize } from '../stops/status-ui';
import React, { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { ShiftStatus } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { SharingIndicator } from '../components/SharingIndicator';
import { ApiError } from '../api/problem';
import { Badge, Button, Card, Text, haptics, useTheme } from '@blue-bee/ui';
import { Field, Screen, useToast } from '../components/kit';
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
    <View style={{ flex: 1, backgroundColor: t.colors.canvas }}>
      <SharingIndicator visible={sharingLocation} />
      <Screen scroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.azure} />}>
        <Text variant="title1" style={{ marginBottom: t.space.lg }}>
          Hi {me?.user.name ?? 'driver'}
        </Text>

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: t.space.sm }}>
            <Text variant="headline">Today&apos;s shift</Text>
            {shift ? <Badge tone={isActive ? 'success' : 'neutral'} dot={isActive}>{isActive ? 'Active' : shift.status}</Badge> : null}
          </View>
          {shift ? (
            <>
              <Field label="Vehicle" value={shift.vehicleLabel ?? shift.vehicleId.slice(0, 8)} mono />
              <View style={{ height: t.space.md }} />
              <Button
                testID="toggle-shift"
                label={isActive ? 'End shift' : 'Start shift'}
                onPress={() => void toggleShift()}
                busy={busy}
                tone={isActive ? 'danger' : 'azure'}
                size="lg"
                icon={isActive ? 'square' : 'play'}
                haptic="none"
                fullWidth
              />
              {!isActive ? (
                <Text variant="footnote" color={t.colors.textSecondary} style={{ marginTop: t.space.sm }}>
                  Starting your shift turns on location sharing.
                </Text>
              ) : null}
            </>
          ) : (
            <Text variant="subhead" color={t.colors.textSecondary}>
              No shift assigned yet. Pull to refresh.
            </Text>
          )}
        </Card>

        <View style={{ height: t.space.lg }} />

        <Card>
          <Text variant="headline" style={{ marginBottom: t.space.sm }}>
            My route today
          </Text>
          {route ? (
            <>
              <Text variant="subhead" color={t.colors.textSecondary} style={{ marginBottom: t.space.md }}>
                {route.stops.length} stop{route.stops.length === 1 ? '' : 's'} · {humanize(route.status)}
              </Text>
              <Button testID="open-route" label="View route & stops" onPress={() => navigation.navigate('Route')} icon="map" iconRight="arrow-right" size="md" fullWidth />
            </>
          ) : (
            <Text variant="subhead" color={t.colors.textSecondary}>
              No route assigned yet.
            </Text>
          )}
        </Card>

        <View style={{ height: t.space.xl }} />

        <View style={{ flexDirection: 'row', gap: t.space.md }}>
          <View style={{ flex: 1 }}>
            <Button testID="settings" label="Settings" onPress={() => navigation.navigate('Settings')} tone="neutral" variant="outline" size="md" icon="settings" fullWidth />
          </View>
          <View style={{ flex: 1 }}>
            <Button testID="logout" label="Sign out" onPress={() => void logout()} variant="ghost" size="md" icon="log-out" fullWidth />
          </View>
        </View>
      </Screen>
      {toastNode}
    </View>
  );
}
