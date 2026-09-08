module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, node: true },
  // No jest / *.spec.ts / *.test.ts files exist in this package (pure types + Zod validators, no test
  // suite of its own — it's exercised transitively by every consumer's tests), so there's no test-file
  // override or jest env/ignore entry to add here (unlike apps/api's identical base config).
  ignorePatterns: ['node_modules/', 'dist/', '.eslintrc.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
};
