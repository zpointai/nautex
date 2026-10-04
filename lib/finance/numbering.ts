export function formatInvoiceNumber(prefix: string, fiscalYear: number, sequence: number) {
  return `${prefix}-${fiscalYear}-${String(sequence).padStart(5, "0")}`;
}

export function formatCreditNoteNumber(prefix: string, fiscalYear: number, sequence: number) {
  return `${prefix}-CN-${fiscalYear}-${String(sequence).padStart(5, "0")}`;
}
