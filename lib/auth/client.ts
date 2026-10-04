"use client";

import { createAuthClient } from "better-auth/react";

const desktopBackendOrigin = typeof window !== "undefined" && window.nautexDesktop?.usesApiProxy
  ? window.nautexDesktop.backendOrigin
  : "";

async function desktopAuthFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  const target = new URL(request.url);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return fetch(`${target.pathname}${target.search}`, {
    method: request.method,
    headers: request.headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    credentials: "include",
    redirect: request.redirect,
    signal: request.signal,
  });
}

export const authClient = createAuthClient(desktopBackendOrigin ? {
  baseURL: `${desktopBackendOrigin}/api/auth`,
  fetchOptions: { customFetchImpl: desktopAuthFetch },
} : undefined);
