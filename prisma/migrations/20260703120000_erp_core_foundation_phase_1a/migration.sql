-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('Organization', 'Person', 'Unknown');

-- CreateEnum
CREATE TYPE "PartyStatus" AS ENUM ('Active', 'Inactive', 'Watch', 'Blocked', 'Archived');

-- CreateEnum
CREATE TYPE "PartyRoleType" AS ENUM ('Customer', 'Supplier', 'Vendor', 'ShippingCompany', 'Owner', 'Agent', 'Broker', 'LegalEntity', 'Contact', 'Other');

-- CreateEnum
CREATE TYPE "NumberSequenceDocumentType" AS ENUM ('Rfq', 'Quote', 'SupplierInquiry', 'PurchaseOrder', 'SalesOrder', 'CustomerInvoice', 'SupplierInvoice', 'CreditNote', 'Agreement', 'ValidationRun', 'Exception', 'AgentRun', 'ExportBatch', 'Document', 'GoodsReceipt', 'Delivery', 'Backorder', 'SupplierConfirmation', 'ImportBatch');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('Operator', 'User', 'System', 'Agent', 'Import', 'Api');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('Active', 'Archived', 'Deleted');

-- CreateEnum
CREATE TYPE "ProvenanceKind" AS ENUM ('Operational', 'Seed', 'Demo', 'Imported', 'Screenshot', 'System');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN "party_id" TEXT;

-- AlterTable
ALTER TABLE "shipping_companies" ADD COLUMN "party_id" TEXT;

-- AlterTable
ALTER TABLE "customer_accounts" ADD COLUMN "party_id" TEXT;

-- CreateTable
CREATE TABLE "parties" (
    "id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "normalized_name" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL DEFAULT 'Organization',
    "status" "PartyStatus" NOT NULL DEFAULT 'Active',
    "country" TEXT,
    "city" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "vat_id" TEXT,
    "company_number" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_role_assignments" (
    "id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "role" "PartyRoleType" NOT NULL,
    "source_model" TEXT,
    "source_id" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "party_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "party_aliases" (
    "id" TEXT NOT NULL,
    "party_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized_alias" TEXT NOT NULL,
    "alias_type" TEXT NOT NULL DEFAULT 'name',
    "source_module" TEXT,
    "confidence" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "party_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_references" (
    "id" TEXT NOT NULL,
    "party_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_value" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "external_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequences" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "document_type" "NumberSequenceDocumentType" NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "prefix" TEXT NOT NULL,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "last_issued_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_number" TEXT,
    "event_type" TEXT NOT NULL,
    "actor_type" "AuditActorType" NOT NULL DEFAULT 'Operator',
    "actor_id" TEXT,
    "actor_name" TEXT,
    "source_module" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "agent_run_id" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "document_no" TEXT,
    "document_type" TEXT NOT NULL,
    "title" TEXT,
    "original_file_name" TEXT,
    "file_name" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "checksum_sha256" TEXT,
    "storage_provider" TEXT NOT NULL DEFAULT 'local',
    "storage_key" TEXT,
    "source_module" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'Active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "archived_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_number" TEXT,
    "link_role" TEXT NOT NULL DEFAULT 'source',
    "source_module" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_provenance" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "kind" "ProvenanceKind" NOT NULL,
    "source" TEXT,
    "scenario" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_provenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parties_normalized_name_idx" ON "parties"("normalized_name");

-- CreateIndex
CREATE INDEX "parties_kind_status_idx" ON "parties"("kind", "status");

-- CreateIndex
CREATE INDEX "party_role_assignments_party_id_role_idx" ON "party_role_assignments"("party_id", "role");

-- CreateIndex
CREATE INDEX "party_role_assignments_source_model_source_id_idx" ON "party_role_assignments"("source_model", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "party_aliases_party_id_normalized_alias_key" ON "party_aliases"("party_id", "normalized_alias");

-- CreateIndex
CREATE INDEX "party_aliases_normalized_alias_idx" ON "party_aliases"("normalized_alias");

-- CreateIndex
CREATE UNIQUE INDEX "external_references_system_reference_type_reference_value_key" ON "external_references"("system", "reference_type", "reference_value");

-- CreateIndex
CREATE INDEX "external_references_entity_type_entity_id_idx" ON "external_references"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "external_references_party_id_idx" ON "external_references"("party_id");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequences_legal_entity_id_document_type_fiscal_year_prefix_key" ON "number_sequences"("legal_entity_id", "document_type", "fiscal_year", "prefix");

-- CreateIndex
CREATE INDEX "number_sequences_document_type_fiscal_year_idx" ON "number_sequences"("document_type", "fiscal_year");

-- CreateIndex
CREATE INDEX "audit_events_entity_type_entity_id_created_at_idx" ON "audit_events"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_event_type_created_at_idx" ON "audit_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_source_module_created_at_idx" ON "audit_events"("source_module", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "documents_document_no_key" ON "documents"("document_no");

-- CreateIndex
CREATE INDEX "documents_document_type_idx" ON "documents"("document_type");

-- CreateIndex
CREATE INDEX "documents_source_module_created_at_idx" ON "documents"("source_module", "created_at");

-- CreateIndex
CREATE INDEX "documents_checksum_sha256_idx" ON "documents"("checksum_sha256");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_document_id_entity_type_entity_id_link_role_key" ON "document_links"("document_id", "entity_type", "entity_id", "link_role");

-- CreateIndex
CREATE INDEX "document_links_entity_type_entity_id_idx" ON "document_links"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "data_provenance_entity_type_entity_id_key" ON "data_provenance"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "data_provenance_kind_idx" ON "data_provenance"("kind");

-- CreateIndex
CREATE INDEX "data_provenance_entity_type_entity_id_idx" ON "data_provenance"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "suppliers_party_id_idx" ON "suppliers"("party_id");

-- CreateIndex
CREATE INDEX "shipping_companies_party_id_idx" ON "shipping_companies"("party_id");

-- CreateIndex
CREATE INDEX "customer_accounts_party_id_idx" ON "customer_accounts"("party_id");

-- AddForeignKey
ALTER TABLE "party_role_assignments" ADD CONSTRAINT "party_role_assignments_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "party_aliases" ADD CONSTRAINT "party_aliases_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_references" ADD CONSTRAINT "external_references_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_companies" ADD CONSTRAINT "shipping_companies_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
