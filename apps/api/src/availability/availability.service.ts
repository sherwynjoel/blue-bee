import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AVAILABILITY_ERRORS,
  OrderStatus,
  type OrgSchedule,
  type PickupSlot,
  type PickupSlotsQuery,
  type PickupSlotsResult,
} from '@blue-bee/shared';
import { PrismaService } from '../prisma/prisma.service';
import { scopedPrisma } from '../prisma/scoped-prisma';
import { resolveOrgSchedule } from '../common/org-schedule';
import { wallDateKey } from '../common/tz';
import type { RequestPrincipal } from '../auth/rbac/types';
import { bookableDates, clockReason, daySlots, isWithinHorizon, overlaps, type SlotInstant } from './pickup-slots';

/**
 * The order statuses that still OCCUPY a pickup slot.
 *
 * An order counts against a slot's capacity only while its pickup is still owed. Once the driver has
 * collected it (`PICKED_UP` and everything downstream) the truck is free again, and a `QUOTE_DECLINED` /
 * `CLOSED_NO_WORK` order was never collected at all. This mirrors `route.service.ts`'s `PICKUPABLE` gate
 * (`REQUESTED` / `SCHEDULED_PICKUP`), plus `PICKUP_EN_ROUTE` — the driver is on the way, so the slot is
 * still very much taken.
 *
 * `ON_HOLD` is deliberately EXCLUDED: a held order has no committed pickup, and holding a slot for it would
 * silently shrink real availability.
 */
const SLOT_OCCUPYING_STATUSES: OrderStatus[] = [
  OrderStatus.REQUESTED,
  OrderStatus.SCHEDULED_PICKUP,
  OrderStatus.PICKUP_EN_ROUTE,
];

/** A booked pickup window read back from `Order.scheduled_pickup_window`. */
interface BookedWindow {
  win_start: Date;
  win_end: Date;
}

/**
 * Pickup availability (Increment 28, PRD §7A A2.1) — the read the customer picker is built on.
 *
 * Everything it reports is derived from something real:
 *
 *  • **The windows** are the founder's, saved through `PATCH /v1/admin/settings/schedule` and read here
 *    through the shared `resolveOrgSchedule`. Until the founder saves any, the documented default is served
 *    and stamped `scheduleSource: 'default'` so no screen can present it as Blue Bee's actual hours.
 *
 *  • **Capacity** is a COUNT of real orders whose `scheduledPickupWindow` overlaps the slot, compared to the
 *    founder's `maxPerSlot`. With no cap configured (`maxPerSlot: null`) nothing is counted, every window is
 *    available, `remaining` is `null`, and `capacityChecked` is `false`. Scarcity is never fabricated — the
 *    same rule `SiteServiceability.checked` encodes for coverage (Inc-26).
 *
 *  • **The clock** excludes past and sub-lead-time windows, computed against the org's real DST offset.
 *
 * ZONE AWARENESS. `siteId` is accepted, row-scoped (another account's site is a 404, never a 403), and fed
 * to `resolveScheduleForSite` — the single seam where a per-zone schedule would override the org's. Today
 * `ServiceZone` carries no hours or capacity column, so there is nothing to override with and the org
 * schedule is returned unchanged. That is a documented fallback, not a hidden one: a zone-hours column and
 * its lookup drop into that one method. Nothing here geo-BLOCKS — with zero active zones an inert gate is
 * not evidence of anything (Inc-19/26), and the booking path already owns the real block.
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async pickupSlots(principal: RequestPrincipal, query: PickupSlotsQuery): Promise<PickupSlotsResult> {
    const now = new Date();

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: principal.orgId } });
    const { schedule: orgSchedule, timezone, source } = resolveOrgSchedule(org);

    // Row-scoping first: an unauthorised siteId must 404 before it can learn anything about our hours.
    const site = query.siteId ? await this.requireOwnSite(principal, query.siteId) : null;
    const schedule = this.resolveScheduleForSite(orgSchedule, site);

    const dates = bookableDates(now, timezone, schedule);
    const date = query.date ?? dates[0] ?? wallDateKey(now, timezone);

    if (!isWithinHorizon(date, now, timezone, schedule)) {
      throw new BadRequestException({
        error: AVAILABILITY_ERRORS.DATE_OUT_OF_RANGE,
        message: `date ${date} is not a bookable calendar date within the next ${schedule.horizonDays} day(s)`,
      });
    }

    const instants = daySlots(date, timezone, schedule);
    if (instants.length === 0) {
      // A configured closed day. `closed: true` is a real answer, not an empty one.
      return { date, timezone, bookableDates: dates, closed: true, capacityChecked: false, scheduleSource: source, slots: [] };
    }

    const counts = await this.countOverlappingOrders(principal.orgId, instants, schedule.maxPerSlot);
    const capacityChecked = counts !== null;

    const slots: PickupSlot[] = instants.map((slot, i) => {
      const clock = clockReason(slot, now, schedule.leadTimeHours);
      const remaining = counts === null ? null : Math.max(0, (schedule.maxPerSlot as number) - (counts[i] as number));
      // The clock wins the `reason`: a slot that has already passed is not "full", whatever the count says.
      const reason = clock ?? (remaining !== null && remaining === 0 ? 'full' : null);
      return {
        label: slot.label,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        startLocal: slot.startLocal,
        endLocal: slot.endLocal,
        available: reason === null,
        remaining,
        reason,
      };
    });

    return { date, timezone, bookableDates: dates, closed: false, capacityChecked, scheduleSource: source, slots };
  }

  /**
   * The caller's own active site, or a 404. Uses the row-scoping client, so an ACCOUNT-confined principal
   * asking about another account's site gets `null` from the DB itself — the 404 is not a hand-written
   * ownership check that a later refactor could forget. Cross-account and cross-org both answer 404 rather
   * than 403: a 403 would confirm the site exists (the Inc-26 `site.not_found` convention).
   */
  private async requireOwnSite(principal: RequestPrincipal, siteId: string): Promise<{ id: string }> {
    const site = await scopedPrisma(this.prisma, principal).site.findFirst({
      where: { id: siteId, active: true },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException({
        error: AVAILABILITY_ERRORS.SITE_NOT_FOUND,
        message: `Site ${siteId} not found`,
      });
    }
    return site;
  }

  /**
   * THE ZONE SEAM. A site's service zone may one day carry its own hours/capacity (a downtown zone with a
   * later evening window, a suburb with a smaller cap). When it does, resolve them here and return them.
   *
   * Today `ServiceZone` has `{ name, active, sortOrder, area }` and no schedule column, so there is nothing
   * to look up and the org schedule is returned unchanged. Adding a fake `ServiceZone.schedule` column that
   * nothing writes would be a stub — and the repo already carries one such ghost (`Site.serviceWindows`,
   * seeded, never read). The seam is the method; the column arrives with the feature that needs it.
   */
  private resolveScheduleForSite(orgSchedule: OrgSchedule, _site: { id: string } | null): OrgSchedule {
    return orgSchedule;
  }

  /**
   * How many slot-occupying orders overlap each slot, or `null` when no cap is configured.
   *
   * Returning `null` rather than an array of zeroes is the honesty firewall in a type: with no cap there is
   * no count, we do not run the query, and the caller cannot accidentally render "3 left" from a number we
   * never measured.
   *
   * One query for the whole day (the slots are contiguous), bucketed in memory. `scheduled_pickup_window` is
   * `jsonb`; the `jsonb_typeof(...) = 'object'` guard matters because `OrdersService.book` writes
   * `Prisma.JsonNull` — a JSON `null` LITERAL, not SQL NULL — when a customer books without a window, so
   * `IS NOT NULL` alone would let those rows through to the timestamp cast.
   */
  private async countOverlappingOrders(
    orgId: string,
    slots: SlotInstant[],
    maxPerSlot: number | null,
  ): Promise<number[] | null> {
    if (maxPerSlot === null) return null;

    const dayStart = slots[0]!.start;
    const dayEnd = slots[slots.length - 1]!.end;

    const rows = await this.prisma.$queryRaw<BookedWindow[]>(Prisma.sql`
      SELECT (scheduled_pickup_window->>'start')::timestamptz AS win_start,
             (scheduled_pickup_window->>'end')::timestamptz   AS win_end
      FROM "Order"
      WHERE org_id = ${orgId}::uuid
        AND jsonb_typeof(scheduled_pickup_window) = 'object'
        AND status::text IN (${Prisma.join(SLOT_OCCUPYING_STATUSES)})
        AND (scheduled_pickup_window->>'start')::timestamptz < ${dayEnd}
        AND (scheduled_pickup_window->>'end')::timestamptz   > ${dayStart}
    `);

    return slots.map((slot) => rows.filter((r) => overlaps(r.win_start, r.win_end, slot.start, slot.end)).length);
  }
}
