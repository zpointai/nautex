$ErrorActionPreference='Stop'
# npm can inherit a PowerShell Core module path when launching Windows PowerShell.
# Load the Windows inbox modules explicitly instead of relying on that search path.
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Utility') -ErrorAction Stop
Import-Module (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security') -ErrorAction Stop
$releaseRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archive=Join-Path $releaseRoot '.desktop-vendor\vc_redist.x64.exe'
$expected='843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C'
if(!(Test-Path -LiteralPath $archive)){throw 'Download Microsoft VC++ x64 runtime from https://aka.ms/vc14/vc_redist.x64.exe into .desktop-vendor first. Review/update the pinned hash if Microsoft replaces this file.'}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected){throw 'VC++ redistributable hash mismatch'}
$signature=Get-AuthenticodeSignature -LiteralPath $archive
if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation'){throw 'VC++ redistributable signature is not valid Microsoft code'}
$target=Join-Path $releaseRoot '.desktop-build\prerequisites'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -LiteralPath $archive -Destination (Join-Path $target 'vc_redist.x64.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-vc-runtime.ps1') -Destination $target
Write-Output 'Microsoft VC++ x64 14.51.36247.0 signature and pinned hash verified.'
