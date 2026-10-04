# Nautex Community 0.3.14 — source release

## Installation time and antivirus alerts — update 4 October 2026

A tester reports that the privately supplied Windows candidate installed successfully, took almost 10 minutes, triggered several Avast alerts, and then appeared to run normally. This is one user-reported result, not a typical installation-time benchmark or a completed clean-Windows qualification. The exact warning text, affected filenames, Avast version/verdict and machine prerequisite baseline have not yet been verified.

The candidate is **unsigned** and bundles Electron/Node, PostgreSQL and other native runtime files. Extracting and scanning those files can take time; the cause of this installation's delay has not been measured. Avast's [CyberCapture documentation](https://support.avast.com/en-ca/article/antivirus-cybercapture/) explains that unfamiliar files may be held for analysis. Separately, [Microsoft documents reputation warnings for new or unsigned applications](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation). These are possible explanations for security prompts, not a diagnosis of the reported Avast alerts. No Avast false-positive determination or antivirus clearance is claimed; successful installation alone does not establish either.

Keep antivirus protection enabled. If a file is blocked or quarantined, leave it blocked pending review and record the detection name, affected filename, file SHA-256 and final antivirus verdict. Share screenshots only after removing personal paths, account details and private data. A matching release checksum establishes that a file matches the published artifact; it does not establish that the file is harmless. Signing may help establish publisher identity, but does not guarantee that antivirus alerts disappear.

The installer remains unavailable as a public release asset while native redistribution and outstanding installation checks remain unresolved. This dated note updates the release page; the original source tag, archived source and checksums are unchanged.


Tag: `v0.3.14-source.1`. Repository: https://github.com/zpointai/nautex.

**The Windows installer is pending verification. No installer or native-materials archive is published with this source release.** GitHub's generated source archives contain code and are not executable installers.

- AGPL-3.0-only application source, attribution, full licence and corresponding-source build scripts.
- Separate Nautex Community installation and profile; no automatic adoption of private Nautex records.
- Empty first launch, local workspace/account creation, optional user-owned provider configuration and authorised catalogue import.
- Accurate requirements for all 17 navigation modules, Ask Nautex and Settings.
- Exact provider model IDs, setup, costs, privacy, explicit activation/removal and bounded failure handling.
- No owner keys, private business data, catalogue content or private Git history.
- Sanitised first-run and empty-catalogue screenshots; third-party notices, source/build manifests and the per-binary candidate inventory.

The Windows candidate passed build/type checks, nine focused tests and nine installed-application acceptance groups on a **developer host** with an isolated synthetic profile. Same-version reinstall, restart and uninstall/data preservation were tested there. No clean-machine, missing-VC++ prerequisite, cross-version upgrade or live-provider qualification is claimed.

Remaining binary gates include exact EDB library source/build correspondence, native static dependency/source and notice closure, vendor grants/revisions, and installer helper redistribution evidence. The candidate is unsigned; signing is optional. A clean supported Windows 11 x64 VM without developer tools, PostgreSQL or VC++ was unavailable. Follow [the precise pending procedure](CLEAN_WINDOWS_TEST.md).

The [release status](RELEASE_STATUS.md), [native review](THIRD_PARTY.md), [provider guide](PROVIDERS.md) and [module matrix](MODULE_REQUIREMENTS.md) describe evidence and limitations. The source tag is distinct from the earlier local `v0.3.14` candidate. Any future cleared installer will use a new tag at its exact final source commit, with regenerated matching artifacts and checksums.
