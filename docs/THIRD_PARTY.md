# Third-party redistribution materials

Nautex application code is AGPL-3.0-only. Each bundled dependency retains its own
licence. The final release supplies its application source, third-party notices,
component inventory, corresponding dependency materials and SHA-256 checksums.
The [Windows preview release](https://github.com/zpointai/nautex/releases/tag/v0.3.14-windows-preview.7) supplies these materials. Clean-Windows qualification remains incomplete and is disclosed separately from the completed redistribution review.

## Inventory and evidence

- [Component versions, provenance, licences and requirements](../third-party/native-components.json).
- [Source/build material hashes and origins](../third-party/native-materials.json).
- [Sharp/libvips static components](../third-party/sharp-components.json).
- [Rust source and notice inventory](../third-party/rust-notices/INVENTORY.json).
- [Installer helper review](INSTALLER_HELPER_REVIEW.md).

The final NATIVE_BINARIES.json is supplied beside the installer, rather than
embedded in that same installer (which would create a circular checksum).
Every retained PE/WebAssembly file is classified and hashed. Unchanged vendor
binary evidence is reused; new files and replacements receive new validation.

## Required material delivery

GNU replacements include exact source releases, recipes, import/export evidence
and compiler/runtime notices. LGPL libraries remain replaceable outside ASAR.
Sharp includes the identified MXE/libvips recipes, patches, all recorded component
source archives and librsvg's complete locked Rust vendor superset. The Cairo
1.18.4 source grant is LGPL-2.1 OR MPL-1.1; the LGPL alternative is used despite
the downstream package table's differing MPL-2.0 label. No original container
image digest or independently reproduced libvips build is claimed.

Prisma includes exact engine commit c2990dca591cba766e3b7ef5d9e8a84796e47ab7,
Cargo.lock, all 607 vendored packages and notices. Librsvg includes 350 vendored
packages; the MXE patches remove optional packages from that superset without
introducing different versions. MPL-2.0 is selected for priority-queue. Original
crate sources and copyright headers are preserved. Standard licence texts
supplement explicit upstream SPDX declarations where no standalone notice was
supplied; no copyright holder or year is invented.

Electron 43.1.0 identifies Chromium 150.0.7871.47 and Node 24.18.0. Source,
patches, build files and the full upstream notice collection are retained.
Chromium's Windows FFmpeg configuration disables GPL, GPLv3 and nonfree flags.
The complete Chromium source archive was checked against its publisher's SHA-256.
The distributed source tree removes prebuilt compiler/toolchain executables,
objects and compiled test fixtures; all source-code/build files remain available.
The filter manifest records each omission. Standard developer tools are obtained
through the upstream build hooks, not redistributed as unexplained binaries.

Large Chromium source materials may be split into numbered parts for hosting.
Join them in the documented order and verify the complete archive checksum.
Only the EXE is needed to install Nautex; source materials are separate downloads
for inspection and modification. See [dependency build/replacement instructions](DEPENDENCY_BUILD.md).

Microsoft's unmodified signed VC++ prerequisite installer retains its own terms.
No Microsoft shader DLL is bundled: Windows 11's system D3DCompiler is used, while
Nautex's unused DXC/validator copies are omitted. Native Windows shortcut APIs
replace WinShell. The Elevate helper, unused Canvas/Skia and unused EDB additions
are also absent.

Copyright notices and licence terms are included in Help → Corresponding source
and licences. Users may modify/rebuild the covered components and replace their
DLLs; this release imposes no additional restriction on debugging those changes.
Independent exact-binary reproducibility and clean-machine qualification are
reported separately from the actual source/notice delivery obligations.
