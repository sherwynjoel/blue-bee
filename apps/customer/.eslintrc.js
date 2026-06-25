module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, node: true, jest: true },
  ignorePatterns: ['node_modules/', 'dist/', '.expo/', 'babel.config.js', 'metro.config.js', 'jest.setup.js', '.eslintrc.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-console': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/*.test.tsx', 'scripts/**/*.ts'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};
