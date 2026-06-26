/** Unit tests for the pure token constants — plain ts-jest (no RN/Expo), Node env. */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'CommonJS',
          esModuleInterop: true,
          skipLibCheck: true,
          lib: ['ES2021'],
          types: ['jest', 'node'],
        },
      },
    ],
  },
};
