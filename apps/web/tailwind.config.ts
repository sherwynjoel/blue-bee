import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { tailwindPreset, light, dark, type ColorScale } from '@blue-bee/design-tokens';

/*
 * ───────────────────────── Daylight design system ─────────────────────────
 * The premium operator-console theme. Colours resolve to CSS variables whose
 * light/dark values now come from the canonical @blue-bee/design-tokens color
 * scale (the SAME source the 3 RN apps consume — Royal Dry Cleaning brand), so a
 * single `.dark` class toggle re-themes everything. The token-derived :root/.dark
 * variables are emitted by the `daylight-tokens` plugin below (see tokenCssVars),
 * NOT hand-copied — app/globals.css only keeps the web-specific derived vars the
 * token scale doesn't model. The legacy `bb-*` tokens remap onto the same
 * variables so even un-restyled markup inherits the palette + dark-mode parity.
 *
 * `presets: [tailwindPreset]` wires this config to the shared design-tokens
 * preset (spacing / type ramp / radius / elevation). Tailwind loads this .ts
 * config through `jiti`, which resolves @blue-bee/design-tokens' raw-TS package
 * entry (a plain `require()` cannot — see the design-tokens package.json).
 */

/**
 * Web's CSS-variable base layer, derived from the canonical design-tokens color scale (single source
 * of truth). Keys are web's long-standing CSS var names; values are the token fields they map to.
 * Emitted for :root (light) and .dark (dark) by the plugin below so the class-based dark toggle keeps
 * working. Web-specific derived vars the token scale doesn't model — --primary-hover/-active,
 * --surface-translucent, --ring, --neutral-strong, --e1..3, --map-tile-filter — stay in globals.css.
 */
const tokenCssVars = (c: ColorScale): Record<string, string> => ({
  '--canvas': c.canvas,
  '--subtle': c.subtle,
  '--surface': c.surface,
  '--hairline': c.hairline,
  '--ink': c.text,
  '--text-secondary': c.textSecondary,
  '--text-tertiary': c.textTertiary,
  '--primary': c.azure,
  '--primary-tint': c.azureTint,
  '--on-primary': c.onAzure,
  '--primary-strong': c.onAzureTint,
  '--honey': c.honey,
  '--honey-tint': c.honeyTint,
  '--success': c.success,
  '--success-tint': c.successTint,
  '--success-strong': c.onSuccessTint,
  '--warning': c.warning,
  '--warning-tint': c.warningTint,
  '--warning-strong': c.onWarningTint,
  '--danger': c.danger,
  '--danger-tint': c.dangerTint,
  '--danger-strong': c.onDangerTint,
});

const config: Config = {
  darkMode: 'class',
  presets: [tailwindPreset as unknown as Config],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // semantic Daylight tokens (preferred going forward)
        canvas: 'var(--canvas)',
        subtle: 'var(--subtle)',
        surface: 'var(--surface)',
        hairline: 'var(--hairline)',
        ink: 'var(--ink)',
        secondary: 'var(--text-secondary)',
        tertiary: 'var(--text-tertiary)',
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          active: 'var(--primary-active)',
          tint: 'var(--primary-tint)',
          fg: 'var(--on-primary)',
        },
        honey: { DEFAULT: 'var(--honey)', tint: 'var(--honey-tint)' },
        success: { DEFAULT: 'var(--success)', tint: 'var(--success-tint)', strong: 'var(--success-strong)' },
        warning: { DEFAULT: 'var(--warning)', tint: 'var(--warning-tint)', strong: 'var(--warning-strong)' },
        danger: { DEFAULT: 'var(--danger)', tint: 'var(--danger-tint)', strong: 'var(--danger-strong)' },
        'primary-strong': 'var(--primary-strong)',
        'neutral-strong': 'var(--neutral-strong)',

        // Canonical azure/honey/text aliases matching the RN apps' token names, kept var-backed so
        // they honour dark mode. This also overrides the shared preset's LIGHT-literal `azure`/`text`
        // color tokens with the CSS-variable versions, so no non-theming literal color leaks into web.
        azure: { DEFAULT: 'var(--primary)', tint: 'var(--primary-tint)' },
        text: { DEFAULT: 'var(--ink)', secondary: 'var(--text-secondary)', tertiary: 'var(--text-tertiary)' },

        // legacy bb-* tokens → remapped onto the Daylight variables (back-compat
        // so untouched screens pick up the new palette + dark mode for free).
        bb: {
          blue: 'var(--primary)',
          blueDark: 'var(--primary-hover)',
          blueSoft: 'var(--primary-tint)',
          green: 'var(--success)',
          ink: 'var(--ink)',
          sub: 'var(--text-secondary)',
          line: 'var(--hairline)',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['var(--font-jbmono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        // px/lineHeight from the Daylight type scale; titles carry tight tracking
        display: ['34px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
        title1: ['28px', { lineHeight: '34px', letterSpacing: '-0.02em', fontWeight: '700' }],
        title2: ['22px', { lineHeight: '28px', letterSpacing: '-0.02em', fontWeight: '600' }],
        title3: ['20px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '600' }],
        headline: ['17px', { lineHeight: '22px', fontWeight: '600' }],
        body: ['16px', { lineHeight: '24px' }],
        subhead: ['15px', { lineHeight: '20px', fontWeight: '500' }],
        footnote: ['13px', { lineHeight: '18px' }],
        caption: ['12px', { lineHeight: '16px' }],
      },
      letterSpacing: { tightest: '-0.02em' },
      borderRadius: {
        card: '16px',
        btn: '12px',
        input: '12px',
        sheet: '20px',
        // The shared preset maps the design-tokens px radius scale onto sm/md/lg/xl/2xl; re-assert
        // Tailwind's defaults here so existing `rounded-{sm,md,lg,xl,2xl}` utilities keep their current
        // pixel radii — radius is NOT part of the Royal Dry Cleaning rebrand (colors only).
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
      boxShadow: {
        e1: 'var(--e1)',
        e2: 'var(--e2)',
        e3: 'var(--e3)',
        focus: '0 0 0 3px var(--ring)',
      },
      transitionTimingFunction: {
        daylight: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
      transitionDuration: {
        fast: '120ms',
        DEFAULT: '200ms',
        slow: '320ms',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        'pulse-ring': { '0%': { transform: 'scale(0.7)', opacity: '0.55' }, '70%, 100%': { transform: 'scale(2.4)', opacity: '0' } },
      },
      animation: {
        shimmer: 'shimmer 1.5s infinite',
        'fade-in': 'fade-in 200ms cubic-bezier(0.2,0.8,0.2,1) both',
        'fade-up': 'fade-up 320ms cubic-bezier(0.2,0.8,0.2,1) both',
        'scale-in': 'scale-in 200ms cubic-bezier(0.2,0.8,0.2,1) both',
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.2,0.8,0.2,1) infinite',
      },
    },
  },
  plugins: [
    // Emit the token-derived CSS variables for :root (light) + .dark (dark) straight from the
    // canonical @blue-bee/design-tokens scale, so globals.css never hand-copies a hex value and the
    // console can't drift from the shared source again.
    plugin(({ addBase }) => {
      addBase({
        ':root': tokenCssVars(light),
        '.dark': tokenCssVars(dark),
      });
    }),
  ],
};

export default config;
