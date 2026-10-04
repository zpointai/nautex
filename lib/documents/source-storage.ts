import { createHash, randomUUID } from "node:crypto";
import { ApiRequestError } from "@/lib/api/request";
import { deleteObject, getObject, putObject } from "@/lib/storage/object-storage";
import { sanitizeFileName } from "@/lib/storage/local-object-storage";
import type { StoredSourceDocument } from "./source-types";

export interface SourceUpload { data: Buffer; fileName: string; mimeType: string }
const MAX_BYTES = 12 * 1024 * 1024;
const FORMATS = new Set(["pdf", "xlsx", "xls", "csv", "docx", "txt", "log"]);
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");

export function uploadedSource(value: unknown): SourceUpload | undefined {
  if (!value || typeof value !== "object") return undefined;
  const file = value as { data?: unknown; name?: unknown; mimeType?: unknown; type?: unknown };
  if (file.data === undefined) return undefined;
  if (typeof file.data !== "string" || !file.data || file.data.length > Math.ceil(MAX_BYTES / 3) * 4) {
    throw new ApiRequestError("SOURCE_UPLOAD_INVALID", "Source upload is empty or exceeds 12 MiB.", 413);
  }
  const bytes = Buffer.from(file.data, "base64");
  if (!bytes.length || bytes.toString("base64").replace(/=+$/, "") !== file.data.replace(/=+$/, "")) {
    throw new ApiRequestError("SOURCE_UPLOAD_INVALID", "Source upload is not valid base64.", 422);
  }
  const name = typeof file.name === "string" ? file.name : "";
  if (!FORMATS.has(name.toLowerCase().split(".").pop() ?? "")) {
    throw new ApiRequestError("SOURCE_FORMAT_UNSUPPORTED", "Use PDF, XLSX, XLS, DOCX, CSV, TXT or LOG source files.", 415);
  }
  return { data: bytes, fileName: name, mimeType: typeof file.mimeType === "string" ? file.mimeType : typeof file.type === "string" ? file.type : "application/octet-stream" };
}

export async function retainSourceDocument(organizationId: string, text: string, upload?: SourceUpload, kind: StoredSourceDocument["kind"] = "text"): Promise<StoredSourceDocument> {
  const data = upload?.data ?? Buffer.from(text, "utf8");
  if (!data.length || data.length > MAX_BYTES) throw new ApiRequestError("SOURCE_SIZE_INVALID", "Source must contain 1 byte to 12 MiB.", 413);
  const fileName = sanitizeFileName(upload?.fileName ?? (kind === "record_snapshot" ? "record-snapshot.txt" : "source-text.txt"));
  const document: StoredSourceDocument = {
    version: 1, storageProvider: "local", storageKey: `organizations/${organizationId}/review-sources/${randomUUID()}/${fileName}`,
    fileName, mimeType: upload?.mimeType || "text/plain; charset=utf-8", sizeBytes: data.length, sha256: hash(data), kind: upload ? "upload" : kind,
  };
  await putObject(document.storageProvider, document.storageKey, data);
  return document;
}

/** Only call for a newly written, unreferenced source after its database save fails. */
export async function discardUnreferencedSources(documents: StoredSourceDocument[]) {
  await Promise.allSettled(documents.map(doc => deleteObject(doc.storageProvider, doc.storageKey, { permanent: true })));
}

export async function sourceDocumentResponse(document: StoredSourceDocument | undefined, organizationId: string) {
  if (!document || document.version !== 1 || document.storageProvider !== "local"
    || !document.storageKey.startsWith(`organizations/${organizationId}/review-sources/`)) {
    throw new ApiRequestError("SOURCE_NOT_AVAILABLE", "The original source was not retained for this record.", 404);
  }
  let bytes: Buffer;
  try { bytes = await getObject(document.storageProvider, document.storageKey); }
  catch { throw new ApiRequestError("SOURCE_NOT_AVAILABLE", "The retained source could not be read. Restore it from a verified backup.", 404); }
  if (bytes.length !== document.sizeBytes || hash(bytes) !== document.sha256) {
    throw new ApiRequestError("SOURCE_INTEGRITY_FAILED", "The retained source failed its integrity check. Restore it from a verified backup.", 409);
  }
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${sanitizeFileName(document.fileName)}"`,
    "Content-Length": String(bytes.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "X-Nautex-Source-SHA256": document.sha256,
  }});
}
