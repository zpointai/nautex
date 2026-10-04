CREATE TYPE "CustomerContractStatus" AS ENUM ('Draft', 'UnderReview', 'Active', 'Expired', 'Archived');

CREATE TYPE "CustomerContractItemStatus" AS ENUM ('Active', 'Excluded', 'NeedsReview');

CREATE TABLE "customer_contracts" (
    "id" TEXT NOT NULL,
    "contract_number" TEXT NOT NULL,
    "shipping_company_id" TEXT NOT NULL,
    "shipping_company_name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "CustomerContractStatus" NOT NULL DEFAULT 'Draft',
    "markup_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "payment_terms" TEXT,
    "delivery_terms" TEXT,
    "notes" TEXT,
    "total_base_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_sell_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL DEFAULT 'operator',
    "reviewed_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contracts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_contract_source_agreements" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "agreement_version_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "included_item_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contract_source_agreements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_contract_items" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "source_agreement_id" TEXT,
    "agreement_item_id" TEXT,
    "supplier_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_code" TEXT,
    "vendor_part_number" TEXT,
    "description" TEXT NOT NULL,
    "base_price" DOUBLE PRECISION NOT NULL,
    "contract_markup_percent" DOUBLE PRECISION NOT NULL,
    "sell_price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "unit" TEXT,
    "moq" INTEGER,
    "lead_time_days" INTEGER,
    "hs_code" TEXT,
    "country_of_origin" TEXT,
    "manufacturer" TEXT,
    "status" "CustomerContractItemStatus" NOT NULL DEFAULT 'Active',
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contract_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_contract_audit_events" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'operator',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_contract_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_contracts_contract_number_key" ON "customer_contracts"("contract_number");
CREATE INDEX "customer_contracts_shipping_company_id_idx" ON "customer_contracts"("shipping_company_id");
CREATE INDEX "customer_contracts_status_idx" ON "customer_contracts"("status");
CREATE INDEX "customer_contracts_valid_to_idx" ON "customer_contracts"("valid_to");

CREATE UNIQUE INDEX "customer_contract_source_agreements_contract_id_agreement_version_id_key" ON "customer_contract_source_agreements"("contract_id", "agreement_version_id");
CREATE INDEX "customer_contract_source_agreements_agreement_version_id_idx" ON "customer_contract_source_agreements"("agreement_version_id");
CREATE INDEX "customer_contract_source_agreements_supplier_id_idx" ON "customer_contract_source_agreements"("supplier_id");

CREATE INDEX "customer_contract_items_contract_id_idx" ON "customer_contract_items"("contract_id");
CREATE INDEX "customer_contract_items_source_agreement_id_idx" ON "customer_contract_items"("source_agreement_id");
CREATE INDEX "customer_contract_items_agreement_item_id_idx" ON "customer_contract_items"("agreement_item_id");
CREATE INDEX "customer_contract_items_supplier_id_idx" ON "customer_contract_items"("supplier_id");

CREATE INDEX "customer_contract_audit_events_contract_id_created_at_idx" ON "customer_contract_audit_events"("contract_id", "created_at");

ALTER TABLE "customer_contracts"
ADD CONSTRAINT "customer_contracts_shipping_company_id_fkey"
FOREIGN KEY ("shipping_company_id") REFERENCES "shipping_companies"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_contract_source_agreements"
ADD CONSTRAINT "customer_contract_source_agreements_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "customer_contracts"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_contract_source_agreements"
ADD CONSTRAINT "customer_contract_source_agreements_agreement_version_id_fkey"
FOREIGN KEY ("agreement_version_id") REFERENCES "agreement_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_contract_items"
ADD CONSTRAINT "customer_contract_items_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "customer_contracts"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_contract_items"
ADD CONSTRAINT "customer_contract_items_source_agreement_id_fkey"
FOREIGN KEY ("source_agreement_id") REFERENCES "customer_contract_source_agreements"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_contract_items"
ADD CONSTRAINT "customer_contract_items_agreement_item_id_fkey"
FOREIGN KEY ("agreement_item_id") REFERENCES "agreement_items"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_contract_audit_events"
ADD CONSTRAINT "customer_contract_audit_events_contract_id_fkey"
FOREIGN KEY ("contract_id") REFERENCES "customer_contracts"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
