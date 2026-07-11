'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { CustomerListItem } from '@blue-bee/shared';
import { Search, Users } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { formatNumber, shortDate } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, Input, PageHeader, Table, TableSkeleton, Td, Th } from './ui';
import { RequireCapability } from './AppShell';

/**
 * Residential-customer directory (Increment 27). B2B accounts have `AccountsHome` → `AccountDetail`;
 * consumers had no equivalent, which mattered the moment Inc-26 gave them saved addresses.
 *
 * Server-authoritative and org-scoped: this list renders the real rows from `GET /v1/admin/customers` and
 * nothing else. RBAC-gated for UX only (OWNER/CSR) — the server enforces the same gate independently.
 *
 * Two column names carry weight. `Order` has no `userId`, so orders belong to the customer's ACCOUNT, not
 * provably to the person: the header says "Account orders", never "Orders". And "Addresses" counts only
 * ACTIVE saved addresses, because a removed one is soft-deleted (Inc-26), not gone.
 */
export function CustomersHome(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.customers(me)}>
      <CustomersHomeInner />
    </RequireCapability>
  );
}

function CustomersHomeInner(): React.ReactElement {
  const { client } = useSession();
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');

  // Debounce so a search doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const state = useAsync(() => client.listCustomers({ limit: 100, ...(search ? { search } : {}) }), [search]);
  const customers: CustomerListItem[] = state.data?.customers ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Customers"
        subtitle="Residential customers — profile, saved addresses, orders and billing in one place."
      />

      <Card padded={false} className="p-5">
        <div className="relative mb-4 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.75} />
          <Input
            aria-label="Search customers"
            placeholder="Search by name, phone or email…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {state.loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : state.error ? (
          <ErrorBox message={state.error} onRetry={state.reload} />
        ) : customers.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" strokeWidth={1.75} />}
            title={search ? 'No matching customers' : 'No customers yet'}
            message={
              search
                ? `Nothing matches “${search}”. Try a different name, phone or email.`
                : 'Residential customers appear here once they sign up.'
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Contact</Th>
                  <Th>Status</Th>
                  {/* Orders belong to the ACCOUNT — `Order` carries no userId. Say so in the header. */}
                  <Th numeric>Account orders</Th>
                  <Th>Last order</Th>
                  <Th numeric>Addresses</Th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.userId} data-testid={`customer-${c.userId}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <Td>
                      <Link href={`/customers/${c.userId}`} className="font-medium text-sky-700 hover:underline dark:text-sky-400">
                        {c.name}
                      </Link>
                      {c.accounts.length > 0 ? (
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{c.accounts.map((a) => a.name).join(' · ')}</div>
                      ) : null}
                    </Td>
                    <Td>
                      <div className="tabular-nums">{c.phone ?? '—'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{c.email ?? '—'}</div>
                    </Td>
                    <Td>
                      <Badge tone={c.status === 'ACTIVE' ? 'green' : 'neutral'}>{c.status}</Badge>
                    </Td>
                    <Td numeric>{formatNumber(c.accountOrderCount)}</Td>
                    {/* No orders at all ⇒ there is no "last order" date to show. An em dash, not today. */}
                    <Td>{c.lastAccountOrderAt ? shortDate(c.lastAccountOrderAt) : '—'}</Td>
                    <Td numeric>{formatNumber(c.savedAddressCount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {/* The API is cursor-paginated; this page requests the max page size. Say so rather than
                silently truncating — a console that hides rows is worse than one that admits the cap. */}
            {state.data?.hasMore ? (
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                Showing the first {customers.length} customers. Narrow the list with search.
              </p>
            ) : null}
          </>
        )}
      </Card>
    </div>
  );
}
