import { resolveApiUrl } from "@/lib/client/api-client";

function absoluteUrl(value: string) {
  if (typeof window === "undefined") throw new Error("Desktop actions require a browser context.");
  return new URL(value, window.location.origin).toString();
}

function safeExternalUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("External links must use HTTPS.");
  }
  return url.toString();
}

export async function openExternalUrl(value: string) {
  const url = safeExternalUrl(value);
  if (window.nautexDesktop) return window.nautexDesktop.openExternal(url);
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openNautexDocument(path: string) {
  const url = absoluteUrl(resolveApiUrl(path));
  if (window.nautexDesktop) return window.nautexDesktop.openDownload(url);
  window.open(url, "_blank", "noopener,noreferrer");
}

export function subscribeDesktopDeepLinks(listener: (url: string) => void) {
  return window.nautexDesktop?.onDeepLink(listener) ?? (() => undefined);
}
