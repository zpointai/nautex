# Source release status — 4 October 2026

Publication scope: the allowlisted application source, AGPL-3.0-only licence, documentation, clean screenshots, dependency notices and review manifests. No native executable, installer, dependency source archive, operational profile or private Git history is included. The source tag is `v0.3.14-source.1`.

## Verified developer-host results

The earlier isolated Windows candidate was built from a clean checkout using locked dependencies. TypeScript, nine focused community tests, both frontends, the backend, PostgreSQL/migration packaging and NSIS packaging passed. A real Sharp resize/PNG test passed outside the development dependency tree after the missing Windows DLL packaging was repaired. Eight unused wxWidgets DLLs and the unused Sharp Wasm fallback were removed; retained PostgreSQL imports were checked.

Actual installation on the developer host passed nine acceptance groups: first-run setup, empty workspace/catalogue, local use without AI, synthetic catalogue import, provider encryption/removal, legal/source access, map controls, restart and persistence. The 10,268 installed payload files matched the build hashes. Same-version reinstall and uninstall returned success; all 6,491 synthetic profile files were preserved byte-for-byte, and installed app/shortcut/uninstall entries were removed. The test used only isolated release profiles. These are developer-host results, not clean-Windows qualification.

The source-only snapshot changes publication documentation and adds the existing per-file native review evidence. It does not claim that the older private installer contains these final documentation changes. That installer and the partial dependency-materials kit remain withheld; they must be regenerated and requalified against a future exact source commit before distribution.

## Pending checks and binary blockers

| Area | Status and exact missing evidence/action |
| --- | --- |
| Native redistribution | Incomplete. See [per-binary inventory](../third-party/NATIVE_BINARIES.json), [readable inventory](../third-party/NATIVE_INVENTORY.md) and [component blockers](THIRD_PARTY.md). Unknown revisions and vendor terms are explicitly marked. No inference of clearance from adjacent components' licences. |
| Clean Windows | Pending. Requires an accessible fresh supported Windows 11 x64 VM, standard-user session and administrator credentials, without Node/developer tools, PostgreSQL or VC++. Windows Sandbox is absent; Hyper-V management is denied to the current account. Follow [the manual checklist](CLEAN_WINDOWS_TEST.md), including UAC denial/success, reboot, offline use, restart and default-profile preservation. |
| Live providers | Pending dedicated test credentials and provider billing/entitlement preflight. USD 0.05 total was authorised; USD 0.00 spent. Model/pricing documentation was reviewed; dry runs make no API requests. See [bounded test plan](LIVE_PROVIDER_TEST.md). |
| Signing | Optional; the private Windows candidate is unsigned. SmartScreen behaviour on a clean VM is unverified. |
| Cross-version upgrade | Pending a previous Community build and disposable VM snapshot. Same-version reinstall is the only upgrade-like path exercised. |

Screenshots in this repository were captured from an isolated synthetic first-run/empty workspace. No supplied catalogue rows or business records are present. External services, OCR and experimental Jev limitations are described in the [module requirements](MODULE_REQUIREMENTS.md).
