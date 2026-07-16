[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [ValidateSet("Analyze", "Optimize")]
    [string]$Mode = "Analyze",

    [switch]$Interactive,
    [switch]$ForceClose,
    [switch]$Restart,
    [switch]$CleanStaleTemp,
    [switch]$AllowCustomPaths,

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
if ($env:OS -ne "Windows_NT") {
    throw "This optimizer supports Windows only."
}

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

function Get-SumValue {
    param(
        [object[]]$Items,
        [string]$Property
    )
    [int64]$sum = 0
    foreach ($item in @($Items)) {
        if ($null -eq $item) { continue }
        if ([string]::IsNullOrWhiteSpace($Property)) {
            $sum += [int64]$item
        }
        else {
            $sum += [int64]$item.$Property
        }
    }
    return $sum
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
    foreach ($process in @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $process.Path } catch {}
        if (-not $path -or $path -match "OpenAI\.Codex|codex-plusplus") {
            $items += $process
        }
    }
    foreach ($process in @(Get-Process -Name codex -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $process.Path } catch {}
        if ($path -and $path -match "OpenAI\.Codex|codex-plusplus") {
            $items += $process
        }
    }
    return @($items)
}

function Get-CacheTargets {
    param([string]$Profile)
    $targets = @(
        (Join-Path $Profile "Default\Cache"),
        (Join-Path $Profile "Default\Code Cache"),
        (Join-Path $Profile "Default\GPUCache"),
        (Join-Path $Profile "Default\DawnGraphiteCache"),
        (Join-Path $Profile "Default\DawnWebGPUCache"),
        (Join-Path $Profile "GrShaderCache"),
        (Join-Path $Profile "ShaderCache"),
        (Join-Path $Profile "GPUPersistentCache")
    )
    foreach ($browserRoot in @(
        (Join-Path $Profile "codex-browser-app"),
        (Join-Path $Profile "Default\Partitions\codex-browser-app")
    )) {
        foreach ($relative in @("Cache", "Code Cache", "GPUCache", "DawnGraphiteCache", "DawnWebGPUCache")) {
            $targets += Join-Path $browserRoot $relative
        }
    }
    return @($targets | Select-Object -Unique)
}

function Get-LogDatabaseParts {
    param([string]$CodexRoot)
    $db = Join-Path $CodexRoot "logs_2.sqlite"
    return @($db, "$db-wal", "$db-shm")
}

function Assert-NoReparsePoint {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to process a reparse point: $Path"
    }
    $nested = Get-ChildItem -LiteralPath $Path -Force -Recurse -Attributes ReparsePoint -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($nested) {
        throw "Refusing to recurse through a reparse point: $($nested.FullName)"
    }
}

function Assert-FileUnlocked {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
        $stream.Dispose()
    }
    catch {
        throw "Codex still has a file open: $Path"
    }
}

function Remove-DisposableDirectory {
    param(
        [string]$Path,
        [string]$AllowedRoot
    )
    if (-not (Test-Path -LiteralPath $Path)) { return [int64]0 }
    $safePath = Assert-SafeChildPath -Path $Path -AllowedRoot $AllowedRoot
    Assert-NoReparsePoint -Path $safePath
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
    $workingSet = Get-SumValue -Items $processes -Property "WorkingSet64"
    $privateMemory = Get-SumValue -Items $processes -Property "PrivateMemorySize64"
    $logParts = Get-LogDatabaseParts -CodexRoot $CodexRoot
    $logPartBytes = @($logParts | ForEach-Object { Get-FileSizeBytes -Path $_ })
    $logBytes = Get-SumValue -Items $logPartBytes
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
    $sessionBytes = Get-SumValue -Items $sessionFiles -Property "Length"

    Write-Step "Read-only analysis completed"
    [pscustomobject]@{
        CodexProcesses = $processes.Count
        WorkingSetMB = ConvertTo-MB $workingSet
        PrivateMemoryMB = ConvertTo-MB $privateMemory
        ActiveLogDatabaseMB = ConvertTo-MB $logBytes
        LogMainMB = ConvertTo-MB $logPartBytes[0]
        LogWalMB = ConvertTo-MB $logPartBytes[1]
        LogShmMB = ConvertTo-MB $logPartBytes[2]
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

    $mainPath = $null
    try { $mainPath = ($processes | Where-Object ProcessName -eq "ChatGPT" | Select-Object -First 1).Path } catch {}
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
    foreach ($part in (Get-LogDatabaseParts -CodexRoot $CodexHome)) {
        Assert-FileUnlocked -Path $part
    }
    return $mainPath
}

function Rotate-LogDatabase {
    param(
        [string]$CodexRoot,
        [int]$ThresholdMB
    )

    $parts = Get-LogDatabaseParts -CodexRoot $CodexRoot
    $db = $parts[0]
    $partBytes = @($parts | ForEach-Object { Get-FileSizeBytes -Path $_ })
    $bytes = Get-SumValue -Items $partBytes
    if ($bytes -lt ($ThresholdMB * 1MB)) {
        Write-Step "The active log database set is $(ConvertTo-MB $bytes) MB, below the $ThresholdMB MB threshold"
        return $null
    }

    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupRoot = Join-Path $CodexRoot "maintenance-backups\$stamp"
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

    foreach ($source in $parts) {
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
    Assert-NoReparsePoint -Path $safeRoot
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

    if ($PreviousExecutable -and (Test-Path -LiteralPath $PreviousExecutable)) {
        Start-Process -FilePath $PreviousExecutable
        Write-Step "Restarted from the executable that was previously running"
        return
    }

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

    Write-Warning "Optimization finished, but no Codex launcher was found. Start Codex manually."
}

$CodexHome = [IO.Path]::GetFullPath($CodexHome)
$WebProfile = [IO.Path]::GetFullPath($WebProfile)
$defaultCodexHome = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".codex"))
$defaultWebProfile = [IO.Path]::GetFullPath((Join-Path $env:APPDATA "Codex\web\Codex"))
if (-not $AllowCustomPaths) {
    if (-not $CodexHome.Equals($defaultCodexHome, [StringComparison]::OrdinalIgnoreCase) -or
        -not $WebProfile.Equals($defaultWebProfile, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Custom maintenance roots require -AllowCustomPaths."
    }
}

if ($Mode -eq "Analyze") {
    Show-Analysis -CodexRoot $CodexHome -Profile $WebProfile
    exit 0
}

if ($Interactive) {
    Write-Host "Windows only. This closes Codex, rotates oversized diagnostic logs, and clears disposable web/GPU caches." -ForegroundColor Yellow
    Write-Host "It does not delete sign-in data, sessions, attachments, skills, settings, or custom artwork." -ForegroundColor Yellow
    Write-Host "Save any unsent text first. The first launch after cache cleanup can be temporarily slower." -ForegroundColor Yellow
    $answer = Read-Host "Type Y to continue"
    if ($answer -notmatch "^[Yy]$") {
        Write-Host "Cancelled."
        exit 0
    }
}

Show-Analysis -CodexRoot $CodexHome -Profile $WebProfile
$allowForce = [bool]$ForceClose
if ($Interactive -and @(Get-CodexProcesses).Count -gt 0) {
    Read-Host "Close every Codex window normally, then press Enter"
    if (@(Get-CodexProcesses).Count -gt 0) {
        $forceAnswer = Read-Host "Codex is still running. Type FORCE to terminate it, or press Enter to cancel"
        if ($forceAnswer -cne "FORCE") {
            Write-Host "Cancelled without changing files."
            exit 0
        }
        $allowForce = $true
    }
}

$maintenanceTarget = "running Codex processes, $CodexHome, and $WebProfile"
$maintenanceApproved = $PSCmdlet.ShouldProcess(
    $maintenanceTarget,
    "Close Codex and perform the requested local maintenance"
)
if (-not $maintenanceApproved) {
    if ($WhatIfPreference) {
        Write-Step "WhatIf completed; Codex was not closed and no files were changed"
    }
    else {
        Write-Step "Confirmation declined; Codex was not closed and no files were changed"
    }
    exit 0
}

# -Confirm lowers ConfirmPreference for nested cmdlets. The approval above is the
# single transaction confirmation, so suppress downstream prompts before Codex
# is closed; otherwise a later Remove-Item prompt could appear after shutdown.
$previousConfirmPreference = $ConfirmPreference
$ConfirmPreference = "None"
try {
    $previousExecutable = Stop-CodexSafely -AllowForce:$allowForce
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
}
finally {
    $ConfirmPreference = $previousConfirmPreference
}
