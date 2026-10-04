-- DR-7E: first-class customer quotes and priced line snapshots.
CREATE TYPE "CustomerQuoteStatus" AS ENUM ('Draft', 'PendingApproval', 'Approved', 'Sent', 'Accepted', 'Declined', 'Expired', 'Cancelled');

CREATE TABLE "customer_quotes" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "legal_entity_id" TEXT,
  "customer_id" TEXT NOT NULL,
  "party_id" TEXT,
  "rfq_id" TEXT,
  "quote_number" TEXT,
  "source_key" TEXT NOT NULL,
  "status" "CustomerQuoteStatus" NOT NULL DEFAULT 'Draft',
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "valid_until" TIMESTAMP(3) NOT NULL,
  "payment_terms" TEXT NOT NULL,
  "vessel_name" TEXT,
  "vessel_imo" TEXT,
  "port" TEXT,
  "customer_reference" TEXT,
  "subject" TEXT NOT NULL,
  "notes" TEXT,
  "markup_pct" DECIMAL(8,2) NOT NULL,
  "margin_pct" DECIMAL(8,2) NOT NULL,
  "net_amount" DECIMAL(14,2) NOT NULL,
  "vat_rate" DECIMAL(5,2) NOT NULL,
  "vat_amount" DECIMAL(14,2) NOT NULL,
  "gross_amount" DECIMAL(14,2) NOT NULL,
  "created_by_id" TEXT,
  "created_by_name" TEXT,
  "submitted_at" TIMESTAMP(3),
  "approved_at" TIMESTAMP(3),
  "approved_by_id" TEXT,
  "approved_by_name" TEXT,
  "sent_at" TIMESTAMP(3),
  "responded_at" TIMESTAMP(3),
  "accepted_at" TIMESTAMP(3),
  "declined_at" TIMESTAMP(3),
  "expired_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_quotes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_quotes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_quotes_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_quotes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_quotes_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "customer_quotes_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "customer_quote_lines" (
  "id" TEXT NOT NULL,
  "quote_id" TEXT NOT NULL,
  "rfq_line_id" TEXT,
  "source_supplier_quote_id" TEXT,
  "line_number" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unit" TEXT NOT NULL,
  "impa_code" TEXT,
  "unit_cost" DECIMAL(14,4) NOT NULL,
  "unit_price" DECIMAL(14,4) NOT NULL,
  "net_amount" DECIMAL(14,2) NOT NULL,
  "margin_pct" DECIMAL(8,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customer_quote_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_quote_lines_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "customer_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "customer_quote_lines_rfq_line_id_fkey" FOREIGN KEY ("rfq_line_id") REFERENCES "rfq_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_quote_lines_source_supplier_quote_id_fkey" FOREIGN KEY ("source_supplier_quote_id") REFERENCES "supplier_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "customer_quotes_source_key_key" ON "customer_quotes"("source_key");
CREATE UNIQUE INDEX "customer_quotes_organization_id_quote_number_key" ON "customer_quotes"("organization_id", "quote_number");
CREATE INDEX "customer_quotes_organization_id_status_valid_until_idx" ON "customer_quotes"("organization_id", "status", "valid_until");
CREATE INDEX "customer_quotes_customer_id_status_idx" ON "customer_quotes"("customer_id", "status");
CREATE INDEX "customer_quotes_party_id_idx" ON "customer_quotes"("party_id");
CREATE INDEX "customer_quotes_rfq_id_idx" ON "customer_quotes"("rfq_id");
CREATE UNIQUE INDEX "customer_quote_lines_quote_id_line_number_key" ON "customer_quote_lines"("quote_id", "line_number");
CREATE UNIQUE INDEX "customer_quote_lines_quote_id_rfq_line_id_key" ON "customer_quote_lines"("quote_id", "rfq_line_id");
CREATE INDEX "customer_quote_lines_rfq_line_id_idx" ON "customer_quote_lines"("rfq_line_id");
CREATE INDEX "customer_quote_lines_source_supplier_quote_id_idx" ON "customer_quote_lines"("source_supplier_quote_id");
