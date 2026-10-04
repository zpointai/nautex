import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getRowValue, parseWorkbookRows, type DatasetRow } from "@/lib/datasets/common";

const SECTION_NAMES: Record<string, string> = {}; // Category names must come from user-authorised data.

function normalizeImpaCode(value: string) {
  return value.trim().toUpperCase();
}

function joinDate(year: string, month: string, day: string) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || !m || !d) return "";
  return [String(y).padStart(4, "0"), String(m).padStart(2, "0"), String(d).padStart(2, "0")].join("-");
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function transformImpaRow(row: DatasetRow, options?: { includeChandlerCodes?: boolean; includeDeleted?: boolean; edition?: string }) {
  const impaCode = normalizeImpaCode(getRowValue(row, ["IMPA CODE", "impaCode", "code"]));
  if (!impaCode) return null;

  const isSixDigit = /^\d{6}$/.test(impaCode);
  if (!isSixDigit && !options?.includeChandlerCodes) return null;

  const description = getRowValue(row, ["DESCRIPTION 1", "description", "itemName", "name"]);
  if (!description) return null;

  const extra = getRowValue(row, ["DESCRIPTION 2", "descriptionExtra", "specifications"]);
  const alternativeCode = getRowValue(row, ["ALTERNATIVE CODE", "alternativeCode"]);
  const unit = getRowValue(row, ["UNIT", "uom"]);
  const dateDeleted = joinDate(
    getRowValue(row, ["DATE DELETED YEAR"]),
    getRowValue(row, ["DATE DELETED MONTH"]),
    getRowValue(row, ["DATE DELETED DAY"]),
  );
  const isDeleted = Boolean(dateDeleted);
  if (isDeleted && options?.includeDeleted === false) return null;

  const section = isSixDigit ? impaCode.slice(0, 2) : "";
  const sectionName = getRowValue(row, ["category", "CATEGORY", "sectionName"]) || SECTION_NAMES[section] || "";
  const category = sectionName ? `${section} - ${sectionName}` : section ? `${section} - IMPA Section` : "IMPA Catalogue";
  const specifications = [extra, alternativeCode ? `Alternative code: ${alternativeCode}` : ""].filter(Boolean).join("\n");

  return {
    impaCode,
    description,
    normalizedDesc: normalizeText([impaCode, description, extra, unit, sectionName, alternativeCode].join(" ")),
    category,
    unit,
    source: "impa_master_csv",
    edition: options?.edition || "User-authorised import",
    isDeleted,
    raw: {
      ...row,
      section,
      sectionName,
      specifications,
      codeFormat: isSixDigit ? "IMPA-6" : "CHANDLER",
      dateAdded: joinDate(
        getRowValue(row, ["DATE ADDED YEAR"]),
        getRowValue(row, ["DATE ADDED MONTH"]),
        getRowValue(row, ["DATE ADDED DAY"]),
      ),
      dateUpdated: joinDate(
        getRowValue(row, ["DATE UPDATE YEAR 1"]),
        getRowValue(row, ["DATE UPDATE MONTH 1"]),
        getRowValue(row, ["DATE UPDATE DAY 1"]),
      ),
      dateDeleted,
      alternativeCode,
    } as Prisma.InputJsonObject,
  };
}

export async function importImpaBuffer(params: {
  buffer: Buffer;
  fileName: string;
  sourcePath?: string;
  includeChandlerCodes?: boolean;
  includeDeleted?: boolean;
  edition?: string;
}) {
  const rows = parseWorkbookRows(params.buffer, params.fileName);
  let importedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (const [index, row] of rows.entries()) {
    const item = transformImpaRow(row, params);
    if (!item) {
      skippedCount += 1;
      continue;
    }

    try {
      await prisma.item.upsert({
        where: { impaCode: item.impaCode },
        create: item,
        update: item,
      });
      importedCount += 1;
    } catch (error) {
      errors.push({ row: index + 2, message: error instanceof Error ? error.message : String(error) });
    }
  }

  const importRecord = await prisma.datasetImport.create({
    data: {
      type: "impa",
      sourceFileName: params.fileName,
      sourcePath: params.sourcePath,
      status: errors.length ? "CompletedWithErrors" : "Completed",
      rowCount: rows.length,
      importedCount,
      skippedCount,
      errorCount: errors.length,
      errors,
      metadata: {
        includeChandlerCodes: Boolean(params.includeChandlerCodes),
        includeDeleted: params.includeDeleted !== false,
        edition: params.edition || "User-authorised import",
      },
    },
  });

  return { importId: importRecord.id, rowCount: rows.length, importedCount, skippedCount, errorCount: errors.length, errors: errors.slice(0, 25) };
}
