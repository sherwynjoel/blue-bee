'use client';

import React from 'react';
import Link from 'next/link';
import type { AccountListItemView } from '@blue-bee/shared';
import { Building2 } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { formatNumber, humanize } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, Table, TableSkeleton, Td, Th } from './ui';
import { RequireCapability } from './AppShell';

/**
 * B2B accounts directory (Track-A condo console) — the org's accounts (condo/building B2B + residential)
 * rendered from the new read-only `GET /v1/accounts`. Server-authoritative + org-scoped; this list just
 * renders the real rows (name, type, billing terms, site + active-standing-order counts) and links each
 * to its detail. RBAC-gated for UX (the server enforces independently). Loading / empty / error states.
 */
export function AccountsHome(): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.accounts(me)}>
      <AccountsHomeInner />
    </RequireCapability>
  );
}

function AccountsHomeInner(): React.ReactElement {
  const { client } = useSession();
  const state = useAsync(() => client.listAccounts({ limit: 100 }), []);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Accounts"
        subtitle="Building (B2B) & residential accounts — billing terms and recurring service."
      />

      <Card padded={false} className="p-5">
        {state.loading ? (
          <TableSkeleton rows={5} cols={6} />
        ) : state.error ? (
          <ErrorBox message={state.error} onRetry={state.reload} />
        ) : !state.data || state.data.accounts.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-5 w-5" strokeWidth={1.75} />}
            title="No accounts"
            message="No accounts are visible for your organization yet."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Type</Th>
                <Th>Billing</Th>
                <Th numeric>Net days</Th>
                <Th numeric>Sites</Th>
                <Th numeric>Active standing orders</Th>
              </tr>
            </thead>
            <tbody className="stagger">
              {state.data.accounts.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function AccountRow({ account: a }: { account: AccountListItemView }): React.ReactElement {
  return (
    <tr className="border-b border-hairline transition-colors duration-fast last:border-0 hover:bg-subtle" data-testid={`account-${a.id}`}>
      <Td>
        <Link
          href={`/accounts/${a.id}`}
          className="font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded"
        >
          {a.name}
        </Link>
      </Td>
      <Td>
        <Badge tone={a.type === 'BUSINESS' ? 'blue' : 'neutral'}>{humanize(a.type)}</Badge>
      </Td>
      <Td>
        <Badge tone={a.billingMode === 'BATCH_PERIODIC' ? 'amber' : 'neutral'}>{humanize(a.billingMode)}</Badge>
      </Td>
      <Td numeric className="text-secondary">{a.billingMode === 'BATCH_PERIODIC' ? formatNumber(a.billingNetDays) : '—'}</Td>
      <Td numeric className="text-secondary">{formatNumber(a.siteCount)}</Td>
      <Td numeric className="text-secondary">{formatNumber(a.activeStandingOrderCount)}</Td>
    </tr>
  );
}
