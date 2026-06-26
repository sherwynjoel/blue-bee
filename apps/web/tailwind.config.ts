import type { Config } from 'tailwindcss';

/*
 * ───────────────────────── Daylight design system ─────────────────────────
 * The premium operator-console theme. Colours resolve to CSS variables defined
 * in app/globals.css (light) + the `.dark` override, so a single class toggle
 * re-themes everything. The legacy `bb-*` tokens are remapped onto the same
 * variables so even un-restyled markup inherits the palette + dark-mode parity.
 */
const config: Config = {
  darkMode: 'class',
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
  plugins: [],
};

export default config;
