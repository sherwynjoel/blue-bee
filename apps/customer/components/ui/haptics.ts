import * as Haptics from 'expo-haptics';

/**
 * Daylight haptics — a tiny, swallow-errors wrapper over `expo-haptics` so a press or state change can
 * fire a tactile cue without each call site importing the SDK or handling the "no taptic engine" reject.
 * Light impact on primary press; success/warning on a meaningful state change (approved, paid, arrived).
 */
export const haptics = {
  light: (): void => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  medium: (): void => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  selection: (): void => void Haptics.selectionAsync().catch(() => undefined),
  success: (): void => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warning: (): void => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
  error: (): void => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
};

export type HapticKind = 'light' | 'medium' | 'selection' | 'success' | 'warning' | 'error' | 'none';

/** Fire a named haptic (no-op for 'none'). */
export function fireHaptic(kind: HapticKind): void {
  if (kind === 'none') return;
  haptics[kind]();
}
