import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Blue Bee — Operator Console',
  description: 'Back-of-house console: orders, intake, quote, dispatch, fleet, finance.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
