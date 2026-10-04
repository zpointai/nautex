import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { recordCustomerPayment } from "@/lib/finance/actions";
import { getCustomerInvoiceRows } from "@/lib/finance/server";
import { createHash } from "node:crypto";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_WRITE);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.amount !== undefined && (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0))) return fail("PAYMENT_INVALID", "Enter a valid positive payment amount.", 400);
    const key = request.headers.get("idempotency-key")?.trim();
    if (key && !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) return fail("PAYMENT_KEY_INVALID", "Invalid payment request key.", 400);
    const requestKey = key ? createHash("sha256").update(`${authorization.context.organizationId}:${authorization.context.userId}:${id}:${key}`).digest("hex") : undefined;
    await recordCustomerPayment(
      id,
      typeof body.amount === "number" ? body.amount : undefined,
      typeof body.reference === "string" ? body.reference : undefined,
      {
        id: authorization.context.userId, name: authorization.context.displayName,
        organizationId: authorization.context.organizationId, activeLegalEntityId: authorization.context.activeLegalEntityId,
      },
      requestKey,
    );
    const data = (await getCustomerInvoiceRows(authorization.context.organizationId)).find((row) => row.id === id);
    return ok(data, { source: "postgres" });
  } catch (error) {
    return fail("FINANCE_PAYMENT_FAILED", error instanceof Error ? error.message : "Payment recording failed.", 409);
  }
}
