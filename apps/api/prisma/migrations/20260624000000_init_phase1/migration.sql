-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('OWNER', 'DISPATCHER', 'CSR', 'PLANT_OP', 'DRIVER', 'FINANCE', 'ACCOUNT_ADMIN', 'ACCOUNT_STAFF', 'RESIDENTIAL_CUSTOMER');

-- CreateEnum
CREATE TYPE "RoleScope" AS ENUM ('ORG', 'ACCOUNT', 'SITE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('RESIDENTIAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "ServiceVertical" AS ENUM ('SPECIALTY', 'LINEN', 'WASHFOLD');

-- CreateEnum
CREATE TYPE "ServiceUnit" AS ENUM ('SQFT', 'PIECE', 'LB', 'ITEM');

-- CreateEnum
CREATE TYPE "OrderVertical" AS ENUM ('SPECIALTY', 'LINEN', 'WASHFOLD');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('JOB', 'ROUTE_STOP_ORDER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('REQUESTED', 'SCHEDULED_PICKUP', 'PICKUP_EN_ROUTE', 'PICKED_UP', 'INTAKE_INSPECTED', 'QUOTED', 'QUOTE_APPROVED', 'QUOTE_DECLINED', 'IN_CLEANING', 'QC', 'READY', 'SCHEDULED_DELIVERY', 'DELIVERY_EN_ROUTE', 'DELIVERED', 'INVOICED', 'CLOSED', 'CLOSED_NO_WORK', 'DAMAGE_PREEXISTING_FLAGGED', 'ON_HOLD', 'REWASH', 'CLAIM_OPENED', 'CLAIM_RESOLVED');

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('RUG', 'CARPET', 'BLIND', 'UPHOLSTERY', 'GARMENT', 'LINEN');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('RECEIVED', 'INSPECTED', 'IN_CLEANING', 'QC', 'READY', 'DELIVERED');

-- CreateEnum
CREATE TYPE "TagType" AS ENUM ('QR', 'BARCODE', 'RFID');

-- CreateEnum
CREATE TYPE "TagBinding" AS ENUM ('ITEM', 'CART', 'CONTAINER', 'RESIDENT');

-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('INTAKE', 'BEFORE', 'AFTER', 'POD', 'CLAIM');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CustodyStage" AS ENUM ('PICKED_UP', 'INTAKE', 'INSPECTED', 'DUSTING', 'WASH', 'DRY', 'FINISH', 'QC', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('PLANNED', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RouteStopKind" AS ENUM ('PICKUP', 'DELIVERY', 'BOTH');

-- CreateEnum
CREATE TYPE "RouteStopStatus" AS ENUM ('PENDING', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "GeofenceEventType" AS ENUM ('APPROACHING', 'ARRIVED', 'DEPARTED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'APPLE_PAY', 'GOOGLE_PAY', 'ACH', 'PAD', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('DAMAGE', 'LOSS', 'SERVICE');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'APPROVED', 'DENIED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "CommsChannel" AS ENUM ('PUSH', 'SMS', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "billing_config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "auth_providers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "RoleType" NOT NULL,
    "scope" "RoleScope" NOT NULL DEFAULT 'ORG',
    "scope_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "billing_terms" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "geo" geography(Point, 4326),
    "service_windows" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "vertical" "ServiceVertical" NOT NULL DEFAULT 'SPECIALTY',
    "name" TEXT NOT NULL,
    "unit" "ServiceUnit" NOT NULL,
    "base_rate" DECIMAL(12,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "site_id" UUID,
    "vertical" "OrderVertical" NOT NULL DEFAULT 'SPECIALTY',
    "type" "OrderType" NOT NULL DEFAULT 'JOB',
    "status" "OrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "scheduled_pickup_window" JSONB,
    "scheduled_delivery_window" JSONB,
    "totals" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "service_id" UUID,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "measure" DOUBLE PRECISION,
    "rate" DECIMAL(12,4) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "tag_id" UUID,
    "kind" "ItemKind" NOT NULL,
    "status" "ItemStatus" NOT NULL DEFAULT 'RECEIVED',
    "measurements" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "TagType" NOT NULL DEFAULT 'QR',
    "bound_to" "TagBinding" NOT NULL DEFAULT 'ITEM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "condition_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "preexisting_damage" BOOLEAN NOT NULL DEFAULT false,
    "ack_by" UUID,
    "ack_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "item_id" UUID,
    "order_id" UUID,
    "pod_id" UUID,
    "claim_id" UUID,
    "kind" "PhotoKind" NOT NULL,
    "url" TEXT NOT NULL,
    "geo" geography(Point, 4326),
    "taken_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "expires_at" TIMESTAMP(3),
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustodyEvent" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "item_id" UUID,
    "stage" "CustodyStage" NOT NULL,
    "actor_id" UUID,
    "geo" geography(Point, 4326),
    "device_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "CustodyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "capacity" INTEGER,
    "plate" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "license" TEXT,
    "default_vehicle_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "status" "ShiftStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "driver_id" UUID,
    "vehicle_id" UUID,
    "status" "RouteStatus" NOT NULL DEFAULT 'PLANNED',
    "optimized" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteStop" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "account_id" UUID,
    "site_id" UUID,
    "order_id" UUID,
    "kind" "RouteStopKind" NOT NULL DEFAULT 'PICKUP',
    "time_window" JSONB,
    "status" "RouteStopStatus" NOT NULL DEFAULT 'PENDING',
    "eta" TIMESTAMP(3),
    "arrived_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "RouteStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GpsPing" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "geo" geography(Point, 4326),
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "GpsPing_pkey" PRIMARY KEY ("id","recorded_at")
);

-- CreateTable
CREATE TABLE "GeofenceEvent" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "route_stop_id" UUID NOT NULL,
    "type" "GeofenceEventType" NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "GeofenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofOfDelivery" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "route_stop_id" UUID NOT NULL,
    "signature_url" TEXT,
    "captured_by" UUID,
    "geo" geography(Point, 4326),
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "ProofOfDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "period" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "cost_center_breakdown" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "invoice_id" UUID,
    "order_id" UUID,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "stripe_ref" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Claim" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "order_id" UUID,
    "item_id" UUID,
    "type" "ClaimType" NOT NULL,
    "amount" DECIMAL(12,2),
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "approved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "order_id" UUID,
    "from_user" UUID,
    "to_user" UUID,
    "channel" "CommsChannel" NOT NULL DEFAULT 'IN_APP',
    "body" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "channel" "CommsChannel" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "actor_id" UUID,
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "push_token" TEXT,
    "platform" "DevicePlatform" NOT NULL,
    "last_seen" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Organization_org_id_idx" ON "Organization"("org_id");

-- CreateIndex
CREATE INDEX "User_org_id_idx" ON "User"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_org_id_email_key" ON "User"("org_id", "email");

-- CreateIndex
CREATE INDEX "UserRole_org_id_idx" ON "UserRole"("org_id");

-- CreateIndex
CREATE INDEX "UserRole_user_id_idx" ON "UserRole"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_user_id_role_scope_scope_id_key" ON "UserRole"("user_id", "role", "scope", "scope_id");

-- CreateIndex
CREATE INDEX "Account_org_id_idx" ON "Account"("org_id");

-- CreateIndex
CREATE INDEX "Site_org_id_idx" ON "Site"("org_id");

-- CreateIndex
CREATE INDEX "Site_account_id_idx" ON "Site"("account_id");

-- CreateIndex
CREATE INDEX "Service_org_id_idx" ON "Service"("org_id");

-- CreateIndex
CREATE INDEX "Order_org_id_idx" ON "Order"("org_id");

-- CreateIndex
CREATE INDEX "Order_account_id_idx" ON "Order"("account_id");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "OrderLine_org_id_idx" ON "OrderLine"("org_id");

-- CreateIndex
CREATE INDEX "OrderLine_order_id_idx" ON "OrderLine"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "Item_tag_id_key" ON "Item"("tag_id");

-- CreateIndex
CREATE INDEX "Item_org_id_idx" ON "Item"("org_id");

-- CreateIndex
CREATE INDEX "Item_order_id_idx" ON "Item"("order_id");

-- CreateIndex
CREATE INDEX "Tag_org_id_idx" ON "Tag"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_org_id_code_key" ON "Tag"("org_id", "code");

-- CreateIndex
CREATE INDEX "Inspection_org_id_idx" ON "Inspection"("org_id");

-- CreateIndex
CREATE INDEX "Inspection_item_id_idx" ON "Inspection"("item_id");

-- CreateIndex
CREATE INDEX "Photo_org_id_idx" ON "Photo"("org_id");

-- CreateIndex
CREATE INDEX "Photo_item_id_idx" ON "Photo"("item_id");

-- CreateIndex
CREATE INDEX "Photo_order_id_idx" ON "Photo"("order_id");

-- CreateIndex
CREATE INDEX "Quote_org_id_idx" ON "Quote"("org_id");

-- CreateIndex
CREATE INDEX "Quote_order_id_idx" ON "Quote"("order_id");

-- CreateIndex
CREATE INDEX "CustodyEvent_org_id_idx" ON "CustodyEvent"("org_id");

-- CreateIndex
CREATE INDEX "CustodyEvent_item_id_idx" ON "CustodyEvent"("item_id");

-- CreateIndex
CREATE INDEX "CustodyEvent_occurred_at_idx" ON "CustodyEvent"("occurred_at");

-- CreateIndex
CREATE INDEX "Vehicle_org_id_idx" ON "Vehicle"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_user_id_key" ON "Driver"("user_id");

-- CreateIndex
CREATE INDEX "Driver_org_id_idx" ON "Driver"("org_id");

-- CreateIndex
CREATE INDEX "Shift_org_id_idx" ON "Shift"("org_id");

-- CreateIndex
CREATE INDEX "Shift_driver_id_idx" ON "Shift"("driver_id");

-- CreateIndex
CREATE INDEX "Route_org_id_idx" ON "Route"("org_id");

-- CreateIndex
CREATE INDEX "Route_date_idx" ON "Route"("date");

-- CreateIndex
CREATE INDEX "RouteStop_org_id_idx" ON "RouteStop"("org_id");

-- CreateIndex
CREATE INDEX "RouteStop_route_id_idx" ON "RouteStop"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "RouteStop_route_id_seq_key" ON "RouteStop"("route_id", "seq");

-- CreateIndex
CREATE INDEX "GpsPing_org_id_idx" ON "GpsPing"("org_id");

-- CreateIndex
CREATE INDEX "GpsPing_shift_id_idx" ON "GpsPing"("shift_id");

-- CreateIndex
CREATE INDEX "GpsPing_vehicle_id_idx" ON "GpsPing"("vehicle_id");

-- CreateIndex
CREATE INDEX "GpsPing_recorded_at_idx" ON "GpsPing"("recorded_at");

-- CreateIndex
CREATE INDEX "GeofenceEvent_org_id_idx" ON "GeofenceEvent"("org_id");

-- CreateIndex
CREATE INDEX "GeofenceEvent_route_stop_id_idx" ON "GeofenceEvent"("route_stop_id");

-- CreateIndex
CREATE UNIQUE INDEX "ProofOfDelivery_route_stop_id_key" ON "ProofOfDelivery"("route_stop_id");

-- CreateIndex
CREATE INDEX "ProofOfDelivery_org_id_idx" ON "ProofOfDelivery"("org_id");

-- CreateIndex
CREATE INDEX "Invoice_org_id_idx" ON "Invoice"("org_id");

-- CreateIndex
CREATE INDEX "Invoice_account_id_idx" ON "Invoice"("account_id");

-- CreateIndex
CREATE INDEX "Payment_org_id_idx" ON "Payment"("org_id");

-- CreateIndex
CREATE INDEX "Payment_invoice_id_idx" ON "Payment"("invoice_id");

-- CreateIndex
CREATE INDEX "Claim_org_id_idx" ON "Claim"("org_id");

-- CreateIndex
CREATE INDEX "Message_org_id_idx" ON "Message"("org_id");

-- CreateIndex
CREATE INDEX "Message_thread_id_idx" ON "Message"("thread_id");

-- CreateIndex
CREATE INDEX "Notification_org_id_idx" ON "Notification"("org_id");

-- CreateIndex
CREATE INDEX "Notification_user_id_idx" ON "Notification"("user_id");

-- CreateIndex
CREATE INDEX "AuditLog_org_id_idx" ON "AuditLog"("org_id");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entity_id_idx" ON "AuditLog"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "Device_org_id_idx" ON "Device"("org_id");

-- CreateIndex
CREATE INDEX "Device_user_id_idx" ON "Device"("user_id");

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_pod_id_fkey" FOREIGN KEY ("pod_id") REFERENCES "ProofOfDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustodyEvent" ADD CONSTRAINT "CustodyEvent_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_default_vehicle_id_fkey" FOREIGN KEY ("default_vehicle_id") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "Route"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteStop" ADD CONSTRAINT "RouteStop_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsPing" ADD CONSTRAINT "GpsPing_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GpsPing" ADD CONSTRAINT "GpsPing_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeofenceEvent" ADD CONSTRAINT "GeofenceEvent_route_stop_id_fkey" FOREIGN KEY ("route_stop_id") REFERENCES "RouteStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_route_stop_id_fkey" FOREIGN KEY ("route_stop_id") REFERENCES "RouteStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_from_user_fkey" FOREIGN KEY ("from_user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_to_user_fkey" FOREIGN KEY ("to_user") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ───────────────────────── Blue Bee custom migration steps ─────────────────────────
-- These are appended to the Prisma-generated DDL above (PRD §9/§10 requirements that
-- Prisma cannot express natively).

-- (1) TimescaleDB hypertable: partition GpsPing by recorded_at (PRD §9.5 time-series,
--     powers live tracking + replay). The composite PK (id, recorded_at) includes the
--     partitioning column, satisfying Timescale's unique-index requirement. Empty table.
SELECT create_hypertable('"GpsPing"', by_range('recorded_at'), if_not_exists => TRUE);

-- (2) Append-only enforcement at the DB level (PRD §8.2/§8.6/§8.7): CustodyEvent and
--     AuditLog are tamper-evident — block UPDATE/DELETE with a trigger, not just convention.
CREATE OR REPLACE FUNCTION bluebee_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER custody_event_append_only
  BEFORE UPDATE OR DELETE ON "CustodyEvent"
  FOR EACH ROW EXECUTE FUNCTION bluebee_block_mutation();

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION bluebee_block_mutation();
