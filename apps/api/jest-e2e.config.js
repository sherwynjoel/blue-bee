/** E2E tests — boot the real app against the real (seeded) Postgres + Redis. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleNameMapper: { '^@blue-bee/shared$': '<rootDir>/../../packages/shared/dist/index.js' },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
};
