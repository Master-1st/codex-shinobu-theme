[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
  throw 'This installer is for Windows only.'
}
if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
  throw 'APPDATA is not available for the current user.'
}

$sourceRoot = $PSScriptRoot
$manifestPath = Join-Path $sourceRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) {
  throw 'manifest.json was not found next to install.ps1.'
}
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
$entryPath = Join-Path $sourceRoot $manifest.main
if (-not (Test-Path -LiteralPath $entryPath)) {
  throw "Built tweak entry is missing: $($manifest.main). Download the release ZIP or run npm run build first."
}

$codexPlusPlusRoot = Join-Path $env:APPDATA 'codex-plusplus'
if (-not (Test-Path -LiteralPath $codexPlusPlusRoot)) {
  throw @'
Codex++ is not installed yet.

Install it from its official project first:
  irm https://raw.githubusercontent.com/b-nnett/codex-plusplus/main/install.ps1 | iex

Then run this installer again. The Shinobu theme never modifies WindowsApps directly.
'@
}

$tweaksRoot = Join-Path $codexPlusPlusRoot 'tweaks'
$backupRoot = Join-Path $codexPlusPlusRoot 'theme-backups'
$destination = Join-Path $tweaksRoot $manifest.id
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $backupRoot "$($manifest.id)-$stamp"
$staging = Join-Path $tweaksRoot ".$($manifest.id).install-$([guid]::NewGuid().ToString('N'))"

New-Item -ItemType Directory -Force -Path $tweaksRoot | Out-Null
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
New-Item -ItemType Directory -Path $staging | Out-Null

try {
  New-Item -ItemType Directory -Path (Join-Path $staging 'assets') | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'dist') -Destination (Join-Path $staging 'dist') -Recurse
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'assets\shinobu-icon.svg') -Destination (Join-Path $staging 'assets\shinobu-icon.svg')
  Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $staging 'manifest.json')
  foreach ($optional in @('README.md', 'NOTICE.md', 'LICENSE')) {
    $path = Join-Path $sourceRoot $optional
    if (Test-Path -LiteralPath $path) {
      Copy-Item -LiteralPath $path -Destination (Join-Path $staging $optional)
    }
  }

  $stagedEntry = Join-Path $staging $manifest.main
  if (-not (Test-Path -LiteralPath $stagedEntry)) {
    throw 'Staged theme entry verification failed.'
  }

  $movedExisting = $false
  if (Test-Path -LiteralPath $destination) {
    Move-Item -LiteralPath $destination -Destination $backup
    $movedExisting = $true
  }
  try {
    Move-Item -LiteralPath $staging -Destination $destination
  }
  catch {
    if ($movedExisting -and -not (Test-Path -LiteralPath $destination)) {
      Move-Item -LiteralPath $backup -Destination $destination
    }
    throw
  }
}
finally {
  if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force
  }
}

$repairedShortcuts = @()
try {
  $shortcutPaths = @(
    (Join-Path $env:USERPROFILE 'Desktop\Codex++.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Codex++.lnk')
  )
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in $shortcutPaths) {
    if (-not (Test-Path -LiteralPath $shortcutPath)) {
      continue
    }
    $shortcut = $shell.CreateShortcut($shortcutPath)
    if ([IO.Path]::GetFileName($shortcut.TargetPath) -ine 'Codex.exe') {
      continue
    }
    $actualApp = Join-Path ([IO.Path]::GetDirectoryName($shortcut.TargetPath)) 'ChatGPT.exe'
    if (-not (Test-Path -LiteralPath $actualApp)) {
      continue
    }
    $shortcut.TargetPath = $actualApp
    $shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($actualApp)
    $shortcut.Description = 'Codex++ with local tweaks'
    $shortcut.Save()
    $repairedShortcuts += $shortcutPath
  }
}
catch {
  Write-Warning "Theme installed, but the Codex++ shortcut check failed: $($_.Exception.Message)"
}

Write-Host ''
Write-Host "Installed $($manifest.name) v$($manifest.version)." -ForegroundColor Green
Write-Host "Path: $destination"
if ($repairedShortcuts.Count -gt 0) {
  Write-Host "Repaired $($repairedShortcuts.Count) Codex++ shortcut(s) to launch ChatGPT.exe." -ForegroundColor Green
}
Write-Host 'Launch the Codex++ shortcut, then open Settings > Tweaks > Shinobu Theme.'
Write-Host 'Your imported original image will be stored separately and preserved across theme updates.'
