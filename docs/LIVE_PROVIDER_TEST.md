# Minimal live-provider qualification — credentials pending

No live call has been made. The maintainer authorised a total USD 0.05 release-test budget on 4 October 2026; spending remains USD 0.00 because dedicated test credentials are not configured. Do not reuse keys from a private Nautex profile. Other users must authorise their own spending before using `--execute`; this document does not grant access to anyone's provider account.

The smallest useful test is one synthetic JSON extraction through the actual Nautex adapter for each fast-tier model: `deepseek-flash` and `gemini-3-flash-preview`. An optional four-model pass also covers `deepseek-v4-pro` and `gemini-3.1-pro-preview`. The default/reasoning tiers share IDs where documented. A successful fast-tier check does not qualify another model or high-thinking workload.

Each input has fewer than 512 UTF-8 bytes including the system message; reserve 512 input tokens and cap output at 512 tokens, including provider thinking where accounted for by its output limit. DeepSeek thinking is explicitly disabled for this minimal extraction; Gemini uses LOW. No search, grounding, files, private records or catalogue data are sent. No automatic fallback to other models/providers occurs. The adapter can retry an empty DeepSeek JSON response once; the request and cost reserve includes that retry. Any failed case stops the sequence.

| API model | Reserved input / output USD per million tokens | Per-request reserve, 512 in + 512 out |
| --- | --- | --- |
| deepseek-flash | 0.30 / 1.20, peak cache-miss | 0.000768 |
| deepseek-v4-pro | 1.32 / 3.96, peak cache-miss | 0.00270336 |
| gemini-3-flash-preview | 0.50 / 3.00 | 0.001792 |
| gemini-3.1-pro-preview | 2.00 / 12.00, prompts below 200k | 0.007168 |

The two-model maximum reserve is **USD 0.003328** (up to three HTTP requests). The four-model reserve is **USD 0.01590272** (up to six requests). The authorised release-test ceiling is **USD 0.05 total**, including any applicable charges. Do not purchase credit top-ups or repeat failed runs under this budget. The estimates exclude taxes, account top-up minimums and future price changes; proceed only if the all-in charge fits the remaining ceiling. Recheck billing before execution; the script's reserve is not a provider-enforced account spending cap.

Prices reviewed on 4 October 2026 against [DeepSeek's official pricing](https://api-docs.deepseek.com/quick_start/pricing/), [Google's pricing](https://ai.google.dev/gemini-api/docs/pricing) and the [Gemini 3 guide's explicit Flash Preview row](https://ai.google.dev/gemini-api/docs/gemini-3). Google's latter guide is marked deprecated, although the [specific model page](https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview) still documents this exact ID; reconfirm its price/entitlement in the API console before spending. No unsupported replacement ID is silently selected.

Run `npx tsx scripts/live-provider-smoke.ts` to print the plan without network calls, or add `--all-models` to preview the extended plan. Only after budget approval, set process-only `NAUTEX_RELEASE_TEST_DEEPSEEK_KEY` and `NAUTEX_RELEASE_TEST_GEMINI_KEY` using a protected shell/secret store, then append `--execute --budget-approved-usd=0.05`. Do not place keys in command-line arguments, committed files, issue reports or screenshots. The test creates a new `nautex-release-test-live-*` directory, does not save credentials, and records only model/status/usage and validation outcomes. Clear the process-only keys afterwards.

Expected result: the structured quantity is 2 and unit EA; response completes, provider/model match the request, usage is reported, and there is no raw provider-error/key output. Failure or quota denial is evidence, not a reason to spend again automatically. This is a connection/schema smoke test, not a quality benchmark. TypeSafe/Jev is excluded; it needs its own pricing/entitlement review and separate approval.
