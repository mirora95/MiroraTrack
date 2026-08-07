$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$modulePath = Join-Path $PSScriptRoot "Task15ProcessLineage.psm1"
$manifestModulePath = Join-Path $PSScriptRoot "Task15LineageManifest.psm1"
$testRoot = Join-Path $repositoryRoot "work\logs\task15a\quality-rereview\lineage-test"

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function Assert-Throws([scriptblock] $Action, [string] $Pattern, [string] $Message) {
    $threw = $false
    try { & $Action }
    catch { $threw = $true; if ($_.Exception.Message -notmatch $Pattern) { throw } }
    if (-not $threw) { throw "ASSERTION FAILED: expected throw for $Message" }
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
if (-not (Test-Path -LiteralPath $manifestModulePath)) { throw "Missing lineage manifest module: $manifestModulePath" }
Import-Module $modulePath -Force
Import-Module $manifestModulePath -Force
$parentCreated = Get-Date
$parentIdentity = [pscustomobject]@{ ProcessId = 50001; CreationDate = $parentCreated.ToString("o") }
$staleProcess = [pscustomobject]@{ ProcessId = 50002; ParentProcessId = 50001; CreationDate = $parentCreated.AddHours(-1) }
$newChildProcess = [pscustomobject]@{ ProcessId = 50003; ParentProcessId = 50001; CreationDate = $parentCreated.AddMilliseconds(1) }
Assert-True (-not (Test-Task15ValidLineageEdge -ParentIdentity $parentIdentity -ChildProcess $staleProcess)) "stale parent PID cannot attribute an older unrelated process"
Assert-True (Test-Task15ValidLineageEdge -ParentIdentity $parentIdentity -ChildProcess $newChildProcess) "child created after exact parent is attributable"
$historicalParent = [pscustomobject]@{ ProcessId = 50001; CreationDate = $parentCreated.AddSeconds(-2).ToString("o"); ExitTime = $parentCreated.ToString("o"); ExitTimeSource = "RetainedProcessHandle" }
$boundaryChild = [pscustomobject]@{ ProcessId = 50004; ParentProcessId = 50001; CreationDate = $parentCreated }
$oneTickLateChild = [pscustomobject]@{ ProcessId = 50005; ParentProcessId = 50001; CreationDate = $parentCreated.AddTicks(1) }
$afterBoundaryChild = [pscustomobject]@{ ProcessId = 50006; ParentProcessId = 50001; CreationDate = $parentCreated.AddSeconds(1) }
Assert-True (Test-Task15HistoricalLineageEdge -ParentIdentity $historicalParent -ChildProcess $boundaryChild) "boundary child created by exact parent exit time is attributable"
Assert-True (-not (Test-Task15HistoricalLineageEdge -ParentIdentity $historicalParent -ChildProcess $oneTickLateChild)) "child one representable tick after exact parent exit time is rejected"
Assert-True (-not (Test-Task15HistoricalLineageEdge -ParentIdentity $historicalParent -ChildProcess $afterBoundaryChild)) "child materially after exact parent exit time is rejected"
Assert-True (-not (Test-Task15HistoricalLineageEdge -ParentIdentity $historicalParent -ChildProcess $staleProcess)) "historical stale preexisting child is rejected"
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
    $triggerPath = Join-Path $testRoot "spawn.trigger"
    $exitPath = Join-Path $testRoot "parent.exit"
    $fixturePath = Join-Path $testRoot "spawn-helper.ps1"
    [IO.File]::WriteAllText($fixturePath, @'
param([string]$HelperPidPath,[string]$TriggerPath,[string]$ExitPath)
while (-not (Test-Path -LiteralPath $TriggerPath)) { Start-Sleep -Milliseconds 5 }
$helper = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-Command", "Start-Sleep -Seconds 45") -WindowStyle Hidden -PassThru
[IO.File]::WriteAllText($HelperPidPath, [string]$helper.Id)
while (-not (Test-Path -LiteralPath $ExitPath)) { Start-Sleep -Milliseconds 5 }
'@, [Text.UTF8Encoding]::new($false))

    $root = Start-Process powershell.exe -ArgumentList @("-NoProfile", "-File", $fixturePath, "-HelperPidPath", $helperPidPath, "-TriggerPath", $triggerPath, "-ExitPath", $exitPath) -WindowStyle Hidden -PassThru
    $rootIdentity = Get-TestIdentity $root.Id
    $lineagePath = Join-Path $testRoot "simulated-step.lineage.json"
    $tracker = New-Task15ProcessLineageTracker -StepName "simulated-step" -RootProcessId $root.Id -EvidencePath $lineagePath
    $parentOnlySnapshot = @(Get-CimInstance Win32_Process -Filter "ProcessId = $($root.Id)")
    Update-Task15ProcessLineageTracker -Tracker $tracker -ProcessSnapshot $parentOnlySnapshot
    $finalPollAt = Get-Date
    [IO.File]::WriteAllText($triggerPath, "go")
    $helperDeadline = (Get-Date).AddSeconds(5)
    while (-not (Test-Path -LiteralPath $helperPidPath) -and (Get-Date) -lt $helperDeadline) { Start-Sleep -Milliseconds 5 }
    $helperPid = [int](Get-Content -LiteralPath $helperPidPath -Raw)
    $helperIdentity = Get-TestIdentity $helperPid
    [IO.File]::WriteAllText($exitPath, "exit")
    [void]$root.WaitForExit(5000)
    Assert-True ($helperIdentity.Name -ieq "powershell.exe") "helper uses the same executable name as preexisting control"
    $helperCim = Get-CimInstance Win32_Process -Filter "ProcessId = $helperPid"
    Assert-True (([datetime]$helperIdentity.CreationDate).ToUniversalTime().Ticks -ge $finalPollAt.ToUniversalTime().Ticks) "helper is created after the final controlled parent poll"
    Assert-True (-not ([string]$helperCim.ExecutablePath).StartsWith($repositoryRoot, [StringComparison]::OrdinalIgnoreCase)) "helper executable is outside repository"

    $oldFinalDescendants = @(Get-TestFinalDescendants -RootProcessId $PID)
    Assert-True (-not ($oldFinalDescendants.ProcessId -contains $helperPid)) "old final-snapshot audit misses reparented helper"

    $completionTimer = [Diagnostics.Stopwatch]::StartNew()
    $result = Complete-Task15ProcessLineageTracker -Tracker $tracker -GraceSeconds 1 -TerminateTrackedSurvivors
    $completionTimer.Stop()
    Assert-True ($completionTimer.Elapsed.TotalMilliseconds -ge 800) "completion samples for the full bounded grace"
    Assert-True ($result.TrackedProcesses.ProcessId -contains $helperPid) "active tracker captured helper before reparenting"
    $helperRecord = $result.TrackedProcesses | Where-Object ProcessId -eq $helperPid
    $rootRecord = $result.TrackedProcesses | Where-Object ProcessId -eq $rootIdentity.ProcessId
    Assert-True ($helperRecord.DiscoveryReason -ceq "ParentExitBoundary") "boundary helper records discovery reason"
    Assert-True ($rootRecord.ExitTimeSource -ceq "RetainedProcessHandle") "root exit time comes from retained exact process handle"
    Assert-True ([datetime]$rootRecord.ExitTime -ge [datetime]$helperRecord.CreationDate) "actual parent exit time encloses child created after final poll"
    Assert-True ([string]$helperRecord.ParentExitTime -ceq [string]$rootRecord.ExitTime) "historical child serializes exact parent exit time evidence"
    Assert-True ([int]$result.ExitTimeAssuranceFailureCount -eq 0) "successful lineage evidence has no exit-time assurance failure"
    Assert-True ([bool]$result.HandlesDisposed) "all retained process handles are disposed after evidence finalization"
    Assert-True (@($result.TrackedProcesses | Where-Object { $_.PSObject.Properties.Name -contains "ProcessHandle" }).Count -eq 0) "process handles are never serialized"
    Assert-True ($result.SurvivorsBeforeCleanup.ProcessId -contains $helperPid) "tracker detected outliving helper"
    Assert-True ($result.TerminatedProcesses.ProcessId -contains $helperPid) "tracker terminated exact helper instance"
    Assert-True (@($result.SurvivorsAfterCleanup).Count -eq 0) "no tracked survivor remains"
    Assert-True (Test-Task15ExactProcessIdentity -Identity $controlIdentity) "unrelated preexisting same-name process untouched"
    Assert-True (Test-Path -LiteralPath $lineagePath -PathType Leaf) "lineage evidence persisted"
    Assert-Task15LineageEvidenceClean -EvidencePaths @($lineagePath)
    $tamperedPath = Join-Path $testRoot "tampered-boundary.lineage.json"
    $tampered = Get-Content -LiteralPath $lineagePath -Raw | ConvertFrom-Json
    $tamperedHelper = $tampered.TrackedProcesses | Where-Object ProcessId -eq $helperPid
    $tamperedParent = $tampered.TrackedProcesses | Where-Object ProcessId -eq $rootIdentity.ProcessId
    $tamperedHelper.CreationDate = ([datetime]$tamperedParent.ExitTime).AddSeconds(2).ToString("o")
    [IO.File]::WriteAllText($tamperedPath, ($tampered | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Assert-Throws { Assert-Task15LineageEvidenceClean -EvidencePaths @($tamperedPath) } "edge|boundary|lineage" "tampered late boundary edge"
    $unassuredPath = Join-Path $testRoot "unassured-exit-time.lineage.json"
    $unassured = Get-Content -LiteralPath $lineagePath -Raw | ConvertFrom-Json
    $unassured.Status = "PASS"
    $unassured.ExitTimeAssuranceFailures = @([pscustomobject]@{ ProcessId = $rootIdentity.ProcessId; CreationDate = $rootIdentity.CreationDate; Reason = "test inability to obtain exact ExitTime" })
    $unassured.ExitTimeAssuranceFailureCount = 1
    [IO.File]::WriteAllText($unassuredPath, ($unassured | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Assert-Throws { Assert-Task15LineageEvidenceClean -EvidencePaths @($unassuredPath) } "exit.?time|assurance" "missing exact exit time fails closed"
    Assert-True (Test-Task15ExactProcessIdentity -Identity $controlIdentity) "exit-time assurance failure does not clean unrelated process"
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

function Write-TestLineageLedger([string] $Root, [string] $StepName, [datetime] $StartedAt, [switch] $PreSchema) {
    $processId = 60000 + [math]::Abs($StepName.GetHashCode() % 4000)
    $createdAt = $StartedAt.AddMilliseconds(1)
    $identityKey = "{0}|{1}" -f $processId, $createdAt.ToUniversalTime().Ticks
    $identity = [ordered]@{
        ProcessId = $processId
        ParentProcessId = 0
        CreationDate = $createdAt.ToString("o")
        Name = "fixture.exe"
        ExecutablePath = "C:\fixture\fixture.exe"
        CommandLine = "fixture"
        DiscoveredFrom = $null
        DiscoveryReason = "Root"
        FirstSeenAt = $createdAt.ToString("o")
        LastSeenAt = $createdAt.ToString("o")
        ExitTime = $StartedAt.AddMilliseconds(900).ToString("o")
        ExitTimeSource = "RetainedProcessHandle"
        ParentExitTime = $null
    }
    if ($PreSchema) {
        $identity.Remove("DiscoveryReason")
        $identity.Remove("ExitTime")
        $identity.Remove("ExitTimeSource")
        $identity.Remove("ParentExitTime")
    }
    $ledger = [ordered]@{
        SchemaVersion = 1
        Status = "PASS"
        StepName = $StepName
        StartedAt = $StartedAt.ToString("o")
        CompletedAt = $StartedAt.AddSeconds(1).ToString("o")
        SampleCount = 1
        RootIdentityKey = $identityKey
        TrackedProcesses = @($identity)
        SurvivorsBeforeCleanup = @()
        TerminatedProcesses = @()
        SurvivorsAfterCleanup = @()
        ExitTimeAssuranceFailures = @()
        ExitTimeAssuranceFailureCount = 0
        RetainedHandleCount = 1
        DisposedHandleCount = 1
        HandlesDisposed = $true
    }
    if (-not $PreSchema) {
        $ledger.BoundaryToleranceMilliseconds = 0
        $ledger.CompletionGraceSeconds = 1
        $ledger.CompletionSamplingDurationMilliseconds = 1000
    }
    $path = Join-Path $Root "$StepName.lineage.json"
    [IO.File]::WriteAllText($path, ($ledger | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    return $path
}

$manifestTestRoot = Join-Path $repositoryRoot "work\logs\task15a\quality-rereview\lineage-manifest-test"
if (Test-Path -LiteralPath $manifestTestRoot) { Remove-Item -LiteralPath $manifestTestRoot -Recurse -Force }
New-Item -ItemType Directory -Path $manifestTestRoot | Out-Null
try {
    $gateSteps = @(Get-Task15ExpectedLineageSteps -Phase Gate)
    $buildSteps = @(Get-Task15ExpectedLineageSteps -Phase Build)
    $allSteps = @(Get-Task15ExpectedLineageSteps -Phase All)
    Assert-True ($gateSteps.Count -eq 9 -and $gateSteps[0] -ceq "01-npm-ci" -and $gateSteps[-1] -ceq "09-tauri-native-build") "Gate manifest has exact 01-09 steps"
    Assert-True ($buildSteps.Count -eq 6 -and $buildSteps[0] -ceq "10-acquire-bundler-tools" -and $buildSteps[-1] -ceq "15-cycle-1-tauri-nsis-0.1.0") "Build manifest has exact 10-15 steps"
    Assert-True ($allSteps.Count -eq 15 -and @($allSteps | Select-Object -Unique).Count -eq 15) "All manifest has exact unique 01-15 steps"

    $gateRoot = Join-Path $manifestTestRoot "gate"
    New-Item -ItemType Directory -Path $gateRoot | Out-Null
    $gateStart = (Get-Date).AddMinutes(-1)
    foreach ($step in $gateSteps) { Write-TestLineageLedger $gateRoot $step $gateStart | Out-Null }
    foreach ($step in $buildSteps) { Write-TestLineageLedger $gateRoot $step $gateStart.AddHours(-1) -PreSchema | Out-Null }
    $gateManifestPath = Join-Path $gateRoot "lineage-manifest-gate.json"
    Publish-Task15LineageManifest -Phase Gate -LogDirectory $gateRoot -OutputPath $gateManifestPath -RunId "gate-run" -PhaseStartedAt $gateStart | Out-Null
    $gateManifest = Read-Task15LineageManifest -ManifestPath $gateManifestPath -ExpectedPhase Gate -LogDirectory $gateRoot
    Assert-True (@($gateManifest.Entries).Count -eq 9) "stale pre-schema 10-15 ledgers do not affect Gate manifest"

    $buildRoot = Join-Path $manifestTestRoot "build"
    New-Item -ItemType Directory -Path $buildRoot | Out-Null
    $buildStart = (Get-Date).AddMinutes(-1)
    foreach ($step in $gateSteps) { Write-TestLineageLedger $buildRoot $step $buildStart.AddHours(-1) -PreSchema | Out-Null }
    foreach ($step in $buildSteps) { Write-TestLineageLedger $buildRoot $step $buildStart | Out-Null }
    $buildManifestPath = Join-Path $buildRoot "lineage-manifest-build.json"
    Publish-Task15LineageManifest -Phase Build -LogDirectory $buildRoot -OutputPath $buildManifestPath -RunId "build-run" -PhaseStartedAt $buildStart | Out-Null
    $buildManifest = Read-Task15LineageManifest -ManifestPath $buildManifestPath -ExpectedPhase Build -LogDirectory $buildRoot
    Assert-True (@($buildManifest.Entries).Count -eq 6) "stale pre-schema 01-09 ledgers do not affect Build manifest"

    $missingRoot = Join-Path $manifestTestRoot "missing"
    New-Item -ItemType Directory -Path $missingRoot | Out-Null
    foreach ($step in $gateSteps | Select-Object -SkipLast 1) { Write-TestLineageLedger $missingRoot $step $gateStart | Out-Null }
    Assert-Throws {
        Publish-Task15LineageManifest -Phase Gate -LogDirectory $missingRoot -OutputPath (Join-Path $missingRoot "manifest.json") -RunId "missing-run" -PhaseStartedAt $gateStart
    } "missing.*09-tauri-native-build|09-tauri-native-build.*missing" "missing expected ledger"

    $unexpectedPath = Join-Path $gateRoot "unexpected-manifest.json"
    $unexpected = Get-Content -LiteralPath $gateManifestPath -Raw | ConvertFrom-Json
    $unexpected.Entries += [pscustomobject]@{ StepName = "99-unexpected"; LineagePath = (Join-Path $gateRoot "99-unexpected.lineage.json"); Sha256 = "BAD"; SchemaVersion = 1; Status = "PASS" }
    [IO.File]::WriteAllText($unexpectedPath, ($unexpected | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Assert-Throws { Read-Task15LineageManifest -ManifestPath $unexpectedPath -ExpectedPhase Gate -LogDirectory $gateRoot } "unexpected.*99-unexpected|99-unexpected.*unexpected" "unexpected current-run manifest entry"

    $duplicatePath = Join-Path $gateRoot "duplicate-manifest.json"
    $duplicate = Get-Content -LiteralPath $gateManifestPath -Raw | ConvertFrom-Json
    $duplicate.Entries += $duplicate.Entries[0]
    [IO.File]::WriteAllText($duplicatePath, ($duplicate | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Assert-Throws { Read-Task15LineageManifest -ManifestPath $duplicatePath -ExpectedPhase Gate -LogDirectory $gateRoot } "duplicate" "duplicate current-run manifest entry"

    $missingEntryPath = Join-Path $gateRoot "missing-entry-manifest.json"
    $missingEntry = Get-Content -LiteralPath $gateManifestPath -Raw | ConvertFrom-Json
    $missingEntry.Entries = @($missingEntry.Entries | Select-Object -SkipLast 1)
    [IO.File]::WriteAllText($missingEntryPath, ($missingEntry | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    Assert-Throws { Read-Task15LineageManifest -ManifestPath $missingEntryPath -ExpectedPhase Gate -LogDirectory $gateRoot } "missing.*09-tauri-native-build|09-tauri-native-build.*missing" "missing current-run manifest entry"
}
finally {
    if (Test-Path -LiteralPath $manifestTestRoot) { Remove-Item -LiteralPath $manifestTestRoot -Recurse -Force }
}

"Task 15 process lineage tests: PASS"
