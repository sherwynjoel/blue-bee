/**
 * Console customer-360 contract (Increment 27) — the OWNER/CSR-gated, org-scoped, read-only view of a
 * RESIDENTIAL customer: identity, saved addresses (Inc-26), order history, invoices/payments, devices and
 * corporate memberships, in one place. B2B accounts already have `AccountDetail`; consumers had nothing.
 *
 * Three things this contract is careful about, because the data model does not say what a naive view
 * would imply:
 *
 *  1. **Orders, invoices and payments hang off an ACCOUNT, not a person.** `Order` has `accountId` and no
 *     `userId`. If two people share an account, both would appear to "own" the same orders. So every such
 *     field is named `account*` (`accountOrderCount`, `lastAccountOrderAt`), and each order carries
 *     `bookedByThisCustomer` — derived from `Order.createdBy`, and **null** when that column is unset
 *     (older rows), never silently `false`.
 *
 *  2. **Serviceability is the same three-state answer as Inc-26.** With no active service zones drawn the
 *     geo-gate is inert, and an inert gate is not evidence of coverage — `checked: false` means the
 *     console must claim nothing about whether we serve that address.
 *
 *  3. **Chat is deliberately absent.** The driver↔customer thread is staff-invisible by design; console
 *     moderation is a separate, deferred decision. There is no chat field here to accidentally render.
 *
 * Read-only v1: staff EDITING a customer (contact details, adding an address on their behalf) is a
 * deliberate follow-up, not this increment.
 */
import { z } from 'zod';
import type { AccountType, DevicePlatform, RoleType } from './enums';
import type { GeoPoint } from './validators';
import type { SiteServiceability } from './sites';

// ───────────────────────────── list ─────────────────────────────

/**
 * `GET /v1/admin/customers` — cursor-paginated, searchable across name / phone / email.
 *
 * Query strings arrive as strings, and a browser happily sends `?search=&cursor=`. An empty string is
 * "absent", not "match the empty string" or "an invalid uuid" — so blanks are normalized away before
 * validation, and only a genuinely malformed cursor/limit is a 400.
 */
const blankToUndefined = (v: unknown): unknown => (v === '' || v === null ? undefined : v);

export const listCustomersQuerySchema = z.object({
  /** Case-insensitive substring match on name, phone or email. */
  search: z.preprocess(blankToUndefined, z.string().trim().min(1).max(120).optional()),
  cursor: z.preprocess(blankToUndefined, z.string().uuid().optional()),
  limit: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(100).default(25)),
});
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;

/** The account a customer belongs to (a residential consumer normally has exactly one). */
export interface CustomerAccountRef {
  id: string;
  name: string;
  type: AccountType;
}

export interface CustomerListItem {
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** `UserStatus` — ACTIVE / SUSPENDED / … (server truth; the console never infers it). */
  status: string;
  joinedAt: string;
  accounts: CustomerAccountRef[];
  /**
   * Orders on this customer's ACCOUNT(s), not necessarily placed by this person — `Order` carries no
   * `userId`. Named to say so.
   */
  accountOrderCount: number;
  lastAccountOrderAt: string | null;
  /** ACTIVE saved addresses on their account(s) (a deactivated one is soft-deleted, Inc-26). */
  savedAddressCount: number;
}

export interface CustomerListResult {
  customers: CustomerListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ───────────────────────────── the 360 ─────────────────────────────

export interface CustomerIdentityView {
  userId: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  joinedAt: string;
  /** How they sign in ('phone', 'apple', …) — from `User.authProviders`. */
  authProviders: string[];
  /** Every role grant they hold, so staff can see they are (only) a residential customer. */
  roles: Array<{ role: RoleType; scope: string; scopeId: string | null }>;
}

/** A saved address (Inc-26 `Site`) with its live coverage answer. */
export interface CustomerAddressView {
  id: string;
  accountId: string;
  /** `Site.name` doubles as the customer-facing label ("Home"/"Work"). */
  name: string;
  address: string | null;
  unit: string | null;
  buzzer: string | null;
  notes: string | null;
  isDefault: boolean;
  geo: GeoPoint | null;
  /** Three-state. `checked: false` ⇒ no active zones ⇒ claim nothing. Null when the site has no point. */
  serviceability: SiteServiceability | null;
}

export interface CustomerOrderView {
  id: string;
  accountId: string;
  siteId: string | null;
  status: string;
  vertical: string;
  /** Grand total from `Order.totals` as a decimal string; null until a quote prices it. */
  total: string | null;
  currency: string;
  createdAt: string;
  /**
   * Did THIS customer place the order? Derived from `Order.createdBy`.
   * `null` = unknown (the column is unset on older rows) — never silently `false`.
   */
  bookedByThisCustomer: boolean | null;
}

export interface CustomerInvoiceView {
  id: string;
  number: string | null;
  status: string;
  total: string;
  currency: string;
  issuedAt: string | null;
  orderId: string | null;
}

export interface CustomerPaymentView {
  id: string;
  status: string;
  method: string;
  amount: string;
  currency: string;
  createdAt: string;
  orderId: string | null;
  invoiceId: string | null;
}

/** Push tokens are masked to their tail, exactly as `GET /v1/admin/devices` already does. */
export interface CustomerDeviceView {
  id: string;
  platform: DevicePlatform;
  pushTokenMasked: string | null;
  lastSeen: string | null;
  createdAt: string;
}

export interface CustomerMembershipView {
  id: string;
  accountId: string;
  accountName: string;
  status: string;
  source: string;
  createdAt: string;
}

/**
 * Notification settings. `configured: false` means the customer has NO `NotificationPreference` row and is
 * therefore on server defaults — the console must not present defaults as choices the customer made.
 */
export interface CustomerNotificationView {
  configured: boolean;
  pushEnabled: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  timezone: string;
}

/** `GET /v1/admin/customers/:id`. Chat is intentionally not part of this aggregate. */
/**
 * [Inc-34] Referral attribution for the console customer-360 (read-only): this customer's own code, who
 * (if anyone) referred THEM, and how many joined via THEIR code. Derived from `User.referredByUserId` —
 * no reward data (none exists), just the invite graph.
 */
export interface CustomerReferralView {
  /** This customer's own invite code (null only if it hasn't been minted yet). */
  code: string | null;
  /** Who referred this customer, if attribution was captured at signup — else null. */
  referredBy: { userId: string; name: string } | null;
  /** How many customers joined via this customer's code. */
  referralsMadeCount: number;
}

export interface Customer360View {
  customer: CustomerIdentityView;
  /** [Inc-34] Referral attribution — this customer's code, who referred them, how many they referred. */
  referral: CustomerReferralView;
  accounts: CustomerAccountRef[];
  addresses: CustomerAddressView[];
  /** Most recent orders on their account(s), newest first, capped at `CUSTOMER_360_ORDER_LIMIT`. */
  orders: CustomerOrderView[];
  /** Total orders on their account(s) — may exceed `orders.length`. */
  accountOrderCount: number;
  invoices: CustomerInvoiceView[];
  payments: CustomerPaymentView[];
  devices: CustomerDeviceView[];
  memberships: CustomerMembershipView[];
  notifications: CustomerNotificationView;
}

/** How many recent orders/invoices/payments the 360 embeds before the console links out to the full list. */
export const CUSTOMER_360_ORDER_LIMIT = 20;
export const CUSTOMER_360_BILLING_LIMIT = 20;

// ───────────────────────── error codes (problem+json `error`) ─────────────────────────

export const ADMIN_CUSTOMER_ERRORS = {
  /**
   * 404 — no RESIDENTIAL_CUSTOMER with that id in the caller's org. Deliberately also the answer for a
   * staff user's id: this endpoint reads customer PII and must not become a way to read staff PII.
   */
  CUSTOMER_NOT_FOUND: 'admin.customer_not_found',
} as const;
export type AdminCustomerErrorCode = (typeof ADMIN_CUSTOMER_ERRORS)[keyof typeof ADMIN_CUSTOMER_ERRORS];
