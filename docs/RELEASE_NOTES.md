# Nautex AI 0.3.14 — Windows preview, revision 7

## Download and install

**[Download the Windows installer](https://github.com/zpointai/nautex/releases/download/v0.3.14-windows-preview.7/Nautex-AI-Setup-0.3.14-x64.exe)** — this is the only file needed to install Nautex AI.

Intended target: Windows 11 x64. Run the EXE and follow the installer. It includes the local application, PostgreSQL and the Microsoft Visual C++ prerequisite installer; administrator consent may be needed for that prerequisite. You do not need Node.js, Docker or a separate PostgreSQL installation. Allow at least 4 GB free disk and 4 GB RAM for evaluation. Windows 10 compatibility is unqualified.

At first launch, create your workspace and administrator. You can skip AI setup and catalogue import and work locally. Configure your own provider keys only if you want AI features; provider usage is billed separately. No owner API keys, private business records or IMPA catalogue data are supplied. Import only catalogue data you are authorised to use. See the repository's PROVIDERS.md and MODULE_REQUIREMENTS.md under docs.

Close Nautex before updating an existing public-release installation. Keep its installation location and data. Public-release profiles remain in `%APPDATA%\Nautex Community`; this legacy internal folder name is retained to preserve data. The application name is Nautex AI. Do not delete application data to apply this update.

## Verification and limitations

This is a **prerelease for evaluation**, not a fully qualified stable Windows release. Revision 7 fixes the sign-out route failure. All 11 isolated developer-host packaged-app checks passed, including setup, empty records, local operation without AI, catalogue import, sign-out, restart and sign-in with preserved synthetic records. All 10,238 extracted installer files match the packaged payload. A household user reports revision 7 works and sign-in/sign-out have no issues. The preceding revision installed in under three minutes without Avast alerts in that user's reported test.

The household computer had a previous Nautex installation. A fresh Windows environment without developer tools, PostgreSQL or VC++ has **not** been qualified. Prerequisite/UAC outcomes and lifecycle/data-preservation checks on that clean baseline remain pending. Revision 7 installer/uninstaller automation was not rerun on the developer PC because an existing user installation was detected and preserved; earlier revision 6 installation/uninstall checks are historical evidence. Live AI-provider calls have not been qualified.

## Unsigned installer and antivirus

The installer is **unsigned**. Windows or antivirus software may show a warning or spend time analysing an unfamiliar executable. An earlier candidate prompted Avast's “Suspicious file detected” scan and Threat Labs submission and reportedly took about ten minutes; the supplied photo showed analysis in progress, not a final malware verdict. Later user testing reported no Avast alerts. These observations do not establish a general antivirus-clearance or false-positive verdict. Extraction and scanning of bundled runtime files can also delay installation. Keep protection enabled. If a file is blocked, record its detection name and SHA-256 and report it; do not disable antivirus to proceed. A matching checksum establishes file identity, not safety.

## Licence and corresponding materials

Nautex application source is **AGPL-3.0-only**. Dependencies retain their own licences. This release includes matching application source, third-party notices, individually classified native binaries, source/build inventories and dependency materials. Native redistribution review is complete for this packaged candidate; exact upstream binary reproducibility is not claimed. Only source, not the private development repository or its history, is published.

The exact source snapshot is tag `v0.3.14-windows-preview.7`, commit `9d613442c8db72d30588e675c388b4feb434ad63`. The build originally used commit `6cabab85a026b2721c44bcfee66ca840b9c41c24`; `SOURCE_PROVENANCE.json` verifies that every source-archive file matches the published tag's identical source tree. Documentation inside the build-time source archive may describe the then-pending publication; these release notes and the current repository README state the current distribution status.

Developers rebuilding dependencies also need `Nautex-Native-Materials-0.3.14-community.1.zip` and all three `Chromium-150.0.7871.47-source-only.tar.gz.partNN` files. Their historical filenames are retained to preserve hashes. Download them beside `Join-Chromium-Source.ps1`, verify SHA256SUMS.txt, then run that script to join the Chromium source archive. Recipes, patches, licences and replacement instructions are supplied in the materials and tagged source's docs/DEPENDENCY_BUILD.md. These multi-gigabyte materials are **not needed to install or run Nautex**.

Installer SHA-256: `efea18069a1a3eb4f38c381f067392bcbb84e820f60af2f211043fa8aad569c7`.

For problems, use [GitHub Issues](https://github.com/zpointai/nautex/issues). Remove personal information, credentials and business data before sharing logs or screenshots. User test screenshots and private announcement notes are not included.
