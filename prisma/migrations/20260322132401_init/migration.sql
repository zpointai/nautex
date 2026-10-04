-- CreateEnum
CREATE TYPE "RfqStatus" AS ENUM ('Draft', 'Sent', 'Quoted', 'Awarded');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('Pending Approval', 'Procurement', 'In Transit', 'Delivered', 'At Risk');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('High', 'Normal', 'Low');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('Active', 'Watch', 'Blocked');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('Active', 'Expiring', 'Expired');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('Low', 'Medium', 'High');

-- CreateEnum
CREATE TYPE "FinanceType" AS ENUM ('Invoice', 'Credit Note', 'Accrual');

-- CreateEnum
CREATE TYPE "FinanceStatus" AS ENUM ('Pending', 'Posted', 'Failed');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RFQ', 'Quote', 'PO', 'Invoice', 'SDS', 'POD');

-- CreateEnum
CREATE TYPE "ComplianceType" AS ENUM ('DG', 'Sanctions', 'UoM', 'Document');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('Open', 'Under Review', 'Resolved');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('Low', 'Medium', 'High');

-- CreateEnum
CREATE TYPE "LinkStage" AS ENUM ('RFQ', 'PO', 'Delivery');

-- CreateEnum
CREATE TYPE "ImpactLevel" AS ENUM ('Low', 'Medium', 'High');

-- CreateTable
CREATE TABLE "rfqs" (
    "id" TEXT NOT NULL,
    "vessel" TEXT NOT NULL,
    "port" TEXT NOT NULL,
    "needed_by" TEXT NOT NULL,
    "items" INTEGER NOT NULL,
    "status" "RfqStatus" NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "vessel" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "eta" TIMESTAMP(3) NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "margin_pct" DOUBLE PRECISION NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'Pending Approval',
    "priority" "Priority" NOT NULL DEFAULT 'Normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "lead_time_days" INTEGER NOT NULL,
    "status" "SupplierStatus" NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start_date" TEXT NOT NULL,
    "end_date" TEXT NOT NULL,
    "discount_pct" DOUBLE PRECISION NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "uom" TEXT NOT NULL,
    "on_hand" INTEGER NOT NULL,
    "reorder_point" INTEGER NOT NULL,
    "dangerous_goods" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_issues" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "expected_margin_pct" DOUBLE PRECISION NOT NULL,
    "actual_margin_pct" DOUBLE PRECISION NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'Low',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_records" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" "FinanceType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "FinanceStatus" NOT NULL DEFAULT 'Pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_records" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "related_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL,
    "extracted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_cases" (
    "id" TEXT NOT NULL,
    "type" "ComplianceType" NOT NULL,
    "vessel" TEXT NOT NULL,
    "status" "ComplianceStatus" NOT NULL DEFAULT 'Open',
    "details" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_check_results" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "risk" "RiskLevel" NOT NULL DEFAULT 'Low',
    "findings" TEXT[],
    "recommendation" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessels" (
    "id" TEXT NOT NULL,
    "mmsi" TEXT NOT NULL,
    "imo" TEXT,
    "name" TEXT NOT NULL,
    "callsign" TEXT,
    "flag" TEXT,
    "type" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "heading" INTEGER NOT NULL,
    "course" INTEGER NOT NULL,
    "destination" TEXT NOT NULL,
    "eta" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "zone" TEXT,
    "src" TEXT,
    "draught" DOUBLE PRECISION,
    "length" INTEGER,
    "beam" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_order_links" (
    "id" TEXT NOT NULL,
    "vessel_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "stage" "LinkStage" NOT NULL,
    "port" TEXT NOT NULL,
    "impact" "ImpactLevel" NOT NULL DEFAULT 'Medium',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vessel_order_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vessels_mmsi_key" ON "vessels"("mmsi");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_issues" ADD CONSTRAINT "pricing_issues_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_records" ADD CONSTRAINT "finance_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_order_links" ADD CONSTRAINT "vessel_order_links_vessel_id_fkey" FOREIGN KEY ("vessel_id") REFERENCES "vessels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
