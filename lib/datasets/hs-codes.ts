import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getRowValue, parseWorkbookRows, type DatasetRow } from "@/lib/datasets/common";

function normalizeCode(value: string) {
  return value.replace(/[^\d.]/g, "").replace(/\.+/g, ".").replace(/^\./, "").replace(/\.$/, "");
}

function compactCode(value: string) {
  return normalizeCode(value).replace(/\D/g, "");
}

function inferChapter(code: string) {
  const digits = compactCode(code);
  return digits.length >= 2 ? digits.slice(0, 2) : null;
}

function inferHeading(code: string) {
  const digits = compactCode(code);
  return digits.length >= 4 ? digits.slice(0, 4) : null;
}

export function transformHsRow(row: DatasetRow, options?: { system?: string; source?: string }) {
  const code = normalizeCode(getRowValue(row, ["code", "hs code", "hs_code", "taric", "htsus", "commodity code"]));
  const description = getRowValue(row, ["description", "desc", "goods description", "commodity description", "heading description"]);

  if (!code || !description) return null;

  const chapter = getRowValue(row, ["chapter"]) || inferChapter(code);
  const heading = getRowValue(row, ["heading"]) || inferHeading(code);

  return {
    code,
    system: (options?.system || getRowValue(row, ["system", "jurisdiction"]) || "generic").toLowerCase(),
    chapter,
    heading,
    description,
    notes: getRowValue(row, ["notes", "note"]),
    source: options?.source || getRowValue(row, ["source"]) || "uploaded_dataset",
    raw: row as Prisma.InputJsonObject,
  };
}

export async function importHsBuffer(params: {
  buffer: Buffer;
  fileName: string;
  sourcePath?: string;
  system?: string;
  source?: string;
}) {
  const rows = parseWorkbookRows(params.buffer, params.fileName);
  let importedCount = 0;
  let skippedCount = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (const [index, row] of rows.entries()) {
    const item = transformHsRow(row, params);
    if (!item) {
      skippedCount += 1;
      continue;
    }

    try {
      await prisma.hsCode.upsert({
        where: { code_system: { code: item.code, system: item.system } },
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
      type: "hs",
      sourceFileName: params.fileName,
      sourcePath: params.sourcePath,
      status: errors.length ? "CompletedWithErrors" : "Completed",
      rowCount: rows.length,
      importedCount,
      skippedCount,
      errorCount: errors.length,
      errors,
      metadata: { system: params.system || "generic", source: params.source || "uploaded_dataset" },
    },
  });

  return { importId: importRecord.id, rowCount: rows.length, importedCount, skippedCount, errorCount: errors.length, errors: errors.slice(0, 25) };
}

export async function findHsMatches(query: string, limit = 5) {
  const q = query.trim();
  if (!q) return [];
  const digits = compactCode(q);

  return prisma.hsCode.findMany({
    where: {
      OR: [
        digits ? { code: { contains: digits } } : undefined,
        { code: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
      ].filter(Boolean) as Array<Record<string, unknown>>,
    },
    orderBy: [{ code: "asc" }],
    take: limit,
  });
}

export function datasetClassification(query: string, matches: Awaited<ReturnType<typeof findHsMatches>>) {
  const primary = matches[0];
  if (!primary) return null;
  const candidate = (systems: string[], label: string) => {
    const match = matches.find((row) => systems.includes(row.system.toLowerCase()));
    return {
      code: match?.code ?? "",
      confidence: 0,
      confidenceLevel: "Unscored",
      description: match?.description ?? `No ${label} dataset match available.`,
      rationale: match
        ? `Keyword candidate from the imported ${label} dataset. Product applicability requires review; this is not a verified classification.`
        : `Import an applicable ${label} dataset or use AI classification. Generic HS entries do not establish jurisdiction-specific codes.`,
      logic: match ? [match.chapter ? `Chapter ${match.chapter}` : null, match.heading ? `Heading ${match.heading}` : null, `Source ${match.source}`].filter(Boolean).join(" > ") : "",
    };
  };

  return {
    id: crypto.randomUUID(),
    query,
    eu: candidate(["eu", "taric", "cn"], "EU"),
    us: candidate(["us", "htsus", "hts"], "US"),
    datasetMatches: matches.map((match) => ({
      id: match.id,
      code: match.code,
      system: match.system,
      description: match.description,
      source: match.source,
    })),
  };
}
