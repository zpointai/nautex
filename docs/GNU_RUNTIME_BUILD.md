# Source-built PostgreSQL library replacements

This candidate replaces EDB's libiconv/libintl binaries with DLLs compiled from
unmodified GNU libiconv 1.15 and gettext 0.19.8 sources. PostgreSQL remains 16.14;
the database engine, local profile format and application architecture are unchanged.
The installer as a whole is **not yet cleared for publication**.

The two libraries are LGPL-2.1-or-later. Their full source archives, licence texts,
this build script, the selected toolchain versions and the DLL hashes must accompany
the eventual binary release. Keep the DLLs replaceable outside ASAR. MinGW runtime
notices and the GCC runtime exception are retained under
`third-party/replacements/gnu/notices`. No owner credentials or catalogue data are
build inputs.

## Build in an isolated MSYS2 MINGW64 environment

The tested portable MSYS2 base was `msys2-base-x86_64-20260927.tar.xz`, SHA-256
`ea2f31a0b6ade63914ce441ffb022f0f6aa96982bfefa2326460a26d5fb01322`, obtained from
the [official release](https://github.com/msys2/msys2-installer/releases/tag/2026-09-27).
Use an isolated extraction; a global compiler or PATH change is unnecessary.

Install `mingw-w64-x86_64-gcc`, `make`, `patch` and `diffutils` there. The tested GCC
package was 16.2.0-4 targeting x86_64-w64-mingw32. The complete package version record
is `third-party/replacements/gnu/toolchain-packages.txt`; extra Rust/NSIS packages
in that record are not required by these two library builds.

Obtain [libiconv 1.15](https://ftp.gnu.org/pub/gnu/libiconv/libiconv-1.15.tar.gz)
and [gettext 0.19.8](https://ftp.gnu.org/pub/gnu/gettext/gettext-0.19.8.tar.gz).
The script verifies their SHA-256 hashes before extraction. From MINGW64, run:

```sh
bash scripts/build-gnu-runtime.sh /c/nautex-build /c/nautex-sources
```

Use fresh directories dedicated to this build. Source archives are not modified.
The configure prefix is `/nautex-native`; installation is redirected with DESTDIR
inside the supplied build directory. The binaries do not embed the operator's
Windows profile path. The gettext build selects native Windows threading, so
winpthreads is not needed. Only `libiconv-2.dll` and `libintl-9.dll` enter PostgreSQL;
the test utility and libcharset DLL are not shipped.

The script writes the DLLs and `SHA256SUMS.txt` to
`<build>/staged/nautex-native/bin`. In PowerShell, set the corresponding absolute
Windows path before preparing PostgreSQL or building the release:

```powershell
$env:NAUTEX_GNU_RUNTIME = 'C:\nautex-build\staged\nautex-native\bin'
npm run desktop:postgres:prepare
```

The staging script verifies checksums, x64 architecture and permitted imports. It
removes the unused EDB debugger/system-stats extensions and winpthreads, then checks
that retained modules do not import those files. A local checksum file is an integrity
check, not an upstream signature. The final release inventory must pin the actual
distributed output hashes. Bit-for-bit reproducibility is not claimed.

## Verification completed

- All 53 existing PostgreSQL consumer/import sets match the replacement exports.
- No new redistributable DLL or winpthreads dependency was introduced.
- An isolated profile passed UTF-8 initialization, loopback startup, multilingual
  insert/read, pg_trgm, backup, restore, restart/persistence and Windows-1252 conversion.
- Replacement DLL strings contain no build operator's profile path.

The evidence is retained in `third-party/replacements/gnu/GNU_ABI_VERIFICATION.json`
and `POSTGRES_REPLACEMENT_TEST.json`. These are **developer-host** tests; they do not
establish clean-Windows prerequisite installation or final-installer qualification.
