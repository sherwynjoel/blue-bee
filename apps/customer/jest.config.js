module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  // Transform RN/Expo ESM deps that ship untranspiled (+ the @blue-bee workspace packages).
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-maps|@stripe/stripe-react-native|socket.io-client|engine.io-client|@blue-bee/.*))',
  ],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  moduleNameMapper: {
    '^@blue-bee/shared$': '<rootDir>/../../packages/shared/dist/index.js',
    '^@blue-bee/api-client$': '<rootDir>/../../packages/api-client/dist/index.js',
    // @blue-bee/ui + @blue-bee/design-tokens are consumed as TypeScript SOURCE (no dist build) — map to
    // src so jest transforms the same files Metro/tsc resolve (transformIgnorePatterns already allows
    // @blue-bee/* through babel).
    '^@blue-bee/ui$': '<rootDir>/../../packages/ui/src/index.ts',
    '^@blue-bee/design-tokens$': '<rootDir>/../../packages/design-tokens/src/index.ts',
  },
};
