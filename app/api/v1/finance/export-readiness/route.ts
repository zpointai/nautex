import { NextResponse } from "next/server";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { getExportReadinessRows } from "@/lib/finance/server";
import { previewExportBatch, createExportBatch, cancelExportBatch } from "@/lib/finance/export-batches";
import { ApiRequestError, readJsonObject } from "@/lib/api/request";
import { fail, ok } from "@/lib/api/response";

export async function POST(request: Request) {
  const auth = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_APPROVE); if (!auth.ok) return auth.response;
  try {
    const body = await readJsonObject(request, 16_384);
    if (body.action === "preview") return ok(await previewExportBatch(auth.context, body));
    if (body.action === "create") return ok(await createExportBatch(auth.context, body));
    if (body.action === "cancel" && typeof body.id === "string") return ok(await cancelExportBatch(auth.context, body.id));
    return fail("EXPORT_ACTION", "Choose preview, create or cancel.", 400);
  } catch (error) { return fail("EXPORT_BATCH_FAILED", error instanceof Error ? error.message : "Export batch could not be created.", error instanceof ApiRequestError ? error.status : 409); }
}

export async function GET(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
    if (!authorization.ok) return authorization.response;
    const data = await getExportReadinessRows(authorization.context.organizationId);
    return NextResponse.json({ ok: true, data, meta: { source: "postgres" } });
  } catch (error) {
    console.error("[api] GET /api/v1/finance/export-readiness:", error);
    return NextResponse.json({ ok: false, error: { message: "Failed to load export readiness." } }, { status: 500 });
  }
}
