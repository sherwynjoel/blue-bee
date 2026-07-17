import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { CustomerSite } from '@blue-bee/shared';
import { ApiError } from '@blue-bee/api-client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSession } from '../session/SessionProvider';
import type { RootStackParamList } from '../navigation';
import { useTheme } from '../../theme';
import { Button, Card, IconBadge, Input, SkeletonCard, Text, fireHaptic } from '../../components/ui';
import {
  addressFormFromSite,
  buildCreateSiteDto,
  buildUpdateSiteDto,
  coverageNotice,
  emptyAddressForm,
  hasErrors,
  isEmptyUpdate,
  newAddressIdempotencyKey,
  validateAddressForm,
  type AddressFormErrors,
  type AddressFormValues,
  type CoverageNotice,
} from '../addresses/address';

/**
 * Add or edit a saved address (Increment 26) — the screen that unblocks onboarding: before this, a
 * customer with no site saw an empty picker in Book and could never create one.
 * [Royal restyle] Grouped Input card + the icon-in-tinted-circle motif for the default toggle and
 * coverage notice — the geocode/serviceability handling below is unchanged from Inc-26.
 *
 * The SERVER resolves the address to a point and decides coverage; this screen only types text and
 * renders the answer. Three server outcomes are surfaced distinctly, because they need different actions:
 *   • 422 `site.geocode_failed`      → the address doesn't exist upstream. Nothing was saved. Fix the text.
 *   • 503 `site.geocode_unavailable` → lookup is down. We know nothing about the address. Retry.
 *   • saved, but out of service area → the address IS saved; booking is what will block. Calm state, no red.
 *
 * There is deliberately no map-pin picker yet: `react-native-maps` needs a Google Maps Android key that has
 * not been provisioned (the parked Tier-1 item), so a picker would render a blank tile on Android. The API
 * already accepts a `geo` pin, so the control drops in unchanged once that key lands.
 */
export function AddressFormScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootStackParamList, 'AddressForm'>): React.ReactElement {
  const { client } = useSession();
  const { colors, space, radius } = useTheme();
  const editingSiteId = route.params?.siteId;
  const returnTo = route.params?.returnTo;

  const [values, setValues] = useState<AddressFormValues>(emptyAddressForm());
  const [original, setOriginal] = useState<CustomerSite | null>(null);
  const [loading, setLoading] = useState(Boolean(editingSiteId));
  const [loadError, setLoadError] = useState<string | null>(null);

  const [errors, setErrors] = useState<AddressFormErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Set when the server saved the address but told us it is outside coverage. Not an error. */
  const [notice, setNotice] = useState<CoverageNotice | null>(null);
  /** Stable across retries → a timeout-then-retry can never save the address twice. */
  const idemKeyRef = useRef<string | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: editingSiteId ? 'Edit address' : 'Add address' });
  }, [navigation, editingSiteId]);

  // Edit mode: load the row through the row-scoped list (a site that isn't ours simply isn't in it).
  useEffect(() => {
    if (!editingSiteId) return;
    let cancelled = false;
    (async () => {
      try {
        const { sites } = await client.getSites();
        if (cancelled) return;
        const site = sites.find((s) => s.id === editingSiteId);
        if (!site) {
          setLoadError('That address is no longer available.');
          return;
        }
        setOriginal(site);
        setValues(addressFormFromSite(site));
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load this address.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, editingSiteId]);

  const set = <K extends keyof AddressFormValues>(key: K, v: AddressFormValues[K]): void => {
    setValues((prev) => ({ ...prev, [key]: v }));
    if (key === 'name' || key === 'address') setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSaveError(null);
  };

  /** Leave for wherever we came from, handing Book the id so it can pre-select the new address. */
  const finish = useCallback(
    (siteId: string): void => {
      if (returnTo === 'Book') {
        navigation.navigate({ name: 'Book', params: { preselectSiteId: siteId }, merge: true });
      } else {
        navigation.goBack();
      }
    },
    [navigation, returnTo],
  );

  const onSave = useCallback(async (): Promise<void> => {
    const found = validateAddressForm(values);
    setErrors(found);
    if (hasErrors(found)) return;

    setSaving(true);
    setSaveError(null);
    setNotice(null);
    if (!idemKeyRef.current) idemKeyRef.current = newAddressIdempotencyKey();

    try {
      if (original) {
        const dto = buildUpdateSiteDto(values, original);
        // Nothing moved — don't send a body the server's `.refine()` would reject as empty.
        if (isEmptyUpdate(dto)) {
          navigation.goBack();
          return;
        }
        const res = await client.updateSite(original.id, dto, idemKeyRef.current);
        idemKeyRef.current = null;
        const n = coverageNotice(res.serviceability);
        if (n.kind === 'out_of_area') setNotice(n);
        else navigation.goBack();
      } else {
        const res = await client.createSite(buildCreateSiteDto(values), idemKeyRef.current);
        idemKeyRef.current = null;
        const n = coverageNotice(res.serviceability);
        if (n.kind === 'out_of_area') setNotice(n);
        else finish(res.site.id);
      }
    } catch (e) {
      // The address does not exist upstream. The server saved NOTHING (it will not invent a coordinate),
      // so this belongs on the address field, not in a generic error box.
      if (e instanceof ApiError && e.isGeocodeFailed) {
        setErrors((prev) => ({ ...prev, address: "We couldn't find that address. Check the street and city." }));
      } else if (e instanceof ApiError && e.isGeocodeUnavailable) {
        // We learned nothing about the address — never tell the customer it's wrong. Keep the key: the retry
        // must be de-duped in case the first attempt actually landed.
        setSaveError('Address lookup is temporarily unavailable. Please try again in a moment.');
        return;
      } else {
        setSaveError(e instanceof Error ? e.message : 'Could not save this address.');
      }
      // A non-transient failure: the next attempt is a genuinely new request.
      idemKeyRef.current = null;
    } finally {
      setSaving(false);
    }
  }, [values, original, client, navigation, finish]);

  if (loading) {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
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
            <Feather name="alert-circle" size={26} color={colors.textTertiary} />
            <Text testID="address-load-error" variant="body" color="danger" center style={{ marginTop: 10 }}>
              {loadError}
            </Text>
            <Button label="Go back" variant="outline" onPress={() => navigation.goBack()} style={{ marginTop: 16 }} />
          </Card>
        </View>
      </View>
    );
  }

  // The address is saved; it just isn't in a serviced area. Calm, terminal state — not the red error box.
  if (notice?.kind === 'out_of_area') {
    return (
      <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          <Card>
            <View style={styles.noticeHead}>
              <IconBadge icon="map-pin" tone="neutral" size={40} />
              <Text variant="headline" weight="700" style={{ marginLeft: 12, flex: 1 }}>
                Outside our service area
              </Text>
            </View>
            <Text testID="out-of-area" variant="body" color="secondary" style={{ marginTop: 12 }}>
              {notice.message}
            </Text>
            {/* Only claim we recorded the address when the server actually returned a coverage-request id. */}
            {notice.recorded ? (
              <Text testID="coverage-recorded" variant="footnote" color="secondary" style={{ marginTop: 8 }}>
                We've noted this address so we can tell you when we start serving it.
              </Text>
            ) : null}
            <Button
              testID="out-of-area-done"
              label="Done"
              onPress={() => navigation.goBack()}
              style={{ marginTop: 18 }}
              fullWidth
            />
          </Card>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingBottom: space.huge }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Card>
          <Input
            testID="address-name"
            label="Name"
            icon="tag"
            placeholder="Home"
            value={values.name}
            onChangeText={(t) => set('name', t)}
            error={errors.name}
            autoCapitalize="words"
            returnKeyType="next"
          />
          <Input
            testID="address-line"
            label="Street address"
            icon="map-pin"
            placeholder="100 Queen St W, Toronto, ON"
            value={values.address}
            onChangeText={(t) => set('address', t)}
            error={errors.address}
            hint="We'll look this up to place your pickup."
            autoCapitalize="words"
            containerStyle={{ marginTop: space.md }}
          />
          <View style={styles.pair}>
            <Input
              testID="address-unit"
              label="Unit"
              placeholder="12B"
              value={values.unit}
              onChangeText={(t) => set('unit', t)}
              containerStyle={styles.pairItem}
            />
            <Input
              testID="address-buzzer"
              label="Buzzer"
              placeholder="1204"
              value={values.buzzer}
              onChangeText={(t) => set('buzzer', t)}
              containerStyle={styles.pairItemRight}
            />
          </View>
          <Input
            testID="address-notes"
            label="Driver notes"
            icon="info"
            placeholder="Side door, leave with concierge"
            value={values.notes}
            onChangeText={(t) => set('notes', t)}
            multiline
            containerStyle={{ marginTop: space.md }}
          />

          <View style={[styles.defaultRow, { borderTopColor: colors.hairline }]}>
            <IconBadge icon="star" tone="honey" size={36} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text variant="subhead" weight="600">
                Default address
              </Text>
              <Text variant="footnote" color="secondary" style={{ marginTop: 1 }}>
                Pre-selected when you book.
              </Text>
            </View>
            <Switch
              testID="address-default"
              value={values.isDefault}
              onValueChange={(v) => {
                fireHaptic('selection');
                set('isDefault', v);
              }}
              trackColor={{ true: colors.azure }}
            />
          </View>
        </Card>

        {saveError ? (
          <View style={[styles.errorBox, { backgroundColor: colors.dangerTint, marginTop: space.md, borderRadius: radius.input }]}>
            <Feather name="alert-circle" size={15} color={colors.danger} />
            <Text testID="address-save-error" variant="footnote" color="danger" style={{ marginLeft: 8, flex: 1 }}>
              {saveError}
            </Text>
          </View>
        ) : null}

        <Button
          testID="address-save"
          label={original ? 'Save changes' : 'Save address'}
          icon="check"
          onPress={onSave}
          busy={saving}
          disabled={saving}
          fullWidth
          style={{ marginTop: space.lg }}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stateCard: { alignItems: 'center', paddingVertical: 28, alignSelf: 'stretch' },
  pair: { flexDirection: 'row', marginTop: 12 },
  pairItem: { flex: 1 },
  pairItemRight: { flex: 1, marginLeft: 12 },
  defaultRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth },
  noticeHead: { flexDirection: 'row', alignItems: 'center' },
  errorBox: { flexDirection: 'row', alignItems: 'center', padding: 10 },
});
