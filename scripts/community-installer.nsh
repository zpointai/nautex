!macro customInstall
  DetailPrint "Checking Microsoft Visual C++ x64 runtime..."
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\prerequisites\install-vc-runtime.ps1"' $0
  ${If} $0 == 3010
    SetRebootFlag true
  ${ElseIf} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "The Microsoft runtime prerequisite could not be installed. Nautex installation is incomplete. Keep Windows protections enabled and retry with an administrator account."
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend
