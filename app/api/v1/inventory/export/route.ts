import { listInventory } from "@/lib/inventory/operations";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

const COLUMNS = [
  "id",
  "itemCode",
  "catalogItemId",
  "description",
  "category",
  "warehouse",
  "locationBin",
  "uom",
  "onHand",
  "reserved",
  "inbound",
  "available",
  "reorderPoint",
  "dangerousGoods",
  "stockStatus",
  "notes",
];

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const rows = await listInventory(authorization.context.organizationId);
  const csv = [
    COLUMNS.join(","),
    ...rows.map((row) => COLUMNS.map((column) => csvCell((row as unknown as Record<string, unknown>)[column])).join(",")),
  ].join("\r\n");

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nautex-inventory-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
