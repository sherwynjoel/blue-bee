/** Unit tests — pure/fast specs under src/. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleNameMapper: { '^@blue-bee/shared$': '<rootDir>/../../packages/shared/dist/index.js' },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};
