import { NextResponse } from "next/server";
import { recordVesselSnapshot, refreshVesselFromSource } from "@/lib/vessel-provider";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const { vessel, meta } = await refreshVesselFromSource(params.id);

  if (!vessel) {
    return NextResponse.json({ error: "Vessel not found." }, { status: 404 });
  }

  await recordVesselSnapshot(vessel).catch(() => undefined);

  return NextResponse.json({ data: { ...vessel, refreshedAt: new Date().toISOString() }, meta });
}
