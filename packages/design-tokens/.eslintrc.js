module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, node: true, jest: true },
  ignorePatterns: ['node_modules/', 'dist/', '.eslintrc.js', 'jest.config.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};
