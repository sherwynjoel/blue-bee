import { renderHook } from '@testing-library/react-native';
import { light as dtLight, dark as dtDark } from '@blue-bee/design-tokens';
import { useTheme, buildTheme, toneColors, HIT_SLOP, MIN_TARGET, type ThemeColors } from './theme';

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
