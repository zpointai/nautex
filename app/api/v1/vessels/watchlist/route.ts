import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const data = await prisma.vesselWatchlist.findMany({
    where: { organizationId: authorization.context.organizationId, userId: authorization.context.userId },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    const { organizationId, userId } = authorization.context;
    const body = await req.json();
    const { vesselId, mmsi, imo, name, note } = body as {
      vesselId?: string;
      mmsi?: string;
      imo?: string;
      name?: string;
      note?: string;
    };

    if (!mmsi || !name) {
      return NextResponse.json({ ok: false, error: { message: "mmsi and name are required." } }, { status: 400 });
    }

    const data = await prisma.vesselWatchlist.upsert({
      where: { organizationId_mmsi_userId: { organizationId, mmsi, userId } },
      create: { vesselId, mmsi, imo, name, note, userId, organizationId },
      update: { vesselId, imo, name, note },
    });

    return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
  } catch {
    return NextResponse.json({ ok: false, error: { message: "Failed to update vessel watchlist." } }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const { searchParams } = new URL(req.url);
  const mmsi = searchParams.get("mmsi");
  if (!mmsi) {
    return NextResponse.json({ ok: false, error: { message: "mmsi is required." } }, { status: 400 });
  }

  await prisma.vesselWatchlist.deleteMany({ where: { mmsi, userId: authorization.context.userId, organizationId: authorization.context.organizationId } });
  return NextResponse.json({ ok: true, data: { mmsi }, meta: { source: "postgres" } });
}
