# Windows installer preview — revision 7

The [Nautex AI Windows installer preview](https://github.com/zpointai/nautex/releases/tag/v0.3.14-windows-preview.7) is available for download. This is an unsigned evaluation prerelease, not a fully qualified stable Windows release. The installer targets Windows 11 x64 and includes the application, local PostgreSQL runtime and VC++ prerequisite installer.

## Verified evidence

- All 11 packaged-application acceptance groups passed on the developer host using isolated synthetic profiles. These cover first-run setup, empty records, local work without AI, PDF extraction, authorised-data import, encrypted provider settings, maps, restart, sign-out and sign-in with preserved records.
- Revision 7 fixes the desktop `/sign-in` route. A household user reports successful operation and sign-in/sign-out without issues after the fix.
- All 10,238 extracted installer files match the packaged payload; all 624 matching-source archive files match the exact tagged source tree. GitHub asset digests and sizes are verified before publication.
- Native redistribution review covers 29 component groups and 222 native file instances, including the generated uninstaller and repeated plugin copies. Required source, patches, recipes and notices accompany the installer. See [THIRD_PARTY.md](THIRD_PARTY.md).
- Earlier developer-host installer/uninstaller tests preserved synthetic profile data. Revision 7 installer/uninstaller automation was not rerun because an existing user installation was detected and preserved. Packaged-app testing used a separate profile.

## Remaining qualification

The household test used Windows 11 Pro 25H2, build 26200.9457, after an earlier Nautex installation. It does not establish a clean prerequisite baseline. Fresh supported Windows without developer tools, PostgreSQL or VC++ is still needed to qualify prerequisite installation, UAC outcomes and the complete first-launch/restart/uninstall/data-preservation lifecycle. Follow [CLEAN_WINDOWS_TEST.md](CLEAN_WINDOWS_TEST.md). Windows 10 compatibility is unqualified.

The installer is unsigned. Earlier user testing reported Avast analysis and a roughly ten-minute installation; a later revision 6 test reported under three minutes and no alerts. No blanket antivirus-clearance claim is made. Keep antivirus enabled. See [RELEASE_NOTES.md](RELEASE_NOTES.md).

Live-provider calls remain unqualified; no paid smoke tests were made. Users supply their own optional provider keys and authorised catalogue data. No owner credentials, private business records or IMPA catalogue content are included. User test screenshots remain private.

Exact installer source tag: `v0.3.14-windows-preview.7`. The source archive and dependency materials are separate assets for inspection and modification; only the EXE is needed to install. Earlier source-only releases and candidate tags are retained unchanged.
