import * as Haptics from 'expo-haptics';

/**
 * Daylight haptics — a tiny, swallow-errors wrapper over `expo-haptics` so a press or state change can
 * fire a tactile cue without each call site importing the SDK or handling the "no taptic engine" reject.
 * Light impact on primary press; success/warning on a meaningful state change (approved, paid, arrived).
 *
 * Reconciled surface (superset of customer's + driver/owner's helpers, never dropping a capability):
 *  - `light`   — customer's primary-press impact (the shared Button's default).
 *  - `tap`     — driver/owner's name for the SAME light impact; kept as an alias so their existing
 *                `haptics.tap()` call sites (PodScreen/WeighScreen) and `haptic="tap"` props keep working.
 *  - `medium` / `selection` / `success` / `warning` / `error` — shared by both apps.
 */
export const haptics = {
  light: (): void => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  /** Alias of `light` — driver/owner's historical name for a primary-press tap. */
  tap: (): void => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  medium: (): void => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  selection: (): void => void Haptics.selectionAsync().catch(() => undefined),
  success: (): void => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warning: (): void => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
  error: (): void => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
};

/** The union of every haptic name both apps use, plus `'none'` for "fire nothing". */
export type HapticKind = 'light' | 'tap' | 'medium' | 'selection' | 'success' | 'warning' | 'error' | 'none';

/** Fire a named haptic (no-op for 'none'). */
export function fireHaptic(kind: HapticKind): void {
  if (kind === 'none') return;
  haptics[kind]();
}
