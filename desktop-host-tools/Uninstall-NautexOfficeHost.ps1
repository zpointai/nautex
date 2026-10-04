[CmdletBinding()]
param([switch]$RemoveCustomerData)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Nautex Office Host removal must be run as administrator."
}

$dataRoot = Join-Path $env:ProgramData "Nautex"
$serviceRoot = Join-Path $dataRoot "service"
$wrapper = Join-Path $serviceRoot "NautexOfficeHost.exe"
$wrapperConfig = Join-Path $serviceRoot "NautexOfficeHost.xml"
if (Test-Path -LiteralPath $wrapper) {
  & $wrapper stop $wrapperConfig 2>$null | Out-Null
  & $wrapper uninstall $wrapperConfig 2>$null | Out-Null
}
Get-NetFirewallRule -DisplayName "Nautex Office Host HTTPS" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($RemoveCustomerData) {
  Remove-Item -LiteralPath $dataRoot -Recurse -Force
  Write-Host "Nautex Office Host and customer data were removed."
} else {
  Write-Host "Nautex Office Host was removed. Customer data remains at $dataRoot"
}
