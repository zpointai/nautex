"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SignInPanel } from "@/components/auth/sign-in-panel";
import { apiClient, ApiClientError, type ApiClientErrorDetail } from "@/lib/client/api-client";
import type { AuthMode } from "@/lib/auth/config";

type RuntimeState = "ready" | "offline" | "backend-unavailable" | "session-expired" | "service-unavailable";

function requiresNetwork() {
  return typeof window === "undefined" || window.nautexDesktop?.deploymentMode !== "standalone";
}

interface HealthResponse {
  checks: Record<string, { ok: boolean }>;
}

interface AuthResponse {
  userId: string;
}

interface AuthConfigResponse {
  mode: AuthMode;
  providerConfigured: boolean;
  bootstrapRequired: boolean;
}

function stateForError(error: unknown): RuntimeState {
  if (typeof navigator !== "undefined" && !navigator.onLine && requiresNetwork()) return "offline";
  const status = error instanceof ApiClientError
    ? error.status
    : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
      ? error.status
      : 0;
  if (status === 401) return "session-expired";
  if (status === 503) return "service-unavailable";
  return "backend-unavailable";
}

function stateForApiEvent(detail: ApiClientErrorDetail): RuntimeState | null {
  if (!navigator.onLine && requiresNetwork()) return "offline";
  if (detail.status === 401) return "session-expired";
  // Optional feature/provider 503 responses must not replace the whole local workspace.
  // The dedicated health check determines service availability.
  if (detail.network || detail.code === "INVALID_BACKEND_CONFIGURATION") return "backend-unavailable";
  return null;
}

const runtimeMessages: Record<Exclude<RuntimeState, "ready">, { icon: string; title: string; detail: string }> = {
  offline: { icon: "wifi_off", title: "Nautex is offline", detail: "Transactional work is paused until this workstation reconnects." },
  "backend-unavailable": { icon: "cloud_off", title: "Backend unavailable", detail: "Nautex cannot reach the configured service." },
  "session-expired": { icon: "lock", title: "Session expired", detail: "Sign in again to continue working." },
  "service-unavailable": { icon: "construction", title: "Service unavailable", detail: "The Nautex service is starting or undergoing maintenance." },
};

export function DesktopRuntimeBoundary({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RuntimeState>("ready");
  const [checking, setChecking] = useState(false);
  const [authConfig, setAuthConfig] = useState<AuthConfigResponse | null>(null);

  const check = useCallback(async () => {
    if (!navigator.onLine && requiresNetwork()) {
      setState("offline");
      return;
    }
    setChecking(true);
    try {
      await apiClient.get<HealthResponse>("/api/v1/system/health");
      await apiClient.get<AuthResponse>("/api/v1/auth/context");
      setState("ready");
    } catch (error) {
      const nextState = stateForError(error);
      if (nextState === "session-expired") {
        try {
          setAuthConfig(await apiClient.get<AuthConfigResponse>("/api/v1/auth/config"));
        } catch {
          setAuthConfig(null);
        }
      }
      setState(nextState);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const handleOffline = () => { if (requiresNetwork()) setState("offline"); };
    const handleOnline = () => void check();
    const handleApiError = (event: Event) => {
      const nextState = stateForApiEvent((event as CustomEvent<ApiClientErrorDetail>).detail);
      if (nextState) setState(nextState);
    };
    const timer = window.setInterval(() => void check(), 30_000);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    window.addEventListener("nautex:api-error", handleApiError);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("nautex:api-error", handleApiError);
    };
  }, [check]);

  if (state === "ready") return children;
  if (state === "session-expired" && authConfig) {
    return (
      <SignInPanel
        mode={authConfig.mode}
        providerConfigured={authConfig.providerConfigured}
        bootstrapRequired={authConfig.bootstrapRequired}
        callbackUrl="/"
      />
    );
  }
  const message = runtimeMessages[state];

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-base px-6" role="alert" aria-live="assertive">
      <div className="w-full max-w-md rounded-lg border border-outline-variant/20 bg-surface-container p-7 text-center shadow-2xl">
        <span className="material-symbols-outlined text-4xl text-primary">{message.icon}</span>
        <h1 className="mt-4 text-lg font-semibold text-on-surface">{message.title}</h1>
        <p className="mt-2 text-sm text-on-surface-variant">{message.detail}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={() => void check()} disabled={checking} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-on-primary disabled:opacity-60">{checking ? "Checking" : state === "session-expired" ? "Load sign in" : "Retry"}</button>
        </div>
      </div>
    </div>
  );
}
