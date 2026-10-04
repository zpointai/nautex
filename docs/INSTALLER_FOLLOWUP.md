# Installer follow-up — 4 October 2026

The Windows EXE already builds and has passed the documented developer-host tests. A clean Windows environment is required for qualification, not for compiling an EXE. Windows Sandbox is one possible fresh-environment test; a separate Windows 11 x64 VM or clean test PC is also suitable. Uninstalling the private app from the developer PC does not remove that PC's existing prerequisites and is not a clean-machine test.

## Progress after the source-only release

- Reviewed NSIS 3.04's retained COPYING and the [official licence](https://nsis.sourceforge.io/License). System, nsDialogs and nsExec are individually byte-matched to the pinned NSIS distribution. Their zlib/libpng terms do not impose source delivery or an independent rebuild. Their inventory status now records the verified notice requirement; the unknown distributor patch revision remains an explicit provenance limitation. This does not clear unrelated plugins or the whole installer.
- Obtained the actual **LZMA SDK 19.00** required by the official Nsis7z 19.00 build instructions. The earlier `7z1900-src.7z` is a different source package. The SDK SHA-256 is `00f569e624b3d9ed89cf8d40136662c4c5207eaceb92a70b1044c77f84234bad`; origin: https://www.7-zip.org/a/lzma1900.7z. The material manifest now identifies 54 archives/files.
- Checked all 359 explicit Nsis7z project source/header entries against the official plugin plus SDK trees: 358 resolve. The remaining `CPP/7zip/IMyUnknown.h` entry is a project `ClInclude` entry; no corresponding C/C++ include reference was found in these trees. This is not an independently reproduced build. The project specifies Visual Studio 2017 v141, Windows SDK 10.0.17763.0 and Release Unicode / Win32 for the actual x86 Unicode installer plugin.
- Retained the plugin wrapper's LGPL statement from its supplied documentation separately from the SDK's public-domain notice. The author does not specify an LGPL version in that statement. Source/build qualification remains partial; no blanket public-domain claim is made for the wrapper.

## What still blocks installer publication

The [remaining component requirements](THIRD_PARTY.md) include exact EDB GNU library build/source correspondence, winpthreads provenance/attribution, static dependency source and notice coverage, vendor-specific terms, and remaining installer helpers. No compiler suitable for the missing native builds was available. A successful app launch cannot settle these redistribution requirements.

The host still has no Windows Sandbox, Hyper-V management access is denied and Docker's Linux engine is unavailable. Enabling Sandbox is an optional host administration step, not an application prerequisite. A fresh test must first verify that PostgreSQL, developer tools and the required VC++ runtime are absent; otherwise it does not qualify prerequisite installation. Use the [full test checklist](CLEAN_WINDOWS_TEST.md). Sandbox testing alone must not be described as proof of standard-user elevation or reboot/data-preservation paths that were not actually exercised.

The existing installer and earlier materials kit remain private historical candidates. These documentation/material changes do not make them match the new source tree. Before binary publication, regenerate the complete matching installer, corresponding source, material kit, notices, inventories and checksums, then qualify that exact installer. The published `v0.3.14-source.1` tag and its assets remain unchanged.

## Sanitisation scope

The published release was built from an explicit public file allowlist and fresh public history. Prior source and packaged-payload scans found no unresolved owner-secret findings, and isolated first-launch tests confirmed empty business records and catalogue tables. Private operational profiles, databases, exports and historical screenshots were excluded. The original installation and credentials were not deleted or revoked. The copyright/author name is deliberately retained as public attribution; this is distinct from private personal records. No scan is a mathematical guarantee, and unchanged files are not being repeatedly rescanned without a reason.

## Follow-up publication decision

The NSIS generated installer core/Deflate stub is now also recorded as having verified permissive notice requirements. An independent rebuild is not a zlib/libpng source-delivery condition. This does not clear its embedded plugin DLLs or the application payload. The prior permissive core-plugin corrections and the correct Nsis7z LZMA SDK material are included in the current source snapshot.

The EDB source page was rechecked: it offers differently versioned libiconv/gettext downloads, so no missing correspondence was inferred. A [precise distributor materials request](DISTRIBUTOR_MATERIALS_REQUEST.md) records the actual file hashes and requested evidence; it is a draft and has not been sent. The installer remains blocked by these and the other listed native requirements. No missing licence/source evidence has been replaced by an assertion of safety or by the successful household-PC launch.

The Community overview video and updated source/documentation can be published independently. The video links to the repository and explicitly states that the Windows installer is pending. Source tag `v0.3.14-source.2` records this documentation/media update; no binary build is attributed to that tag.
