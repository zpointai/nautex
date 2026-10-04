-- CreateEnum
CREATE TYPE "EnrichmentState" AS ENUM ('None', 'Pending', 'Enriching', 'Enriched', 'Failed');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('Draft', 'Sent', 'Received', 'Accepted', 'Rejected');

-- CreateEnum
CREATE TYPE "AgreementStatus" AS ENUM ('Draft', 'Sent', 'Active', 'Expired', 'Archived');

-- CreateEnum
CREATE TYPE "ComparisonStatus" AS ENUM ('Queued', 'Processing', 'Completed', 'Failed');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('New', 'Removed', 'Price Change', 'Field Change');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('Pending', 'Accepted', 'Rejected', 'Auto Applied');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('BuyerPO', 'SubPO', 'DirectPO');

-- CreateEnum
CREATE TYPE "ShipServLifecycle" AS ENUM ('RFQ Received', 'Quote Sent', 'PO Received', 'Order Confirmed', 'Invoiced', 'Closed');

-- CreateEnum
CREATE TYPE "ConfirmStatus" AS ENUM ('Unconfirmed', 'Partially Confirmed', 'Confirmed', 'Rejected');

-- CreateEnum
CREATE TYPE "LineStatus" AS ENUM ('Open', 'Confirmed', 'Partially Delivered', 'Delivered', 'Backordered', 'Cancelled');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('Running', 'Completed', 'Failed', 'Awaiting Approval');

-- CreateEnum
CREATE TYPE "AgentTaskStatus" AS ENUM ('Pending', 'Running', 'Completed', 'Failed', 'Awaiting Approval', 'Auto Committed');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'Auto Approved');

-- CreateEnum
CREATE TYPE "ExceptionSeverity" AS ENUM ('Critical', 'Warning', 'Info');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('Open', 'Reviewing', 'Resolved', 'Dismissed');

-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('Draft', 'Committed', 'Rejected');

-- CreateEnum
CREATE TYPE "MatchRunStatus" AS ENUM ('Running', 'Ranked', 'Accepted', 'AllRejected', 'Expired', 'Failed');

-- CreateEnum
CREATE TYPE "CandidateOutcome" AS ENUM ('Pending', 'Accepted', 'Accepted With Edits', 'Rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SupplierStatus" ADD VALUE 'Suggested';
ALTER TYPE "SupplierStatus" ADD VALUE 'Inactive';
ALTER TYPE "SupplierStatus" ADD VALUE 'Verified';
ALTER TYPE "SupplierStatus" ADD VALUE 'Rejected';
ALTER TYPE "SupplierStatus" ADD VALUE 'Needs Review';

-- AlterTable
ALTER TABLE "finance_records" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "buyer_name" TEXT,
ADD COLUMN     "buyer_ref" TEXT,
ADD COLUMN     "confirmStatus" "ConfirmStatus" NOT NULL DEFAULT 'Unconfirmed',
ADD COLUMN     "confirmed_date" TIMESTAMP(3),
ADD COLUMN     "cost_total" DOUBLE PRECISION,
ADD COLUMN     "margin_override" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "markup_pct" DOUBLE PRECISION,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "order_type" "OrderType" NOT NULL DEFAULT 'DirectPO',
ADD COLUMN     "parent_order_id" TEXT,
ADD COLUMN     "po_number" TEXT NOT NULL,
ADD COLUMN     "port" TEXT,
ADD COLUMN     "requested_date" TIMESTAMP(3),
ADD COLUMN     "rfq_id" TEXT,
ADD COLUMN     "shipserv_lifecycle" "ShipServLifecycle",
ADD COLUMN     "shipserv_po_id" TEXT,
ADD COLUMN     "shipserv_quote_id" TEXT,
ADD COLUMN     "shipserv_rfq_id" TEXT,
ADD COLUMN     "supplier_id" TEXT,
ADD COLUMN     "supplier_ref" TEXT,
ADD COLUMN     "vessel_imo" TEXT,
ADD COLUMN     "vessel_owner" TEXT,
ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "rfqs" DROP COLUMN "items",
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "city" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "contact_person" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "enrichment_status" "EnrichmentState" NOT NULL DEFAULT 'None',
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "ports_covered" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "source_references" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supplier_code" TEXT NOT NULL,
ADD COLUMN     "website" TEXT,
ALTER COLUMN "score" SET DEFAULT 0,
ALTER COLUMN "lead_time_days" SET DEFAULT 0;

-- CreateTable
CREATE TABLE "rfq_lines" (
    "id" TEXT NOT NULL,
    "rfq_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "impa_code" TEXT,
    "hs_code" TEXT,
    "country_origin" TEXT,
    "normalized_desc" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "normalized_desc" TEXT,
    "impa_code" TEXT,
    "hs_code_eu" TEXT,
    "hs_code_us" TEXT,
    "country_origin" TEXT,
    "category" TEXT,
    "unit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotes" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "rfq_line_id" TEXT,
    "description" TEXT NOT NULL,
    "unit_price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "lead_time_days" INTEGER,
    "stock_status" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'Received',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_versions" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "status" "AgreementStatus" NOT NULL DEFAULT 'Draft',
    "markup_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_base_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_marked_up_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "exported_file_name" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_items" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "offi_number" TEXT,
    "system_id" TEXT,
    "vendor_part_number" TEXT,
    "description" TEXT NOT NULL,
    "base_price" DOUBLE PRECISION NOT NULL,
    "marked_up_price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "unit" TEXT,
    "moq" INTEGER,
    "lead_time_days" INTEGER,
    "hs_code" TEXT,
    "country_of_origin" TEXT,
    "manufacturer" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_comparisons" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "status" "ComparisonStatus" NOT NULL DEFAULT 'Queued',
    "source_file_name" TEXT NOT NULL,
    "source_file_type" TEXT NOT NULL,
    "source_row_count" INTEGER,
    "total_changes" INTEGER NOT NULL DEFAULT 0,
    "new_items" INTEGER NOT NULL DEFAULT 0,
    "removed_items" INTEGER NOT NULL DEFAULT 0,
    "changed_items" INTEGER NOT NULL DEFAULT 0,
    "price_changes" INTEGER NOT NULL DEFAULT 0,
    "total_price_impact" DOUBLE PRECISION,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "progress_message" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_changes" (
    "id" TEXT NOT NULL,
    "comparison_id" TEXT NOT NULL,
    "change_type" "ChangeType" NOT NULL,
    "match_key" TEXT NOT NULL,
    "offi_number" TEXT,
    "system_id" TEXT,
    "vendor_part_number" TEXT,
    "description" TEXT,
    "old_values" JSONB NOT NULL DEFAULT '{}',
    "new_values" JSONB NOT NULL DEFAULT '{}',
    "changed_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "price_old" DOUBLE PRECISION,
    "price_new" DOUBLE PRECISION,
    "price_diff_pct" DOUBLE PRECISION,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'Pending',
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "applied_to_item_id" TEXT,
    "baseline_item_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agreement_insights" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "suggestion" TEXT,
    "supplier_id" TEXT,
    "supplier_name" TEXT,
    "version_id" TEXT,
    "comparison_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "dismissed_at" TIMESTAMP(3),
    "dedupe_key" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_notes" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'operator',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "actor" TEXT NOT NULL DEFAULT 'operator',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "item_code" TEXT,
    "description" TEXT NOT NULL,
    "supplier_part_no" TEXT,
    "qty_ordered" DOUBLE PRECISION NOT NULL,
    "qty_confirmed" DOUBLE PRECISION,
    "qty_delivered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uom" TEXT NOT NULL DEFAULT 'EA',
    "unit_price" DOUBLE PRECISION NOT NULL,
    "line_total" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "parent_line_id" TEXT,
    "buyer_unit_price" DOUBLE PRECISION,
    "forwarded_to_order_id" TEXT,
    "requested_date" TIMESTAMP(3),
    "confirmed_date" TIMESTAMP(3),
    "status" "LineStatus" NOT NULL DEFAULT 'Open',
    "remarks" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_allocations" (
    "id" TEXT NOT NULL,
    "buyer_line_id" TEXT NOT NULL,
    "sub_po_line_id" TEXT NOT NULL,
    "allocated_qty" DOUBLE PRECISION NOT NULL,
    "buyer_unit_price" DOUBLE PRECISION NOT NULL,
    "supplier_unit_price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_line_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "command_text" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'Running',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB,
    "status" "AgentTaskStatus" NOT NULL DEFAULT 'Pending',
    "confidence" DOUBLE PRECISION,
    "model" TEXT,
    "provider" TEXT,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'medium',
    "status" "ApprovalStatus" NOT NULL DEFAULT 'Pending',
    "data" JSONB,
    "resolved_by" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_exceptions" (
    "id" TEXT NOT NULL,
    "task_id" TEXT,
    "agent" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "severity" "ExceptionSeverity" NOT NULL DEFAULT 'Warning',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "suggested_action" TEXT,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'Open',
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "agent_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "run_id" TEXT,
    "agent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "provider" TEXT,
    "duration_ms" INTEGER,
    "committed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrichment_results" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "model" TEXT,
    "provider" TEXT,
    "status" "EnrichmentStatus" NOT NULL DEFAULT 'Draft',
    "committed_to" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrichment_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_history" (
    "id" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "user_id" TEXT,
    "routed_to" TEXT NOT NULL,
    "run_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "result_summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_runs" (
    "id" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "status" "MatchRunStatus" NOT NULL DEFAULT 'Running',
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "accepted_candidate_id" TEXT,
    "saved_supplier_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "match_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_candidates" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "source_tag" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "country" TEXT,
    "city" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "contact_person" TEXT,
    "description" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ports_covered" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "overall_score" DOUBLE PRECISION NOT NULL,
    "confidence_band" TEXT NOT NULL,
    "score_breakdown" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "conflicts" JSONB,
    "missing_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "existing_supplier_id" TEXT,
    "outcome" "CandidateOutcome" NOT NULL DEFAULT 'Pending',
    "user_edits" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_feedback" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "corrected_fields" JSONB,
    "rejection_reason" TEXT,
    "query_snapshot" JSONB NOT NULL,
    "candidate_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_reliability" (
    "id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_key" TEXT NOT NULL,
    "total_uses" INTEGER NOT NULL DEFAULT 0,
    "accepts" INTEGER NOT NULL DEFAULT 0,
    "rejects" INTEGER NOT NULL DEFAULT 0,
    "edits" INTEGER NOT NULL DEFAULT 0,
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_reliability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agreement_versions_supplier_id_idx" ON "agreement_versions"("supplier_id");

-- CreateIndex
CREATE INDEX "agreement_versions_status_idx" ON "agreement_versions"("status");

-- CreateIndex
CREATE INDEX "agreement_versions_valid_to_idx" ON "agreement_versions"("valid_to");

-- CreateIndex
CREATE INDEX "agreement_items_version_id_idx" ON "agreement_items"("version_id");

-- CreateIndex
CREATE INDEX "agreement_comparisons_version_id_idx" ON "agreement_comparisons"("version_id");

-- CreateIndex
CREATE INDEX "agreement_comparisons_status_idx" ON "agreement_comparisons"("status");

-- CreateIndex
CREATE INDEX "agreement_changes_comparison_id_idx" ON "agreement_changes"("comparison_id");

-- CreateIndex
CREATE INDEX "agreement_changes_review_status_idx" ON "agreement_changes"("review_status");

-- CreateIndex
CREATE UNIQUE INDEX "agreement_insights_dedupe_key_key" ON "agreement_insights"("dedupe_key");

-- CreateIndex
CREATE INDEX "agreement_insights_dismissed_type_idx" ON "agreement_insights"("dismissed", "type");

-- CreateIndex
CREATE INDEX "agreement_insights_supplier_id_idx" ON "agreement_insights"("supplier_id");

-- CreateIndex
CREATE INDEX "purchase_order_notes_order_id_created_at_idx" ON "purchase_order_notes"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_order_events_order_id_created_at_idx" ON "purchase_order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "purchase_order_lines_parent_line_id_idx" ON "purchase_order_lines"("parent_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_order_id_line_number_key" ON "purchase_order_lines"("order_id", "line_number");

-- CreateIndex
CREATE INDEX "order_line_allocations_buyer_line_id_idx" ON "order_line_allocations"("buyer_line_id");

-- CreateIndex
CREATE INDEX "order_line_allocations_sub_po_line_id_idx" ON "order_line_allocations"("sub_po_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_allocations_buyer_line_id_sub_po_line_id_key" ON "order_line_allocations"("buyer_line_id", "sub_po_line_id");

-- CreateIndex
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs"("agent");

-- CreateIndex
CREATE INDEX "agent_runs_status_idx" ON "agent_runs"("status");

-- CreateIndex
CREATE INDEX "agent_tasks_run_id_idx" ON "agent_tasks"("run_id");

-- CreateIndex
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks"("status");

-- CreateIndex
CREATE INDEX "approvals_status_idx" ON "approvals"("status");

-- CreateIndex
CREATE INDEX "agent_exceptions_status_idx" ON "agent_exceptions"("status");

-- CreateIndex
CREATE INDEX "agent_exceptions_severity_idx" ON "agent_exceptions"("severity");

-- CreateIndex
CREATE INDEX "audit_log_agent_idx" ON "audit_log"("agent");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE INDEX "enrichment_results_type_idx" ON "enrichment_results"("type");

-- CreateIndex
CREATE UNIQUE INDEX "enrichment_results_type_input_hash_key" ON "enrichment_results"("type", "input_hash");

-- CreateIndex
CREATE INDEX "command_history_created_at_idx" ON "command_history"("created_at");

-- CreateIndex
CREATE INDEX "match_runs_status_idx" ON "match_runs"("status");

-- CreateIndex
CREATE INDEX "match_runs_created_at_idx" ON "match_runs"("created_at");

-- CreateIndex
CREATE INDEX "match_candidates_run_id_rank_idx" ON "match_candidates"("run_id", "rank");

-- CreateIndex
CREATE INDEX "match_feedback_action_idx" ON "match_feedback"("action");

-- CreateIndex
CREATE INDEX "match_feedback_created_at_idx" ON "match_feedback"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_reliability_source_type_source_key_key" ON "source_reliability"("source_type", "source_key");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "purchase_orders"("po_number");

-- CreateIndex
CREATE INDEX "purchase_orders_order_type_idx" ON "purchase_orders"("order_type");

-- CreateIndex
CREATE INDEX "purchase_orders_parent_order_id_idx" ON "purchase_orders"("parent_order_id");

-- CreateIndex
CREATE INDEX "purchase_orders_shipserv_po_id_idx" ON "purchase_orders"("shipserv_po_id");

-- CreateIndex
CREATE INDEX "purchase_orders_supplier_id_idx" ON "purchase_orders"("supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_supplier_code_key" ON "suppliers"("supplier_code");

-- CreateIndex
CREATE INDEX "suppliers_status_idx" ON "suppliers"("status");

-- CreateIndex
CREATE INDEX "suppliers_region_idx" ON "suppliers"("region");

-- CreateIndex
CREATE INDEX "suppliers_supplier_code_idx" ON "suppliers"("supplier_code");

-- AddForeignKey
ALTER TABLE "rfq_lines" ADD CONSTRAINT "rfq_lines_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotes" ADD CONSTRAINT "supplier_quotes_rfq_line_id_fkey" FOREIGN KEY ("rfq_line_id") REFERENCES "rfq_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_versions" ADD CONSTRAINT "agreement_versions_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_items" ADD CONSTRAINT "agreement_items_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "agreement_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_comparisons" ADD CONSTRAINT "agreement_comparisons_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "agreement_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agreement_changes" ADD CONSTRAINT "agreement_changes_comparison_id_fkey" FOREIGN KEY ("comparison_id") REFERENCES "agreement_comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_parent_order_id_fkey" FOREIGN KEY ("parent_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_rfq_id_fkey" FOREIGN KEY ("rfq_id") REFERENCES "rfqs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_notes" ADD CONSTRAINT "purchase_order_notes_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_events" ADD CONSTRAINT "purchase_order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_parent_line_id_fkey" FOREIGN KEY ("parent_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_exceptions" ADD CONSTRAINT "agent_exceptions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "agent_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "match_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

