import { fail, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { prepareAccountingExport } from "@/lib/finance/actions";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(request, PERMISSIONS.FINANCE_APPROVE);
    if (!authorization.ok) return authorization.response;
    if (authorization.context.roles.includes("system-agent")) return fail("HUMAN_REQUIRED", "A human finance reviewer must prepare accounting exports.", 403);
    const { id } = await params;
    const data = await prepareAccountingExport(id, {
      id: authorization.context.userId, name: authorization.context.displayName,
      organizationId: authorization.context.organizationId, activeLegalEntityId: authorization.context.activeLegalEntityId,
    });
    return ok(
      { fileName: data.fileName, csv: data.csv, records: data.records },
      { source: "postgres", mode: "local_csv_prepare" },
    );
  } catch (error) {
    return fail("ACCOUNTING_EXPORT_PREPARE_FAILED", error instanceof Error ? error.message : "Accounting export preparation failed.", 409);
  }
}
