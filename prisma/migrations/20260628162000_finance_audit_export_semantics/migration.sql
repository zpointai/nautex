ALTER TYPE "FinanceAuditAction" ADD VALUE IF NOT EXISTS 'SupplierInvoiceRejected';
ALTER TYPE "FinanceAuditAction" ADD VALUE IF NOT EXISTS 'CreditNoteIssued';
ALTER TYPE "FinanceAuditAction" ADD VALUE IF NOT EXISTS 'CreditNoteRejected';
ALTER TYPE "FinanceAuditAction" ADD VALUE IF NOT EXISTS 'AccountingExportPrepared';
ALTER TYPE "AccountingExportStatus" ADD VALUE IF NOT EXISTS 'Prepared';
