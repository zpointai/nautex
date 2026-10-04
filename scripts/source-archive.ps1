$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$releaseRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourceFiles=Get-Content -LiteralPath (Join-Path $releaseRoot 'release-files.json') -Raw | ConvertFrom-Json
$zipPath=Join-Path $releaseRoot 'public\legal\source.zip'
$stream=[IO.File]::Open($zipPath,[IO.FileMode]::Create)
$zip=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
  foreach($relative in $sourceFiles){
    $file=[IO.Path]::GetFullPath((Join-Path $releaseRoot $relative))
    if(!$file.StartsWith($releaseRoot+[IO.Path]::DirectorySeparatorChar)){throw 'Unsafe source path'}
    $entry=$zip.CreateEntry($relative,[IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime=[DateTimeOffset]::new(2026,10,4,0,0,0,[TimeSpan]::Zero)
    $inputStream=[IO.File]::OpenRead($file); $outputStream=$entry.Open()
    try {$inputStream.CopyTo($outputStream)} finally {$inputStream.Dispose();$outputStream.Dispose()}
  }
} finally {$zip.Dispose();$stream.Dispose()}
