'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Building2,
  ClipboardList,
  Landmark,
  Layers,
  Map as MapIcon,
  Tag,
  type LucideIcon,
  LogOut,
  MapPin,
  Menu,
  Moon,
  Route as RouteIcon,
  Settings,
  Shirt,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useSession } from '@/lib/session';
import { can, isOps, isPortal, roleNames } from '@/lib/rbac';
import { useTheme } from '@/lib/theme';
import { Button, IconButton, Loading, cn } from './ui';
import { Login } from './Login';
import { Logo } from './Logo';

interface NavItem {
  href: string;
  label: string;
  show: boolean;
  icon: LucideIcon;
}
interface NavGroup {
  heading: string;
  items: NavItem[];
}

/** The dark-mode toggle — jsdom-safe (no matchMedia), persists the operator's choice. */
function ThemeToggle(): React.ReactElement {
  const { dark, toggle } = useTheme();
  return (
    <IconButton label={dark ? 'Switch to light mode' : 'Switch to dark mode'} variant="secondary" size="sm" onClick={toggle}>
      {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </IconButton>
  );
}

/**
 * The console auth-gate + role-gated shell. loading → spinner; signed-out → Login;
 * signed-in but NOT an ops role → a clear no-access page; else the Daylight shell
 * (left sidebar + slim top bar). Nav items are role-gated for UX only — every
 * endpoint is independently enforced server-side.
 */
export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status, me, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  // A B2B account customer (ACCOUNT_ADMIN/ACCOUNT_STAFF, not an ops role) belongs in the self-serve
  // invoice portal, not the operator console — route them there (the server stays authoritative).
  const toPortal = status === 'signedIn' && isPortal(me) && !isOps(me);
  useEffect(() => {
    if (toPortal) router.replace('/portal');
  }, [toPortal, router]);

  if (status === 'loading') return <Loading label="Loading console…" />;
  if (status === 'signedOut') return <Login />;
  if (toPortal) return <Loading label="Opening your portal…" />;

  if (!isOps(me)) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-6 text-center">
        <Logo size="lg" />
        <h1 className="text-title2 text-ink">No console access</h1>
        <p className="max-w-md text-footnote text-secondary">
          This account ({roleNames(me).join(', ') || 'no ops role'}) isn’t an operator. The console is for owner / dispatcher / CSR / plant /
          finance staff.
        </p>
        <Button variant="secondary" onClick={() => void logout()}>
          Sign out
        </Button>
      </main>
    );
  }

  const groups: NavGroup[] = [
    {
      heading: 'Operations',
      items: [
        { href: '/orders', label: 'Orders', show: true, icon: ClipboardList },
        { href: '/dispatch', label: 'Dispatch', show: can.dispatch(me) || can.fleet(me), icon: RouteIcon },
        { href: '/fleet', label: 'Live fleet', show: can.fleet(me), icon: MapPin },
        { href: '/residents', label: 'Residents', show: can.residents(me), icon: Shirt },
        { href: '/facility-linen', label: 'Facility linen', show: can.facilityLinen(me), icon: Layers },
      ],
    },
    {
      heading: 'Commercial',
      items: [
        // [Inc-27] Consumer customers. Sits beside Accounts: `AccountDetail` is the B2B 360, this is the
        // residential one. OWNER/CSR only — it reads PII.
        { href: '/customers', label: 'Customers', show: can.customers(me), icon: Users },
        { href: '/accounts', label: 'Accounts', show: can.accounts(me), icon: Building2 },
        { href: '/corporate', label: 'Corporate', show: can.corporate(me), icon: Landmark },
        { href: '/service-zones', label: 'Service zones', show: can.zones(me), icon: MapIcon },
        { href: '/catalog', label: 'Catalog & pricing', show: can.catalog(me), icon: Tag },
        { href: '/finance', label: 'Finance', show: can.finance(me), icon: Wallet },
        { href: '/analytics', label: 'Analytics', show: can.analytics(me), icon: BarChart3 },
      ],
    },
    {
      heading: 'Administration',
      items: [{ href: '/admin', label: 'Admin', show: can.admin(me), icon: Settings }],
    },
  ];

  return (
    <div className="min-h-screen bg-canvas lg:flex">
      {/* scrim for the mobile drawer */}
      {navOpen && <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[2px] lg:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />}

      {/* sidebar (static on lg, slide-over drawer below lg) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-hairline bg-surface transition-transform duration-300 ease-daylight',
          'lg:static lg:z-auto lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between px-4">
          <Link href="/orders" aria-label="Blue Bee — go to orders" className="shrink-0 rounded focus-visible:outline-none focus-visible:shadow-focus" onClick={() => setNavOpen(false)}>
            <Logo />
          </Link>
          <IconButton label="Close navigation" size="sm" className="lg:hidden" onClick={() => setNavOpen(false)}>
            <X className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g) => {
            const visible = g.items.filter((n) => n.show);
            if (visible.length === 0) return null;
            return (
              <div key={g.heading} className="mb-5">
                <p className="px-3 pb-1.5 text-caption font-semibold uppercase tracking-wide text-tertiary">{g.heading}</p>
                <ul className="space-y-0.5">
                  {visible.map((n) => {
                    const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
                    const Icon = n.icon;
                    return (
                      <li key={n.href}>
                        <Link
                          href={n.href}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => setNavOpen(false)}
                          className={cn(
                            'group flex items-center gap-3 rounded-btn px-3 py-2 text-subhead font-medium transition duration-fast ease-daylight focus-visible:outline-none focus-visible:shadow-focus',
                            active ? 'bg-primary-tint text-primary' : 'text-secondary hover:bg-subtle hover:text-ink',
                          )}
                        >
                          <Icon className={cn('h-[18px] w-[18px] shrink-0', active ? 'text-primary' : 'text-tertiary group-hover:text-secondary')} strokeWidth={2} />
                          {n.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-hairline p-3">
          <div className="flex items-center gap-3 rounded-btn px-2 py-1.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-subhead font-semibold text-primary">
              {(me?.user.name ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-footnote font-semibold text-ink">{me?.user.name}</p>
              <p className="truncate text-caption text-secondary">{me?.org.name}</p>
            </div>
            <IconButton label="Sign out" size="sm" onClick={() => void logout()}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-hairline bg-surface/80 px-4 backdrop-blur-md sm:px-6">
          <IconButton label="Open navigation" size="sm" className="lg:hidden" onClick={() => setNavOpen(true)}>
            <Menu className="h-5 w-5" aria-hidden="true" />
          </IconButton>
          {/* mobile brand mark (the sidebar logo is off-canvas on small screens) */}
          <span className="lg:hidden">
            <Logo />
          </span>
          <p className="ml-1 hidden text-footnote font-medium uppercase tracking-wide text-tertiary lg:block">Operator console</p>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Wraps a screen that requires a specific ops capability; renders a gentle notice if not allowed. */
export function RequireCapability({ allowed, children }: { allowed: boolean; children: React.ReactNode }): React.ReactElement {
  if (!allowed) {
    return (
      <div className="rounded-card border border-warning bg-warning-tint p-6 text-footnote text-warning-strong">
        You don’t have access to this section.
      </div>
    );
  }
  return <>{children}</>;
}
