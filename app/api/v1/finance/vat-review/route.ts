import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fail, ok } from "@/lib/api/response";
import { financeCsv, getVatReview } from "@/lib/finance/vat-review";
export async function GET(req: Request) {
  const auth = await authorizeOrganizationRequest(req, PERMISSIONS.APP_READ);
  if (!auth.ok) return auth.response;
  try {
    const search = new URL(req.url).searchParams;
    const data = await getVatReview(auth.context.organizationId, { from: search.get("from") ?? "", to: search.get("to") ?? "", legalEntityId: search.get("legalEntityId") || undefined });
    if (search.get("format") === "csv") return new Response(`\uFEFF${financeCsv(data.rows.map(row => ({ periodFrom: data.from, periodTo: data.to, rulesVersion: data.rulesVersion, ...row })))}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="Nautex-VAT-review-${data.from}-${data.to}.csv"`, "Cache-Control": "no-store" } });
    return ok(data);
  } catch (error) { return fail("VAT_REVIEW_FAILED", error instanceof Error ? error.message : "Could not generate the VAT review.", 400); }
}
