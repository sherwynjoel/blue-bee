import { tokens, light, dark, space, radius, fontSize, shadow, motion, tailwindPreset } from './index';

/**
 * A small, real assertion that the canonical token values exist and match the spec exactly. These
 * are the values every reskin surface mirrors, so a silent drift here would desync the whole system.
 */
describe('@blue-bee/design-tokens', () => {
  it('exposes the light color scale with the exact brand values', () => {
    expect(light.canvas).toBe('#FBFCFE');
    expect(light.surface).toBe('#FFFFFF');
    expect(light.textPrimary).toBe('#0A2540');
    expect(light.primary).toBe('#0B5FFF');
    expect(light.primaryHover).toBe('#0A54E0');
    expect(light.primaryActive).toBe('#0848C2');
    expect(light.primaryTint).toBe('#E8F0FF');
    expect(light.success).toBe('#14B86A');
    expect(light.danger).toBe('#E5484D');
  });

  it('exposes the dark color scale with the exact dark values', () => {
    expect(dark.canvas).toBe('#0A0E1A');
    expect(dark.surface).toBe('#141B2D');
    expect(dark.hairline).toBe('rgba(255,255,255,0.08)');
    expect(dark.primary).toBe('#3D8BFF');
    expect(dark.primaryTint).toBe('rgba(61,139,255,0.16)');
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
    expect(radius.md).toBe(12);
    expect(radius['2xl']).toBe(28);
    expect(radius.pill).toBe(999);
  });

  it('exposes the type ramp (size/lineHeight/weight/tracking)', () => {
    expect(fontSize.display).toEqual({ size: 34, lineHeight: 40, weight: 700, tracking: -0.02 });
    expect(fontSize.body).toEqual({ size: 16, lineHeight: 24, weight: 400, tracking: 0 });
    expect(fontSize.caption.tracking).toBe(0.01);
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
    expect((tailwindPreset.theme.extend.colors.primary as Record<string, string>).DEFAULT).toBe(light.primary);
  });

  it('bundles everything under a single `tokens` object', () => {
    expect(tokens.color.light.primary).toBe('#0B5FFF');
    expect(tokens.color.dark.primary).toBe('#3D8BFF');
    expect(tokens.space[4]).toBe(16);
  });
});
