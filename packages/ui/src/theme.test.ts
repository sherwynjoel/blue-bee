import { renderHook } from '@testing-library/react-native';
import { light as dtLight, dark as dtDark, space as dtSpace, radius as dtRadius } from '@blue-bee/design-tokens';
import {
  useTheme,
  buildTheme,
  toneColors,
  HIT_SLOP,
  MIN_TARGET,
  space as rnSpace,
  radius as rnRadius,
  type ThemeColors,
} from './theme';

describe('theme (packages/ui) — reconciled field names & design-tokens colors', () => {
  it('sources colors from @blue-bee/design-tokens (light + dark), not a local copy', () => {
    expect(buildTheme('light').colors).toEqual(dtLight);
    expect(buildTheme('dark').colors).toEqual(dtDark);
  });

  it('uses the reconciled color field names, not the old driver/owner-only names', () => {
    const c = buildTheme('light').colors;
    // Reconciled names present…
    expect(c.textSecondary).toBeDefined();
    expect(c.textTertiary).toBeDefined();
    expect(c.onAzureTint).toBeDefined();
    expect(c.onHoneyTint).toBeDefined();
    expect(c.onSuccessTint).toBeDefined();
    expect(c.onWarningTint).toBeDefined();
    expect(c.onDangerTint).toBeDefined();
    // …and the old driver/owner names are gone.
    const asRecord = c as unknown as Record<string, unknown>;
    expect(asRecord.textMuted).toBeUndefined();
    expect(asRecord.textFaint).toBeUndefined();
    expect(asRecord.azureInk).toBeUndefined();
    expect(asRecord.honeyInk).toBeUndefined();
    expect(asRecord.successInk).toBeUndefined();
  });

  it('includes the overline type variant (driver/owner had it; customer lacked it)', () => {
    expect(buildTheme('light').type.overline).toEqual({
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
      letterSpacing: 0.7,
    });
  });

  it('exposes the semantic radius tokens components rely on (button/input/card/sheet + sm)', () => {
    const r = buildTheme('light').radius;
    expect(r.button).toBe(14);
    expect(r.input).toBe(12);
    expect(r.card).toBe(16);
    expect(r.sheet).toBe(24);
    expect(r.sm).toBe(10); // added from driver/owner
  });

  it('toneColors resolves through the reconciled fields', () => {
    const c: ThemeColors = buildTheme('light').colors;
    expect(toneColors(c, 'azure')).toEqual({ ink: c.onAzureTint, bg: c.azureTint, solid: c.azure });
    expect(toneColors(c, 'success')).toEqual({ ink: c.onSuccessTint, bg: c.successTint, solid: c.success });
    expect(toneColors(c, 'neutral')).toEqual({ ink: c.textSecondary, bg: c.subtle, solid: c.textSecondary });
  });

  it('exports the driver/owner touch-target constants unchanged', () => {
    expect(HIT_SLOP).toEqual({ top: 8, bottom: 8, left: 8, right: 8 });
    expect(MIN_TARGET).toBe(48);
  });

  it('useTheme() reads the OS scheme (no provider) and returns a valid theme', () => {
    const { result } = renderHook(() => useTheme());
    // jest-expo's useColorScheme defaults to light.
    expect(result.current.scheme).toBe('light');
    expect(result.current.isDark).toBe(false);
    expect(result.current.colors).toEqual(dtLight);
    expect(result.current.type.headline).toBeDefined();
  });
});

/**
 * Drift guard: packages/ui keeps RN-shaped `space`/`radius` scales (semantic keys) rather than importing
 * design-tokens' web-shaped ones (numeric / t-shirt keys) — a deliberate, defensible split (see the
 * task-2 report). These scales are NOT unified into one source yet, so this suite fails the moment the
 * shared numeric values silently diverge, forcing a conscious reconciliation instead of a quiet drift.
 */
describe('scale drift guard — packages/ui RN scales vs @blue-bee/design-tokens', () => {
  it('space: every RN semantic token matches its design-tokens numeric-key equivalent', () => {
    // key mapping worked out during the Task 2 investigation (RN semantic -> design-tokens numeric step)
    expect(rnSpace.xs).toBe(dtSpace[1]); // 4
    expect(rnSpace.sm).toBe(dtSpace[2]); // 8
    expect(rnSpace.md).toBe(dtSpace[3]); // 12
    expect(rnSpace.lg).toBe(dtSpace[4]); // 16
    expect(rnSpace.xl).toBe(dtSpace[5]); // 20
    expect(rnSpace.xxl).toBe(dtSpace[6]); // 24
    expect(rnSpace.xxxl).toBe(dtSpace[8]); // 32
    expect(rnSpace.huge).toBe(dtSpace[10]); // 40
  });

  it('radius: RN tokens that have a design-tokens equivalent match it', () => {
    expect(rnRadius.sm).toBe(dtRadius.sm); // 10
    expect(rnRadius.input).toBe(dtRadius.md); // 12
    expect(rnRadius.card).toBe(dtRadius.lg); // 16
    expect(rnRadius.pill).toBe(dtRadius.pill); // 999
    // RN-only radii with NO design-tokens counterpart (nothing to assert against): `button: 14` and
    // `sheet: 24` — design-tokens has no matching token today. If design-tokens ever grows equivalents,
    // add assertions here.
    expect(rnRadius.button).toBe(14);
    expect(rnRadius.sheet).toBe(24);
  });
});
