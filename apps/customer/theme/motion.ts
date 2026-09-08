import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useTheme, useReducedMotion, usePressScale } from '@blue-bee/ui';

/**
 * Daylight motion helpers on RN's built-in `Animated` (no extra native deps). Every helper degrades to
 * a static, instantly-settled state when the OS "Reduce Motion" setting is on — so animation is always
 * an enhancement, never required for the UI to make sense.
 *
 * `useReducedMotion` and `usePressScale` are the shared implementations from `@blue-bee/ui` (identical to
 * customer's former local copies) — re-exported here so existing `import … from '../theme'` call sites keep
 * working. `useEntrance` and `usePulse` are customer-only (booking-flow list stagger + the live-marker
 * pulse) and stay local; they read the `motion` spring/timing constants from the shared `useTheme()`.
 */

export { useReducedMotion, usePressScale };

/** Entrance fade + lift for list/card items, staggered by index. Settled instantly under reduced motion. */
export function useEntrance(index = 0): {
  opacity: Animated.Value;
  transform: { translateY: Animated.AnimatedInterpolation<number> }[];
} {
  const reduce = useReducedMotion();
  const { motion } = useTheme();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      progress.setValue(1);
      return;
    }
    const delay = Math.min(index, motion.staggerMax) * motion.staggerStep;
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.durationBase,
      delay,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [reduce, index, progress, motion]);

  return {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };
}

/**
 * A looping 0→1 progress driver for ambient pulses (the live vehicle marker halo, the "live" dot).
 * Returns a settled `0` under reduced motion so callers render a static ring.
 */
export function usePulse(active = true): Animated.Value {
  const reduce = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce || !active) {
      v.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1600, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, active, v]);

  return v;
}
