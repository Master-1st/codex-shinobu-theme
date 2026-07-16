[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
  throw 'This uninstaller is for Windows only.'
}
if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
  throw 'APPDATA is not available for the current user.'
}
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') | ConvertFrom-Json
$manifestId = [string]$manifest.id
if ($manifestId -notmatch '^[A-Za-z0-9._-]+$') {
  throw 'manifest.id contains unsafe path characters.'
}

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

function Assert-NoReparsePointTree {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing to remove a reparse point: $Path"
  }
  if (-not $item.PSIsContainer) { return }

  foreach ($child in @(Get-ChildItem -LiteralPath $Path -Force)) {
    if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing to recurse through a reparse point: $($child.FullName)"
    }
    if ($child.PSIsContainer) {
      Assert-NoReparsePointTree -Path $child.FullName
    }
  }
}

$root = Join-Path $env:APPDATA 'codex-plusplus'
$themePath = Get-SafeDirectChildPath -Root (Join-Path $root 'tweaks') -Name $manifestId
$dataPath = Get-SafeDirectChildPath -Root (Join-Path $root 'tweak-data') -Name $manifestId

# Validate every requested deletion before changing either tree. This prevents a
# junction or symlink from turning a recursive uninstall into an out-of-root walk.
if (Test-Path -LiteralPath $themePath) {
  Assert-NoReparsePointTree -Path $themePath
}
if ($PurgeData -and (Test-Path -LiteralPath $dataPath)) {
  Assert-NoReparsePointTree -Path $dataPath
}

if (Test-Path -LiteralPath $themePath) {
  if ($PSCmdlet.ShouldProcess($themePath, 'Remove the installed Shinobu theme')) {
    Assert-NoReparsePointTree -Path $themePath
    Remove-Item -LiteralPath $themePath -Recurse -Force
    Write-Host "Removed theme files: $themePath" -ForegroundColor Green
  }
}
else {
  Write-Host 'The Shinobu theme is not installed.'
}

if ($PurgeData -and (Test-Path -LiteralPath $dataPath)) {
  if ($PSCmdlet.ShouldProcess($dataPath, 'Delete imported artwork and theme preferences')) {
    Assert-NoReparsePointTree -Path $dataPath
    Remove-Item -LiteralPath $dataPath -Recurse -Force
    Write-Host "Removed local artwork data: $dataPath" -ForegroundColor Yellow
  }
}
elseif (-not $PurgeData) {
  Write-Host 'Local imported artwork data was kept. Add -PurgeData to remove it too.'
}
