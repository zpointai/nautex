import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { importInventoryCsvText } from "@/lib/inventory/import-export";

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.INVENTORY_WRITE);
    if (!authorization.ok) return authorization.response;
    const contentType = req.headers.get("content-type") ?? "";
    let text = "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file");
      if (file instanceof File) text = await file.text();
    } else {
      text = await req.text();
    }

    if (!text.trim()) return fail("EMPTY_IMPORT", "Upload a CSV file or CSV request body.", 400);
    return ok(await importInventoryCsvText(text, authorization.context.organizationId), { source: "postgres" });
  } catch (error) {
    logApiError("POST /api/v1/inventory/import", error);
    return fail("INVENTORY_IMPORT_FAILED", "Inventory import failed.", 500);
  }
}
