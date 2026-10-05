#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C
# Run from the isolated MSYS2 MINGW64 shell. Arguments must be absolute POSIX paths.
# Usage: bash scripts/build-gnu-runtime.sh /path/to/build /path/to/source-archives
ROOT="${1:?Pass an isolated build directory}"
SOURCES="${2:?Pass the source archive directory}"
[[ "$ROOT" = /* && "$SOURCES" = /* && "$ROOT" != / ]] || { echo 'Absolute isolated directories required' >&2; exit 1; }
[[ "${MSYSTEM:-}" = MINGW64 ]] || { echo 'Use an MSYS2 MINGW64 shell' >&2; exit 1; }
(cd "$SOURCES" && printf '%s\n' \
  'ccf536620a45458d26ba83887a983b96827001e92a13847b45e4925cc8913178  libiconv-1.15.tar.gz' \
  '3da4f6bd79685648ecf46dab51d66fcdddc156f41ed07e580a696a38ac61d48f  gettext-0.19.8.tar.gz' | sha256sum -c -)
INSTALL_PREFIX=/nautex-native
DEST="$ROOT/staged"
PREFIX="$DEST$INSTALL_PREFIX"
export MSYS2_ARG_CONV_EXCL="-DLOCALEDIR=;-DLOCALE_ALIAS_PATH=;-DLIBDIR=;-DINSTALLPREFIX="
mkdir -p "$ROOT/work" "$PREFIX" "$ROOT/logs"
pacman -Q > "$ROOT/logs/toolchain-packages.txt"
gcc --version > "$ROOT/logs/gcc-version.txt"
gcc -dumpmachine >> "$ROOT/logs/gcc-version.txt"
sha256sum "$SOURCES/libiconv-1.15.tar.gz" "$SOURCES/gettext-0.19.8.tar.gz" > "$ROOT/logs/source-inputs.sha256"
if [ ! -d "$ROOT/work/libiconv-1.15" ]; then tar xf "$SOURCES/libiconv-1.15.tar.gz" -C "$ROOT/work"; fi
if [ ! -d "$ROOT/work/gettext-0.19.8" ]; then tar xf "$SOURCES/gettext-0.19.8.tar.gz" -C "$ROOT/work"; fi
export PATH="$PREFIX/bin:$PATH"
export CFLAGS='-O2 -std=gnu11'
export LDFLAGS='-static-libgcc'
mkdir -p "$ROOT/work/build-iconv-neutral" "$ROOT/work/build-intl-neutral"
cd "$ROOT/work/build-iconv-neutral"
"$ROOT/work/libiconv-1.15/configure" --host=x86_64-w64-mingw32 --prefix="$INSTALL_PREFIX" --disable-static --enable-shared --disable-nls > "$ROOT/logs/iconv-configure.log" 2>&1
make clean > "$ROOT/logs/iconv-clean.log" 2>&1
make -j4 > "$ROOT/logs/iconv-build.log" 2>&1
make DESTDIR="$DEST" install > "$ROOT/logs/iconv-install.log" 2>&1
echo 'libiconv built and installed into isolated prefix'
cd "$ROOT/work/build-intl-neutral"
"$ROOT/work/gettext-0.19.8/gettext-runtime/configure" --host=x86_64-w64-mingw32 --prefix="$INSTALL_PREFIX" --disable-static --enable-shared --disable-java --disable-csharp --disable-openmp --disable-curses --enable-threads=windows --with-libiconv-prefix="$PREFIX" > "$ROOT/logs/intl-configure.log" 2>&1
make -C intl clean > "$ROOT/logs/intl-clean.log" 2>&1
make -C intl -j4 > "$ROOT/logs/intl-build.log" 2>&1
make -C intl DESTDIR="$DEST" install > "$ROOT/logs/intl-install.log" 2>&1
echo 'libintl built and installed into isolated prefix'
find "$PREFIX" -maxdepth 2 -type f -name '*.dll' -exec sha256sum '{}' \; > "$ROOT/logs/output-dlls.sha256"
(cd "$PREFIX/bin" && sha256sum libiconv-2.dll libintl-9.dll > SHA256SUMS.txt)
