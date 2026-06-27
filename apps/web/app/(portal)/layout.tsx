'use client';

import type { ReactNode } from 'react';
import { PortalShell } from '@/components/PortalShell';

/** Every portal route is wrapped by the B2B account-customer auth-gate + shell (not the ops console). */
export default function PortalLayout({ children }: { children: ReactNode }): ReactNode {
  return <PortalShell>{children}</PortalShell>;
}
