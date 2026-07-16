[CmdletBinding()]
param(
  [string]$OutputRoot
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'manifest.json') | ConvertFrom-Json
$outputRoot = if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
  Join-Path $root 'output'
} else {
  $OutputRoot
}
$folderName = "codex-shinobu-theme-v$($manifest.version)"
$staging = Join-Path $outputRoot $folderName
$zipPath = Join-Path $outputRoot "$folderName-windows.zip"

New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null
if (Test-Path -LiteralPath $staging) {
  Remove-Item -LiteralPath $staging -Recurse -Force
}
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $staging | Out-Null
New-Item -ItemType Directory -Path (Join-Path $staging 'assets') | Out-Null
Copy-Item -LiteralPath (Join-Path $root 'dist') -Destination (Join-Path $staging 'dist') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'assets\shinobu-icon.svg') -Destination (Join-Path $staging 'assets\shinobu-icon.svg')
Copy-Item -LiteralPath (Join-Path $root 'assets\shinobu-hero-safe-landscape.webp') -Destination (Join-Path $staging 'assets\shinobu-hero-safe-landscape.webp')
Copy-Item -LiteralPath (Join-Path $root 'assets\artwork.json') -Destination (Join-Path $staging 'assets\artwork.json')
Copy-Item -LiteralPath (Join-Path $root 'assets\preview.png') -Destination (Join-Path $staging 'assets\preview.png')
Copy-Item -LiteralPath (Join-Path $root 'docs') -Destination (Join-Path $staging 'docs') -Recurse
Copy-Item -LiteralPath (Join-Path $root 'tools') -Destination (Join-Path $staging 'tools') -Recurse

$files = @(
  'manifest.json',
  'install.ps1',
  'install.cmd',
  'Analyze-Codex.cmd',
  'Optimize-Codex.cmd',
  'Uninstall-Theme.cmd',
  'uninstall.ps1',
  'README.md',
  'CHANGELOG.md',
  'NOTICE.md',
  'ASSET-LICENSE.md',
  'LICENSE'
)
foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $staging $file)
}

Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zipPath -CompressionLevel Optimal
$stream = [IO.File]::OpenRead($zipPath)
try {
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha256.ComputeHash($stream)
  }
  finally {
    $sha256.Dispose()
  }
}
finally {
  $stream.Dispose()
}
$hash = ([BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
$hashPath = "$zipPath.sha256"
Set-Content -LiteralPath $hashPath -Value "$hash  $(Split-Path -Leaf $zipPath)" -Encoding ascii

[pscustomobject]@{
  Archive = $zipPath
  Bytes = (Get-Item -LiteralPath $zipPath).Length
  SHA256 = $hash
  Checksum = $hashPath
} | Format-List
