export type AuthMode = "development" | "local" | "required";

const DEVELOPMENT_SECRET = "nautex-development-only-secret-change-before-production";

export function getAuthMode(): AuthMode {
  const configured = process.env.NAUTEX_AUTH_MODE?.trim().toLowerCase();
  if (configured === "development" || configured === "local" || configured === "required") return configured;
  return process.env.NODE_ENV === "production" ? "required" : "development";
}

export function isAuthRequired() {
  return getAuthMode() !== "development";
}

export function isLocalAuthMode() {
  return getAuthMode() === "local";
}

export function isMicrosoftAuthConfigured() {
  return Boolean(
    process.env.MICROSOFT_CLIENT_ID?.trim() &&
    process.env.MICROSOFT_CLIENT_SECRET?.trim() &&
    process.env.MICROSOFT_TENANT_ID?.trim(),
  );
}

export function getAuthConfigurationIssues() {
  if (!isAuthRequired()) return [];

  const issues: string[] = [];
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
    issues.push("BETTER_AUTH_SECRET must contain at least 32 characters.");
  }
  if (!process.env.BETTER_AUTH_URL) issues.push("BETTER_AUTH_URL is required.");
  if (!isLocalAuthMode() && !isMicrosoftAuthConfigured()) issues.push("Microsoft Entra client, secret, and tenant configuration is incomplete.");
  return issues;
}

export function getBetterAuthSecret() {
  return process.env.BETTER_AUTH_SECRET || DEVELOPMENT_SECRET;
}

export function getTrustedOrigins() {
  const configured = process.env.NAUTEX_AUTH_TRUSTED_ORIGINS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured?.length) return configured;
  return [process.env.BETTER_AUTH_URL || "http://127.0.0.1:3002", "http://localhost:3002"];
}
