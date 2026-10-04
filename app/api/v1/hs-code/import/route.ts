import { fail, logApiError, ok } from "@/lib/api/response";
import { importHsBuffer } from "@/lib/datasets/hs-codes";
import { authorizeRequest } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/permissions";

export async function POST(req: Request) {
  try {
    const authorization = await authorizeRequest(req, PERMISSIONS.ADMIN_USERS);
    if (!authorization.ok) return authorization.response;
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file !== "object" || typeof (file as File).arrayBuffer !== "function") {
      return fail("INVALID_FILE", "Upload an HS CSV or spreadsheet file.", 400);
    }

    const uploaded = file as File;
    if (uploaded.size > 20 * 1024 * 1024) return fail("FILE_TOO_LARGE", "HS datasets must be 20 MB or smaller.", 413);
    if (!/\.(csv|xlsx|xls)$/i.test(uploaded.name)) return fail("INVALID_FILE", "Upload a CSV or Excel spreadsheet.", 400);
    const result = await importHsBuffer({
      buffer: Buffer.from(await uploaded.arrayBuffer()),
      fileName: uploaded.name || "hs-codes.csv",
      system: form.get("system") ? String(form.get("system")) : undefined,
      source: String(form.get("source") || "uploaded_dataset"),
    });

    return ok(result, { source: "postgres" });
  } catch (error) {
    logApiError("POST /api/v1/hs-code/import", error);
    return fail("HS_IMPORT_FAILED", error instanceof Error ? error.message : "Failed to import HS code dataset.", 500);
  }
}
