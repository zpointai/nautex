import { fail, logApiError, ok } from "@/lib/api/response";
import { authorizeOrganizationRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { importImpaBuffer } from "@/lib/datasets/impa";

export async function POST(req: Request) {
  try {
    const authorization = await authorizeOrganizationRequest(req, PERMISSIONS.PROCUREMENT_WRITE);
    if (!authorization.ok) return authorization.response;
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file !== "object" || typeof (file as File).arrayBuffer !== "function") {
      return fail("INVALID_FILE", "Upload an IMPA CSV or spreadsheet file.", 400);
    }

    const uploaded = file as File;
    const result = await importImpaBuffer({
      buffer: Buffer.from(await uploaded.arrayBuffer()),
      fileName: uploaded.name || "impa-import.csv",
      includeChandlerCodes: form.get("includeChandlerCodes") === "true",
      includeDeleted: form.get("includeDeleted") !== "false",
      edition: String(form.get("edition") || "User-authorised import"),
    });

    return ok(result, { source: "postgres" });
  } catch (error) {
    logApiError("POST /api/v1/impa/import", error);
    return fail("IMPA_IMPORT_FAILED", error instanceof Error ? error.message : "Failed to import IMPA catalogue.", 500);
  }
}
