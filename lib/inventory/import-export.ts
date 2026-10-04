import {
  createInventoryItem,
  listInventory,
  parseInventoryInput,
  updateInventoryItem,
} from "@/lib/inventory/operations";

export interface InventoryImportResult {
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
}

export function parseInventoryCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index++;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function toRecord(headers: string[], row: string[]) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function bool(value: string) {
  return /^(true|yes|1)$/i.test(value.trim());
}

export async function importInventoryCsvText(text: string, organizationId?: string): Promise<InventoryImportResult> {
  if (!text.trim()) throw new Error("Upload a CSV file or CSV request body.");

  const rows = parseInventoryCsv(text);
  const headers = rows.shift()?.map((header) => header.trim()) ?? [];
  if (!headers.includes("description") || !headers.includes("warehouse") || !headers.includes("uom")) {
    throw new Error("CSV must include description, warehouse, and uom columns.");
  }

  const existing = await listInventory(organizationId);
  const byId = new Map(existing.map((item) => [item.id, item]));
  const byItemCodeWarehouse = new Map(existing.filter((item) => item.itemCode).map((item) => [`${item.itemCode}::${item.warehouse}`, item]));

  let created = 0;
  let updated = 0;
  const errors: Array<{ row: number; message: string }> = [];

  for (const [index, row] of rows.entries()) {
    const record = toRecord(headers, row);
    try {
      const current =
        (record.id ? byId.get(record.id) : null) ||
        (record.itemCode ? byItemCodeWarehouse.get(`${record.itemCode}::${record.warehouse}`) : null);

      const input = parseInventoryInput({
        itemCode: record.itemCode || null,
        catalogItemId: record.catalogItemId || null,
        description: record.description,
        category: record.category || null,
        warehouse: record.warehouse,
        locationBin: record.locationBin || null,
        uom: record.uom,
        onHand: record.onHand || 0,
        reserved: record.reserved || current?.reserved || 0,
        inbound: record.inbound || current?.inbound || 0,
        reorderPoint: record.reorderPoint || 0,
        dangerousGoods: bool(record.dangerousGoods || ""),
        notes: record.notes || null,
      }, current ?? undefined);

      if (current) {
        await updateInventoryItem(current.id, input, organizationId);
        updated++;
      } else {
        await createInventoryItem(input, organizationId);
        created++;
      }
    } catch (error) {
      errors.push({ row: index + 2, message: error instanceof Error ? error.message : "Row failed." });
    }
  }

  return { created, updated, failed: errors.length, errors };
}
