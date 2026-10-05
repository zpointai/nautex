# Installer follow-up — revision 5

The current candidate replaces or excludes the disputed helper/runtime binaries
and supplies the reviewed source/notices described in THIRD_PARTY.md. Historical
candidate-2/3/4 reports are superseded by the exact final release inventory.

Compilation and developer-host tests are separate from clean-machine testing.
A fresh supported Windows 11 x64 VM or test PC is still required to qualify the
missing-VC++ installation path, reboot and default-profile lifecycle. Sandbox is
one option; it need not be enabled on the owner's private PC. Follow
CLEAN_WINDOWS_TEST.md with the final checksummed candidate. Signing is optional.

Private photos show an earlier candidate starting and an Avast scan in progress;
those photos are retained privately. They establish neither a final antivirus
verdict nor the full fresh-Windows lifecycle. The release notes disclose the
observed delay and the unsigned status without claiming antivirus clearance.
