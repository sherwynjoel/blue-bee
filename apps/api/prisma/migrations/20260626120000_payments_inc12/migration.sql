-- Increment 12 — Stripe billing rail (additive, reversible).
-- Augments the modelled-since-Inc-1 Payment + Invoice tables with Stripe linkage + denormalized
-- money state, and adds InvoiceLine, Refund, Dispute, and the ProcessedStripeEvent webhook-idempotency
-- ledger. No existing column is dropped or retyped; all new NOT NULL columns carry defaults.
--
-- (Reverse: DROP the four new tables + the new enums; DROP the columns added to "Payment"/"Invoice"
--  below; ALTER TABLE "Payment" ALTER COLUMN "method" DROP DEFAULT.)

-- ── CreateEnum ──────────────────────────────────────────────────────────────────────────────────
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED');

-- ── AlterTable: Payment gains Stripe linkage + denormalized money state ──────────────────────────
ALTER TABLE "Payment"
  ADD COLUMN "account_id"               UUID,
  ADD COLUMN "currency"                 TEXT NOT NULL DEFAULT 'CAD',
  ADD COLUMN "stripe_payment_intent_id" TEXT,
  ADD COLUMN "stripe_charge_id"         TEXT,
  ADD COLUMN "idempotency_key"          TEXT,
  ADD COLUMN "capture_method"           TEXT NOT NULL DEFAULT 'automatic',
  ADD COLUMN "captured_amount"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "refunded_amount"          DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "captured_at"              TIMESTAMP(3),
  ADD COLUMN "attempts"                 INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error"               TEXT;
ALTER TABLE "Payment" ALTER COLUMN "method" SET DEFAULT 'CARD';
CREATE UNIQUE INDEX "Payment_stripe_payment_intent_id_key" ON "Payment"("stripe_payment_intent_id");
CREATE INDEX "Payment_order_id_idx" ON "Payment"("order_id");

-- ── AlterTable: Invoice gains an order link + Stripe linkage + lifecycle timestamps ─────────────
ALTER TABLE "Invoice"
  ADD COLUMN "order_id"          UUID,
  ADD COLUMN "number"            TEXT,
  ADD COLUMN "currency"          TEXT NOT NULL DEFAULT 'CAD',
  ADD COLUMN "stripe_invoice_id" TEXT,
  ADD COLUMN "issued_at"         TIMESTAMP(3),
  ADD COLUMN "paid_at"           TIMESTAMP(3),
  ADD COLUMN "due_at"            TIMESTAMP(3);
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE UNIQUE INDEX "Invoice_stripe_invoice_id_key" ON "Invoice"("stripe_invoice_id");
CREATE INDEX "Invoice_order_id_idx" ON "Invoice"("order_id");

-- ── CreateTable: InvoiceLine (per-line breakdown — quote lines + the HST line) ──────────────────
CREATE TABLE "InvoiceLine" (
    "id"          UUID NOT NULL,
    "org_id"      UUID NOT NULL,
    "invoice_id"  UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity"    INTEGER NOT NULL DEFAULT 1,
    "unit_amount" DECIMAL(12,2) NOT NULL,
    "amount"      DECIMAL(12,2) NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoiceLine_org_id_idx" ON "InvoiceLine"("org_id");
CREATE INDEX "InvoiceLine_invoice_id_idx" ON "InvoiceLine"("invoice_id");

-- ── CreateTable: Refund ────────────────────────────────────────────────────────────────────────
CREATE TABLE "Refund" (
    "id"               UUID NOT NULL,
    "org_id"           UUID NOT NULL,
    "payment_id"       UUID NOT NULL,
    "order_id"         UUID,
    "stripe_refund_id" TEXT,
    "amount"           DECIMAL(12,2) NOT NULL,
    "currency"         TEXT NOT NULL DEFAULT 'CAD',
    "reason"           TEXT,
    "status"           "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,
    "created_by"       UUID,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Refund_stripe_refund_id_key" ON "Refund"("stripe_refund_id");
CREATE INDEX "Refund_org_id_idx" ON "Refund"("org_id");
CREATE INDEX "Refund_payment_id_idx" ON "Refund"("payment_id");

-- ── CreateTable: Dispute ───────────────────────────────────────────────────────────────────────
CREATE TABLE "Dispute" (
    "id"                UUID NOT NULL,
    "org_id"            UUID NOT NULL,
    "payment_id"        UUID,
    "order_id"          UUID,
    "stripe_dispute_id" TEXT NOT NULL,
    "amount"            DECIMAL(12,2) NOT NULL,
    "currency"          TEXT NOT NULL DEFAULT 'CAD',
    "reason"            TEXT,
    "status"            "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "evidence_due_by"   TIMESTAMP(3),
    "opened_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at"       TIMESTAMP(3),
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Dispute_stripe_dispute_id_key" ON "Dispute"("stripe_dispute_id");
CREATE INDEX "Dispute_org_id_idx" ON "Dispute"("org_id");
CREATE INDEX "Dispute_payment_id_idx" ON "Dispute"("payment_id");

-- ── CreateTable: ProcessedStripeEvent (webhook idempotency ledger; append-only) ─────────────────
CREATE TABLE "ProcessedStripeEvent" (
    "id"          UUID NOT NULL,
    "event_id"    TEXT NOT NULL,
    "type"        TEXT NOT NULL,
    "org_id"      UUID,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessedStripeEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProcessedStripeEvent_event_id_key" ON "ProcessedStripeEvent"("event_id");
CREATE INDEX "ProcessedStripeEvent_type_idx" ON "ProcessedStripeEvent"("type");

-- ── AddForeignKey ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Append-only: the financial webhook ledger is tamper-evident (reuses bluebee_block_mutation,
--    defined in the init migration). A processed event is never updated or deleted. ──────────────
CREATE TRIGGER processed_stripe_event_append_only
  BEFORE UPDATE OR DELETE ON "ProcessedStripeEvent"
  FOR EACH ROW EXECUTE FUNCTION bluebee_block_mutation();
