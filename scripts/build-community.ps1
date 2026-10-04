param([switch]$UsePreparedPostgres)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$env:NEXT_TELEMETRY_DISABLED='1'
$env:DATABASE_URL='postgresql://synthetic:synthetic@127.0.0.1:1/nautex_build'
$env:NAUTEX_AUTH_MODE='local'
$env:NAUTEX_DATA_MODE='operational'
$env:BETTER_AUTH_SECRET='Synthetic-isolated-build-secret-not-runtime'
$env:NAUTEX_DATA_DIR=Join-Path (Get-Location) '.desktop-build\build-profile'
$env:AI_PROVIDER='none'
$env:DEEPSEEK_API_KEY=''
$env:GEMINI_API_KEY=''
$env:NEXT_PUBLIC_NAUTEX_API_BASE_URL=''
function Run-Checked([string]$Program,[string[]]$Arguments){ & $Program @Arguments; if($LASTEXITCODE -ne 0){throw "$Program failed with exit code $LASTEXITCODE"} }
# Only this clean source snapshot is a valid build input. Do not point these paths at a user profile.
Run-Checked 'node.exe' @('scripts/check-build-inputs.mjs')
Run-Checked 'npm.cmd' @('ci','--no-audit','--no-fund')
Run-Checked 'npm.cmd' @('ci','--prefix','desktop','--no-audit','--no-fund')
Run-Checked 'npm.cmd' @('ci','--prefix','desktop-runtime','--no-audit','--no-fund')
Run-Checked 'node.exe' @('scripts/collect-notices.mjs')
Run-Checked 'node.exe' @('scripts/release-source.mjs')
Run-Checked 'npm.cmd' @('run','desktop:icons')
Run-Checked 'npm.cmd' @('run','desktop:renderer:build')
Run-Checked 'npm.cmd' @('run','desktop:backend:build')
if(!$UsePreparedPostgres){Run-Checked 'node.exe' @('scripts/prepare-postgres-runtime.mjs')}
& (Join-Path $PSScriptRoot 'prepare-vc-runtime.ps1')
Run-Checked 'node.exe' @('scripts/prepare-prisma-runtime.mjs')
Run-Checked 'node.exe' @('scripts/prepare-desktop-runtime.mjs','--standalone')
Run-Checked 'node.exe' @('scripts/test-native-runtime.mjs')
Run-Checked 'npx.cmd' @('electron-builder','--win','nsis','--x64','--publish','never')
Run-Checked 'node.exe' @('scripts/scan-release.mjs','releases/win-unpacked/resources')
