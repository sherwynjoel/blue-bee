// Mirrors apps/driver/.eslintrc.js (the RN/JSX-aware config) rather than the pure-TS
// packages/api-client one, since this package ships .tsx components. Same rule set as the
// rest of the monorepo; jsx enabled; test files may use `any`.
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, node: true, jest: true },
  ignorePatterns: ['node_modules/', 'dist/', '.eslintrc.js', 'jest.config.js', 'jest.setup.js', 'babel.config.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};
