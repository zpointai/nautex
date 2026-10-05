# Native release candidate — revision 5

This private candidate supersedes revisions 2–4. Final Windows qualification is
pending the user's test on a fresh supported Windows 11 x64 environment.

- GNU libiconv 1.15 and gettext 0.19.8 were rebuilt from identified source with
  supplied recipes and compiler/runtime notices. Unicode, backup/restore,
  PostgreSQL restart and exported/imported ABI tests passed.
- Unused winpthreads and EDB debugger/system-stats extensions were excluded.
- Unused native Canvas/Skia was excluded. PDF text extraction uses the MIT
  DOMMatrix implementation and passes real PDF upload tests.
- WinShell and the unused Elevate helper were excluded. Native Windows shortcut
  operations use NSIS System; a real shortcut-property probe passed.
- Bundled D3DCompiler_47, dxcompiler and dxil were excluded. Windows 11 supplies
  the system D3DCompiler used by ANGLE. Direct3D11 hardware acceleration,
  shader compilation and exact pixel output passed without those bundled DLLs.
  Nautex does not use WebGPU. No global hardware-acceleration disable was added.
- StdUtils, Nsis7z and UAC provenance was matched to official author binaries.
  Matching covered source and required notices accompany the material kit.
- Sharp/MXE source versions, downstream patches and the complete librsvg Rust
  vendor superset are supplied. The original moving build-image digest is not
  claimed; an independent reproduction of that image is not a licence condition.
- Prisma's exact engine source, locked Rust vendor superset and notice inventory
  are supplied. The engine's embedded Rust revision matches Rust 1.90.0.
- Exact Electron/Node source, Electron patches and the complete Chromium source
  tree are supplied. The Chromium material omits prebuilt host toolchains and
  compiled test fixtures; upstream hooks obtain developer tools separately.

All developer-host checks use isolated synthetic profiles. These results do not
qualify missing-prerequisite installation, clean Windows graphics, reboot or
standard-user elevation. Follow [the clean Windows checklist](CLEAN_WINDOWS_TEST.md)
on the exact checksummed final candidate. Signing remains optional and the
candidate is unsigned. The private installation, credentials and data are untouched.
