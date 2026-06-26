'use client';

import React from 'react';
import Link from 'next/link';
import type { AccountListItemView } from '@blue-bee/shared';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { formatNumber, humanize } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, Loading } from './ui';
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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-bb-ink">Accounts</h1>
        <p className="mt-1 text-sm text-bb-sub">Building (B2B) &amp; residential accounts — billing terms and recurring service.</p>
      </div>

      <Card>
        {state.loading ? (
          <Loading />
        ) : state.error ? (
          <ErrorBox message={state.error} onRetry={state.reload} />
        ) : !state.data || state.data.accounts.length === 0 ? (
          <EmptyState title="No accounts" message="No accounts are visible for your organization yet." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-bb-line text-left text-bb-sub">
                <th className="py-2 pr-4 font-medium">Account</th>
                <th className="py-2 pr-4 font-medium">Type</th>
                <th className="py-2 pr-4 font-medium">Billing</th>
                <th className="py-2 pr-4 font-medium">Net days</th>
                <th className="py-2 pr-4 font-medium">Sites</th>
                <th className="py-2 font-medium">Active standing orders</th>
              </tr>
            </thead>
            <tbody>
              {state.data.accounts.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function AccountRow({ account: a }: { account: AccountListItemView }): React.ReactElement {
  return (
    <tr className="border-b border-bb-line last:border-0" data-testid={`account-${a.id}`}>
      <td className="py-2 pr-4">
        <Link href={`/accounts/${a.id}`} className="font-medium text-bb-blue hover:underline">
          {a.name}
        </Link>
      </td>
      <td className="py-2 pr-4">
        <Badge tone={a.type === 'BUSINESS' ? 'blue' : 'neutral'}>{humanize(a.type)}</Badge>
      </td>
      <td className="py-2 pr-4">
        <Badge tone={a.billingMode === 'BATCH_PERIODIC' ? 'amber' : 'neutral'}>{humanize(a.billingMode)}</Badge>
      </td>
      <td className="py-2 pr-4 text-bb-sub">{a.billingMode === 'BATCH_PERIODIC' ? formatNumber(a.billingNetDays) : '—'}</td>
      <td className="py-2 pr-4 text-bb-sub">{formatNumber(a.siteCount)}</td>
      <td className="py-2 text-bb-sub">{formatNumber(a.activeStandingOrderCount)}</td>
    </tr>
  );
}
