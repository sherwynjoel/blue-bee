import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import type { ApiClient } from '../api/client';
import { LOCATION_TASK } from '../config';
import { DUTY_CYCLE, LocationOutbox, toPing, type DeviceFix } from './duty-cycle';

/**
 * The background-GPS tracker shell (PRD §4.4 D4 / §6.2). It wires the REAL `expo-location` +
 * `expo-task-manager` background task to the pure `LocationOutbox`, and enforces the privacy
 * invariants (US-T5/§12.2):
 *   • emits ONLY while a shift is ACTIVE (start on shift-start, stop on shift-end/logout);
 *   • consent-gated — requests foreground+background permission and refuses to start without it;
 *   • a subscribable `tracking` flag drives the visible "sharing location" indicator.
 *
 * On each OS location callback the fixes are normalized + buffered, then flushed to the proven
 * `POST /v1/locations:batch`; a failed flush leaves them queued for the next callback (idempotent
 * re-send). Durable cross-relaunch persistence of the buffer is part of the deferred offline queue.
 */

interface TrackerState {
  client: ApiClient | null;
  shiftId: string | null;
  vehicleId: string | null;
}

const state: TrackerState = { client: null, shiftId: null, vehicleId: null };
const outbox = new LocationOutbox();
let tracking = false;
const listeners = new Set<(on: boolean) => void>();

function setTracking(on: boolean): void {
  tracking = on;
  for (const l of listeners) l(on);
}

/** Subscribe to the sharing-indicator state. Returns an unsubscribe fn. */
export function onTrackingChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  listener(tracking);
  return () => listeners.delete(listener);
}

export function isTracking(): boolean {
  return tracking;
}

export function pendingPingCount(): number {
  return outbox.size;
}

/**
 * Push fixes into the outbox and flush to the API. Exported so the background task handler (and
 * tests) can drive it; a no-op when no active shift/client is bound (i.e. shift not ACTIVE).
 */
export async function ingestFixes(fixes: DeviceFix[]): Promise<void> {
  const { client, shiftId, vehicleId } = state;
  if (!client || !shiftId || !vehicleId) return; // not emitting unless a shift is active
  outbox.enqueue(fixes.map(toPing));
  if (outbox.size === 0) return;
  await outbox.flush((pings) => client.postLocations({ shiftId, vehicleId, pings }));
}

// The background task: defined once at module load. Receives batched fixes from the OS and forwards
// them through the gated outbox. Errors are swallowed (logged) so the OS keeps delivering updates.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[tracker] location task error:', error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  if (locations.length === 0) return;
  const fixes: DeviceFix[] = locations.map((l) => ({
    latitude: l.coords.latitude,
    longitude: l.coords.longitude,
    speed: l.coords.speed,
    heading: l.coords.heading,
    timestampMs: l.timestamp,
  }));
  try {
    await ingestFixes(fixes);
  } catch (e) {
    console.warn('[tracker] flush failed (kept for retry):', e instanceof Error ? e.message : String(e));
  }
});

export type PermissionOutcome = 'granted' | 'foreground-only' | 'denied';

/** Request foreground + background location consent. Returns the consent level reached. */
export async function requestLocationConsent(): Promise<PermissionOutcome> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === 'granted' ? 'granted' : 'foreground-only';
}

/**
 * Start streaming for an ACTIVE shift. Consent-gated: returns false (and does NOT start) if the
 * driver denied location. Idempotent — safe to call again.
 */
export async function startTracking(client: ApiClient, shiftId: string, vehicleId: string): Promise<boolean> {
  const consent = await requestLocationConsent();
  if (consent === 'denied') return false;

  state.client = client;
  state.shiftId = shiftId;
  state.vehicleId = vehicleId;

  const alreadyStarted = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK).catch(() => false);
  if (!alreadyStarted) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: DUTY_CYCLE.approachingIntervalMs,
      distanceInterval: DUTY_CYCLE.distanceIntervalM,
      activityType: Location.ActivityType.AutomotiveNavigation,
      showsBackgroundLocationIndicator: true, // the OS-level "sharing" indicator (iOS)
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: 'Blue Bee — shift active',
        notificationBody: 'Sharing your location with dispatch and the customer.',
      },
    });
  }
  setTracking(true);
  return true;
}

/**
 * Stop streaming (shift end / logout). Clears the shift binding FIRST so any OS callback that fires
 * in the window before the task unregisters becomes a no-op (it can never POST under the just-ended
 * shift — the privacy gate). No post-stop flush: those pings belong to a now-ended shift and the
 * server would (correctly) reject them; per-callback flushes already drained the buffer while active.
 */
export async function stopTracking(): Promise<void> {
  state.client = null;
  state.shiftId = null;
  state.vehicleId = null;
  setTracking(false);
  const started = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK).catch(() => false);
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
}
