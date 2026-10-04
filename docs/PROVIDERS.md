# User-owned provider setup

Adapter audit: `lib/ai/provider.ts`, `config.ts`, `routing.ts` and `services/`. Settings implements DeepSeek and Gemini. OpenAI, Anthropic and Vertex are not implemented general-purpose providers in this release and are not recommended as substitutes. Review date: 4 October 2026.

Exact configured API IDs were checked individually: `deepseek-flash`, `deepseek-v4-pro`, `gemini-3-flash-preview`, and `gemini-3.1-pro-preview`. These are API identifiers, not consumer subscription names. Current documentation is not proof of account entitlement or successful live execution. The [minimal live-test plan](LIVE_PROVIDER_TEST.md) is prepared and dry-run tested. Live qualification remains pending: dedicated test credentials are not configured. Do not interpret a dry run as a successful provider request.

## DeepSeek — recommended starting point

The existing adapter uses text chat completions and JSON mode. `deepseek-flash` is the default and fast tier; `deepseek-v4-pro` is the reasoning tier. Flash is an economical starting point for extraction and drafts, with human review. This is an implementation/cost recommendation, not a new live quality benchmark. Official models and JSON support were verified against [models/pricing](https://api-docs.deepseek.com/quick_start/pricing/).

1. Register/sign in at [DeepSeek Platform](https://platform.deepseek.com/).
2. Check account billing and available credits; API usage is deducted from your balance.
3. Create a key in [API keys](https://platform.deepseek.com/api_keys).
4. In Nautex, open Settings → AI providers → DeepSeek. Paste the key and select **Connect provider**.
5. Keep the supplied model tiers initially. Expand **Model selection** to change supported model IDs, then **Save models**.
6. **Test DeepSeek** sends a synthetic prompt using the fast tier. It may consume paid credits. Saving alone makes no model request.

## Google Gemini — supported alternative

The adapter calls `generateContent` with text input and structured JSON output. The retained tested-code defaults are `gemini-3.1-pro-preview` (default/reasoning) and `gemini-3-flash-preview` (fast). Both remain listed in the [official model catalogue](https://ai.google.dev/gemini-api/docs/models); preview lifetimes and availability can change. Newer models are not claimed to be qualified by this release. Evaluate your own representative documents before changing defaults.

1. Sign in to [Google AI Studio](https://aistudio.google.com/) and create/import a project.
2. Review [billing](https://ai.google.dev/gemini-api/docs/billing) and the applicable paid/free tier and data terms. A consumer Gemini subscription is separate from API billing.
3. Create a key at [API keys](https://aistudio.google.com/api-keys); follow Google's [current key instructions](https://ai.google.dev/gemini-api/docs/api-key), including API restrictions.
4. Choose Google Gemini in Nautex Settings, paste the key and **Connect provider**.
5. Review **Model selection**, save changes if needed, and explicitly run **Test Google Gemini**.

## Changing, removing and troubleshooting

The [specific Gemini Flash Preview page](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview) documents its exact identifier and structured-output support. The older [Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3) still lists USD 0.50 input / 3.00 output per million tokens for that ID but is now marked deprecated; reconfirm billing before a live call. The [current pricing page](https://ai.google.dev/gemini-api/docs/pricing) lists `gemini-3.1-pro-preview` at USD 2 input / 12 output per million tokens for prompts below 200k tokens. Preview lifecycle and account access remain live-test gates; newer model names are not silently substituted.

DeepSeek's documentation currently maps `deepseek-flash` to DeepSeek-V4.1-Flash and `deepseek-v4-pro` to DeepSeek-V4-Pro-0813. Both support JSON output. The Flash recommendation reflects the implemented text/JSON adapter and lower published cost; no comparative task-quality claim is made. Model aliases can change behind an API ID, so record the provider's returned model in qualification results.

Select a provider and **Update key** to replace its key. **Disconnect** removes that provider's saved key. If it was active, AI becomes disabled even when another provider has a saved key. Select the other provider and **Make active** explicitly. No error silently switches providers. The fast-tier connection test does not qualify the default or reasoning tier.

401/403: replace an invalid key or fix account/model permissions. 402/429: check API billing, credits, quota and rate limits, then retry later. 404: select an available model ID in Model selection. Timeout/5xx: check connectivity/provider status and retry. Inputs remain in the current form. Provider response bodies are not displayed or stored as errors. No provider is configured on first launch and no paid request is made without a user key and an invoked AI action.

Keys are sent to the local backend and encrypted using a workspace secret held by the native process in Windows DPAPI storage. This protects data at rest, not against a compromised logged-in account. Keys never enter the renderer bundle, source archive or shareable diagnostics. Complete private recovery backups are sensitive and may include encrypted credentials.

When invoked, AI actions transmit their prompts, selected document text and relevant record fields to the chosen provider. They can include RFQ lines, supplier details, purchase orders or product descriptions. Verify your rights and the provider's retention/data-use terms. Nautex does not proxy requests through an owner-paid service. Usage is charged by the selected provider separately from this free software.

## Specialist services

Optional Jev advice uses TypeSafe's `jev-1.13.0` via `https://api.typesafe.ai/v1/systemone`. See [TypeSafe documentation](https://docs.typesafe.ai/introduction/quickstart) for account/dashboard access and commercial terms; no free quota is promised. In Settings → Jev save your own key, choose a daily limit and grant external-processing consent. Selected record fields are sent only when a review is requested. Use Disconnect to remove the key. The UI's review action is the implemented test path; there is no separate synthetic connection-test button. Current model entitlement and live responses remain unverified; keep this experimental feature disabled until evaluated.

Microsoft 365 mailbox access is a separate integration with tenant/app registration and OAuth consent; see the fields and guidance in Settings → Mailbox. Google Places enrichment uses a separate server-side `GOOGLE_MAPS_API_KEY` and its own billing; the isolated standalone community build does not inherit that machine key and has no desktop Places-key setup UI. Fleet lookup uses public pages and external tiles; it is not a paid AIS integration and not an AI provider. No external credentials are necessary for basic local use.
