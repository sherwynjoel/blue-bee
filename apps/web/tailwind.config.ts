import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bb: { blue: '#1f6feb', green: '#1a7f37', ink: '#1f2328', sub: '#57606a', line: '#eaeef2' },
      },
    },
  },
  plugins: [],
};

export default config;
