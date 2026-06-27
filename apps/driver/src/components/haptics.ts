import * as Haptics from 'expo-haptics';

/**
 * Operator haptics (Daylight). One thin, fire-and-forget surface so every screen taps the same feel:
 * light impact on a primary action press, success/warning on §5.4-style state transitions + approvals.
 * Always non-blocking and swallow errors — a haptics hiccup must never affect UX (or tests).
 */
function fire(run: () => Promise<unknown>): void {
  try {
    void run();
  } catch {
    // ignore — haptics are a nicety, never a dependency
  }
}

export const haptics = {
  /** Light tap — primary/secondary action press. */
  tap: (): void => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A weightier press — destructive confirm, big primary. */
  medium: (): void => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Success notification — a completed transition / approval. */
  success: (): void => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Warning notification — a fail/skip/decline, or a server-authority refresh. */
  warning: (): void => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** Error notification — a hard failure. */
  error: (): void => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  /** Selection tick — segmented control / picker change. */
  selection: (): void => fire(() => Haptics.selectionAsync()),
};
