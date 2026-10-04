import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get("limit") || "25", 10) || 25));
  const favoritesOnly = searchParams.get("favorites") === "true";

  const data = await prisma.hsCodeHistory.findMany({
    where: { organizationId: authorization.context.organizationId, ...(favoritesOnly ? { favorite: true } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
}

export async function PATCH(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    const body = await req.json();
    const { id, favorite } = body as { id?: string; favorite?: boolean };

    if (!id || typeof favorite !== "boolean") {
      return NextResponse.json({ ok: false, error: { message: "id and favorite are required." } }, { status: 400 });
    }

    const existing = await prisma.hsCodeHistory.findFirst({ where: { id, organizationId: authorization.context.organizationId }, select: { id: true } });
    if (!existing) return NextResponse.json({ ok: false, error: { message: "HS history not found." } }, { status: 404 });
    const data = await prisma.hsCodeHistory.update({
      where: { id, organizationId: authorization.context.organizationId },
      data: { favorite },
    });

    return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
  } catch {
    return NextResponse.json({ ok: false, error: { message: "Failed to update HS history." } }, { status: 500 });
  }
}
