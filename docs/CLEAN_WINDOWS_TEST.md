# Clean Windows installer qualification — pending

No clean VM was accessible. Windows Sandbox is absent. Hyper-V is present, but `Get-VM` denies this account VM-management permission. Only Docker Desktop's WSL distribution is registered and its engine is stopped; it is not a clean Windows environment. No host features, permissions, prerequisites or private installation were changed to work around this.

Use a fresh, supported Windows 11 x64 VM from an official Microsoft image, with administrator credentials available for the prerequisite. Keep UAC, Defender and SmartScreen enabled. Do not remove prerequisites from the owner's PC. Record OS edition/build, VM snapshot, date and final installer SHA-256. Windows 10 compatibility and cross-version upgrade are separate pending checks.

1. Allocate 4 vCPUs, 8 GB RAM and 40 GB free disk; install/update Windows and snapshot it as `Before Nautex`. Do not install developer tools, Node, npm, Docker, PostgreSQL or VC++. Copy only the final Setup EXE, checksum file and checklist into the VM.
2. Capture the baseline using built-in PowerShell:

   ```powershell
   Get-Command node,npm,docker,psql,postgres -ErrorAction SilentlyContinue
   Get-Service -Name '*postgres*' -ErrorAction SilentlyContinue
   $h=[Microsoft.Win32.RegistryKey]::OpenBaseKey('LocalMachine','Registry64')
   $h.OpenSubKey('SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')
   Test-Path "$env:APPDATA\Nautex Community"
   Get-FileHash .\Nautex-AI-Setup-0.3.14-x64.exe -Algorithm SHA256
   ```

   Expect no matching commands/services, no installed x64 VC++ key, no Community profile, and the exact final checksum. If VC++ is already present, use another fresh image; this does not qualify the missing-prerequisite path.
3. Run Setup interactively. Record unsigned/SmartScreen warnings and follow organisational policy without disabling protections. If policy blocks the EXE, record that result. Check licence and separate Community destination. Missing VC++ must trigger administrator consent for a valid **Microsoft**-signed prerequisite; approve and record exit/reboot behaviour. Reboot if requested. Separately restore the snapshot and deny/cancel UAC once: Setup must report incomplete installation. Then restore and perform the successful path again.
4. Recheck the 64-bit registry key: `Installed=1`, version at least `v14.50.35719.0`. No separate developer/database installation should be required. Open Nautex Community from the Start menu.
5. Create `Fictional Clean VM Workspace`, administrator `Synthetic Tester`, email `tester@example.invalid`, with a new test password of at least 12 characters. Select **Skip and start locally**. Enter no provider key, mailbox credential or private data. Capture first-run and empty-catalogue screenshots using only this fictional identity.
6. Confirm zero catalogue, supplier, purchase-order and inventory records and no AI provider. Catalogue must show **No catalogue imported** and the header-only template. Disconnect the VM network after prerequisite setup. Create/edit a fictional supplier; calculate 2 units at cost 100 plus 20% markup (total 240); process structured RFQ text; compare identical quote text with the rule Validator. AI actions must show setup/recovery guidance without endless loading. External map/feed failures are expected offline.
7. Download the import template. Add one row whose first four matching fields are `999998,FICTIONAL clean VM test widget,EA,Synthetic`; leave other optional fields empty. Import it and verify one result in catalogue and Item Search. Use no IMPA content. Check the full licence and bundled application-source download in About/Legal.
8. Quit through the application menu. Confirm Community backend/PostgreSQL processes stop in Task Manager. Relaunch/sign in: the fictional supplier/item should persist, no keys should appear, and first-run setup should not recur. Reboot the VM and repeat. Data must reside under `%APPDATA%\Nautex Community`, outside installation resources.
9. Quit, rerun the same installer and reopen the workspace. Verify synthetic data remains. This is same-version reinstall only; cross-version migration requires a separate previous Community build and snapshot, never the owner's private profile.
10. Quit and record profile hashes with PowerShell:

    ```powershell
    $testProfile=Join-Path $env:APPDATA 'Nautex Community'
    $before=Get-ChildItem -LiteralPath $testProfile -Recurse -File | Get-FileHash
    $before | Export-Csv .\profile-before-uninstall.csv -NoTypeInformation
    ```

    Uninstall **Nautex Community** through Installed apps. Confirm executable, Start menu and uninstall entries are removed and no managed Community processes remain. The profile must still exist; compare every saved path/hash and record missing or changed files. Reinstall and verify the fictional records again. Retain evidence before deliberately reverting the disposable VM.

Mark each step PASS, FAIL or PENDING with evidence. Developer-host results do not replace this run. Prerequisite elevation/reboot, clean first launch and uninstall/default-profile preservation remain **PENDING** until executed here. Signing is optional for this candidate; record unsigned behaviour accurately. No paid-provider calls belong in this checklist.
