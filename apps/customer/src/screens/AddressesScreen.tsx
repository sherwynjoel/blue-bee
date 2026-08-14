import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { CustomerSite } from '@blue-bee/shared';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { useTheme } from '../../theme';
import { Badge, Button, Card, EmptyState, IconBadge, SkeletonCard, Text, fireHaptic } from '../../components/ui';

/**
 * Saved addresses (Increment 26) — list, add, edit, set-default, remove. Reached from Settings.
 * [Royal restyle] Card(padding=0) list with hairline-separated items, the icon-in-tinted-circle motif
 * (IconBadge) and pill actions — content/wiring below is unchanged from Inc-26.
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
  const { colors, space, radius } = useTheme();

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
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          <SkeletonCard />
          <SkeletonCard />
        </ScrollView>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <View style={[styles.center, { padding: space.lg }]}>
          <Card style={styles.stateCard}>
            <Feather name="wifi-off" size={26} color={colors.textTertiary} />
            <Text variant="headline" weight="600" center style={{ marginTop: 10 }}>
              Couldn’t load your addresses
            </Text>
            <Text testID="addresses-error" variant="subhead" color="secondary" center style={{ marginTop: 4 }}>
              {loadError}
            </Text>
            <Button label="Try again" icon="refresh-cw" variant="outline" onPress={() => void load()} fullWidth={false} style={{ marginTop: 16 }} />
          </Card>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.huge }} showsVerticalScrollIndicator={false}>
        {sites.length === 0 ? (
          <Card>
            <EmptyState
              testID="addresses-empty"
              icon="map-pin"
              title="No saved addresses"
              body="Add the address we should collect from, and we'll pre-fill it every time you book."
              actionLabel="Add address"
              actionIcon="plus"
              onAction={() => navigation.navigate('AddressForm', {})}
            />
          </Card>
        ) : (
          <>
            <Card padding={0} style={{ marginBottom: space.lg }}>
              {sites.map((s, i) => {
                const confirming = confirmingId === s.id;
                const busy = busyId === s.id;
                return (
                  <View
                    key={s.id}
                    style={[styles.item, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline }]}
                  >
                    <View style={styles.itemHead}>
                      <IconBadge icon="map-pin" tone="azure" size={36} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={styles.nameRow}>
                          <Text variant="headline" weight="700" style={{ flex: 1 }} numberOfLines={1}>
                            {s.name}
                          </Text>
                          {s.isDefault ? <Badge testID={`default-badge-${s.id}`} label="Default" tone="azure" /> : null}
                        </View>

                        {s.address ? (
                          <Text testID={`address-line-${s.id}`} variant="subhead" color="secondary" style={{ marginTop: 3 }}>
                            {s.address}
                          </Text>
                        ) : null}
                        {s.unit || s.buzzer ? (
                          <Text variant="footnote" color="tertiary" style={{ marginTop: 2 }}>
                            {[s.unit ? `Unit ${s.unit}` : null, s.buzzer ? `Buzzer ${s.buzzer}` : null].filter(Boolean).join(' · ')}
                          </Text>
                        ) : null}
                        {s.notes ? (
                          <Text variant="footnote" color="tertiary" style={{ marginTop: 2 }}>
                            {s.notes}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    <View style={[styles.actions, { borderTopColor: colors.hairline }]}>
                      <Pressable
                        testID={`edit-${s.id}`}
                        onPress={() => {
                          fireHaptic('selection');
                          navigation.navigate('AddressForm', { siteId: s.id });
                        }}
                        style={[styles.actionPill, { backgroundColor: colors.azureTint, borderRadius: radius.pill }]}
                        accessibilityRole="button"
                      >
                        <Feather name="edit-2" size={14} color={colors.azure} />
                        <Text variant="footnote" weight="600" color="azure" style={{ marginLeft: 6 }}>
                          Edit
                        </Text>
                      </Pressable>

                      {!s.isDefault ? (
                        <Pressable
                          testID={`make-default-${s.id}`}
                          onPress={() => void onMakeDefault(s)}
                          disabled={busy}
                          style={[styles.actionPill, { backgroundColor: colors.subtle, borderRadius: radius.pill, opacity: busy ? 0.5 : 1 }]}
                          accessibilityRole="button"
                        >
                          <Feather name="star" size={14} color={colors.textSecondary} />
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
                        style={[
                          styles.actionPill,
                          styles.actionEnd,
                          { backgroundColor: colors.dangerTint, borderRadius: radius.pill, opacity: busy ? 0.5 : 1 },
                        ]}
                        accessibilityRole="button"
                      >
                        <Feather name="trash-2" size={14} color={colors.danger} />
                        <Text variant="footnote" weight="600" color="danger" style={{ marginLeft: 6 }}>
                          {confirming ? 'Tap to confirm' : 'Remove'}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </Card>

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
          <View style={[styles.errorBox, { backgroundColor: colors.dangerTint, marginTop: space.md }]}>
            <Feather name="alert-circle" size={15} color={colors.danger} />
            <Text testID="addresses-action-error" variant="footnote" color="danger" style={{ marginLeft: 8, flex: 1 }}>
              {actionError}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateCard: { alignItems: 'center', paddingVertical: 28, alignSelf: 'stretch' },
  item: { padding: 16 },
  itemHead: { flexDirection: 'row' },
  nameRow: { flexDirection: 'row', alignItems: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  actionPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, marginRight: 10 },
  actionEnd: { marginRight: 0, marginLeft: 'auto' },
  errorBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, padding: 10 },
});
