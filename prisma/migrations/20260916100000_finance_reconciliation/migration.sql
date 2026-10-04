ALTER TABLE "customer_invoices" ADD COLUMN "credited_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "customer_payments" ADD COLUMN "request_key" TEXT;
CREATE UNIQUE INDEX "customer_payments_request_key_key" ON "customer_payments"("request_key");
ALTER TABLE "credit_notes" ADD COLUMN "applied_to_invoice_at" TIMESTAMP(3);
-- Historical issued credits are not reapplied: their original reconciliation is unknown.
DROP INDEX "customer_invoices_invoice_no_key";
CREATE UNIQUE INDEX "customer_invoices_legal_entity_id_invoice_no_key" ON "customer_invoices"("legal_entity_id", "invoice_no");
