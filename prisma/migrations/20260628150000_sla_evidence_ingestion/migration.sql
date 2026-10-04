CREATE TYPE "SlaEvidenceStatus" AS ENUM ('Processing', 'Completed', 'NeedsReview', 'Reviewed', 'Archived', 'Failed');

CREATE TABLE "sla_evidence" (
    "id" TEXT NOT NULL,
    "document_id" TEXT,
    "primary_order_id" TEXT,
    "vendor_name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_name" TEXT,
    "file_type" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "evidence_date" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'upload',
    "status" "SlaEvidenceStatus" NOT NULL DEFAULT 'Completed',
    "extracted_text" TEXT,
    "extracted_pos" JSONB NOT NULL DEFAULT '[]',
    "parser_warnings" JSONB NOT NULL DEFAULT '[]',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sla_evidence_purchase_orders" (
    "id" TEXT NOT NULL,
    "evidence_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "matched_by" TEXT NOT NULL DEFAULT 'operator',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_evidence_purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sla_evidence_document_id_key" ON "sla_evidence"("document_id");
CREATE INDEX "sla_evidence_status_created_at_idx" ON "sla_evidence"("status", "created_at");
CREATE INDEX "sla_evidence_primary_order_id_idx" ON "sla_evidence"("primary_order_id");
CREATE UNIQUE INDEX "sla_evidence_purchase_orders_evidence_id_order_id_key" ON "sla_evidence_purchase_orders"("evidence_id", "order_id");
CREATE INDEX "sla_evidence_purchase_orders_order_id_idx" ON "sla_evidence_purchase_orders"("order_id");

ALTER TABLE "sla_evidence" ADD CONSTRAINT "sla_evidence_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "purchase_order_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sla_evidence" ADD CONSTRAINT "sla_evidence_primary_order_id_fkey" FOREIGN KEY ("primary_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sla_evidence_purchase_orders" ADD CONSTRAINT "sla_evidence_purchase_orders_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "sla_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sla_evidence_purchase_orders" ADD CONSTRAINT "sla_evidence_purchase_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
