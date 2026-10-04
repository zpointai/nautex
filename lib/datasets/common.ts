import * as XLSX from "xlsx";
import { sanitizeParsedRow } from "@/lib/documents/sheet-safety";

export type DatasetRow = Record<string, unknown>;

export function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function getRowValue(row: DatasetRow, names: string[]) {
  const normalizedNames = names.map(normalizeHeader);
  const entry = Object.entries(row).find(([key]) => normalizedNames.includes(normalizeHeader(key)));
  const value = entry?.[1];
  return value == null ? "" : String(value).trim();
}

export function parseWorkbookRows(buffer: Buffer, fileName = "dataset.csv") {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: false,
    cellDates: false,
    WTF: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<DatasetRow>(sheet, {
    defval: "",
    raw: false,
  }).map((row) => ({ ...sanitizeParsedRow(row), __sourceFileName: fileName }));
}

export function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
