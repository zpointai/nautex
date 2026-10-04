import { SignInPanel } from "@/components/auth/sign-in-panel";
import { getAuthMode, isMicrosoftAuthConfigured } from "@/lib/auth/config";
import { getLocalBootstrapState } from "@/lib/auth/local-users";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const params = await searchParams;
  const callbackUrl = params.callbackUrl?.startsWith("/") && !/^\/[\\/]/.test(params.callbackUrl) && !/[\r\n\\]/.test(params.callbackUrl)
    ? params.callbackUrl : "/";
  const mode = getAuthMode();
  const bootstrapRequired = mode === "local" ? (await getLocalBootstrapState()).required : false;
  return <SignInPanel mode={mode} providerConfigured={isMicrosoftAuthConfigured()} bootstrapRequired={bootstrapRequired} callbackUrl={callbackUrl} />;
}
