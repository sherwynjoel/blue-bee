import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated } from 'react-native';
import { motion } from './theme';

/**
 * Daylight motion helpers on RN's built-in `Animated` (no extra native deps). Every helper degrades to
 * a static, instantly-settled state when the OS "Reduce Motion" setting is on — so animation is always
 * an enhancement, never required for the UI to make sense.
 */

/** Live OS "Reduce Motion" preference (with change subscription). */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    // Guard the result shape: some environments (jest) return undefined rather than a Promise.
    const probe = AccessibilityInfo.isReduceMotionEnabled?.();
    if (probe && typeof (probe as Promise<boolean>).then === 'function') {
      (probe as Promise<boolean>).then((v) => mounted && setReduce(!!v)).catch(() => undefined);
    }
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/**
 * Press-scale feedback for primary controls (scale → .97 on press, spring back on release). Returns a
 * `transform` to spread onto an `Animated.View` plus the press handlers. No-op under reduced motion.
 */
export function usePressScale(enabled = true): {
  scale: Animated.Value;
  transform: { scale: Animated.Value }[];
  onPressIn: () => void;
  onPressOut: () => void;
} {
  const reduce = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() => {
    if (reduce || !enabled) return;
    Animated.spring(scale, { toValue: motion.pressScale, ...motion.springPress }).start();
  }, [reduce, enabled, scale]);

  const onPressOut = useCallback(() => {
    if (reduce || !enabled) return;
    Animated.spring(scale, { toValue: 1, ...motion.springPress }).start();
  }, [reduce, enabled, scale]);

  return { scale, transform: [{ scale }], onPressIn, onPressOut };
}

/** Entrance fade + lift for list/card items, staggered by index. Settled instantly under reduced motion. */
export function useEntrance(index = 0): { opacity: Animated.Value; transform: { translateY: Animated.AnimatedInterpolation<number> }[] } {
  const reduce = useReducedMotion();
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
  }, [reduce, index, progress]);

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
