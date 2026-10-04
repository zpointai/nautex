import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { decideCreditNote } from "@/lib/finance/actions";
import { getCreditNoteRows } from "@/lib/finance/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_APPROVE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    if (!["approve", "issue", "reject"].includes(body.decision)) return fail("BAD_REQUEST", "Unsupported credit note decision.", 400);
    await decideCreditNote(id, body.decision, {
      id: authorization.context.userId, name: authorization.context.displayName,
      organizationId: authorization.context.organizationId, activeLegalEntityId: authorization.context.activeLegalEntityId,
    });
    const data = (await getCreditNoteRows(authorization.context.organizationId)).find((row) => row.id === id);
    return ok(data, { source: "postgres" });
  } catch (error) {
    return fail("CREDIT_NOTE_DECISION_FAILED", error instanceof Error ? error.message : "Credit note decision failed.", 409);
  }
}
