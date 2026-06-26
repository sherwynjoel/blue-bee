import '@testing-library/jest-dom';
import React from 'react';

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
