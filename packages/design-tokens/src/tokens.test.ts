import { tokens, light, dark, space, radius, fontSize, shadow, motion, tailwindPreset } from './index';

/**
 * A small, real assertion that the canonical token values exist and match the spec exactly. These
 * are the values every reskin surface mirrors, so a silent drift here would desync the whole system.
 */
describe('@blue-bee/design-tokens', () => {
  it('exposes the light color scale with the exact brand values', () => {
    expect(light.canvas).toBe('#F4F6FB');
    expect(light.surface).toBe('#FFFFFF');
    expect(light.text).toBe('#0A2540');
    expect(light.azure).toBe('#1E50C8');
    expect(light.azureTint).toBe('#E7ECFB');
    expect(light.honey).toBe('#DDA82E');
    expect(light.success).toBe('#14B86A');
    expect(light.danger).toBe('#E5484D');
  });

  it('exposes the dark color scale with the exact dark values', () => {
    expect(dark.canvas).toBe('#0A0E1A');
    expect(dark.surface).toBe('#141B2D');
    expect(dark.hairline).toBe('rgba(255,255,255,0.08)');
    expect(dark.azure).toBe('#5B87F5');
    expect(dark.azureTint).toBe('rgba(91,135,245,0.18)');
    expect(dark.danger).toBe('#FF6168');
  });

  it('uses an 8pt spacing rhythm with fine half-steps', () => {
    expect(space[0]).toBe(0);
    expect(space[0.5]).toBe(2);
    expect(space[1]).toBe(4);
    expect(space[2]).toBe(8);
    expect(space[8]).toBe(32);
    expect(space[16]).toBe(64);
  });

  it('exposes the radius ramp incl. the pill', () => {
    expect(radius.xs).toBe(6);
    expect(radius.sm).toBe(10);
    expect(radius.md).toBe(12);
    expect(radius['2xl']).toBe(28);
    expect(radius.pill).toBe(999);
  });

  it('exposes the type ramp (size/lineHeight/weight/tracking)', () => {
    expect(fontSize.display).toEqual({ size: 34, lineHeight: 40, weight: 700, tracking: -0.02 });
    expect(fontSize.body).toEqual({ size: 16, lineHeight: 24, weight: 400, tracking: 0 });
    expect(fontSize.caption.tracking).toBe(0.01);
  });

  it('adds the overline type variant matching driver/owner\'s production value', () => {
    expect(fontSize.overline).toEqual({ size: 12, lineHeight: 16, weight: 700, tracking: 0.7 });
  });

  it('exposes elevation + motion', () => {
    expect(shadow.focus).toBe('0 0 0 3px rgba(11,95,255,.35)');
    expect(shadow.e2).toContain('rgba(10,37,64,.08)');
    expect(motion.durations.sheet).toBe(400);
    expect(motion.easing.standard).toBe('cubic-bezier(.2,.8,.2,1)');
    expect(motion.spring).toEqual({ damping: 18, stiffness: 180, mass: 1 });
  });

  it('derives a Tailwind preset that stays in lock-step with the tokens', () => {
    expect(tailwindPreset.theme.extend.spacing['8']).toBe('32px');
    expect(tailwindPreset.theme.extend.borderRadius.pill).toBe('999px');
    expect(tailwindPreset.theme.extend.boxShadow.e2).toBe(shadow.e2);
    const display = tailwindPreset.theme.extend.fontSize.display;
    expect(display).toBeDefined();
    expect(display?.[0]).toBe('34px');
    expect(display?.[1].lineHeight).toBe('40px');
    expect(display?.[1].fontWeight).toBe('700');
    expect((tailwindPreset.theme.extend.colors.azure as Record<string, string>).DEFAULT).toBe(light.azure);
  });

  it('bundles everything under a single `tokens` object', () => {
    expect(tokens.color.light.azure).toBe('#1E50C8');
    expect(tokens.color.dark.azure).toBe('#5B87F5');
    expect(tokens.space[4]).toBe(16);
  });
});

describe('canonical color scale — Royal Dry Cleaning brand, azure/honey naming', () => {
  it('uses the azure/honey brand fields, not the old generic primary/accent names', () => {
    expect(light).not.toHaveProperty('primary');
    expect(light).not.toHaveProperty('accent');
    expect(light.azure).toBeDefined();
    expect(light.honey).toBeDefined();
  });

  it('carries the Royal Dry Cleaning brand values', () => {
    expect(light.azure).toBe('#1E50C8');
    expect(light.honey).toBe('#DDA82E');
  });

  it('has the full reconciled field superset in both light and dark', () => {
    const requiredFields = [
      'canvas', 'subtle', 'surface', 'surfacePressed', 'hairline',
      'text', 'textSecondary', 'textTertiary',
      'azure', 'azureTint', 'honey', 'honeyTint',
      'success', 'successTint', 'warning', 'warningTint', 'danger', 'dangerTint',
      'onAzure', 'onHoney', 'onAzureTint', 'onSuccessTint', 'onWarningTint', 'onDangerTint', 'onHoneyTint',
      'scrim', 'skeleton', 'skeletonHighlight',
    ];
    for (const field of requiredFields) {
      expect(light).toHaveProperty(field);
      expect(dark).toHaveProperty(field);
    }
  });
});
