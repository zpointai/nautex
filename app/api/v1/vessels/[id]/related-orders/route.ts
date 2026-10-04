import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVesselById } from "@/lib/vessel-provider";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!authorization.ok) return authorization.response;
  const params = await context.params;
  const vessel = await getVesselById(params.id);

  const links = await prisma.vesselOrderLink.findMany({
    where: { vesselId: vessel?.id ?? params.id },
    orderBy: { updatedAt: "desc" },
  });

  const orders = await prisma.purchaseOrder.findMany({
    where: { organizationId: authorization.context.organizationId, id: { in: links.map((link) => link.orderId) } },
  });
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const data = links.filter((link) => ordersById.has(link.orderId)).map((link) => ({ ...link, order: ordersById.get(link.orderId)! }));

  return NextResponse.json({ data });
}
