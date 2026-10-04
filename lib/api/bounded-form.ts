import { ApiRequestError, assertRequestSize } from "./request";
/** Enforce streamed body size even without Content-Length, before multipart allocation. */
export async function boundedFormData(request: Request, maxBytes: number) {
  assertRequestSize(request, maxBytes);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ApiRequestError("REQUEST_TOO_LARGE","Upload exceeds the supported size.",413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks),{headers:{"content-type":request.headers.get("content-type") ?? ""}}).formData();
}
