import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { CustomerSite } from '@blue-bee/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { useTheme } from '../../theme';
import { Badge, Button, Card, EmptyState, SkeletonCard, Text, fireHaptic } from '../../components/ui';

/**
 * Saved addresses (Increment 26) — list, add, edit, set-default, remove. Reached from Settings.
 *
 * "Remove" is a soft delete server-side: a past order still points at the row, so the API deactivates it
 * and it simply stops appearing here. Removing the default hands the default to the next address, and the
 * server tells us which one — we re-fetch rather than guess. A two-step confirm guards the destructive
 * action, mirroring Delete Account on the Settings screen.
 */
export function AddressesScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, 'Addresses'>): React.ReactElement {
  const { client } = useSession();
  const { colors, space } = useTheme();

  const [sites, setSites] = useState<CustomerSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Two-step confirm: the id awaiting a second tap to remove. */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoadError(null);
      const { sites: rows } = await client.getSites();
      setSites(rows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your addresses.');
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-fetch when this screen regains focus, so returning from the add/edit form shows the new state
  // (including a default the server moved). The navigation prop's `focus` event is used rather than
  // `useFocusEffect`, which requires a NavigationContainer and so cannot run in a screen unit test.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      void load();
    });
    return unsubscribe;
  }, [navigation, load]);

  const onRemove = useCallback(
    async (site: CustomerSite): Promise<void> => {
      setBusyId(site.id);
      setActionError(null);
      try {
        await client.deactivateSite(site.id);
        setConfirmingId(null);
        await load();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not remove that address.');
      } finally {
        setBusyId(null);
      }
    },
    [client, load],
  );

  const onMakeDefault = useCallback(
    async (site: CustomerSite): Promise<void> => {
      setBusyId(site.id);
      setActionError(null);
      try {
        await client.updateSite(site.id, { isDefault: true });
        await load();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : 'Could not set that as your default.');
      } finally {
        setBusyId(null);
      }
    },
    [client, load],
  );

  if (loading) {
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg }}>
        <SkeletonCard />
        <SkeletonCard />
      </ScrollView>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.center, { padding: space.lg }]}>
        <Text testID="addresses-error" variant="body" color="danger">
          {loadError}
        </Text>
        <Button label="Try again" variant="outline" onPress={() => void load()} style={{ marginTop: 12 }} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xl }}>
      {sites.length === 0 ? (
        <EmptyState
          testID="addresses-empty"
          icon="map-pin"
          title="No saved addresses"
          body="Add the address we should collect from, and we'll pre-fill it every time you book."
          actionLabel="Add address"
          actionIcon="plus"
          onAction={() => navigation.navigate('AddressForm', {})}
        />
      ) : (
        <>
          {sites.map((s) => {
            const confirming = confirmingId === s.id;
            const busy = busyId === s.id;
            return (
              <Card key={s.id} style={{ marginBottom: 12 }}>
                <View style={styles.head}>
                  <Feather name="map-pin" size={18} color={colors.azure} />
                  <Text variant="headline" weight="700" style={{ marginLeft: 8, flex: 1 }}>
                    {s.name}
                  </Text>
                  {s.isDefault ? <Badge testID={`default-badge-${s.id}`} label="Default" tone="azure" /> : null}
                </View>

                {s.address ? (
                  <Text testID={`address-line-${s.id}`} variant="subhead" color="secondary" style={{ marginTop: 6 }}>
                    {s.address}
                  </Text>
                ) : null}
                {s.unit || s.buzzer ? (
                  <Text variant="footnote" color="secondary" style={{ marginTop: 2 }}>
                    {[s.unit ? `Unit ${s.unit}` : null, s.buzzer ? `Buzzer ${s.buzzer}` : null].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {s.notes ? (
                  <Text variant="footnote" color="tertiary" style={{ marginTop: 2 }}>
                    {s.notes}
                  </Text>
                ) : null}

                <View style={[styles.actions, { borderTopColor: colors.hairline }]}>
                  <Pressable
                    testID={`edit-${s.id}`}
                    onPress={() => {
                      fireHaptic('selection');
                      navigation.navigate('AddressForm', { siteId: s.id });
                    }}
                    style={styles.action}
                    accessibilityRole="button"
                  >
                    <Feather name="edit-2" size={15} color={colors.azure} />
                    <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 6 }}>
                      Edit
                    </Text>
                  </Pressable>

                  {!s.isDefault ? (
                    <Pressable
                      testID={`make-default-${s.id}`}
                      onPress={() => void onMakeDefault(s)}
                      disabled={busy}
                      style={styles.action}
                      accessibilityRole="button"
                    >
                      <Feather name="star" size={15} color={colors.textSecondary} />
                      <Text variant="footnote" weight="600" color="secondary" style={{ marginLeft: 6 }}>
                        Make default
                      </Text>
                    </Pressable>
                  ) : null}

                  <Pressable
                    testID={confirming ? `confirm-remove-${s.id}` : `remove-${s.id}`}
                    onPress={() => {
                      fireHaptic('warning');
                      if (confirming) void onRemove(s);
                      else setConfirmingId(s.id);
                    }}
                    disabled={busy}
                    style={[styles.action, styles.actionEnd]}
                    accessibilityRole="button"
                  >
                    <Feather name="trash-2" size={15} color={colors.danger} />
                    <Text variant="footnote" weight="600" color="danger" style={{ marginLeft: 6 }}>
                      {confirming ? 'Tap to confirm' : 'Remove'}
                    </Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}

          <Button
            testID="add-address"
            label="Add address"
            icon="plus"
            variant="outline"
            onPress={() => navigation.navigate('AddressForm', {})}
            fullWidth
          />
        </>
      )}

      {actionError ? (
        <View style={[styles.errorBox, { backgroundColor: colors.dangerTint, marginTop: 12 }]}>
          <Text testID="addresses-action-error" variant="footnote" color="danger">
            {actionError}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  action: { flexDirection: 'row', alignItems: 'center', marginRight: 18 },
  actionEnd: { marginRight: 0, marginLeft: 'auto' },
  errorBox: { borderRadius: 10, padding: 10 },
});
