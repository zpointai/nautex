import { NextResponse } from "next/server";

type ApiMeta = Record<string, unknown>;

export function ok<T>(data: T, meta?: ApiMeta, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data, ...(meta ? { meta } : {}) }, init);
}

export function fail(code: string, message: string, status = 500, meta?: ApiMeta) {
  return NextResponse.json(
    { ok: false, error: { code, message }, ...(meta ? { meta } : {}) },
    { status },
  );
}

export function notConnected<T>(data: T, message: string, meta?: ApiMeta) {
  return ok(data, {
    status: "not_connected",
    message,
    ...(meta ?? {}),
  });
}

export function logApiError(route: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ level: "error", event: "api_error", route, message, timestamp: new Date().toISOString() }));
}

export function requestId(request: Request) {
  return request.headers.get("x-request-id") ?? "unassigned";
}

export function logApiRequest(route: string, request: Request, fields: Record<string, unknown> = {}) {
  console.info(JSON.stringify({
    level: "info",
    event: "api_request",
    route,
    method: request.method,
    requestId: requestId(request),
    timestamp: new Date().toISOString(),
    ...fields,
  }));
}
