import './globals.css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui';

// Inter for UI, JetBrains Mono (tabular figures) for money / IDs / timestamps.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const jbMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jbmono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Blue Bee — Operator Console',
  description: 'Back-of-house console: orders, intake, quote, dispatch, fleet, finance.',
};

// Sets the theme class on <html> before first paint (no flash). Reads the saved
// choice, else the OS preference. Mirrors the toggle in lib/theme.ts.
const THEME_INIT = `(function(){try{var t=localStorage.getItem('bb-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" className={`${inter.variable} ${jbMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen bg-canvas font-sans text-body text-ink antialiased">
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
