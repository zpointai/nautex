import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getVesselById } from "@/lib/vessel-provider";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

interface LinkPayload {
  orderId?: string;
  stage?: "RFQ" | "PO" | "Delivery";
  port?: string;
  impact?: "Low" | "Medium" | "High";
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
  if (!authorization.ok) return authorization.response;
  const params = await context.params;
  const body = (await req.json()) as LinkPayload;

  const allowedStages = new Set(["RFQ", "PO", "Delivery"]);
  const allowedImpacts = new Set(["Low", "Medium", "High"]);
  if (!body.orderId || !body.stage || !body.impact || !allowedStages.has(body.stage) || !allowedImpacts.has(body.impact)) {
    return NextResponse.json({ error: "orderId, stage, and impact are required." }, { status: 400 });
  }

  const [vessel, order] = await Promise.all([
    getVesselById(params.id),
    prisma.purchaseOrder.findFirst({ where: { id: body.orderId, organizationId: authorization.context.organizationId } }),
  ]);
  if (!vessel) {
    return NextResponse.json({ error: "Vessel not found." }, { status: 404 });
  }
  if (!order) {
    return NextResponse.json({ error: "Purchase order not found." }, { status: 404 });
  }

  const port = body.port?.trim() || order.port?.trim() || vessel.destination?.trim();
  if (!port) {
    return NextResponse.json({ error: "A port is required when the order and vessel do not provide one." }, { status: 400 });
  }

  const existing = await prisma.vesselOrderLink.findFirst({
    where: { vesselId: vessel.id, orderId: order.id, stage: body.stage },
  });
  const data = existing
    ? await prisma.vesselOrderLink.update({
        where: { id: existing.id },
        data: { port, impact: body.impact },
      })
    : await prisma.vesselOrderLink.create({
        data: {
          vesselId: vessel.id,
          orderId: order.id,
          stage: body.stage,
          port,
          impact: body.impact,
        },
      });

  return NextResponse.json({ data }, { status: existing ? 200 : 201 });
}
