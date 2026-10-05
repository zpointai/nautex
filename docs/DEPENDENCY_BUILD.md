# Dependency source, rebuild and replacement instructions

Use a separate build directory. Do not build or test against a private Nautex
installation or profile. The material manifest records input versions, origins
and SHA-256 values. The application source archive supplies its lockfiles and
scripts. Public source history starts with the sanitised snapshot.

## GNU runtime

Follow GNU_RUNTIME_BUILD.md. The tested DLL recipe is scripts/build-gnu-runtime.sh.
Set NAUTEX_GNU_RUNTIME to the resulting bin directory before preparing PostgreSQL.
The preparation script verifies the DLL hashes and imports before packaging.

## Sharp/libvips

Extract the tagged build-win64-mxe and MXE recipe snapshots plus the 28 component
sources listed in sharp-components.json. Preserve the downstream build/patches
files. Use the upstream build.sh --without-prebuilt route and the x86_64 Windows
vips-web target; `build.sh --help` describes toolchain/container requirements.
The material set includes the source archives and patches from both the Windows
MXE and Sharp recipes. AOM 3.14.1 is the Windows input, not the POSIX AOM release.
The librsvg Cargo vendor set includes the original lockfile superset; the MXE
patches remove optional image formats from it. The original moving container
image digest is unknown; its independent reproduction is not claimed. Build
instructions and preferred sources are supplied to permit modification.

After rebuilding, replace libvips-42.dll and its matching C++ wrapper in the
packaged @img/sharp-win32-x64/lib directories, keeping the documented DLL names
and ABI. Run scripts/test-native-runtime.mjs against the prepared backend, then
real PDF/image workflows. Keep the source and notices with redistributed changes.

## Prisma and Rust source

Extract the exact engine source commit. The upstream rust-toolchain.toml selects
Rust 1.90.0. For Windows engines use the x86_64-pc-windows-msvc toolchain and Visual
Studio C++/Windows SDK prerequisites described in the upstream source README.
Build query-engine-node-api and schema-engine-cli with Cargo release settings.
The material set contains unmodified source, Cargo.lock and all vendored crates.
For offline crate resolution, copy the corresponding vendor directory into the
source root and copy its config.toml to .cargo/config.toml. Build tools and SDKs
are separate prerequisites; an offline developer-tool installation is not supplied.
The vendor sources are a conservative superset including dev/non-Windows crates.

## Electron/Chromium

Extract the Chromium source parts and Node source, then use the exact Electron
43.1.0 source and its DEPS/patches and Windows build documentation. Apply Electron's
recorded Chromium/Node patches through its upstream build tooling. Use the exact
Chromium 150.0.7871.47 source; retain the Chrome/win/x64 FFmpeg configuration.
The source filter removes prebuilt tools and compiled fixtures, not preferred
source. Run upstream sync/build hooks to obtain platform compilers and SDK tools.
Rebuild Electron/FFmpeg when modifying statically linked covered components.
The normal Nautex packaging script uses the locked official Electron release;
its afterPack hook removes three pinned Microsoft shader DLL copies, and fails
if a future dependency update changes those input hashes.

## Installer plugins

StdUtils: use the supplied original solution/project with Visual Studio 2010,
Release_Unicode / Win32. The source kit omits optional Date.exe/Zip.exe packaging
tools and supplies direct build instructions. Nsis7z: extract SDK 19.00 C and CPP
trees into Contrib/nsis7z as its upstream docs instruct; build the supplied
VS2017 v141 solution for Release Unicode / Win32 with Windows SDK 10.0.17763.0.
Its obsolete CPP/7zip/IMyUnknown.h project entry is unused, not a compiled source.

The full installer scripts/templates are supplied. Run
`node scripts/build-community-installer.cjs` to build the installer; it prepares
modified templates in isolated staging and replaces WinShell calls with the
original macros in scripts/community-shortcuts.nsh. Its version-pinned wrapper keeps the normal two-pass uninstaller build and does not modify node_modules. No private workspace is used.
The standalone Windows test remains a separate qualification step.
