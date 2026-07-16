[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
  [switch]$PurgeData
)

$ErrorActionPreference = 'Stop'
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') | ConvertFrom-Json
$root = Join-Path $env:APPDATA 'codex-plusplus'
$themePath = Join-Path (Join-Path $root 'tweaks') $manifest.id
$dataPath = Join-Path (Join-Path $root 'tweak-data') $manifest.id

if (Test-Path -LiteralPath $themePath) {
  if ($PSCmdlet.ShouldProcess($themePath, 'Remove the installed Shinobu theme')) {
    Remove-Item -LiteralPath $themePath -Recurse -Force
    Write-Host "Removed theme files: $themePath" -ForegroundColor Green
  }
}
else {
  Write-Host 'The Shinobu theme is not installed.'
}

if ($PurgeData -and (Test-Path -LiteralPath $dataPath)) {
  if ($PSCmdlet.ShouldProcess($dataPath, 'Delete imported artwork and theme preferences')) {
    Remove-Item -LiteralPath $dataPath -Recurse -Force
    Write-Host "Removed local artwork data: $dataPath" -ForegroundColor Yellow
  }
}
elseif (-not $PurgeData) {
  Write-Host 'Local imported artwork data was kept. Add -PurgeData to remove it too.'
}
