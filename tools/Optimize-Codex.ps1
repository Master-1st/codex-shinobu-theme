[CmdletBinding()]
param(
    [ValidateSet("Analyze", "Optimize")]
    [string]$Mode = "Analyze",

    [switch]$Interactive,
    [switch]$ForceClose,
    [switch]$Restart,
    [switch]$CleanStaleTemp,

    [ValidateRange(0, 8192)]
    [int]$LogThresholdMB = 128,

    [ValidateRange(7, 3650)]
    [int]$TempRetentionDays = 30,

    [string]$CodexHome = $(
        if ($env:CODEX_HOME) { $env:CODEX_HOME }
        else { Join-Path $env:USERPROFILE ".codex" }
    ),

    [string]$WebProfile = $(Join-Path $env:APPDATA "Codex\web\Codex")
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[Codex] $Message" -ForegroundColor Cyan
}

function Get-FileSizeBytes {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return [int64]0 }
    return [int64](Get-Item -LiteralPath $Path -Force).Length
}

function Get-DirectorySizeBytes {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return [int64]0 }
    $sum = (Get-ChildItem -LiteralPath $Path -Force -Recurse -File -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    if ($null -eq $sum) { return [int64]0 }
    return [int64]$sum
}

function ConvertTo-MB {
    param([int64]$Bytes)
    return [math]::Round($Bytes / 1MB, 1)
}

function Assert-SafeChildPath {
    param(
        [string]$Path,
        [string]$AllowedRoot
    )

    $rootFull = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd("\")
    $pathFull = [IO.Path]::GetFullPath($Path).TrimEnd("\")
    $prefix = $rootFull + "\"
    if (-not $pathFull.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to process a path outside the allowed root: $pathFull"
    }
    return $pathFull
}

function Get-CodexProcesses {
    $items = @()
    foreach ($process in (Get-Process -Name ChatGPT, codex -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $process.Path } catch {}
        if ($path -and ($path -match "OpenAI\.Codex|codex-plusplus")) {
            $items += $process
        }
    }
    return @($items)
}

function Get-CacheTargets {
    param([string]$Profile)
    return @(
        (Join-Path $Profile "Default\Cache"),
        (Join-Path $Profile "Default\Code Cache"),
        (Join-Path $Profile "Default\GPUCache"),
        (Join-Path $Profile "Default\DawnGraphiteCache"),
        (Join-Path $Profile "Default\DawnWebGPUCache"),
        (Join-Path $Profile "GrShaderCache"),
        (Join-Path $Profile "ShaderCache"),
        (Join-Path $Profile "GPUPersistentCache")
    )
}

function Remove-DisposableDirectory {
    param(
        [string]$Path,
        [string]$AllowedRoot
    )
    if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
    $safePath = Assert-SafeChildPath -Path $Path -AllowedRoot $AllowedRoot
    $bytes = Get-DirectorySizeBytes -Path $safePath
    Remove-Item -LiteralPath $safePath -Recurse -Force
    return $bytes
}

function Show-Analysis {
    param(
        [string]$CodexRoot,
        [string]$Profile
    )

    $processes = @(Get-CodexProcesses)
    $workingSet = [int64](($processes | Measure-Object -Property WorkingSet64 -Sum).Sum)
    $privateMemory = [int64](($processes | Measure-Object -Property PrivateMemorySize64 -Sum).Sum)
    $logDb = Join-Path $CodexRoot "logs_2.sqlite"
    $logBytes = Get-FileSizeBytes -Path $logDb
    $cacheBytes = [int64]0
    foreach ($target in (Get-CacheTargets -Profile $Profile)) {
        $cacheBytes += Get-DirectorySizeBytes -Path $target
    }
    $tempBytes = Get-DirectorySizeBytes -Path (Join-Path $CodexRoot ".tmp")
    $sessionRoot = Join-Path $CodexRoot "sessions"
    $sessionFiles = @()
    if (Test-Path -LiteralPath $sessionRoot) {
        $sessionFiles = @(Get-ChildItem -LiteralPath $sessionRoot -Recurse -Force -File -Filter "*.jsonl" -ErrorAction SilentlyContinue)
    }
    $sessionBytes = [int64](($sessionFiles | Measure-Object -Property Length -Sum).Sum)

    Write-Step "Read-only analysis completed"
    [pscustomobject]@{
        CodexProcesses = $processes.Count
        WorkingSetMB = ConvertTo-MB $workingSet
        PrivateMemoryMB = ConvertTo-MB $privateMemory
        ActiveLogDatabaseMB = ConvertTo-MB $logBytes
        DisposableWebCacheMB = ConvertTo-MB $cacheBytes
        TemporaryFilesMB = ConvertTo-MB $tempBytes
        SessionFiles = $sessionFiles.Count
        SessionStorageMB = ConvertTo-MB $sessionBytes
    } | Format-List

    $largeSessions = @($sessionFiles | Where-Object Length -ge 50MB | Sort-Object Length -Descending)
    if ($largeSessions.Count -gt 0) {
        Write-Warning "Found $($largeSessions.Count) session files larger than 50 MB. Opening those sessions can still pause briefly. They will not be deleted."
        $largeSessions | Select-Object -First 8 @{N="SizeMB";E={ConvertTo-MB $_.Length}}, LastWriteTime, FullName |
            Format-Table -AutoSize
    }
}

function Stop-CodexSafely {
    param([switch]$AllowForce)
    $processes = @(Get-CodexProcesses)
    if ($processes.Count -eq 0) { return $null }

    $mainPath = ($processes | Where-Object ProcessName -eq "ChatGPT" | Select-Object -First 1).Path
    if (-not $AllowForce) {
        throw "Codex is still running. Close every Codex window or use -ForceClose."
    }

    Write-Step "Closing Codex before touching its active databases"
    $processes | Sort-Object @{E={if ($_.ProcessName -eq "ChatGPT") { 1 } else { 0 }}} |
        Stop-Process -Force -ErrorAction SilentlyContinue

    $deadline = (Get-Date).AddSeconds(20)
    do {
        Start-Sleep -Milliseconds 250
        $remaining = @(Get-CodexProcesses)
    } while ($remaining.Count -gt 0 -and (Get-Date) -lt $deadline)

    if ($remaining.Count -gt 0) {
        throw "Some Codex processes did not exit. Restart Windows before running the optimizer again."
    }
    return $mainPath
}

function Rotate-LogDatabase {
    param(
        [string]$CodexRoot,
        [int]$ThresholdMB
    )

    $db = Join-Path $CodexRoot "logs_2.sqlite"
    $bytes = Get-FileSizeBytes -Path $db
    if ($bytes -lt ($ThresholdMB * 1MB)) {
        Write-Step "The active log database is $(ConvertTo-MB $bytes) MB, below the $ThresholdMB MB threshold"
        return $null
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupRoot = Join-Path $CodexRoot "maintenance-backups\$stamp"
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

    foreach ($suffix in @("", "-wal", "-shm")) {
        $source = $db + $suffix
        if (Test-Path -LiteralPath $source) {
            Move-Item -LiteralPath $source -Destination $backupRoot -Force
        }
    }
    Write-Step "Backed up and rotated $(ConvertTo-MB $bytes) MB of active logs: $backupRoot"
    return $backupRoot
}

function Remove-StaleTempFiles {
    param(
        [string]$CodexRoot,
        [int]$RetentionDays
    )
    $tempRoot = Join-Path $CodexRoot ".tmp"
    if (-not (Test-Path -LiteralPath $tempRoot)) { return [int64]0 }
    $safeRoot = [IO.Path]::GetFullPath($tempRoot).TrimEnd("\")
    $cutoff = (Get-Date).AddDays(-$RetentionDays)
    $bytes = [int64]0

    foreach ($file in (Get-ChildItem -LiteralPath $safeRoot -Recurse -Force -File -ErrorAction SilentlyContinue |
        Where-Object LastWriteTime -lt $cutoff)) {
        Assert-SafeChildPath -Path $file.FullName -AllowedRoot $safeRoot | Out-Null
        $bytes += $file.Length
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    }
    Get-ChildItem -LiteralPath $safeRoot -Recurse -Force -Directory -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Where-Object { -not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue) } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    return $bytes
}

function Start-CodexAgain {
    param([string]$PreviousExecutable)

    $shortcutCandidates = @(
        (Join-Path ([Environment]::GetFolderPath("Desktop")) "Codex++.lnk"),
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Codex++.lnk")
    )
    $shortcut = $shortcutCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($shortcut) {
        Start-Process -FilePath $shortcut
        Write-Step "Restarted from the Codex++ shortcut"
        return
    }

    $startApp = Get-StartApps -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "Codex" -or $_.AppID -match "OpenAI\.Codex" } |
        Select-Object -First 1
    if ($startApp) {
        Start-Process -FilePath "explorer.exe" -ArgumentList "shell:AppsFolder\$($startApp.AppID)"
        Write-Step "Restarted from the Windows app entry"
        return
    }

    if ($PreviousExecutable -and (Test-Path -LiteralPath $PreviousExecutable)) {
        Start-Process -FilePath $PreviousExecutable
        Write-Step "Restarted from the previous executable"
        return
    }

    Write-Warning "Optimization finished, but no Codex launcher was found. Start Codex manually."
}

$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$WebProfile = [IO.Path]::GetFullPath($WebProfile)

if ($Mode -eq "Analyze") {
    Show-Analysis -CodexRoot $CodexHome -Profile $WebProfile
    exit 0
}

if ($Interactive) {
    Write-Host "This closes Codex, rotates oversized diagnostic logs, and clears disposable web/GPU caches." -ForegroundColor Yellow
    Write-Host "It does not delete sign-in data, sessions, attachments, skills, settings, or custom artwork." -ForegroundColor Yellow
    $answer = Read-Host "Type Y to continue"
    if ($answer -notmatch "^[Yy]$") {
        Write-Host "Cancelled."
        exit 0
    }
}

Show-Analysis -CodexRoot $CodexHome -Profile $WebProfile
$previousExecutable = Stop-CodexSafely -AllowForce:$ForceClose
$backup = Rotate-LogDatabase -CodexRoot $CodexHome -ThresholdMB $LogThresholdMB

$cacheBytes = [int64]0
foreach ($target in (Get-CacheTargets -Profile $WebProfile)) {
    $cacheBytes += Remove-DisposableDirectory -Path $target -AllowedRoot $WebProfile
}
Write-Step "Cleared $(ConvertTo-MB $cacheBytes) MB of disposable web/GPU caches"

if ($CleanStaleTemp) {
    $tempBytes = Remove-StaleTempFiles -CodexRoot $CodexHome -RetentionDays $TempRetentionDays
    Write-Step "Cleared $(ConvertTo-MB $tempBytes) MB of temporary files older than $TempRetentionDays days"
}

Write-Host "Optimization completed. Sessions and sign-in data were preserved." -ForegroundColor Green
if ($backup) { Write-Host "Log backup: $backup" }

if ($Restart) {
    Start-CodexAgain -PreviousExecutable $previousExecutable
}
