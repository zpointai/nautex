ALTER TABLE "supplier_invoices" ADD COLUMN "legal_entity_id" TEXT;
ALTER TYPE "FinanceAuditAction" ADD VALUE 'SupplierPaymentRecorded';
ALTER TYPE "FinanceAuditAction" ADD VALUE 'CustomerRefundRecorded';
ALTER TYPE "FinanceAuditAction" ADD VALUE 'SettlementReversed';
ALTER TYPE "FinanceAuditAction" ADD VALUE 'CreditNoteReconciled';
ALTER TYPE "FinanceAuditAction" ADD VALUE 'SupplierEntityAssigned';
ALTER TABLE "credit_notes" ADD COLUMN "refund_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "reconciliation_method" TEXT, ADD COLUMN "reconciliation_reason" TEXT, ADD COLUMN "reconciled_by" TEXT;
ALTER TABLE "credit_notes" ADD COLUMN "request_key" TEXT, ADD COLUMN "review_note" TEXT;
CREATE UNIQUE INDEX "credit_notes_request_key_key" ON "credit_notes"("request_key");
ALTER TABLE "inventory_reservations" ADD COLUMN "order_unit" TEXT, ADD COLUMN "stock_unit" TEXT,
  ADD COLUMN "stock_per_order_unit" DECIMAL(18,6) NOT NULL DEFAULT 1, ADD COLUMN "conversion_id" TEXT;
-- Historical ownership, credits, cash movements and conversion ratios are not inferred.
CREATE TABLE "supplier_payments" (
  "id" TEXT PRIMARY KEY, "invoice_id" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL, "paid_at" TIMESTAMP(3) NOT NULL, "reference" TEXT NOT NULL,
  "request_key" TEXT NOT NULL, "recorded_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversed_at" TIMESTAMP(3), "reversed_by" TEXT, "reversal_reason" TEXT,
  CONSTRAINT "supplier_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "supplier_payments_request_key_key" ON "supplier_payments"("request_key");
CREATE INDEX "supplier_payments_invoice_id_idx" ON "supplier_payments"("invoice_id");
CREATE TABLE "customer_refunds" (
  "id" TEXT PRIMARY KEY, "credit_note_id" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL, "paid_at" TIMESTAMP(3) NOT NULL, "reference" TEXT NOT NULL,
  "request_key" TEXT NOT NULL, "recorded_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reversed_at" TIMESTAMP(3), "reversed_by" TEXT, "reversal_reason" TEXT,
  CONSTRAINT "customer_refunds_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "customer_refunds_request_key_key" ON "customer_refunds"("request_key");
CREATE INDEX "customer_refunds_credit_note_id_idx" ON "customer_refunds"("credit_note_id");
CREATE TABLE "inventory_unit_conversions" (
  "id" TEXT PRIMARY KEY, "inventory_item_id" TEXT NOT NULL, "order_unit" TEXT NOT NULL, "stock_unit" TEXT NOT NULL,
  "stock_per_order_unit" DECIMAL(18,6) NOT NULL, "status" TEXT NOT NULL DEFAULT 'Pending',
  "reason" TEXT NOT NULL, "created_by" TEXT NOT NULL, "reviewed_by" TEXT, "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_unit_conversions_inventory_item_id_fkey" FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "inventory_unit_conversions_inventory_item_id_order_unit_idx" ON "inventory_unit_conversions"("inventory_item_id", "order_unit");
ALTER TABLE "goods_receipt_lines" ADD COLUMN "order_unit" TEXT, ADD COLUMN "stock_unit" TEXT, ADD COLUMN "stock_per_order_unit" DECIMAL(18,6) NOT NULL DEFAULT 1, ADD COLUMN "conversion_id" TEXT;
