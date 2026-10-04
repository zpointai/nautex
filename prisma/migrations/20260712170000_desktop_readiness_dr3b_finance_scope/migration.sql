-- DR-3B direct organization ownership for finance exports and finance audit events.

ALTER TABLE "finance_audit_events" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "accounting_export_batches" ADD COLUMN "organization_id" TEXT;

CREATE INDEX "finance_audit_events_organization_id_created_at_idx" ON "finance_audit_events"("organization_id", "created_at");
CREATE INDEX "accounting_export_batches_organization_id_created_at_idx" ON "accounting_export_batches"("organization_id", "created_at");

ALTER TABLE "finance_audit_events" ADD CONSTRAINT "finance_audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "accounting_export_batches" ADD CONSTRAINT "accounting_export_batches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
