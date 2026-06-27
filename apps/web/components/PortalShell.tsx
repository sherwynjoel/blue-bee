'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Moon, Sun } from 'lucide-react';
import { useSession } from '@/lib/session';
import { isOps, isPortal, roleNames } from '@/lib/rbac';
import { useTheme } from '@/lib/theme';
import { Button, IconButton, Loading } from './ui';
import { Login } from './Login';
import { Logo } from './Logo';

/** The dark-mode toggle (jsdom-safe; persists the choice). */
function ThemeToggle(): React.ReactElement {
  const { dark, toggle } = useTheme();
  return (
    <IconButton label={dark ? 'Switch to light mode' : 'Switch to dark mode'} variant="secondary" size="sm" onClick={toggle}>
      {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </IconButton>
  );
}

/**
 * The B2B self-serve invoice portal shell. Auth-gate + a slim top bar (no ops sidebar). loading →
 * spinner; signed-out → Login; an ops-only token → bounced to the console; a non-portal/non-ops token
 * → a clear no-access page; else the portal chrome. RBAC here is UX only — every endpoint is enforced
 * account-scoped server-side.
 */
export function PortalShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status, me, logout } = useSession();
  const router = useRouter();

  // A pure operator who lands here belongs in the console.
  const toConsole = status === 'signedIn' && isOps(me) && !isPortal(me);
  useEffect(() => {
    if (toConsole) router.replace('/orders');
  }, [toConsole, router]);

  if (status === 'loading') return <Loading label="Loading your portal…" />;
  if (status === 'signedOut') return <Login />;
  if (toConsole) return <Loading label="Opening the console…" />;

  if (!isPortal(me)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
        <Logo size="lg" />
        <h1 className="text-title2 text-ink">No portal access</h1>
        <p className="max-w-md text-footnote text-secondary">
          This account ({roleNames(me).join(', ') || 'no account role'}) isn’t a building account admin. The billing portal is for account
          admins and staff.
        </p>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-hairline bg-surface/80 px-4 backdrop-blur-md sm:px-6">
        <Logo />
        <span className="ml-1 hidden text-footnote font-medium uppercase tracking-wide text-tertiary sm:block">Billing portal</span>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="truncate text-footnote font-semibold text-ink">{me?.user.name}</p>
            <p className="truncate text-caption text-secondary">{me?.org.name}</p>
          </div>
          <ThemeToggle />
          <IconButton label="Sign out" variant="secondary" size="sm" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
