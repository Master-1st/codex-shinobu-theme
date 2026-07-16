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
$manifestId = [string]$manifest.id
if ($manifestId -notmatch '^[A-Za-z0-9._-]+$') {
  throw 'manifest.id contains unsafe path characters.'
}
$manifestMain = ([string]$manifest.main).Replace('/', '\')
if ($manifestMain -ne 'dist\index.js') {
  throw 'manifest.main must point to dist/index.js.'
}
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

function Get-SafeDirectChildPath {
  param([string]$Root, [string]$Name)
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $Name))
  $parent = [IO.Path]::GetDirectoryName($candidate).TrimEnd('\')
  if (-not $parent.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to use a path outside the expected root: $candidate"
  }
  return $candidate
}

$destination = Get-SafeDirectChildPath -Root $tweaksRoot -Name $manifestId
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Get-SafeDirectChildPath -Root $backupRoot -Name "$manifestId-$stamp"
$staging = Get-SafeDirectChildPath -Root $tweaksRoot -Name ".$manifestId.install-$([guid]::NewGuid().ToString('N'))"

New-Item -ItemType Directory -Force -Path $tweaksRoot | Out-Null
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
New-Item -ItemType Directory -Path $staging | Out-Null

try {
  New-Item -ItemType Directory -Path (Join-Path $staging 'assets') | Out-Null
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'dist') -Destination (Join-Path $staging 'dist') -Recurse
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'assets\shinobu-icon.svg') -Destination (Join-Path $staging 'assets\shinobu-icon.svg')
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'assets\preview.png') -Destination (Join-Path $staging 'assets\preview.png')
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'docs') -Destination (Join-Path $staging 'docs') -Recurse
  Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $staging 'manifest.json')
  foreach ($optional in @('README.md', 'CHANGELOG.md', 'NOTICE.md', 'ASSET-LICENSE.md', 'LICENSE')) {
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
  $latestCodexPlusPlusApp = $null
  $storeAppsRoot = $null
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    $storeAppsRoot = Join-Path $env:LOCALAPPDATA 'codex-plusplus\store-apps'
    if (Test-Path -LiteralPath $storeAppsRoot) {
      $appCandidates = @(
        Get-ChildItem -LiteralPath $storeAppsRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
          if ($_.Name -notmatch '^OpenAI\.Codex_(\d+\.\d+\.\d+\.\d+)_') {
            return
          }
          $candidate = Join-Path $_.FullName 'app\ChatGPT.exe'
          if (Test-Path -LiteralPath $candidate) {
            [pscustomobject]@{
              Version = [version]$Matches[1]
              LastWriteTime = $_.LastWriteTime
              Target = $candidate
            }
          }
        } | Sort-Object Version, LastWriteTime -Descending
      )
      $latestCodexPlusPlusApp = $appCandidates | Select-Object -First 1 -ExpandProperty Target
    }
  }

  $desktopRoot = if (-not [string]::IsNullOrWhiteSpace($env:CODEX_SHINOBU_DESKTOP)) {
    $env:CODEX_SHINOBU_DESKTOP
  } else {
    [Environment]::GetFolderPath('Desktop')
  }
  $shortcutPaths = @(
    (Join-Path $desktopRoot 'Codex++.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Codex++.lnk')
  )
  $shell = New-Object -ComObject WScript.Shell
  foreach ($shortcutPath in $shortcutPaths) {
    try {
      if (-not (Test-Path -LiteralPath $shortcutPath)) {
        continue
      }
      $shortcut = $shell.CreateShortcut($shortcutPath)
      $targetName = [IO.Path]::GetFileName($shortcut.TargetPath)
      if ($targetName -ine 'Codex.exe' -and $targetName -ine 'ChatGPT.exe') {
        continue
      }
      $targetInsideCurrentMirror = $false
      if ($storeAppsRoot -and $targetName -ieq 'ChatGPT.exe') {
        $normalizedTarget = [IO.Path]::GetFullPath($shortcut.TargetPath)
        $normalizedStoreRoot = [IO.Path]::GetFullPath($storeAppsRoot).TrimEnd('\') + '\'
        $targetInsideCurrentMirror = $normalizedTarget.StartsWith($normalizedStoreRoot, [StringComparison]::OrdinalIgnoreCase)
      }
      if ($targetInsideCurrentMirror -and (Test-Path -LiteralPath $shortcut.TargetPath)) {
        continue
      }
      if (-not $latestCodexPlusPlusApp -or -not (Test-Path -LiteralPath $latestCodexPlusPlusApp)) {
        continue
      }
      $shortcut.TargetPath = $latestCodexPlusPlusApp
      $shortcut.WorkingDirectory = [IO.Path]::GetDirectoryName($latestCodexPlusPlusApp)
      $shortcut.Description = 'Codex++ with local tweaks'
      $shortcut.Save()
      $repairedShortcuts += $shortcutPath
    }
    catch {
      Write-Warning "Could not inspect shortcut '$shortcutPath': $($_.Exception.Message)"
    }
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
Write-Host 'This package supports Windows only; fully exit and relaunch Codex++ after installing.'
