import '@testing-library/jest-dom';
import React from 'react';

// jsdom 20 (pinned by jest-environment-jsdom@29) ships a `Crypto` without `randomUUID` — every real
// browser the console targets has had it for years (Chrome 92+, Safari 15.4+, Firefox 95+). Patch the
// test environment's gap with Node's own implementation rather than changing the production code.
if (typeof globalThis.crypto?.randomUUID !== 'function') {
  const nodeCrypto: { randomUUID: () => string } = require('node:crypto');
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: nodeCrypto.randomUUID, configurable: true });
}

// next/link + next/navigation need an app router context that doesn't exist under jsdom — stub them so
// component tests render. (These are test-only mocks; the shipped app uses the real Next modules.)
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: unknown; children: React.ReactNode }) =>
    React.createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children),
}));

const routerMock = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() };
jest.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(),
}));
