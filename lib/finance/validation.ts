import { validCurrency } from "./calculations";
const requiredInvoiceFields = [
  "invoiceNo",
  "invoiceDate",
  "deliveryDate",
  "dueDate",
  "paymentTerms",
  "bankPaymentReference",
  "currency",
];

export function findMissingInvoiceFields(invoice: Record<string, unknown>) {
  return requiredInvoiceFields.filter((field) => {
    const value = invoice[field];
    if (field === "currency") return !validCurrency(value);
    return value === null || value === undefined || value === "";
  });
}

export function isHumanApprovalRequired(action: string) {
  return [
    "post_invoice",
    "send_invoice",
    "approve_supplier_payment",
    "issue_credit_note",
    "export_accounting_records",
  ].includes(action);
}
