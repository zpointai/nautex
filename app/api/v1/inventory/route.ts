import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createInventoryItem, listInventory, parseInventoryInput } from "@/lib/inventory/operations";

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q")?.trim().toLowerCase() ?? "";
    const status = searchParams.get("status")?.trim();
    const warehouse = searchParams.get("warehouse")?.trim();

    const records = await listInventory(authorization.context.organizationId);
    const data = records.filter((item) => {
      const matchesQuery =
        !query ||
        item.description.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query) ||
        item.itemCode?.toLowerCase().includes(query) ||
        item.category?.toLowerCase().includes(query) ||
        item.warehouse.toLowerCase().includes(query) ||
        item.locationBin?.toLowerCase().includes(query);
      const matchesStatus = !status || status === "all" || item.stockStatus === status;
      const matchesWarehouse = !warehouse || warehouse === "all" || item.warehouse === warehouse;
      return matchesQuery && matchesStatus && matchesWarehouse;
    });

    const warehouses = [...new Set(records.map((item) => item.warehouse))].sort();
    const counts = records.reduce(
      (acc, item) => {
        acc.total += 1;
        acc[item.stockStatus] += 1;
        if (item.dangerousGoods) acc.dangerousGoods += 1;
        return acc;
      },
      { total: 0, critical: 0, reorder: 0, healthy: 0, dangerousGoods: 0 },
    );

    return ok(data, { source: "postgres", demoReady: records.length > 0, totalCount: data.length, warehouses, counts });
  } catch (error) {
    logApiError("GET /api/v1/inventory", error);
    return fail("INVENTORY_LIST_FAILED", "Failed to fetch inventory.", 500);
  }
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    const body = (await req.json()) as Record<string, unknown>;
    const item = await createInventoryItem(parseInventoryInput(body), authorization.context.organizationId);
    return ok(item, { source: "postgres" }, { status: 201 });
  } catch (error) {
    logApiError("POST /api/v1/inventory", error);
    const message = error instanceof Error ? error.message : "Failed to create inventory item.";
    return fail("INVENTORY_CREATE_FAILED", message, 400);
  }
}
