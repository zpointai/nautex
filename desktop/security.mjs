export const NAUTEX_PROTOCOL = "nautex:";
export const RENDERER_ORIGIN = "nautex-app://renderer";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const MODULE_KEYS = new Set([
  "dashboard",
  "purchaseOrders",
  "suppliers",
  "contracts",
  "backorders",
  "vessels",
  "inventory",
  "finance",
  "evidenceAnalyzer",
  "procurementSearch",
  "impaSearch",
  "hsCodeFinder",
  "rfqAutomation",
  "procurementValidator",
  "priceCalculator",
  "agentMonitor",
  "exceptionsQueue",
]);

export function normalizeTrustedOrigin(value, { allowLocalhostHttp = false } = {}) {
  if (!value || typeof value !== "string") throw new Error("A Nautex backend origin is required.");

  const url = new URL(value.trim());
  const isLocalHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(allowLocalhostHttp && isLocalHttp)) {
    throw new Error("The Nautex backend must use HTTPS.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The Nautex backend must be an origin without credentials, paths, queries, or fragments.");
  }
  return url.origin;
}

export function isAllowedRendererUrl(value, trustedOrigin) {
  try {
    const url = new URL(value);
    if (trustedOrigin === RENDERER_ORIGIN) {
      return url.protocol === "nautex-app:" && url.hostname === "renderer";
    }
    return url.origin === trustedOrigin && (url.protocol === "https:" || LOCAL_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

export function resolveBackendRequestUrl(value, backendOrigin) {
  try {
    const url = new URL(value, `${RENDERER_ORIGIN}/`);
    if (url.protocol === "nautex-app:" && url.hostname === "renderer" && url.pathname.startsWith("/api/")) {
      return new URL(`${url.pathname}${url.search}`, backendOrigin).toString();
    }
    if (url.origin === backendOrigin && url.pathname.startsWith("/api/")) return url.toString();
  } catch {
    // Invalid and non-API URLs are rejected by returning null.
  }
  return null;
}

export function isAllowedExternalUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function parseDeepLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== NAUTEX_PROTOCOL || url.hostname !== "open") return null;
    const [moduleKey, ...recordParts] = url.pathname.split("/").filter(Boolean);
    if (!MODULE_KEYS.has(moduleKey)) return null;
    const recordId = recordParts.length ? decodeURIComponent(recordParts.join("/")) : undefined;
    return `nautex://open/${moduleKey}${recordId ? `/${encodeURIComponent(recordId)}` : ""}`;
  } catch {
    return null;
  }
}

export function findDeepLink(values) {
  for (const value of values) {
    const parsed = parseDeepLink(value);
    if (parsed) return parsed;
  }
  return null;
}

export function normalizeOptionalHttpsUrl(value, label) {
  if (!value) return "";
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${label} must be an HTTPS URL without embedded credentials.`);
  }
  return url.toString();
}
