import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";

type Result = {
  id: string;
  module: string;
  moduleKey: string;
  title: string;
  subtitle: string;
  icon: string;
};

export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    return ok([], { source: "postgres", totalCount: 0 });
  }

  try {
    const [purchaseOrders, suppliers, rfqs, items, inventory, vessels] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where: {
          organizationId: authorization.context.organizationId,
          OR: [
            { poNumber: { contains: q, mode: "insensitive" } },
            { vessel: { contains: q, mode: "insensitive" } },
            { supplier: { contains: q, mode: "insensitive" } },
            { port: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
      prisma.supplier.findMany({
        where: {
          organizationId: authorization.context.organizationId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { supplierCode: { contains: q, mode: "insensitive" } },
            { country: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
      prisma.rfq.findMany({
        where: {
          organizationId: authorization.context.organizationId,
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { vessel: { contains: q, mode: "insensitive" } },
            { port: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
      prisma.item.findMany({
        where: {
          isDeleted: false,
          OR: [
            { description: { contains: q, mode: "insensitive" } },
            { impaCode: { contains: q, mode: "insensitive" } },
            { hsCodeEu: { contains: q, mode: "insensitive" } },
            { hsCodeUs: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 6,
      }),
      prisma.inventoryItem.findMany({
        where: {
          organizationId: authorization.context.organizationId,
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { warehouse: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
      prisma.vessel.findMany({
        where: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { mmsi: { contains: q, mode: "insensitive" } },
            { imo: { contains: q, mode: "insensitive" } },
            { destination: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 5,
      }),
    ]);

    const results: Result[] = [
      ...purchaseOrders.map((item) => ({
        id: item.id,
        module: "Purchase Orders",
        moduleKey: "purchaseOrders",
        title: item.poNumber,
        subtitle: `${item.vessel} - ${item.supplier} - ${item.status.replace(/_/g, " ")}`,
        icon: "receipt_long",
      })),
      ...suppliers.map((item) => ({
        id: item.id,
        module: "Suppliers",
        moduleKey: "suppliers",
        title: item.name,
        subtitle: [item.city, item.country, `${item.score} score`].filter(Boolean).join(" - "),
        icon: "storefront",
      })),
      ...rfqs.map((item) => ({
        id: item.id,
        module: "RFQ Automation",
        moduleKey: "rfqAutomation",
        title: item.id,
        subtitle: `${item.vessel} - ${item.port} - ${item.status}`,
        icon: "bolt",
      })),
      ...items.map((item) => ({
        id: item.id,
        module: item.impaCode ? "IMPA Catalogue" : "Item Search",
        moduleKey: item.impaCode ? "impaSearch" : "procurementSearch",
        title: item.impaCode || item.id,
        subtitle: item.description,
        icon: item.impaCode ? "menu_book" : "manage_search",
      })),
      ...inventory.map((item) => ({
        id: item.id,
        module: "Inventory",
        moduleKey: "inventory",
        title: item.id,
        subtitle: `${item.description} - ${item.onHand} ${item.uom} on hand at ${item.warehouse}`,
        icon: "inventory_2",
      })),
      ...vessels.map((item) => ({
        id: item.id,
        module: "Fleet Tracking",
        moduleKey: "vessels",
        title: item.name,
        subtitle: `MMSI ${item.mmsi} - ${item.destination || "No destination"}`,
        icon: "directions_boat",
      })),
    ].slice(0, 18);

    return ok(results, { source: "postgres", totalCount: results.length });
  } catch (error) {
    logApiError("GET /api/v1/command-center/search", error);
    return fail("COMMAND_CENTER_SEARCH_FAILED", "Command Center search failed.");
  }
}
