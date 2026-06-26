import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { navigationRef } from '../navigation';
import { routeForPushData } from './deep-link';

/** Resolve + navigate for one tapped-notification response (pure routing in `routeForPushData`). */
function handleResponse(response: Notifications.NotificationResponse | null): void {
  if (!response) return;
  const target = routeForPushData(response.notification.request.content.data);
  if (target && navigationRef.isReady()) {
    navigationRef.navigate(target.screen, target.params);
  }
}

/**
 * Wire tapped owner pushes to the navigation stack (PRD §7C C4). Handles both the cold-start tap (the
 * notification that launched the app) and taps while running. Scoped: routing only ever targets an
 * order id, read through the OWNER-scoped API. Mount once near the navigation container.
 */
export function useNotificationDeepLinks(): void {
  useEffect(() => {
    let active = true;
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (active) handleResponse(r);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
}
