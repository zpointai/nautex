# Nautex AI 0.3.14 — Windows candidate revision 7

Revision 7 fixes desktop sign-out: `/sign-in` loads the packaged interface, which displays the existing sign-in form after the session is removed. The regression test also checks restart while signed out, signing back in and preservation of synthetic records. Missing or forbidden asset paths retain their existing handling.

Revision 6 restored the visible name **Nautex AI** in the installer, executable, Start menu and About dialog. Existing internal profile/registration identifiers are retained. Private announcement notes are excluded from its corresponding source.

This candidate preserves the local Electron/PostgreSQL architecture and empty first-run
workspace. It replaces the unclear WinShell helper with original COM macros, uses the
Windows system shader compiler, removes unused shader/compiler copies, and completes
the dependency material set. GNU runtime replacements and the removal of unused Canvas,
EDB extensions and Elevate remain in place. User-owned provider configuration and
authorised catalogue import remain available; owner credentials and catalogue data
are excluded.

The public source release remains `v0.3.14-source.2`. The new installer is a private test
candidate pending the user's clean Windows 11 x64 checklist. Developer-host test evidence
and hashes accompany the candidate. An eventual public installer will receive a new tag
at its exact source commit and the complete source/material/checksum set. No earlier tag
will be moved. The installer is unsigned; signing remains optional.

## Installation time and antivirus alerts — update 4 October 2026

A tester reports that the privately supplied Windows candidate installed successfully, took almost 10 minutes, triggered several Avast alerts, and then appeared to run normally. Four supplied photos were subsequently reviewed. One shows Avast's **"Suspicious file detected"** message naming **`Nautex Community.exe`**, an active scan with about 60 seconds remaining, and a statement that the file was sent to Avast Threat Labs. This is an analysis-in-progress message: the photo shows neither a named malware detection nor a final safe/malicious verdict. Only this one alert is visible; the other reported alerts have not been identified.

The remaining photos show Nautex 0.3.14 at first-run setup, the About dialog with AGPL-3.0-only attribution, and a post-setup dashboard showing **AI not connected**, zero activity metrics and the optional provider/catalogue setup choices. This supports successful launch and entry into the local workspace; it is not a full database audit or completed clean-Windows qualification. The almost-10-minute duration remains user-reported, and the scan countdown does not measure the total delay. The OS build, prerequisite baseline, Avast version, affected file hash and final Threat Labs verdict remain unverified. The photos are retained privately; only this text summary is published.

The visible Avast scan and Threat Labs referral are consistent with the unfamiliar-file analysis described in Avast's [CyberCapture documentation](https://support.avast.com/en-ca/article/antivirus-cybercapture/). Such analysis can delay launch; these photos do not establish why Avast selected this file or how much of the reported installation time the checks consumed. The candidate is **unsigned** and bundles Electron/Node, PostgreSQL and other native runtime files, whose extraction and scanning can also take time. Separately, [Microsoft documents reputation warnings for new or unsigned applications](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation); no Microsoft SmartScreen warning is shown in these photos. No Avast false-positive determination or antivirus clearance is claimed; successful installation alone does not establish either.

Keep antivirus protection enabled. If a file is blocked or quarantined, leave it blocked pending review and record the detection name, affected filename, file SHA-256 and final antivirus verdict. Share screenshots only after removing personal paths, account details and private data. A matching release checksum establishes that a file matches the published artifact; it does not establish that the file is harmless. Signing may help establish publisher identity, but does not guarantee that antivirus alerts disappear.


See RELEASE_STATUS.md, THIRD_PARTY.md, PROVIDERS.md and MODULE_REQUIREMENTS.md for evidence and limits.
