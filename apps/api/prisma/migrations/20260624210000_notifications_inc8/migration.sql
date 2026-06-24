-- Increment 8 — Notification delivery (matrix-driven engine + outbox + device registration).
-- Additive + reversible: two new enum values, new nullable/defaulted columns on the (empty)
-- Notification outbox, and two new tables (DeviceToken, NotificationPreference). No drops, no
-- type changes, no data backfill. Notification has no writers before this increment, so the
-- NOT NULL dedupe_key is safe (the table is empty on every environment).
-- (PostgreSQL 12+ — required for ALTER TYPE … ADD VALUE inside the migration transaction; the
--  Blue Bee DB is PG 15/16 via the PostGIS 3.4 + TimescaleDB 2.26 image.)

-- AlterEnum (Increment 8): RETRYING (a transport attempt failed; a bounded retry is scheduled)
-- and SUPPRESSED (deliberately not sent — opt-out or quiet-hours). Appended; value order is not
-- semantically meaningful (sort order only) and `prisma migrate diff` treats it as no-drift.
ALTER TYPE "NotificationStatus" ADD VALUE 'RETRYING';
ALTER TYPE "NotificationStatus" ADD VALUE 'SUPPRESSED';

-- AlterTable: the Notification outbox (§8.5) — source trace, dedup key, retry accounting, the
-- provider message id (Twilio SID / SendGrid id / Expo ticket), and scheduled_for (quiet-hours
-- deferral OR retry backoff).
ALTER TABLE "Notification" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "dedupe_key" TEXT NOT NULL,
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "provider_message_id" TEXT,
ADD COLUMN     "scheduled_for" TIMESTAMP(3),
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "source_id" UUID,
ADD COLUMN     "source_type" TEXT,
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: DeviceToken — the real push-registration surface (`POST /v1/device-tokens`). One
-- row per push token, globally unique; unregister = deactivate (active=false).
CREATE TABLE "DeviceToken" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable: NotificationPreference — per-user channel opt-outs + a quiet-hours window
-- (minutes-from-local-midnight in the user's IANA timezone; absent row ⇒ all on, no quiet hours).
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_start" INTEGER,
    "quiet_hours_end" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_org_id_idx" ON "DeviceToken"("org_id");

-- CreateIndex
CREATE INDEX "DeviceToken_user_id_idx" ON "DeviceToken"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_user_id_key" ON "NotificationPreference"("user_id");

-- CreateIndex
CREATE INDEX "NotificationPreference_org_id_idx" ON "NotificationPreference"("org_id");

-- CreateIndex: the outbox dedup key (one row per event-source × recipient × channel) — backs
-- INSERT … ON CONFLICT (dedupe_key) DO NOTHING so a re-fire/replay/concurrent trigger sends once.
CREATE UNIQUE INDEX "Notification_dedupe_key_key" ON "Notification"("dedupe_key");

-- CreateIndex: the drain scan — due work is PENDING/RETRYING rows whose scheduled_for has passed.
CREATE INDEX "Notification_status_scheduled_for_idx" ON "Notification"("status", "scheduled_for");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
