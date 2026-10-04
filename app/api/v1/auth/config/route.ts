import { ok } from "@/lib/api/response";
import {
  getAuthConfigurationIssues,
  getAuthMode,
  isMicrosoftAuthConfigured,
} from "@/lib/auth/config";
import { getLocalBootstrapState } from "@/lib/auth/local-users";

export async function GET() {
  const issues = getAuthConfigurationIssues();
  const mode = getAuthMode();
  const bootstrapRequired = mode === "local" ? (await getLocalBootstrapState()).required : false;
  return ok({
    mode,
    provider: mode === "local" ? "local" : "microsoft",
    providerConfigured: mode === "local" || isMicrosoftAuthConfigured(),
    bootstrapRequired,
    ready: issues.length === 0,
    issues: process.env.NODE_ENV === "production" ? [] : issues,
  });
}
