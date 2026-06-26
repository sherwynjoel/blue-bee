'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';

/** Every console route is wrapped by the auth-gate + role-gated shell. */
export default function ConsoleLayout({ children }: { children: ReactNode }): ReactNode {
  return <AppShell>{children}</AppShell>;
}
