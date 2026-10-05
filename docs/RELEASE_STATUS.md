# Windows candidate status — revision 7

The public release remains source-only (`v0.3.14-source.2`). This isolated candidate
replaces WinShell with original NSIS/Windows COM macros, omits three disputed shader
DLL copies, and supplies the matching dependency source/build/notices material set.
The local review artifacts must be kept together; no installer download is published yet.

## Evidence and remaining qualification

GNU replacements passed 53 consumer ABI checks and PostgreSQL Unicode backup/restore.
The preceding revision passed ten installed-app acceptance groups and preserved its
synthetic profile during uninstall on the developer host. Revision 5 graphics tests
passed WebGL shader compilation/rendering and Canvas2D using Windows' own D3DCompiler;
the shortcut probe retained the application identity using the replacement COM macros.
Final revision 5 installer acceptance results are supplied beside the installer in
INSTALLED_ACCEPTANCE.json and GRAPHICS.json. These are developer-host tests.

The native material set includes component origins, versions, hashes, applicable
notices, build instructions and source archives. Excluded components are rejected by
the native audit. The final per-file NATIVE_BINARIES.json is a separate release asset,
avoiding a circular hash between the installer and its embedded source. See THIRD_PARTY.md.

The user will perform the clean Windows 11 x64 test in CLEAN_WINDOWS_TEST.md. Prerequisite
installation without existing VC++, UAC denial/success, first launch, offline local use,
restart and uninstall/data preservation remain pending on that machine. This developer
host cannot establish those results. Cross-version upgrade is also unqualified.

Live-provider calls remain untested: USD 0.00 spent of the USD 0.05 authorised budget;
dedicated credentials and billing/entitlement preflight are still needed. Signing is
optional; this candidate is unsigned. User-provided photos show an Avast scan in progress,
successful setup and an empty dashboard on an earlier candidate; they establish neither
an antivirus verdict nor qualification of revision 5. See RELEASE_NOTES.md.

The private installation, credentials, catalogue and business records are not build inputs.
Only allowlisted sanitised application source enters the corresponding-source archive.

Revision 6 changes visible branding to Nautex AI and removes private announcement notes from corresponding source. Native dependencies and architecture are unchanged from revision 5. Existing native evidence is retained; final packaging, branding, source correspondence and installed-app checks accompany the new artifact.

On 5 October, a household tester reported installation under three minutes and no Avast alerts on Windows 11 25H2, build 26200.9457. An earlier Nautex version had been uninstalled first, so missing-prerequisite qualification is not established. The tester found a sign-out route error in revision 6. Revision 7 maps the desktop sign-in route to its entry point and adds an installed regression test. Final revision 7 results are supplied with its installer.
