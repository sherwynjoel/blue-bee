import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UserNotificationPref } from './notification-policy';

/**
 * Loads a user's NotificationPreference row (Increment 8, §8.5). Server-internal ⇒ explicit org_id.
 * The decision itself (opt-out / quiet-hours defer / urgent bypass) lives in the pure
 * `notification-policy` module so it is unit-tested without the DB.
 */
@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The user's preferences, or null when no row exists (⇒ all channels on, no quiet hours). */
  async load(orgId: string, userId: string): Promise<UserNotificationPref | null> {
    const rows = await this.prisma.$queryRaw<
      {
        pushEnabled: boolean;
        smsEnabled: boolean;
        emailEnabled: boolean;
        quietHoursStart: number | null;
        quietHoursEnd: number | null;
        timezone: string;
      }[]
    >(Prisma.sql`
      SELECT push_enabled AS "pushEnabled", sms_enabled AS "smsEnabled", email_enabled AS "emailEnabled",
             quiet_hours_start AS "quietHoursStart", quiet_hours_end AS "quietHoursEnd", timezone
      FROM "NotificationPreference"
      WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid
      LIMIT 1
    `);
    return rows[0] ?? null;
  }
}
