/**
 * RN/Expo component tests for the shared UI kit. Mirrors apps/driver's jest setup (preset jest-expo,
 * transform the untranspiled RN/Expo + @blue-bee workspace deps). @blue-bee/design-tokens is resolved
 * to its TypeScript SOURCE (it has no built dist and this package consumes it as source) so the tests
 * never depend on a separate build step.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-maps|@blue-bee/.*))',
  ],
  testMatch: ['**/src/**/*.test.ts', '**/src/**/*.test.tsx'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  moduleNameMapper: {
    '^@blue-bee/design-tokens$': '<rootDir>/../design-tokens/src/index.ts',
  },
};
