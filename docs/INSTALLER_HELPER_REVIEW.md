# Installer helper review — revision 5

| Component | Evidence and delivery |
| --- | --- |
| NSIS core, System, nsDialogs, nsExec | Pinned NSIS 3.04 distributor bundle; original zlib/libpng notices retained. Deflate outer stub. |
| StdUtils 1.14 | Exact author-release Unicode DLL hash; all 51 project references present. Matching source/project/import libraries, LGPL text, installer clarification and RHash/BLAKE2 notices supplied. Optional Date.exe/Zip.exe packaging tools omitted from the source kit. |
| Nsis7z 19.00 | Exact official Unicode DLL hash; wrapper sources plus the matching LZMA SDK 19.00 and VS2017 project supplied. The obsolete noncompiled ClInclude entry is documented. Wrapper LGPL statement is separate from SDK public-domain terms. |
| UAC 0.2.4c | Exact official Unicode DLL hash and explicit zlib/libpng grant; full notice included. |
| Elevate | Excluded. This release has no automatic-update feed; updates use the full installer. Reassess before enabling an update feed. |
| WinShell | Excluded. Original Nautex macros call Windows COM through the cleared NSIS System plugin. AppUserModelID, jump-list cleanup and shortcut unpin operations retain the existing behavior. |

The NSIS template preparation script checks the two modified upstream template
hashes and replaces exactly ten WinShell calls. It copies templates into release
staging without modifying installed npm sources. The full modified templates,
script and applicable electron-builder MIT notice accompany the material kit.
A probe compiled with the actual pinned NSIS compiler created a real shortcut
and verified its AppUserModelID through Windows Shell COM.

See `third-party/installer-evidence/PLUGIN_CORRESPONDENCE.json` for unchanged
plugin hashes and the release's final per-file inventory for the final installer.
Independent byte-for-byte rebuilds are not asserted for unchanged vendor plugins.
The required matching source and notices are supplied; the original optional
source-packaging utilities are not part of the build needed to modify the DLL.

References:
- https://github.com/lordmulder/stdutils/releases/tag/1.14
- https://nsis.sourceforge.io/StdUtils_plug-in
- https://nsis.sourceforge.io/Nsis7z_plug-in
- https://nsis.sourceforge.io/UAC_plug-in
- https://nsis.sourceforge.io/WinShell_plug-in
- https://www.electron.build/nsis/
