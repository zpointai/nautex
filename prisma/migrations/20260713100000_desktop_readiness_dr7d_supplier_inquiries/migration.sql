-- DR-7D: first-class supplier inquiries and line responses.
CREATE TYPE "SupplierInquiryStatus" AS ENUM ('Draft', 'Sent', 'PartiallyResponded', 'Responded', 'Closed', 'Cancelled');
CREATE TYPE "SupplierInquiryLineStatus" AS ENUM ('Pending', 'Quoted', 'Unavailable', 'NoResponse');

CREATE TABLE "supplier_inquiries" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "legal_entity_id" TEXT,
  "rfq_id" TEXT NOT NULL,
  "supplier_id" TEXT NOT NULL,
  "party_id" TEXT,
  "inquiry_number" TEXT,
  "source_key" TEXT NOT NULL,
  "status" "SupplierInquiryStatus" NOT NULL DEFAULT 'Draft',
  "subject" TEXT NOT NULL,
  "message" TEXT,
  "response_due_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "responded_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_inquiries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_inquiries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_inquiries_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_inquiries_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_inquiries_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_inquiries_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "supplier_inquiry_lines" (
  "id" TEXT NOT NULL,
  "inquiry_id" TEXT NOT NULL,
  "rfq_line_id" TEXT NOT NULL,
  "line_number" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "impa_code" TEXT,
  "status" "SupplierInquiryLineStatus" NOT NULL DEFAULT 'Pending',
  "response_note" TEXT,
  "responded_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supplier_inquiry_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_inquiry_lines_inquiry_id_fkey" FOREIGN KEY ("inquiry_id") REFERENCES "supplier_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplier_inquiry_lines_rfq_line_id_fkey" FOREIGN KEY ("rfq_line_id") REFERENCES "rfq_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "supplier_quotes" ADD COLUMN "supplier_inquiry_line_id" TEXT;
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplier_inquiry_line_id_fkey" FOREIGN KEY ("supplier_inquiry_line_id") REFERENCES "supplier_inquiry_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "supplier_inquiries_source_key_key" ON "supplier_inquiries"("source_key");
CREATE UNIQUE INDEX "supplier_inquiries_organization_id_inquiry_number_key" ON "supplier_inquiries"("organization_id", "inquiry_number");
CREATE INDEX "supplier_inquiries_organization_id_status_response_due_at_idx" ON "supplier_inquiries"("organization_id", "status", "response_due_at");
CREATE INDEX "supplier_inquiries_rfq_id_status_idx" ON "supplier_inquiries"("rfq_id", "status");
CREATE INDEX "supplier_inquiries_supplier_id_status_idx" ON "supplier_inquiries"("supplier_id", "status");
CREATE INDEX "supplier_inquiries_party_id_idx" ON "supplier_inquiries"("party_id");
CREATE UNIQUE INDEX "supplier_inquiry_lines_inquiry_id_rfq_line_id_key" ON "supplier_inquiry_lines"("inquiry_id", "rfq_line_id");
CREATE UNIQUE INDEX "supplier_inquiry_lines_inquiry_id_line_number_key" ON "supplier_inquiry_lines"("inquiry_id", "line_number");
CREATE INDEX "supplier_inquiry_lines_rfq_line_id_idx" ON "supplier_inquiry_lines"("rfq_line_id");
CREATE INDEX "supplier_inquiry_lines_inquiry_id_status_idx" ON "supplier_inquiry_lines"("inquiry_id", "status");
CREATE UNIQUE INDEX "supplier_quotes_supplier_inquiry_line_id_key" ON "supplier_quotes"("supplier_inquiry_line_id");
