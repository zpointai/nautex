import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: Request) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const favorites = await prisma.impaFavorite.findMany({
    where: { organizationId: authorization.context.organizationId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ ok: true, data: favorites, meta: { source: "postgres" } });
}

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req);
    if (!authorization.ok) return authorization.response;
    const organizationId = authorization.context.organizationId;
    const body = await req.json();
    const { impaCode, isFavorite } = body as { impaCode?: string; isFavorite?: boolean };

    if (typeof impaCode !== "string" || !/^\d{6}$/.test(impaCode) || typeof isFavorite !== "boolean") {
      return NextResponse.json({ ok: false, error: { message: "IMPA code is required." } }, { status: 400 });
    }

    const item = await prisma.item.findFirst({ where: { impaCode } });

    if (isFavorite) {
      const favorite = await prisma.impaFavorite.upsert({
        where: { organizationId_impaCode: { organizationId, impaCode } },
        create: {
          organizationId,
          impaCode,
          itemId: item?.id,
          label: item?.description ?? impaCode,
          userId: authorization.context.userId,
        },
        update: {
          itemId: item?.id,
          label: item?.description ?? impaCode,
        },
      });

      return NextResponse.json({ ok: true, data: favorite, meta: { source: "postgres" } });
    }

    await prisma.impaFavorite.deleteMany({ where: { organizationId, impaCode } });
    return NextResponse.json({ ok: true, data: { impaCode, isFavorite: false }, meta: { source: "postgres" } });
  } catch {
    return NextResponse.json({ ok: false, error: { message: "Failed to update favourite." } }, { status: 500 });
  }
}
