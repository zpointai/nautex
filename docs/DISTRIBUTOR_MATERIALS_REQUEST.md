# Distributor materials request — draft, not sent

This request contains public vendor binary identifiers only. It has not been sent to EDB or another party.

Subject: Matching source/build and licence materials for PostgreSQL 16.14-2 Windows x64

Please provide the exact upstream revisions, local patches, build configuration/scripts and applicable copyright/licence notices for the following files in your PostgreSQL 16.14-2 Windows x64 distribution (archive SHA-256 `8a7f54c1968d5d49bdcd3f66b1291f736c74b8cb6a26e9874771fcc7837dbf38`). We need materials corresponding to these actual binaries, rather than older similarly named downloads.

| File | Reported version | SHA-256 |
| --- | --- | --- |
| resources/local-runtime/postgresql/bin/libiconv-2.dll | 1.15 | `3ee9786ab3eb8dfd791bdbd17c7e791dbe025734befcded0ee4170e1089f79df` |
| resources/local-runtime/postgresql/bin/libintl-9.dll | 0.19.8 | `1125ac8dc0c4f5c3ed4712e0d8ad29474099fcb55bb0e563a352ce9d03ef1d78` |
| resources/local-runtime/postgresql/bin/libwinpthread-1.dll | 1, 0, 0, 0 | `ffe2d56375bb4e8bdee9037df6befc5016ddd8871d0d85027314dd5792f8fdc9` |
| resources/local-runtime/postgresql/lib/plugin_debugger.dll | Not versioned in PE resources; exact revision UNKNOWN | `b1953a0ff3d49af3d25e03d049b533d2f312896e13a3332d5bf9b9ee181a2275` |
| resources/local-runtime/postgresql/lib/system_stats.dll | Not versioned in PE resources; exact revision UNKNOWN | `760b7c2690a1514d9aa7851ed5fd24fdba4e712e8010a75df25e28ac8d1d9062` |

For libwinpthread-1.dll, please identify the precise mingw-w64/winpthreads revision and required MIT/BSD copyright notices. The aggregate EDB notice labels pthreads LGPL-2.1; please clarify which implementation and grant apply to this actual file.

For plugin_debugger/system_stats, please identify the version/revision and exact redistribution licence for each supplied extension.

Your public modified-GPL page currently lists libiconv 1.14 and gettext 0.19.6/runtime 0.18.3.2. The actual files above report other versions. An account or these older downloads alone does not establish correspondence.

Please supply a stable source download or a precise source archive, patch set and build recipe mapping to the listed hashes. If a file is unmodified upstream, please identify the release/commit and complete build inputs.

Source page reviewed 4 October 2026: https://www.enterprisedb.com/modified-gpl

Alternative technical route: build compatible replacements in isolated staging from identified source/toolchain inputs, document the patches and complete notices, then compare exports/imports and run PostgreSQL startup, migration, locale/encoding and persistence checks before rebuilding the installer. No such replacement is claimed as completed.

This request covers the EDB components only. The other open items in [THIRD_PARTY.md](THIRD_PARTY.md) remain separate.
