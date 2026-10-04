import { fail } from "@/lib/api/response";
import { renderCustomerInvoiceHtml } from "@/lib/finance/documents";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authorization = await authorizeOrganizationRequest(_request);
    if (!authorization.ok) return authorization.response;
    const { id } = await params;
    const invoice = await prisma.customerInvoice.findFirst({ where: { id, legalEntity: { organizationId: authorization.context.organizationId } }, select: { id: true } });
    if (!invoice) return fail("CUSTOMER_INVOICE_NOT_FOUND", "Invoice not found.", 404);
    const html = await renderCustomerInvoiceHtml(id);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail("CUSTOMER_INVOICE_DOCUMENT_FAILED", error instanceof Error ? error.message : "Invoice document generation failed.", 404);
  }
}
