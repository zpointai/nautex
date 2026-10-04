export class ApiRequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export const DEFAULT_JSON_LIMIT_BYTES = 1024 * 1024;

function declaredLength(request: Request) {
  const value = request.headers.get("content-length");
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function assertRequestSize(request: Request, maxBytes: number) {
  const length = declaredLength(request);
  if (length != null && length > maxBytes) {
    throw new ApiRequestError("REQUEST_TOO_LARGE", `Request body exceeds the ${maxBytes}-byte limit.`, 413);
  }
}

export async function readJsonObject(request: Request, maxBytes = DEFAULT_JSON_LIMIT_BYTES): Promise<Record<string, unknown>> {
  assertRequestSize(request, maxBytes);
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new ApiRequestError("JSON_CONTENT_TYPE_REQUIRED", "Content-Type must be application/json.", 415);
  }
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new ApiRequestError("REQUEST_TOO_LARGE", `Request body exceeds the ${maxBytes}-byte limit.`, 413);
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiRequestError("INVALID_JSON", "Request body must contain valid JSON.", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiRequestError("JSON_OBJECT_REQUIRED", "Request body must be a JSON object.", 400);
  }
  return value as Record<string, unknown>;
}

export function assertUploadFile(file: FormDataEntryValue | null, options: {
  requiredCode: string;
  emptyCode: string;
  tooLargeCode: string;
  maxBytes: number;
  allowedExtensions?: ReadonlySet<string>;
}): File {
  if (!(file instanceof File)) throw new ApiRequestError(options.requiredCode, "A file is required.", 400);
  if (file.size <= 0) throw new ApiRequestError(options.emptyCode, "The uploaded file is empty.", 400);
  if (file.size > options.maxBytes) throw new ApiRequestError(options.tooLargeCode, `File exceeds the ${options.maxBytes}-byte limit.`, 413);
  if (options.allowedExtensions) {
    const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
    if (!options.allowedExtensions.has(extension)) throw new ApiRequestError("UPLOAD_TYPE_UNSUPPORTED", "Uploaded file type is not supported.", 415);
  }
  return file;
}
