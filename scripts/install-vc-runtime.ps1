# Called by the installer. The existing private application is never stopped or changed.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop
try {
  $hive=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryView]::Registry64)
  $key=$hive.OpenSubKey('SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64')
  if($key -and $key.GetValue('Installed') -eq 1){
    $version=[version]($key.GetValue('Version').TrimStart('v'))
    if($version -ge [version]'14.50.35719.0'){exit 0}
  }
  $runtime=Join-Path $PSScriptRoot 'vc_redist.x64.exe'
  $signature=Get-AuthenticodeSignature -LiteralPath $runtime
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation'){throw 'Microsoft prerequisite signature verification failed'}
  $process=Start-Process -FilePath $runtime -ArgumentList @('/install','/passive','/norestart') -Verb RunAs -WindowStyle Hidden -Wait -PassThru
  if($process.ExitCode -eq 3010){exit 3010}
  if($process.ExitCode -ne 0){throw "Microsoft prerequisite returned $($process.ExitCode)"}
  exit 0
} catch {Write-Error $_;exit 1}
