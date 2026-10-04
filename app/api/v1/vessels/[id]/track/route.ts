import { NextResponse } from "next/server";
import { getVesselById, getVesselTrack } from "@/lib/vessel-provider";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const vessel = await getVesselById(params.id);

  if (!vessel) {
    return NextResponse.json({ error: "Vessel not found." }, { status: 404 });
  }

  return NextResponse.json({ data: await getVesselTrack(vessel) });
}
