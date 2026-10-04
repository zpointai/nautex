import { NextRequest, NextResponse } from "next/server";
import { searchVessels } from "@/lib/vessel-provider";
import { prisma } from "@/lib/prisma";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";

export async function GET(req: NextRequest) {
  const authorization = await authorizeOrganizationRequest(req);
  if (!authorization.ok) return authorization.response;
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ error: "Enter at least 2 characters." }, { status: 400 });
  }

  const result = await searchVessels(q);
  await prisma.searchHistory.create({
    data: {
      organizationId: authorization.context.organizationId,
      userId: authorization.context.userId,
      query: q,
      module: "vessel_search",
      resultCount: result.data.length,
      topResults: result.data.slice(0, 5).map((vessel) => ({
        id: vessel.id,
        mmsi: vessel.mmsi,
        imo: vessel.imo,
        name: vessel.name,
        destination: vessel.destination,
      })),
    },
  });
  return NextResponse.json(result);
}


