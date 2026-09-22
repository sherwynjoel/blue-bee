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

  it('adds the overline type variant, tracking converted from RN points to this file\'s em convention', () => {
    // driver/owner's raw RN value is { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.7 }
    // (points). This file's `tracking` is em, so 0.7 / 12 (the font size) ≈ 0.058 — NOT 0.7 (0.7em would
    // be ~8.4px of extra space after every character on a 12px font, wider than the letters themselves).
    expect(fontSize.overline).toEqual({ size: 12, lineHeight: 16, weight: 700, tracking: 0.058 });
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
      'successSolid', 'onSuccess', 'dangerSolid', 'onDanger',
      'scrim', 'skeleton', 'skeletonHighlight',
    ];
    for (const field of requiredFields) {
      expect(light).toHaveProperty(field);
      expect(dark).toHaveProperty(field);
    }
  });
});

/**
 * The values above are only correct if they are LEGIBLE. This computes WCAG 2.1 contrast from the
 * token values themselves and fails if any pair the UI actually draws drops below its threshold —
 * 4.5:1 for text, which is what a 17px semibold button label needs. Four of these pairs shipped
 * failing before this suite existed (white on `danger` was 3.91:1); the point of the test is that
 * the next person to nudge a hex finds out immediately instead of at an accessibility audit.
 */
describe('token contrast (WCAG 2.1 AA)', () => {
  const channels = (c: string): [number, number, number, number] => {
    const rgba = /rgba?\(([^)]+)\)/.exec(c);
    if (rgba?.[1]) {
      const p = rgba[1].split(',').map((x) => parseFloat(x.trim()));
      return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
    }
    const h = c.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
      1,
    ];
  };

  /** Flatten `fg` (which may be translucent) onto the opaque `bg`. */
  const flatten = (fg: string, bg: string): [number, number, number] => {
    const [r, g, b, a] = channels(fg);
    const [bgR, bgG, bgB] = channels(bg);
    return [r * a + bgR * (1 - a), g * a + bgG * (1 - a), b * a + bgB * (1 - a)];
  };

  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  const luminance = ([r, g, b]: [number, number, number]): number =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  const contrast = (fg: string, bg: string, base: string): number => {
    const bgFlat = flatten(bg, base);
    const fgFlat = flatten(fg, `rgb(${bgFlat.join(',')})`);
    const a = luminance(fgFlat);
    const b = luminance(bgFlat);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };

  it.each([
    ['black on white is the known 21:1 anchor', '#000000', '#FFFFFF', '#FFFFFF', 21],
    ['#767676 on white is the known 4.54:1 anchor', '#767676', '#FFFFFF', '#FFFFFF', 4.5],
  ])('%s', (_name, fg, bg, base, min) => {
    expect(contrast(fg, bg, base)).toBeGreaterThanOrEqual(min - 0.01);
  });

  const textPairs = (): Array<[string, string, string, string]> => {
    const out: Array<[string, string, string, string]> = [];
    for (const [scheme, c] of [['light', light], ['dark', dark]] as const) {
      const base = c.canvas;
      for (const ground of ['canvas', 'surface', 'subtle'] as const) {
        for (const ink of ['text', 'textSecondary', 'textTertiary'] as const) {
          out.push([`${scheme} ${ink} on ${ground}`, c[ink], c[ground], base]);
        }
      }
      out.push(
        [`${scheme} onAzure on azure`, c.onAzure, c.azure, base],
        [`${scheme} onHoney on honey`, c.onHoney, c.honey, base],
        [`${scheme} onSuccess on successSolid`, c.onSuccess, c.successSolid, base],
        [`${scheme} onDanger on dangerSolid`, c.onDanger, c.dangerSolid, base],
        [`${scheme} azure label on surface`, c.azure, c.surface, base],
        [`${scheme} successSolid label on surface`, c.successSolid, c.surface, base],
        [`${scheme} dangerSolid label on surface`, c.dangerSolid, c.surface, base],
        [`${scheme} onAzureTint on azureTint`, c.onAzureTint, c.azureTint, c.surface],
        [`${scheme} onSuccessTint on successTint`, c.onSuccessTint, c.successTint, c.surface],
        [`${scheme} onWarningTint on warningTint`, c.onWarningTint, c.warningTint, c.surface],
        [`${scheme} onDangerTint on dangerTint`, c.onDangerTint, c.dangerTint, c.surface],
        [`${scheme} onHoneyTint on honeyTint`, c.onHoneyTint, c.honeyTint, c.surface],
      );
    }
    return out;
  };

  it.each(textPairs())('%s meets 4.5:1', (_name, fg, bg, base) => {
    expect(contrast(fg, bg, base)).toBeGreaterThanOrEqual(4.5);
  });
});
