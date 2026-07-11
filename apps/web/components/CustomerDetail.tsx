'use client';

import React from 'react';
import Link from 'next/link';
import type { Customer360View, CustomerAddressView, SiteServiceability } from '@blue-bee/shared';
import { ArrowLeft } from 'lucide-react';
import { useSession } from '@/lib/session';
import { useAsync } from '@/lib/useAsync';
import { can } from '@/lib/rbac';
import { humanize, money, orderRef, orderTone, shortDate } from '@/lib/format';
import { Badge, Card, EmptyState, ErrorBox, KV, Skeleton, StatusPill, Table, TableSkeleton, Td, Th } from './ui';
import { RequireCapability } from './AppShell';

/**
 * One residential customer's 360 (Increment 27) — the consumer counterpart to `AccountDetail`.
 * Read-only: staff editing a customer's contact details or adding an address on their behalf is a
 * deliberate follow-up, not this view.
 *
 * Everything rendered here is server truth. Three places where the obvious rendering would lie, and
 * what this component does instead:
 *
 *  • **Coverage.** `serviceability.checked === false` means the org has drawn no active service zones, so
 *    the geo-gate is inert. That is not "out of area" and not "we serve them" — it is *unknown*, and we say
 *    "Not checked". Only `checked && serviceable` prints "In service area".
 *  • **Who booked an order.** `bookedByThisCustomer === null` means `Order.createdBy` is unset. We print
 *    "—", never "Staff", because the data does not support that claim.
 *  • **Notification settings.** `configured === false` means the customer never chose anything and is on
 *    server defaults; the card says so instead of presenting a default as a decision.
 *
 * Chat is deliberately absent: the driver↔customer thread is staff-invisible by design, and console
 * moderation is a separate decision — so the aggregate carries no chat and this page shows none.
 */
export function CustomerDetail({ userId }: { userId: string }): React.ReactElement {
  const { me } = useSession();
  return (
    <RequireCapability allowed={can.customers(me)}>
      <CustomerDetailInner userId={userId} />
    </RequireCapability>
  );
}

function CustomerDetailInner({ userId }: { userId: string }): React.ReactElement {
  const { client } = useSession();
  const state = useAsync(() => client.getCustomer360(userId), [userId]);

  if (state.loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <TableSkeleton rows={4} cols={2} />
        </Card>
      </div>
    );
  }
  if (state.error) return <ErrorBox message={state.error} onRetry={state.reload} />;
  if (!state.data) return <ErrorBox message="Customer not found." onRetry={state.reload} />;

  const d: Customer360View = state.data;

  return (
    <div className="space-y-6 animate-fade-in" data-testid="customer-360">
      <div>
        <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} /> Customers
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{d.customer.name}</h1>
      </div>

      {/* ── contact ── */}
      <Card title="Contact">
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <KV label="Phone" value={d.customer.phone ?? '—'} />
          <KV label="Email" value={d.customer.email ?? '—'} />
          <KV label="Status" value={<Badge tone={d.customer.status === 'ACTIVE' ? 'green' : 'neutral'}>{d.customer.status}</Badge>} />
          <KV label="Joined" value={shortDate(d.customer.joinedAt)} />
          <KV label="Signs in with" value={d.customer.authProviders.length > 0 ? d.customer.authProviders.map(humanize).join(', ') : '—'} />
          <KV label="Account" value={d.accounts.length > 0 ? d.accounts.map((a) => a.name).join(' · ') : '—'} />
        </div>
      </Card>

      {/* ── referral (Inc-34) — the invite graph, read-only. Reward is deferred, so NO reward/credit is shown. ── */}
      <Card title="Referral">
        <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2" data-testid="referral">
          <KV label="Referral code" value={d.referral.code ?? '—'} />
          <KV label="Referred by" value={d.referral.referredBy?.name ?? '—'} />
          <KV label="Referrals made" value={String(d.referral.referralsMadeCount)} />
        </div>
      </Card>

      {/* ── saved addresses (Inc-26) ── */}
      <Card title="Saved addresses">
        {d.addresses.length === 0 ? (
          <EmptyState title="No saved addresses" message="This customer has not saved an address yet." />
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700" data-testid="addresses">
            {d.addresses.map((a) => (
              <AddressRow key={a.id} address={a} />
            ))}
          </ul>
        )}
      </Card>

      {/* ── order history ── */}
      <Card
        title="Order history"
        // `Order` has no `userId`: these are the ACCOUNT's orders. Never imply personal ownership.
        subtitle={`Orders on this customer's account — ${d.accountOrderCount} total${
          d.accountOrderCount > d.orders.length ? `, showing the ${d.orders.length} most recent` : ''
        }`}
      >
        {d.orders.length === 0 ? (
          <EmptyState title="No orders" message="No orders have been placed on this customer's account." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Status</Th>
                <Th>Placed</Th>
                <Th>Booked by</Th>
                <Th numeric>Total</Th>
              </tr>
            </thead>
            <tbody>
              {d.orders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <Td>
                    <Link href={`/orders/${o.id}`} className="font-medium text-sky-700 hover:underline dark:text-sky-400">
                      {orderRef(o.id)}
                    </Link>
                  </Td>
                  <Td>
                    <StatusPill tone={orderTone(o.status)}>{humanize(o.status)}</StatusPill>
                  </Td>
                  <Td>{shortDate(o.createdAt)}</Td>
                  <Td>{bookedByLabel(o.bookedByThisCustomer, d.customer.name)}</Td>
                  {/* An unpriced order has no total — "—", never "$0.00". */}
                  <Td numeric>{o.total ? money(o.total, o.currency) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ── billing ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Invoices">
          {d.invoices.length === 0 ? (
            <EmptyState title="No invoices" message="Nothing has been invoiced on this account." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Invoice</Th>
                  <Th>Status</Th>
                  <Th>Issued</Th>
                  <Th numeric>Total</Th>
                </tr>
              </thead>
              <tbody>
                {d.invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.number ?? orderRef(i.id)}</Td>
                    <Td>
                      <Badge tone={i.status === 'PAID' ? 'green' : 'neutral'}>{humanize(i.status)}</Badge>
                    </Td>
                    <Td>{i.issuedAt ? shortDate(i.issuedAt) : '—'}</Td>
                    <Td numeric>{money(i.total, i.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Payments">
          {d.payments.length === 0 ? (
            <EmptyState title="No payments" message="No payments have been taken on this account." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Method</Th>
                  <Th>Status</Th>
                  <Th>Date</Th>
                  <Th numeric>Amount</Th>
                </tr>
              </thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id}>
                    <Td>{humanize(p.method)}</Td>
                    <Td>
                      <Badge tone={p.status === 'SUCCEEDED' ? 'green' : p.status === 'FAILED' ? 'red' : 'neutral'}>{humanize(p.status)}</Badge>
                    </Td>
                    <Td>{shortDate(p.createdAt)}</Td>
                    <Td numeric>{money(p.amount, p.currency)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* ── corporate memberships ── */}
      {d.memberships.length > 0 ? (
        <Card title="Corporate pricing">
          <ul className="space-y-2" data-testid="memberships">
            {d.memberships.map((m) => (
              <li key={m.id} className="flex items-center justify-between text-sm">
                <span>{m.accountName}</span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 dark:text-slate-400">{humanize(m.source)}</span>
                  <Badge tone={m.status === 'ACTIVE' ? 'green' : 'neutral'}>{humanize(m.status)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* ── devices + notifications ── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Devices">
          {d.devices.length === 0 ? (
            <EmptyState title="No devices" message="This customer has no registered device." />
          ) : (
            <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700" data-testid="devices">
              {d.devices.map((dev) => (
                <li key={dev.id} className="flex items-center justify-between py-2">
                  <span>{humanize(dev.platform)}</span>
                  <span className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    {/* Masked server-side; the full push token never reaches the console. */}
                    <span className="tabular-nums">{dev.pushTokenMasked ?? 'no push token'}</span>
                    <span>{dev.lastSeen ? `seen ${shortDate(dev.lastSeen)}` : 'never seen'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Notifications">
          {!d.notifications.configured ? (
            // The customer never opened notification settings. Showing the defaults as if they were
            // choices would misrepresent them, so say plainly that nothing was chosen.
            <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="notifications-default">
              This customer has not changed their notification settings — they are on the defaults (push, SMS and email on).
            </p>
          ) : (
            <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2" data-testid="notifications-configured">
              <KV label="Push" value={d.notifications.pushEnabled ? 'On' : 'Off'} />
              <KV label="SMS" value={d.notifications.smsEnabled ? 'On' : 'Off'} />
              <KV label="Email" value={d.notifications.emailEnabled ? 'On' : 'Off'} />
              <KV label="Time zone" value={d.notifications.timezone} />
              <KV label="Quiet hours" value={quietHours(d.notifications.quietHoursStart, d.notifications.quietHoursEnd)} />
            </div>
          )}
        </Card>
      </div>

      {/* Chat is staff-invisible by design — name the boundary rather than leave a silent gap. */}
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Order messages between the customer and their driver are not shown here.
      </p>
    </div>
  );
}

function AddressRow({ address }: { address: CustomerAddressView }): React.ReactElement {
  const extras = [address.unit ? `Unit ${address.unit}` : null, address.buzzer ? `Buzzer ${address.buzzer}` : null].filter(Boolean);
  return (
    <li className="flex items-start justify-between gap-4 py-3" data-testid={`address-${address.id}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{address.name}</span>
          {address.isDefault ? <Badge tone="blue">Default</Badge> : null}
        </div>
        <div className="mt-0.5 truncate text-sm text-slate-600 dark:text-slate-300">{address.address ?? '—'}</div>
        {extras.length > 0 ? <div className="text-xs text-slate-500 dark:text-slate-400">{extras.join(' · ')}</div> : null}
        {address.notes ? <div className="text-xs italic text-slate-500 dark:text-slate-400">{address.notes}</div> : null}
      </div>
      <ServiceabilityBadge serviceability={address.serviceability} />
    </li>
  );
}

/**
 * Three states, three answers — plus a fourth for an address with no point at all. The one thing this must
 * never do is render "Out of area" when the org simply has no zones drawn.
 */
function ServiceabilityBadge({ serviceability }: { serviceability: SiteServiceability | null }): React.ReactElement {
  if (serviceability === null) {
    return (
      <Badge tone="neutral" className="shrink-0">
        No map pin
      </Badge>
    );
  }
  if (!serviceability.checked) {
    return (
      <Badge tone="neutral" className="shrink-0">
        Coverage not checked
      </Badge>
    );
  }
  return serviceability.serviceable ? (
    <Badge tone="green" className="shrink-0">
      In service area
    </Badge>
  ) : (
    <Badge tone="amber" className="shrink-0">
      Outside service area
    </Badge>
  );
}

/** `null` = `Order.createdBy` is unset, so we do not know. Never guess "Staff". */
function bookedByLabel(bookedByThisCustomer: boolean | null, customerName: string): string {
  if (bookedByThisCustomer === null) return '—';
  return bookedByThisCustomer ? customerName : 'Staff';
}

/** Minutes-from-local-midnight → "22:00 – 07:00", or "Not set" when either bound is absent. */
function quietHours(start: number | null, end: number | null): string {
  if (start === null || end === null) return 'Not set';
  const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `${hhmm(start)} – ${hhmm(end)}`;
}
