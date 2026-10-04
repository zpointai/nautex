export interface ApiSuccess<T> {
  ok: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiFailure {
  ok: false;
  error: { code: string; message: string };
  meta?: Record<string, unknown>;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export interface ApiClientErrorDetail {
  status: number;
  code: string;
  message: string;
  path: string;
  network: boolean;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly path: string;
  readonly network: boolean;

  constructor(detail: ApiClientErrorDetail) {
    super(detail.message);
    this.name = "ApiClientError";
    this.status = detail.status;
    this.code = detail.code;
    this.path = detail.path;
    this.network = detail.network;
  }
}

function isLocalHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function normalizeBackendOrigin(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;

  const url = new URL(candidate);
  if (url.username || url.password) throw new Error("Backend URL must not contain credentials.");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error("Backend URL must contain only an origin.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalHostname(url.hostname))) {
    throw new Error("Backend URL must use HTTPS, except for local development.");
  }
  return url.origin;
}

function configuredBackendOrigin() {
  if (typeof window !== "undefined" && window.nautexDesktop?.usesApiProxy) return null;
  if (typeof window !== "undefined" && window.nautexDesktop?.backendOrigin) {
    return normalizeBackendOrigin(window.nautexDesktop.backendOrigin);
  }
  return normalizeBackendOrigin(process.env.NEXT_PUBLIC_NAUTEX_API_BASE_URL);
}

export function resolveApiUrl(path: string, backendOrigin = configuredBackendOrigin()) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("API paths must be root-relative.");
  return backendOrigin ? new URL(path, `${backendOrigin}/`).toString() : path;
}

function emitApiError(detail: ApiClientErrorDetail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ApiClientErrorDetail>("nautex:api-error", { detail }));
  }
}

function errorFrom(status: number, path: string, payload?: Partial<ApiFailure>, fallback?: string) {
  const detail: ApiClientErrorDetail = {
    status,
    code: payload?.error?.code ?? "API_REQUEST_FAILED",
    message: payload?.error?.message ?? fallback ?? `Request failed with status ${status}.`,
    path,
    network: false,
  };
  emitApiError(detail);
  return new ApiClientError(detail);
}

function requestBody(body: unknown, headers: Headers) {
  if (body === undefined || body instanceof FormData || body instanceof Blob || typeof body === "string") return body as BodyInit | undefined;
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return JSON.stringify(body);
}

export class NautexApiClient {
  async raw(path: string, init: RequestInit = {}) {
    let url: string;
    try {
      url = resolveApiUrl(path);
    } catch (error) {
      const detail: ApiClientErrorDetail = {
        status: 0,
        code: "INVALID_BACKEND_CONFIGURATION",
        message: error instanceof Error ? error.message : "The Nautex backend URL is invalid.",
        path,
        network: false,
      };
      emitApiError(detail);
      throw new ApiClientError(detail);
    }
    try {
      const response = await fetch(url, { ...init, credentials: "include" });
      if (!response.ok) {
        const payload = await response.clone().json().catch(() => undefined) as Partial<ApiFailure> | undefined;
        throw errorFrom(response.status, path, payload, response.statusText);
      }
      return response;
    } catch (error) {
      if (error instanceof ApiClientError || (error instanceof DOMException && error.name === "AbortError")) throw error;
      const detail: ApiClientErrorDetail = {
        status: 0,
        code: "NETWORK_UNAVAILABLE",
        message: "The Nautex backend is unavailable.",
        path,
        network: true,
      };
      emitApiError(detail);
      throw new ApiClientError(detail);
    }
  }

  async request<T>(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const response = await this.raw(path, { ...init, headers, body: requestBody(init.body, headers) });
    const payload = await response.json().catch(() => null) as ApiEnvelope<T> | null;
    if (!payload || typeof payload !== "object" || !("ok" in payload)) {
      throw errorFrom(response.status, path, undefined, "The backend returned an invalid response.");
    }
    if (!payload.ok) throw errorFrom(response.status, path, payload);
    return payload.data;
  }

  get<T>(path: string, init: RequestInit = {}) {
    return this.request<T>(path, { ...init, method: "GET" });
  }

  post<T>(path: string, body?: unknown, init: RequestInit = {}) {
    return this.request<T>(path, { ...init, method: "POST", body: body as BodyInit | undefined });
  }

  patch<T>(path: string, body?: unknown, init: RequestInit = {}) {
    return this.request<T>(path, { ...init, method: "PATCH", body: body as BodyInit | undefined });
  }
}

export const apiClient = new NautexApiClient();
