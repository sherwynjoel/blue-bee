import React, { useState } from 'react';
import { View } from 'react-native';
import type { DriverStopAction } from '@blue-bee/shared';
import { useSession } from '../session/SessionProvider';
import { ApiError } from '../api/problem';
import { ACTION_LABEL, availableActions, isTerminal, reasonsFor, requiresReason } from '../stops/actions';
import { stopStatusMeta } from '../stops/status-ui';
import { useTheme } from '../theme';
import { Badge, Button, Card, EmptyState, Field, Screen, Sheet, SheetOption, Text, useToast, type FeatherName } from '../components/kit';
import { haptics } from '../components/haptics';
import type { StopProps } from '../navigation';

const ACTION_ICON: Record<DriverStopAction, FeatherName> = {
  depart: 'navigation',
  arrive: 'map-pin',
  start: 'play',
  complete: 'check-circle',
  fail: 'x-circle',
  skip: 'skip-forward',
};

/**
 * One stop — its details + the legal §5.4 actions. The forward action (depart/arrive/start/complete) is
 * one large, unmistakable primary button; fail/skip are clearly subordinate and open a reason sheet
 * (reason required). The server is authority: a 409 (illegal transition — e.g. the office moved the
 * stop) surfaces as a calm "refreshing" toast and the assignment re-syncs (handled in the session).
 */
export function StopScreen({ route, navigation }: StopProps): React.ReactElement {
  const t = useTheme();
  const { stopId } = route.params;
  const { assignment, doStopAction } = useSession();
  const { toast, node: toastNode } = useToast();
  const [busy, setBusy] = useState<DriverStopAction | null>(null);
  const [reasonFor, setReasonFor] = useState<DriverStopAction | null>(null);

  const stop = assignment?.route?.stops.find((s) => s.id === stopId) ?? null;

  if (!stop) {
    return <EmptyState icon="map-pin" title="Stop not found" message="This stop is no longer on your route." />;
  }

  const actions = availableActions(stop.status);
  const forward = actions.filter((a) => !requiresReason(a));
  const exceptions = actions.filter((a) => requiresReason(a));
  const meta = stopStatusMeta(stop.status);
  const terminal = isTerminal(stop.status);

  async function run(action: DriverStopAction, reason?: string): Promise<void> {
    setBusy(action);
    try {
      await doStopAction(stopId, action, reason ? { reason } : {});
      if (requiresReason(action)) {
        haptics.warning();
        toast(`Stop ${action === 'fail' ? 'marked failed' : 'skipped'}.`, 'warning');
      } else {
        haptics.success();
        toast(`${ACTION_LABEL[action]}.`, 'success');
      }
    } catch (e) {
      if (e instanceof ApiError && e.isConflict) {
        haptics.warning();
        toast('The office updated this stop — showing the latest.', 'warning');
      } else {
        haptics.error();
        toast(e instanceof ApiError ? e.message : 'Action failed. Please try again.', 'danger');
      }
    } finally {
      setBusy(null);
    }
  }

  function onPress(action: DriverStopAction): void {
    if (requiresReason(action)) {
      setReasonFor(action); // open the reason sheet
      return;
    }
    // A delivery stop captures proof of delivery (photo + signature + geo) BEFORE it can complete —
    // the POD screen drives the §5.4 complete itself after a successful capture (the server also gates
    // a DELIVERY complete on a POD, so this can never skip the evidence). Pickup stops complete directly.
    if (action === 'complete' && stop && (stop.kind === 'DELIVERY' || stop.kind === 'BOTH')) {
      navigation.navigate('Pod', { stopId });
      return;
    }
    void run(action);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.color.canvas }}>
      <Screen scroll>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <Text variant="title2" style={{ flex: 1 }}>
              {stop.siteName ?? 'Stop'}
            </Text>
            <Badge tone={meta.tone} icon={meta.icon} dot={!terminal}>
              {meta.label}
            </Badge>
          </View>
          {stop.address ? (
            <Text variant="subhead" color={t.color.textMuted} style={{ marginTop: 4, marginBottom: 8 }}>
              {stop.address}
            </Text>
          ) : null}
          <Field label="Stop #" value={String(stop.seq)} mono />
          <Field label="Kind" value={stop.kind} />
          {stop.timeWindow ? (
            <Field
              label="Window"
              value={`${new Date(stop.timeWindow.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(stop.timeWindow.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
              mono
            />
          ) : null}
          {stop.eta ? <Field label="ETA" value={new Date(stop.eta).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} mono /> : null}
          {stop.exceptionReason ? <Field label="Reason" value={stop.exceptionReason.replace(/_/g, ' ')} valueColor={t.color.dangerInk} /> : null}
        </Card>

        <View style={{ height: t.spacing.xl }} />

        {terminal ? (
          <Card>
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 8 }}>
              <Badge tone={meta.tone} icon={meta.icon}>
                {meta.label}
              </Badge>
              <Text variant="subhead" color={t.color.textMuted} center>
                This stop is {stop.status.toLowerCase()}. Nothing more to do here.
              </Text>
            </View>
          </Card>
        ) : (
          <>
            {/* The next §5.4 step — large + unmistakable. */}
            {forward.map((action) => (
              <Button
                key={action}
                testID={`action-${action}`}
                label={ACTION_LABEL[action]}
                icon={ACTION_ICON[action]}
                onPress={() => onPress(action)}
                busy={busy === action}
                disabled={busy !== null}
                size="lg"
                haptic="none"
                fullWidth
                style={{ marginBottom: t.spacing.md }}
              />
            ))}

            {/* Subordinate exceptions. */}
            {exceptions.length > 0 ? (
              <View style={{ marginTop: t.spacing.sm }}>
                <Text variant="footnote" color={t.color.textFaint} style={{ marginBottom: t.spacing.sm }}>
                  Can&apos;t complete this stop?
                </Text>
                <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
                  {exceptions.map((action) => (
                    <View key={action} style={{ flex: 1 }}>
                      <Button
                        testID={`action-${action}`}
                        label={ACTION_LABEL[action]}
                        icon={ACTION_ICON[action]}
                        onPress={() => onPress(action)}
                        busy={busy === action}
                        disabled={busy !== null}
                        variant="secondary"
                        haptic="none"
                        fullWidth
                      />
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {forward.length === 0 && exceptions.length === 0 ? (
              <Text variant="subhead" color={t.color.textMuted} center>
                No actions available.
              </Text>
            ) : null}
          </>
        )}

        {stop.orderId ? (
          <>
            <View style={{ height: t.spacing.lg }} />
            <Button
              testID="message-customer"
              label="Message customer"
              onPress={() => navigation.navigate('Chat', { orderId: stop.orderId! })}
              variant="secondary"
              icon="message-circle"
              fullWidth
            />
          </>
        ) : null}

        <View style={{ height: t.spacing.lg }} />
        <Button label="Back to route" onPress={() => navigation.goBack()} variant="ghost" icon="arrow-left" fullWidth />
      </Screen>

      <Sheet visible={reasonFor !== null} onClose={() => setReasonFor(null)} title={reasonFor ? ACTION_LABEL[reasonFor] : ''}>
        <Text variant="subhead" color={t.color.textMuted} style={{ marginBottom: t.spacing.sm }}>
          Pick a reason
        </Text>
        {reasonFor
          ? reasonsFor(reasonFor).map((r) => (
              <SheetOption
                key={r}
                testID={`reason-${r}`}
                label={r.replace(/_/g, ' ')}
                icon="chevron-right"
                tone={reasonFor === 'fail' ? 'danger' : 'warning'}
                onPress={() => {
                  const action = reasonFor;
                  setReasonFor(null);
                  void run(action, r);
                }}
              />
            ))
          : null}
      </Sheet>
      {toastNode}
    </View>
  );
}
