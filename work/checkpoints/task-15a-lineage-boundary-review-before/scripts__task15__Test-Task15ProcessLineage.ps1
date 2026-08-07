$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$modulePath = Join-Path $PSScriptRoot "Task15ProcessLineage.psm1"
$testRoot = Join-Path $repositoryRoot "work\logs\task15a\quality-rereview\lineage-test"

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function Get-TestIdentity([int] $ProcessId) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    [pscustomobject]@{
        ProcessId = [int] $process.ProcessId
        CreationDate = ([datetime] $process.CreationDate).ToString("o")
        Name = [string] $process.Name
    }
}

function Stop-TestExactProcess($Identity) {
    if (-not $Identity) { return }
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($Identity.ProcessId)" -ErrorAction SilentlyContinue
    if ($current -and ([datetime] $current.CreationDate).ToString("o") -ceq [string] $Identity.CreationDate) {
        Stop-Process -Id $Identity.ProcessId -Force
        Wait-Process -Id $Identity.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    }
}

function Get-TestFinalDescendants([int] $RootProcessId) {
    $snapshot = @(Get-CimInstance Win32_Process)
    $known = [Collections.Generic.HashSet[int]]::new()
    [void] $known.Add($RootProcessId)
    $found = [Collections.Generic.List[object]]::new()
    $added = $true
    while ($added) {
        $added = $false
        foreach ($process in $snapshot) {
            if (-not $known.Contains([int] $process.ProcessId) -and $known.Contains([int] $process.ParentProcessId)) {
                [void] $known.Add([int] $process.ProcessId)
                $found.Add($process)
                $added = $true
            }
        }
    }
    @($found)
}

if (-not (Test-Path -LiteralPath $modulePath)) { throw "Missing process-lineage module: $modulePath" }
Import-Module $modulePath -Force
$parentCreated = Get-Date
$parentIdentity = [pscustomobject]@{ ProcessId = 50001; CreationDate = $parentCreated.ToString("o") }
$staleProcess = [pscustomobject]@{ ProcessId = 50002; ParentProcessId = 50001; CreationDate = $parentCreated.AddHours(-1) }
$newChildProcess = [pscustomobject]@{ ProcessId = 50003; ParentProcessId = 50001; CreationDate = $parentCreated.AddMilliseconds(1) }
Assert-True (-not (Test-Task15ValidLineageEdge -ParentIdentity $parentIdentity -ChildProcess $staleProcess)) "stale parent PID cannot attribute an older unrelated process"
Assert-True (Test-Task15ValidLineageEdge -ParentIdentity $parentIdentity -ChildProcess $newChildProcess) "child created after exact parent is attributable"
if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
New-Item -ItemType Directory -Path $testRoot | Out-Null

$controlIdentity = $null
$helperIdentity = $null
$rootIdentity = $null
try {
    $control = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 45") -WindowStyle Hidden -PassThru
    $controlIdentity = Get-TestIdentity $control.Id
    $reusedPidIdentity = [pscustomobject]@{ ProcessId = $controlIdentity.ProcessId; CreationDate = ([datetime]$controlIdentity.CreationDate).AddSeconds(-1).ToString("o"); Name = $controlIdentity.Name }
    Assert-True (-not (Test-Task15ExactProcessIdentity -Identity $reusedPidIdentity)) "same PID with different creation time is rejected as reuse"

    $helperPidPath = Join-Path $testRoot "helper.pid"
    $fixturePath = Join-Path $testRoot "spawn-helper.ps1"
    [IO.File]::WriteAllText($fixturePath, @'
param([string]$HelperPidPath)
$helper = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 45") -WindowStyle Hidden -PassThru
[IO.File]::WriteAllText($HelperPidPath, [string]$helper.Id)
Start-Sleep -Seconds 3
'@, [Text.UTF8Encoding]::new($false))

    $root = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-File", $fixturePath, "-HelperPidPath", $helperPidPath) -WindowStyle Hidden -PassThru
    $rootIdentity = Get-TestIdentity $root.Id
    $lineagePath = Join-Path $testRoot "simulated-step.lineage.json"
    $tracker = New-Task15ProcessLineageTracker -StepName "simulated-step" -RootProcessId $root.Id -EvidencePath $lineagePath
    while (-not $root.WaitForExit(100)) { Update-Task15ProcessLineageTracker -Tracker $tracker }
    Update-Task15ProcessLineageTracker -Tracker $tracker

    $helperPid = [int](Get-Content -LiteralPath $helperPidPath -Raw)
    $helperIdentity = Get-TestIdentity $helperPid
    Assert-True ($helperIdentity.Name -ieq "powershell.exe") "helper uses the same executable name as preexisting control"
    $helperCim = Get-CimInstance Win32_Process -Filter "ProcessId = $helperPid"
    Assert-True (-not ([string]$helperCim.ExecutablePath).StartsWith($repositoryRoot, [StringComparison]::OrdinalIgnoreCase)) "helper executable is outside repository"

    $oldFinalDescendants = @(Get-TestFinalDescendants -RootProcessId $PID)
    Assert-True (-not ($oldFinalDescendants.ProcessId -contains $helperPid)) "old final-snapshot audit misses reparented helper"

    $result = Complete-Task15ProcessLineageTracker -Tracker $tracker -GraceSeconds 0 -TerminateTrackedSurvivors
    Assert-True ($result.TrackedProcesses.ProcessId -contains $helperPid) "active tracker captured helper before reparenting"
    Assert-True ($result.SurvivorsBeforeCleanup.ProcessId -contains $helperPid) "tracker detected outliving helper"
    Assert-True ($result.TerminatedProcesses.ProcessId -contains $helperPid) "tracker terminated exact helper instance"
    Assert-True (@($result.SurvivorsAfterCleanup).Count -eq 0) "no tracked survivor remains"
    Assert-True (Test-Task15ExactProcessIdentity -Identity $controlIdentity) "unrelated preexisting same-name process untouched"
    Assert-True (Test-Path -LiteralPath $lineagePath -PathType Leaf) "lineage evidence persisted"
    Assert-Task15LineageEvidenceClean -EvidencePaths @($lineagePath)
    $retainedFixture = Join-Path $repositoryRoot "work\logs\task15a\quality-rereview\harmless-fixture"
    New-Item -ItemType Directory -Force -Path $retainedFixture | Out-Null
    Copy-Item -LiteralPath $lineagePath -Destination (Join-Path $retainedFixture "simulated-step.lineage.json") -Force
}
finally {
    Stop-TestExactProcess $helperIdentity
    Stop-TestExactProcess $rootIdentity
    Stop-TestExactProcess $controlIdentity
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

"Task 15 process lineage tests: PASS"
