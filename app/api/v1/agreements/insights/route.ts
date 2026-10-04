/**
 * Agreement Insights API
 *
 * GET  /api/v1/agreements/insights          — list active insights
 * POST /api/v1/agreements/insights          — dismiss/resolve insight
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

/* ── GET — List insights ───────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const sp = req.nextUrl.searchParams;
  const supplierId = sp.get("supplierId");
  const type = sp.get("type");
  const includeDismissed = sp.get("includeDismissed") === "true";
  const limit = Math.min(50, Math.max(1, Number(sp.get("limit")) || 20));

  const where: Record<string, unknown> = { organizationId: authorization.context.organizationId };
  if (!includeDismissed) where.dismissed = false;
  if (supplierId) where.supplierId = supplierId;
  if (type) where.type = type;

  const insights = await prisma.agreementInsight.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ insights, total: insights.length });
}

/* ── POST — Dismiss/resolve insight ────────────────────────────── */

export async function POST(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const organizationId = authorization.context.organizationId;
  const body = await req.json();
  const { insightId, action, context } = body;

  // Bulk dismiss all
  if (action === "dismissAll") {
    const where: Record<string, unknown> = { dismissed: false, organizationId };
    if (context && context !== "all") where.type = { startsWith: context };

    const result = await prisma.agreementInsight.updateMany({
      where,
      data: { dismissed: true, dismissedAt: new Date() },
    });

    return NextResponse.json({ success: true, dismissed: result.count });
  }

  // Single insight operations
  if (!insightId) {
    return NextResponse.json({ error: "insightId required" }, { status: 400 });
  }

  const insight = await prisma.agreementInsight.findFirst({ where: { id: insightId, organizationId } });
  if (!insight) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.agreementInsight.update({
    where: { id: insightId, organizationId },
    data: { dismissed: true, dismissedAt: new Date() },
  });

  return NextResponse.json({ success: true, insightId, action });
}
