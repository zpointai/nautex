-- DR-3 customer organization and legal-entity access foundation. Additive only.

CREATE TYPE "OrganizationStatus" AS ENUM ('Active', 'Suspended', 'Archived');
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('Invited', 'Active', 'Suspended', 'Removed');

CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'Active',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'Active',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_membership_roles" (
    "membership_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_membership_roles_pkey" PRIMARY KEY ("membership_id", "role_id")
);

CREATE TABLE "legal_entity_access" (
    "membership_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "legal_entity_access_pkey" PRIMARY KEY ("membership_id", "legal_entity_id")
);

ALTER TABLE "rfqs" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "shipping_companies" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "agreement_versions" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "inventory_items" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "legal_entities" ADD COLUMN "code" TEXT;
ALTER TABLE "customer_accounts" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "supplier_invoices" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "finance_exceptions" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "audit_events" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "documents" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "data_provenance" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "agent_runs" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "agent_exceptions" ADD COLUMN "organization_id" TEXT;
ALTER TABLE "validation_runs" ADD COLUMN "organization_id" TEXT;

CREATE UNIQUE INDEX "organizations_code_key" ON "organizations"("code");
CREATE INDEX "organizations_status_idx" ON "organizations"("status");
CREATE UNIQUE INDEX "organization_memberships_organization_id_user_id_key" ON "organization_memberships"("organization_id", "user_id");
CREATE INDEX "organization_memberships_user_id_status_idx" ON "organization_memberships"("user_id", "status");
CREATE INDEX "organization_membership_roles_role_id_idx" ON "organization_membership_roles"("role_id");
CREATE INDEX "legal_entity_access_legal_entity_id_idx" ON "legal_entity_access"("legal_entity_id");
CREATE INDEX "rfqs_organization_id_status_idx" ON "rfqs"("organization_id", "status");
CREATE INDEX "suppliers_organization_id_status_idx" ON "suppliers"("organization_id", "status");
CREATE INDEX "shipping_companies_organization_id_idx" ON "shipping_companies"("organization_id");
CREATE INDEX "agreement_versions_organization_id_status_idx" ON "agreement_versions"("organization_id", "status");
CREATE INDEX "purchase_orders_organization_id_status_idx" ON "purchase_orders"("organization_id", "status");
CREATE INDEX "inventory_items_organization_id_warehouse_idx" ON "inventory_items"("organization_id", "warehouse");
CREATE INDEX "legal_entities_organization_id_idx" ON "legal_entities"("organization_id");
CREATE UNIQUE INDEX "legal_entities_organization_id_code_key" ON "legal_entities"("organization_id", "code");
CREATE INDEX "customer_accounts_organization_id_status_idx" ON "customer_accounts"("organization_id", "status");
CREATE INDEX "supplier_invoices_organization_id_approval_status_idx" ON "supplier_invoices"("organization_id", "approval_status");
CREATE INDEX "finance_exceptions_organization_id_status_idx" ON "finance_exceptions"("organization_id", "status");
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");
CREATE INDEX "documents_organization_id_document_type_idx" ON "documents"("organization_id", "document_type");
CREATE INDEX "data_provenance_organization_id_kind_idx" ON "data_provenance"("organization_id", "kind");
CREATE INDEX "agent_runs_organization_id_status_idx" ON "agent_runs"("organization_id", "status");
CREATE INDEX "agent_exceptions_organization_id_status_idx" ON "agent_exceptions"("organization_id", "status");
CREATE INDEX "validation_runs_organization_id_created_at_idx" ON "validation_runs"("organization_id", "created_at");

ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_membership_roles" ADD CONSTRAINT "organization_membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_membership_roles" ADD CONSTRAINT "organization_membership_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_entity_access" ADD CONSTRAINT "legal_entity_access_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legal_entity_access" ADD CONSTRAINT "legal_entity_access_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shipping_companies" ADD CONSTRAINT "shipping_companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_accounts" ADD CONSTRAINT "customer_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "finance_exceptions" ADD CONSTRAINT "finance_exceptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_provenance" ADD CONSTRAINT "data_provenance_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agent_exceptions" ADD CONSTRAINT "agent_exceptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "validation_runs" ADD CONSTRAINT "validation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
