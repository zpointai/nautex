import { NextRequest, NextResponse } from "next/server";
import { deleteRecentTrackedVessel, getRecentTrackedVessels } from "@/lib/vessel-provider";

export async function GET() {
  const data = await getRecentTrackedVessels();
  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest) {
  const mmsi = req.nextUrl.searchParams.get("mmsi")?.trim() ?? "";
  if (!mmsi) {
    return NextResponse.json({ error: "mmsi is required." }, { status: 400 });
  }

  const data = await deleteRecentTrackedVessel(mmsi);
  return NextResponse.json({ data });
}
