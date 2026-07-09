import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { OrderWeightView } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { useTheme } from '../theme';
import { Badge, Button, Card, Input, Screen, Segmented, Stat, Text, useToast } from '../components/kit';
import { haptics } from '../components/haptics';
import { useWeighQueue } from '../weigh/useWeighQueue';
import type { WeighProps } from '../navigation';

const WEIGH_POINTS = [
  { value: 'PICKUP' as const, label: 'Pickup' },
  { value: 'PLANT' as const, label: 'Plant' },
];

/**
 * Weigh load (Inc-23 P2) — at a stop the driver enters the actual weight, picks the weigh point
 * (Pickup/Plant), reviews the customer estimate + the current authoritative weight, then APPROVES. The
 * approval flows through the durable offline `WeighOutbox` (persisted): online it syncs immediately and
 * shows the computed price; offline it is QUEUED honestly and syncs on the next trigger. A re-weigh is a
 * new immutable capture (never edits the old). Stop status stays authoritative over raw GPS.
 */
export function WeighScreen({ route, navigation }: WeighProps): React.ReactElement {
  const t = useTheme();
  const { stopId } = route.params;
  const { assignment, client } = useSession();
  const { toast, node: toastNode } = useToast();
  const { pending, syncing, approve } = useWeighQueue(client);

  const stop = assignment?.route?.stops.find((s) => s.id === stopId) ?? null;

  const [weightKg, setWeightKg] = useState('');
  const [weighPoint, setWeighPoint] = useState<'PICKUP' | 'PLANT'>('PICKUP');
  const [current, setCurrent] = useState<OrderWeightView | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    try {
      setCurrent(await client.getStopWeight(stopId));
    } catch {
      // a read failure just hides the current-weight card; approving still works offline
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopId]);

  const submit = async (): Promise<void> => {
    const kg = Number(weightKg);
    if (!Number.isFinite(kg) || kg <= 0) {
      haptics.warning();
      toast('Enter the weight in kilograms.', 'warning');
      return;
    }
    setBusy(true);
    try {
      const res = await approve({ stopId, orderLabel: stop?.orderId ? stop.orderId.slice(0, 8) : null, weightKg: kg, weighPoint, source: 'driver' });
      if (res.outcome === 'synced') {
        haptics.success();
        const p = res.result.pricing;
        toast(
          p.status === 'auto_approved' && p.total
            ? `Weighed ${kg.toFixed(2)} kg → priced $${p.total}`
            : p.status === 'quote_sent'
              ? `Weighed ${kg.toFixed(2)} kg → quote sent for approval`
              : `Weighed ${kg.toFixed(2)} kg — recorded.`,
          'success',
        );
        setWeightKg('');
        await refresh();
      } else if (res.outcome === 'queued') {
        haptics.tap();
        toast('No signal — approval saved and will sync automatically.', 'warning');
        setWeightKg('');
      } else {
        haptics.error();
        toast(res.error ?? 'Could not record the weight.', 'danger');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.color.canvas }}>
      <Screen scroll>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text variant="title2" style={{ flex: 1 }}>
              Weigh load
            </Text>
            <Badge tone="azure" icon="package">
              {stop?.kind ?? 'Stop'}
            </Badge>
          </View>
          <Text variant="subhead" color={t.color.textMuted} style={{ marginTop: 4 }}>
            {stop?.siteName ?? 'This stop'} — enter the actual weight and approve. The approved weight is authoritative.
          </Text>
        </Card>

        <View style={{ height: t.spacing.lg }} />

        {/* Current authoritative weight + the customer's booking estimate */}
        <Card>
          <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
            <View style={{ flex: 1 }}>
              <Stat label="Authoritative" value={current?.authoritativeWeightKg ? `${current.authoritativeWeightKg} kg` : '—'} hint={current?.authoritativeWeighPoint ?? 'not weighed yet'} valueTestID="weigh-authoritative" />
            </View>
            <View style={{ flex: 1 }}>
              <Stat label="Customer estimate" value={current?.customerEstimate != null ? `~${current.customerEstimate} kg` : '—'} hint={current?.customerEstimate != null ? 'from booking' : 'none given'} />
            </View>
          </View>
          {current && current.captures.length > 0 ? (
            <Text variant="footnote" color={t.color.textFaint} style={{ marginTop: t.spacing.sm }} testID="weigh-history-count">
              {current.captures.length} capture{current.captures.length === 1 ? '' : 's'} on record (re-weighing adds a new one).
            </Text>
          ) : null}
        </Card>

        <View style={{ height: t.spacing.lg }} />

        {/* Enter + approve */}
        <Card>
          <Text variant="headline" style={{ marginBottom: t.spacing.sm }}>
            Weight (kg)
          </Text>
          <Input testID="weigh-input" value={weightKg} onChangeText={setWeightKg} placeholder="e.g. 6.5" keyboardType="decimal-pad" icon="package" big />
          <View style={{ height: t.spacing.md }} />
          <Text variant="subhead" color={t.color.textMuted} style={{ marginBottom: t.spacing.xs }}>
            Weigh point
          </Text>
          <Segmented testID="weigh-point" options={WEIGH_POINTS} value={weighPoint} onChange={setWeighPoint} />
          <View style={{ height: t.spacing.lg }} />
          <Button testID="weigh-approve" label="Approve weight" icon="check-circle" onPress={() => void submit()} busy={busy || syncing} disabled={busy} size="lg" haptic="none" fullWidth />
        </Card>

        {pending > 0 ? (
          <>
            <View style={{ height: t.spacing.md }} />
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Badge tone="warning" icon="wifi-off" dot>
                  Offline
                </Badge>
                <Text variant="footnote" color={t.color.textMuted} style={{ flex: 1 }} testID="weigh-pending">
                  {pending} approval{pending === 1 ? '' : 's'} queued — syncing automatically when back online.
                </Text>
              </View>
            </Card>
          </>
        ) : null}

        <View style={{ height: t.spacing.lg }} />
        <Button label="Back to stop" onPress={() => navigation.goBack()} variant="ghost" icon="arrow-left" disabled={busy} fullWidth />
      </Screen>
      {toastNode}
    </View>
  );
}
