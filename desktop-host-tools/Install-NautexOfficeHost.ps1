[CmdletBinding()]
param(
  [Parameter()][ValidateNotNullOrEmpty()][string]$OfficeName = "Nautex Office",
  [Parameter()][ValidateNotNullOrEmpty()][string]$HostName = $env:COMPUTERNAME,
  [Parameter()][ValidateRange(1024, 65535)][int]$Port = 8443,
  [Parameter()][string]$EnrollmentOutput
)

$ErrorActionPreference = "Stop"
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Nautex Office Host setup must be run as administrator."
}

Add-Type -AssemblyName System.Security
$resourcesRoot = Split-Path -Parent $PSScriptRoot
$installRoot = Split-Path -Parent $resourcesRoot
$appExecutable = Join-Path $installRoot "Nautex.exe"
$serviceScript = Join-Path $resourcesRoot "local-runtime\host-service\office-host-service.mjs"
$wrapperSource = Join-Path $resourcesRoot "service-wrapper\WinSW.exe"
$dataRoot = Join-Path $env:ProgramData "Nautex"
$serviceRoot = Join-Path $dataRoot "service"
$certificateRoot = Join-Path $dataRoot "certificates"
$enrollmentRoot = Join-Path $dataRoot "enrollment"
$logRoot = Join-Path $dataRoot "logs"
$wrapper = Join-Path $serviceRoot "NautexOfficeHost.exe"
$wrapperConfig = Join-Path $serviceRoot "NautexOfficeHost.xml"
$hostConfig = Join-Path $serviceRoot "office-host-config.json"
$certificatePath = Join-Path $certificateRoot "office-host.pfx"
$certificatePasswordPath = Join-Path $certificateRoot "office-host-password.bin"
$profilePath = Join-Path $dataRoot "office-client-profile.json"

foreach ($required in @($appExecutable, $serviceScript, $wrapperSource)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required Nautex Office Host resource is missing: $required" }
}
New-Item -ItemType Directory -Force -Path $serviceRoot, $certificateRoot, $enrollmentRoot, $logRoot | Out-Null
& icacls.exe $dataRoot /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" | Out-Null
& icacls.exe $dataRoot /grant "BUILTIN\Users:(RX)" | Out-Null
& icacls.exe $enrollmentRoot /grant "BUILTIN\Users:(OI)(CI)(RX)" | Out-Null

if (-not (Test-Path -LiteralPath $certificatePath) -or -not (Test-Path -LiteralPath $certificatePasswordPath)) {
  $dnsNames = @($HostName, $env:COMPUTERNAME) | Select-Object -Unique
  $certificate = New-SelfSignedCertificate `
    -DnsName $dnsNames `
    -CertStoreLocation "Cert:\LocalMachine\My" `
    -FriendlyName "Nautex Office Host" `
    -KeyAlgorithm RSA `
    -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(3)
  $random = New-Object byte[] 48
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($random) } finally { $rng.Dispose() }
  $certificatePassword = [Convert]::ToBase64String($random)
  $securePassword = ConvertTo-SecureString -String $certificatePassword -AsPlainText -Force
  Export-PfxCertificate -Cert $certificate -FilePath $certificatePath -Password $securePassword | Out-Null
  $plainBytes = [Text.Encoding]::UTF8.GetBytes($certificatePassword)
  $protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
    $plainBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  [IO.File]::WriteAllBytes($certificatePasswordPath, $protectedBytes)
} else {
  $protectedBytes = [IO.File]::ReadAllBytes($certificatePasswordPath)
  $plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $null,
    [Security.Cryptography.DataProtectionScope]::LocalMachine
  )
  $certificatePassword = [Text.Encoding]::UTF8.GetString($plainBytes)
  $securePassword = ConvertTo-SecureString -String $certificatePassword -AsPlainText -Force
  $certificate = New-Object Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(
    $certificatePath,
    $certificatePassword,
    [Security.Cryptography.X509Certificates.X509KeyStorageFlags]::MachineKeySet
  )
}

$sha = [Security.Cryptography.SHA256]::Create()
try { $fingerprint = ([BitConverter]::ToString($sha.ComputeHash($certificate.RawData))).Replace("-", "") } finally { $sha.Dispose() }
$publicOrigin = "https://${HostName}:$Port"
$hostSettings = [ordered]@{
  formatVersion = 1
  resourcesRoot = (Join-Path $resourcesRoot "local-runtime")
  dataRoot = $dataRoot
  publicOrigin = $publicOrigin
  port = $Port
  certificatePath = $certificatePath
  certificatePasswordPath = $certificatePasswordPath
}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($hostConfig, ($hostSettings | ConvertTo-Json), $utf8)

$profile = [ordered]@{
  type = "nautex-office-enrollment"
  formatVersion = 1
  officeName = $OfficeName
  backendOrigin = $publicOrigin
  certificateSha256 = $fingerprint
}
[IO.File]::WriteAllText($profilePath, ($profile | ConvertTo-Json), $utf8)
$namedProfile = Join-Path $enrollmentRoot "Nautex-$($HostName)-Office.nautex-office.json"
Copy-Item -LiteralPath $profilePath -Destination $namedProfile -Force
& icacls.exe $profilePath /grant:r "BUILTIN\Users:R" | Out-Null
& icacls.exe $namedProfile /grant:r "BUILTIN\Users:R" | Out-Null
if ($EnrollmentOutput) {
  $outputParent = Split-Path -Parent $EnrollmentOutput
  if ($outputParent) { New-Item -ItemType Directory -Force -Path $outputParent | Out-Null }
  Copy-Item -LiteralPath $profilePath -Destination $EnrollmentOutput -Force
}

Copy-Item -LiteralPath $wrapperSource -Destination $wrapper -Force
function Escape-Xml([string]$value) { [Security.SecurityElement]::Escape($value) }
$xml = @"
<service>
  <id>NautexOfficeHost</id>
  <name>Nautex Office Host</name>
  <description>Customer-owned Nautex ERP API and private PostgreSQL runtime.</description>
  <executable>$(Escape-Xml $appExecutable)</executable>
  <arguments>&quot;$(Escape-Xml $serviceScript)&quot; --config=&quot;$(Escape-Xml $hostConfig)&quot;</arguments>
  <env name="ELECTRON_RUN_AS_NODE" value="1" />
  <workingdirectory>$(Escape-Xml $serviceRoot)</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>30sec</stoptimeout>
  <onfailure action="restart" delay="10 sec" />
  <resetfailure>1 hour</resetfailure>
  <serviceaccount><username>LocalSystem</username></serviceaccount>
  <logpath>$(Escape-Xml (Join-Path $dataRoot "logs"))</logpath>
  <log mode="roll-by-size"><sizeThreshold>10485760</sizeThreshold><keepFiles>8</keepFiles></log>
</service>
"@
$xml | Set-Content -LiteralPath $wrapperConfig -Encoding UTF8

& $wrapper stop $wrapperConfig 2>$null | Out-Null
& $wrapper uninstall $wrapperConfig 2>$null | Out-Null
& $wrapper install $wrapperConfig
if ($LASTEXITCODE -ne 0) { throw "Nautex Office Host service installation failed." }

$firewallName = "Nautex Office Host HTTPS"
Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $firewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Profile Domain,Private | Out-Null
& $wrapper start $wrapperConfig
if ($LASTEXITCODE -ne 0) { throw "Nautex Office Host service could not be started." }

Write-Host "Nautex Office Host is installed at $publicOrigin"
Write-Host "Distribute this enrollment profile to each office client: $namedProfile"
Write-Host "PostgreSQL remains bound to loopback and is not exposed through the firewall."
