# Nautex Community 0.3.14 — source release

## Source and Community video update

This source-only revision includes the corrected NSIS core/core-plugin notice classifications, the matching LZMA SDK 19.00 material reference, a precise outstanding distributor-materials request, and a new sanitised Community overview video. The MP4, silent version, editable project, storyboard, validation and checksums accompany the source snapshot. See [video and sharing guidance](COMMUNITY_VIDEO.md).

The Windows installer and native-materials kit remain withheld. No app runtime or architecture change is made by this documentation/media revision. Earlier developer-host and household test evidence applies to the earlier private candidate, not a new build. Signing remains optional.

## Installation time and antivirus alerts — update 4 October 2026

A tester reports that the privately supplied Windows candidate installed successfully, took almost 10 minutes, triggered several Avast alerts, and then appeared to run normally. Four supplied photos were subsequently reviewed. One shows Avast's **"Suspicious file detected"** message naming **`Nautex Community.exe`**, an active scan with about 60 seconds remaining, and a statement that the file was sent to Avast Threat Labs. This is an analysis-in-progress message: the photo shows neither a named malware detection nor a final safe/malicious verdict. Only this one alert is visible; the other reported alerts have not been identified.

The remaining photos show Nautex 0.3.14 at first-run setup, the About dialog with AGPL-3.0-only attribution, and a post-setup dashboard showing **AI not connected**, zero activity metrics and the optional provider/catalogue setup choices. This supports successful launch and entry into the local workspace; it is not a full database audit or completed clean-Windows qualification. The almost-10-minute duration remains user-reported, and the scan countdown does not measure the total delay. The OS build, prerequisite baseline, Avast version, affected file hash and final Threat Labs verdict remain unverified. The photos are retained privately; only this text summary is published.

The visible Avast scan and Threat Labs referral are consistent with the unfamiliar-file analysis described in Avast's [CyberCapture documentation](https://support.avast.com/en-ca/article/antivirus-cybercapture/). Such analysis can delay launch; these photos do not establish why Avast selected this file or how much of the reported installation time the checks consumed. The candidate is **unsigned** and bundles Electron/Node, PostgreSQL and other native runtime files, whose extraction and scanning can also take time. Separately, [Microsoft documents reputation warnings for new or unsigned applications](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation); no Microsoft SmartScreen warning is shown in these photos. No Avast false-positive determination or antivirus clearance is claimed; successful installation alone does not establish either.

Keep antivirus protection enabled. If a file is blocked or quarantined, leave it blocked pending review and record the detection name, affected filename, file SHA-256 and final antivirus verdict. Share screenshots only after removing personal paths, account details and private data. A matching release checksum establishes that a file matches the published artifact; it does not establish that the file is harmless. Signing may help establish publisher identity, but does not guarantee that antivirus alerts disappear.

The installer remains unavailable as a public release asset while native redistribution and outstanding installation checks remain unresolved. The original source.1 release remains unchanged; source.2 packages the updated documentation and media with new matching checksums.


Tag: `v0.3.14-source.2`. Repository: https://github.com/zpointai/nautex.

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
