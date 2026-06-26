import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // `blue` is the single brand accent; `blueDark` is its hover/active shade and `blueSoft` its
        // tint (active-nav + brand surfaces). Keep all accent usage on these tokens for consistency.
        bb: {
          blue: '#1f6feb',
          blueDark: '#1a5fd0',
          blueSoft: '#eaf2fe',
          green: '#1a7f37',
          ink: '#1f2328',
          sub: '#57606a',
          line: '#eaeef2',
        },
      },
    },
  },
  plugins: [],
};

export default config;
