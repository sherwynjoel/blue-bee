'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';
import { can, isOps, roleNames } from '@/lib/rbac';
import { Button, Loading } from './ui';
import { Login } from './Login';

interface NavItem {
  href: string;
  label: string;
  show: boolean;
}

/**
 * The console auth-gate + role-gated shell (Increment 13). loading → spinner; signed-out → Login;
 * signed-in but NOT an ops role → a clear no-access page (a customer-only token gets nothing); else the
 * nav shell. Nav items are role-gated for UX only — every endpoint is independently enforced server-side.
 */
export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status, me, logout } = useSession();
  const pathname = usePathname();

  if (status === 'loading') return <Loading label="Loading console…" />;
  if (status === 'signedOut') return <Login />;

  if (!isOps(me)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="text-xl font-bold text-bb-ink">No console access</h1>
        <p className="max-w-md text-sm text-bb-sub">
          This account ({roleNames(me).join(', ') || 'no ops role'}) isn’t an operator. The console is for owner / dispatcher / CSR / plant /
          finance staff.
        </p>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </main>
    );
  }

  const nav: NavItem[] = [
    { href: '/orders', label: 'Orders', show: true },
    { href: '/dispatch', label: 'Dispatch', show: can.dispatch(me) || can.fleet(me) },
    { href: '/fleet', label: 'Live fleet', show: can.fleet(me) },
    { href: '/finance', label: 'Finance', show: can.finance(me) },
    { href: '/analytics', label: 'Analytics', show: can.analytics(me) },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b border-bb-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link href="/orders" className="text-lg font-bold text-bb-ink">
              🐝 Blue Bee
            </Link>
            <nav className="flex items-center gap-1">
              {nav
                .filter((n) => n.show)
                .map((n) => {
                  const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium ${active ? 'bg-blue-50 text-bb-blue' : 'text-bb-sub hover:text-bb-ink'}`}
                    >
                      {n.label}
                    </Link>
                  );
                })}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-bb-sub">
              {me?.user.name} · <span className="font-medium text-bb-ink">{me?.org.name}</span>
            </span>
            <Button variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

/** Wraps a screen that requires a specific ops capability; renders a gentle notice if not allowed. */
export function RequireCapability({ allowed, children }: { allowed: boolean; children: React.ReactNode }): React.ReactElement {
  if (!allowed) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">You don’t have access to this section.</div>;
  }
  return <>{children}</>;
}
