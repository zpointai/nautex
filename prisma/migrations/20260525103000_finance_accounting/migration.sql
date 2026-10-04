-- CreateEnum
CREATE TYPE "VatCategory" AS ENUM ('Standard21', 'Reduced9', 'Zero', 'ReverseCharge', 'Exempt', 'OutsideScope', 'BondedCustoms');

-- CreateEnum
CREATE TYPE "CustomerInvoiceStatus" AS ENUM ('Draft', 'Reviewed', 'Posted', 'Sent', 'PartiallyPaid', 'Paid', 'Overdue', 'Disputed', 'Cancelled');

-- CreateEnum
CREATE TYPE "SupplierInvoiceMatchStatus" AS ENUM ('Matched', 'PriceVariance', 'QuantityVariance', 'MissingPO', 'MissingGoodsReceipt', 'DuplicateRisk', 'AwaitingApproval', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "FinanceApprovalStatus" AS ENUM ('NotRequired', 'Pending', 'Approved', 'Rejected');

-- CreateEnum
CREATE TYPE "CreditNoteReasonCode" AS ENUM ('WrongItemDelivered', 'QuantityMismatch', 'PriceCorrection', 'LateDelivery', 'DamagedGoods', 'RejectedSubstitute', 'DuplicateInvoice', 'CustomerDispute', 'SupplierCorrection');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('Draft', 'AwaitingApproval', 'Approved', 'Issued', 'Rejected');

-- CreateEnum
CREATE TYPE "MarginStatus" AS ENUM ('Healthy', 'Watchlist', 'MarginLeakage', 'NegativeMargin', 'MissingCost');

-- CreateEnum
CREATE TYPE "FinanceExceptionType" AS ENUM ('SupplierInvoicePriceVariance', 'SupplierInvoiceQuantityVariance', 'CustomerInvoiceOverdue', 'DeliveredOrderNotInvoiced', 'MarginBelowThreshold', 'MissingDeliveryEvidence', 'DuplicateSupplierInvoiceRisk', 'CreditNoteAwaitingApproval', 'VatDataIncomplete', 'InvoiceMissingLegalField');

-- CreateEnum
CREATE TYPE "FinanceExceptionStatus" AS ENUM ('Open', 'InReview', 'Resolved', 'Dismissed');

-- CreateEnum
CREATE TYPE "FinanceAuditAction" AS ENUM ('InvoiceCreated', 'InvoiceReviewed', 'InvoicePosted', 'InvoiceSent', 'PaymentReceived', 'PartialPaymentReceived', 'SupplierInvoiceApproved', 'CreditNoteCreated', 'CreditNoteApproved', 'ExceptionCreated', 'ExceptionResolved', 'ExportedToAccountingSystem');

-- CreateEnum
CREATE TYPE "AccountingExportTarget" AS ENUM ('CsvXlsx', 'ExactOnline', 'Twinfield', 'Afas', 'BusinessCentral', 'SapBusinessOne', 'Peppol');

-- CreateEnum
CREATE TYPE "AccountingExportStatus" AS ENUM ('NotReady', 'Ready', 'Exported', 'Failed', 'Blocked');

-- CreateTable
CREATE TABLE "legal_entities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "postal_code" TEXT,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "vat_id" TEXT NOT NULL,
    "kvk_number" TEXT,
    "bank_name" TEXT,
    "bank_iban" TEXT,
    "bank_bic" TEXT,
    "default_currency" TEXT NOT NULL DEFAULT 'EUR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" TEXT NOT NULL,
    "customer_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "postal_code" TEXT,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "vat_id" TEXT,
    "payment_terms" TEXT NOT NULL DEFAULT 'Net 30',
    "default_currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_number_sequences" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "fiscal_year" INTEGER NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1,
    "last_issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_invoices" (
    "id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "order_id" TEXT,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" TIMESTAMP(3) NOT NULL,
    "delivery_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "customer_po_ref" TEXT,
    "vessel_name" TEXT,
    "vessel_imo" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "payment_terms" TEXT NOT NULL,
    "bank_payment_reference" TEXT NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gross_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "CustomerInvoiceStatus" NOT NULL DEFAULT 'Draft',
    "margin_pct" DECIMAL(8,2),
    "exception_flag" BOOLEAN NOT NULL DEFAULT false,
    "posted_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "order_line_id" TEXT,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(14,4) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_category" "VatCategory" NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "customer_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_vat_summaries" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "vat_category" "VatCategory" NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "taxable_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "invoice_vat_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "received_at" TIMESTAMP(3) NOT NULL,
    "payment_reference" TEXT,
    "method" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Posted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "purchase_order_id" TEXT,
    "supplier_name" TEXT NOT NULL,
    "supplier_invoice_no" TEXT NOT NULL,
    "invoice_date" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "expected_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "invoiced_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "variance_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gross_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "match_status" "SupplierInvoiceMatchStatus" NOT NULL DEFAULT 'AwaitingApproval',
    "approval_status" "FinanceApprovalStatus" NOT NULL DEFAULT 'Pending',
    "duplicate_risk_score" DECIMAL(5,2),
    "evidence_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "supplier_invoice_id" TEXT NOT NULL,
    "purchase_order_line_id" TEXT,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(14,4) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_category" "VatCategory" NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "quantity_variance" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "price_variance" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_margin_snapshots" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "revenue" DECIMAL(14,2) NOT NULL,
    "supplier_cost" DECIMAL(14,2) NOT NULL,
    "freight_delivery_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "customs_bonded_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "warehouse_handling_cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "other_costs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "gross_profit" DECIMAL(14,2) NOT NULL,
    "margin_pct" DECIMAL(8,2) NOT NULL,
    "target_margin_pct" DECIMAL(8,2) NOT NULL,
    "margin_variance" DECIMAL(8,2) NOT NULL,
    "status" "MarginStatus" NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_margin_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "credit_note_no" TEXT NOT NULL,
    "original_invoice_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "vessel_name" TEXT,
    "vessel_imo" TEXT,
    "reason_code" "CreditNoteReasonCode" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'Draft',
    "approval_status" "FinanceApprovalStatus" NOT NULL DEFAULT 'Pending',
    "approved_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" TEXT NOT NULL,
    "credit_note_id" TEXT NOT NULL,
    "invoice_line_id" TEXT,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_price" DECIMAL(14,4) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "vat_category" "VatCategory" NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "gross_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_exceptions" (
    "id" TEXT NOT NULL,
    "type" "FinanceExceptionType" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'Medium',
    "status" "FinanceExceptionStatus" NOT NULL DEFAULT 'Open',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order_id" TEXT,
    "customer_invoice_id" TEXT,
    "supplier_invoice_id" TEXT,
    "credit_note_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_audit_events" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" "FinanceAuditAction" NOT NULL,
    "actor_type" TEXT NOT NULL DEFAULT 'operator',
    "actor_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_export_batches" (
    "id" TEXT NOT NULL,
    "target" "AccountingExportTarget" NOT NULL,
    "status" "AccountingExportStatus" NOT NULL DEFAULT 'NotReady',
    "records_ready" INTEGER NOT NULL DEFAULT 0,
    "records_blocked" INTEGER NOT NULL DEFAULT 0,
    "validation_errors" JSONB NOT NULL DEFAULT '[]',
    "exported_at" TIMESTAMP(3),
    "file_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_export_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_export_records" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "status" "AccountingExportStatus" NOT NULL DEFAULT 'NotReady',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_export_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_customer_code_key" ON "customer_accounts"("customer_code");

-- CreateIndex
CREATE INDEX "customer_accounts_status_idx" ON "customer_accounts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_sequences_legal_entity_id_prefix_fiscal_year_key" ON "invoice_number_sequences"("legal_entity_id", "prefix", "fiscal_year");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoices_invoice_no_key" ON "customer_invoices"("invoice_no");

-- CreateIndex
CREATE INDEX "customer_invoices_customer_id_idx" ON "customer_invoices"("customer_id");

-- CreateIndex
CREATE INDEX "customer_invoices_order_id_idx" ON "customer_invoices"("order_id");

-- CreateIndex
CREATE INDEX "customer_invoices_status_idx" ON "customer_invoices"("status");

-- CreateIndex
CREATE INDEX "customer_invoices_due_date_idx" ON "customer_invoices"("due_date");

-- CreateIndex
CREATE INDEX "customer_invoice_lines_order_line_id_idx" ON "customer_invoice_lines"("order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_invoice_lines_invoice_id_line_number_key" ON "customer_invoice_lines"("invoice_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_vat_summaries_invoice_id_vat_category_vat_rate_key" ON "invoice_vat_summaries"("invoice_id", "vat_category", "vat_rate");

-- CreateIndex
CREATE INDEX "customer_payments_invoice_id_idx" ON "customer_payments"("invoice_id");

-- CreateIndex
CREATE INDEX "supplier_invoices_purchase_order_id_idx" ON "supplier_invoices"("purchase_order_id");

-- CreateIndex
CREATE INDEX "supplier_invoices_match_status_idx" ON "supplier_invoices"("match_status");

-- CreateIndex
CREATE INDEX "supplier_invoices_approval_status_idx" ON "supplier_invoices"("approval_status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplier_name_supplier_invoice_no_key" ON "supplier_invoices"("supplier_name", "supplier_invoice_no");

-- CreateIndex
CREATE INDEX "supplier_invoice_lines_purchase_order_line_id_idx" ON "supplier_invoice_lines"("purchase_order_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoice_lines_supplier_invoice_id_line_number_key" ON "supplier_invoice_lines"("supplier_invoice_id", "line_number");

-- CreateIndex
CREATE UNIQUE INDEX "order_margin_snapshots_order_id_key" ON "order_margin_snapshots"("order_id");

-- CreateIndex
CREATE INDEX "order_margin_snapshots_status_idx" ON "order_margin_snapshots"("status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_credit_note_no_key" ON "credit_notes"("credit_note_no");

-- CreateIndex
CREATE INDEX "credit_notes_original_invoice_id_idx" ON "credit_notes"("original_invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_status_idx" ON "credit_notes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_note_lines_credit_note_id_line_number_key" ON "credit_note_lines"("credit_note_id", "line_number");

-- CreateIndex
CREATE INDEX "finance_exceptions_status_idx" ON "finance_exceptions"("status");

-- CreateIndex
CREATE INDEX "finance_exceptions_type_idx" ON "finance_exceptions"("type");

-- CreateIndex
CREATE INDEX "finance_audit_events_entity_type_entity_id_idx" ON "finance_audit_events"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "finance_audit_events_action_idx" ON "finance_audit_events"("action");

-- CreateIndex
CREATE INDEX "accounting_export_batches_target_idx" ON "accounting_export_batches"("target");

-- CreateIndex
CREATE INDEX "accounting_export_batches_status_idx" ON "accounting_export_batches"("status");

-- CreateIndex
CREATE INDEX "accounting_export_records_entity_type_entity_id_idx" ON "accounting_export_records"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "invoice_number_sequences" ADD CONSTRAINT "invoice_number_sequences_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoices" ADD CONSTRAINT "customer_invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "customer_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_invoice_lines" ADD CONSTRAINT "customer_invoice_lines_order_line_id_fkey" FOREIGN KEY ("order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_vat_summaries" ADD CONSTRAINT "invoice_vat_summaries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "customer_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "customer_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_purchase_order_line_id_fkey" FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_margin_snapshots" ADD CONSTRAINT "order_margin_snapshots_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_margin_snapshots" ADD CONSTRAINT "order_margin_snapshots_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "customer_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "customer_invoice_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_exceptions" ADD CONSTRAINT "finance_exceptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_exceptions" ADD CONSTRAINT "finance_exceptions_customer_invoice_id_fkey" FOREIGN KEY ("customer_invoice_id") REFERENCES "customer_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_exceptions" ADD CONSTRAINT "finance_exceptions_supplier_invoice_id_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_exceptions" ADD CONSTRAINT "finance_exceptions_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_export_records" ADD CONSTRAINT "accounting_export_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "accounting_export_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

