"use client";

import { useState } from "react";
import type { AuthMode } from "@/lib/auth/config";
import { authClient } from "@/lib/auth/client";

interface SignInPanelProps {
  mode: AuthMode;
  providerConfigured: boolean;
  bootstrapRequired: boolean;
  callbackUrl: string;
}

export function SignInPanel({ mode, providerConfigured, bootstrapRequired, callbackUrl }: SignInPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupCompleted, setSetupCompleted] = useState(false);

  async function localSignIn() {
    const result = await authClient.signIn.email({ email: email.trim(), password, callbackURL: callbackUrl });
    if (result.error) throw new Error(result.error.message || "Email or password is incorrect.");
    window.location.assign(callbackUrl);
  }

  async function submitLocal(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (bootstrapRequired && !setupCompleted) {
        const response = await fetch("/api/v1/auth/bootstrap", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyName, name, email, password }),
        });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.error?.message ?? "Local setup failed.");
        setSetupCompleted(true);
      }
      await localSignIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
      setPending(false);
    }
  }

  async function signInMicrosoft() {
    setPending(true);
    setError(null);
    const result = await authClient.signIn.social({ provider: "microsoft", callbackURL: callbackUrl });
    if (result.error) {
      setError(result.error.message || "Microsoft sign-in could not be started.");
      setPending(false);
    }
  }

  const localMode = mode === "local";
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-base px-5 text-on-surface">
      <section className="w-full max-w-sm rounded-lg border border-outline-variant/15 bg-surface-container p-6 shadow-xl shadow-black/20">
        {/* eslint-disable-next-line @next/next/no-img-element -- Local brand asset with intrinsic sizing on the authentication surface. */}
        <img src="/brand/nautex-logo-horizontal-reversed.svg" alt="Nautex AI" className="mb-7 h-auto w-40" />
        <h1 className="text-xl font-semibold">{bootstrapRequired ? "Set up Nautex" : "Sign in to Nautex"}</h1>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          {bootstrapRequired
            ? "Create your private local workspace and its first administrator account. No OASIS account is required."
            : localMode ? "Use your Nautex employee account." : "Use your organization account."}
        </p>

        {bootstrapRequired && <p className="mt-3 text-xs leading-5 text-on-surface-variant">Start with empty records and no API keys. Orders, suppliers, inventory, finance and rule validation work locally. After account creation you can connect an optional AI provider or import your own authorised catalogue, or skip both.</p>}
        {localMode ? (
          <form onSubmit={submitLocal} className="mt-6 space-y-3">
            {bootstrapRequired && (
              <>
                <Field label="Company name" value={companyName} onChange={setCompanyName} autoComplete="organization" />
                <Field label="Administrator name" value={name} onChange={setName} autoComplete="name" />
              </>
            )}
            <Field label="Email" value={email} onChange={setEmail} type="email" autoComplete="username" />
            <Field label="Password" value={password} onChange={setPassword} type="password" autoComplete={bootstrapRequired ? "new-password" : "current-password"} />
            {bootstrapRequired && <p className="text-[0.68rem] leading-5 text-outline">Use at least 12 characters. Additional employees are created by an administrator after setup.</p>}
            <button type="submit" disabled={pending} className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-on-primary transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
              <span className="material-symbols-outlined text-lg">{bootstrapRequired ? "domain_add" : "login"}</span>
              {pending ? "Please wait..." : bootstrapRequired ? "Create office" : "Sign in"}
            </button>
          </form>
        ) : (
          <button type="button" disabled={!providerConfigured || pending} onClick={() => void signInMicrosoft()} className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-on-primary transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
            <span className="material-symbols-outlined text-lg">login</span>
            {pending ? "Connecting..." : "Continue with Microsoft"}
          </button>
        )}

        {!localMode && !providerConfigured && <p className="mt-4 text-xs leading-5 text-warning">Microsoft Entra authentication is not configured for this environment.</p>}
        {error && <p className="mt-4 text-xs leading-5 text-error">{error}</p>}
      </section>
    </main>
  );
}

function Field({ label, value, onChange, type = "text", autoComplete }: { label: string; value: string; onChange: (value: string) => void; type?: string; autoComplete: string }) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  // Password fields render as plain text while revealed so the typed value is
  // visible; the input keeps its password autocomplete semantics either way.
  const inputType = isPassword && revealed ? "text" : type;

  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-on-surface-variant">{label}</span>
      <div className="relative">
        <input
          required
          aria-label={label}
          type={inputType}
          value={value}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          className={`h-10 w-full rounded-md border border-outline-variant/20 bg-surface-base text-sm text-on-surface outline-none focus:border-primary/50 ${isPassword ? "pl-3 pr-11" : "px-3"}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            title={revealed ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-on-surface-variant transition hover:text-on-surface focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
          >
            <span aria-hidden="true" className="material-symbols-outlined text-lg leading-none">
              {revealed ? "visibility_off" : "visibility"}
            </span>
          </button>
        )}
      </div>
    </label>
  );
}
