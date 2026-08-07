Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Task15CreationUtcTicks {
    param([Parameter(Mandatory)]$CreationDate)
    if ($CreationDate -is [datetime]) { return ([DateTimeOffset]$CreationDate).UtcDateTime.Ticks }
    return ([DateTimeOffset]::Parse([string]$CreationDate, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)).UtcDateTime.Ticks
}

function Get-Task15ProcessIdentityFromCim {
    param([Parameter(Mandatory)]$Process)
    $creation = [datetime]$Process.CreationDate
    [pscustomobject][ordered]@{
        ProcessId = [int]$Process.ProcessId
        ParentProcessId = [int]$Process.ParentProcessId
        CreationDate = $creation.ToString("o")
        Name = [string]$Process.Name
        ExecutablePath = [string]$Process.ExecutablePath
        CommandLine = [string]$Process.CommandLine
    }
}

function Get-Task15ProcessIdentityKey {
    param([Parameter(Mandatory)]$Identity)
    return "$([int]$Identity.ProcessId)|$(Get-Task15CreationUtcTicks $Identity.CreationDate)"
}

function Test-Task15ExactProcessIdentity {
    param([Parameter(Mandatory)]$Identity)
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$Identity.ProcessId)" -ErrorAction SilentlyContinue
    if (-not $current) { return $false }
    return (Get-Task15CreationUtcTicks ([datetime]$current.CreationDate)) -eq (Get-Task15CreationUtcTicks $Identity.CreationDate)
}

function Test-Task15ValidLineageEdge {
    param([Parameter(Mandatory)]$ParentIdentity,[Parameter(Mandatory)]$ChildProcess)
    if ([int]$ChildProcess.ParentProcessId -ne [int]$ParentIdentity.ProcessId) { return $false }
    return (Get-Task15CreationUtcTicks ([datetime]$ChildProcess.CreationDate)) -ge (Get-Task15CreationUtcTicks $ParentIdentity.CreationDate)
}

function Add-Task15TrackedIdentity {
    param([Parameter(Mandatory)]$Tracker,[Parameter(Mandatory)]$Process,$DiscoveredFrom)
    $identity = Get-Task15ProcessIdentityFromCim $Process
    $key = Get-Task15ProcessIdentityKey $identity
    if (-not $Tracker.Records.ContainsKey($key)) {
        $now = (Get-Date).ToString("o")
        $Tracker.Records[$key] = [pscustomobject][ordered]@{
            ProcessId = $identity.ProcessId
            ParentProcessId = $identity.ParentProcessId
            CreationDate = $identity.CreationDate
            Name = $identity.Name
            ExecutablePath = $identity.ExecutablePath
            CommandLine = $identity.CommandLine
            DiscoveredFrom = $DiscoveredFrom
            FirstSeenAt = $now
            LastSeenAt = $now
        }
    }
    return $key
}

function New-Task15ProcessLineageTracker {
    param(
        [Parameter(Mandatory)][string]$StepName,
        [Parameter(Mandatory)][int]$RootProcessId,
        [Parameter(Mandatory)][string]$EvidencePath
    )
    $root = Get-CimInstance Win32_Process -Filter "ProcessId = $RootProcessId" -ErrorAction SilentlyContinue
    if (-not $root) { throw "Cannot start lineage tracker because root PID $RootProcessId is absent." }
    $tracker = [pscustomobject]@{
        StepName = $StepName
        EvidencePath = [IO.Path]::GetFullPath($EvidencePath)
        StartedAt = Get-Date
        RootKey = $null
        Records = @{}
        SampleCount = 0
        LastSampleAt = $null
    }
    $tracker.RootKey = Add-Task15TrackedIdentity -Tracker $tracker -Process $root -DiscoveredFrom $null
    Update-Task15ProcessLineageTracker -Tracker $tracker
    return $tracker
}

function Update-Task15ProcessLineageTracker {
    param([Parameter(Mandatory)]$Tracker)
    $snapshot = @(Get-CimInstance Win32_Process)
    $byPid = @{}
    foreach ($process in $snapshot) { $byPid[[int]$process.ProcessId] = $process }
    $liveTrackedPids = [Collections.Generic.HashSet[int]]::new()
    foreach ($entry in @($Tracker.Records.GetEnumerator())) {
        $record = $entry.Value
        $current = $byPid[[int]$record.ProcessId]
        if ($current -and (Get-Task15CreationUtcTicks ([datetime]$current.CreationDate)) -eq (Get-Task15CreationUtcTicks $record.CreationDate)) {
            [void]$liveTrackedPids.Add([int]$record.ProcessId)
            $record.LastSeenAt = (Get-Date).ToString("o")
        }
    }
    $added = $true
    while ($added) {
        $added = $false
        foreach ($process in $snapshot) {
            $pid = [int]$process.ProcessId
            if ($liveTrackedPids.Contains($pid) -or -not $liveTrackedPids.Contains([int]$process.ParentProcessId)) { continue }
            $parentRecord = @($Tracker.Records.Values | Where-Object {
                [int]$_.ProcessId -eq [int]$process.ParentProcessId -and
                (Get-Task15CreationUtcTicks $_.CreationDate) -eq (Get-Task15CreationUtcTicks ([datetime]$byPid[[int]$process.ParentProcessId].CreationDate))
            } | Select-Object -First 1)
            if ($parentRecord.Count -ne 1 -or -not (Test-Task15ValidLineageEdge -ParentIdentity $parentRecord[0] -ChildProcess $process)) { continue }
            $parentKey = Get-Task15ProcessIdentityKey $parentRecord[0]
            [void](Add-Task15TrackedIdentity -Tracker $Tracker -Process $process -DiscoveredFrom $parentKey)
            [void]$liveTrackedPids.Add($pid)
            $added = $true
        }
    }
    $Tracker.SampleCount = [int]$Tracker.SampleCount + 1
    $Tracker.LastSampleAt = Get-Date
}

function Get-Task15TrackedSurvivors {
    param([Parameter(Mandatory)]$Tracker)
    $survivors = [Collections.Generic.List[object]]::new()
    foreach ($record in @($Tracker.Records.Values)) {
        if (Test-Task15ExactProcessIdentity -Identity $record) { $survivors.Add($record) }
    }
    return @($survivors | Sort-Object ProcessId, CreationDate)
}

function Stop-Task15TrackedIdentity {
    param([Parameter(Mandatory)]$Identity)
    if (-not (Test-Task15ExactProcessIdentity -Identity $Identity)) { return $false }
    $process = Get-Process -Id ([int]$Identity.ProcessId) -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    $startTicks = ([DateTimeOffset]$process.StartTime).UtcDateTime.Ticks
    if ([math]::Abs($startTicks - (Get-Task15CreationUtcTicks $Identity.CreationDate)) -gt [TimeSpan]::TicksPerSecond) {
        throw "PID $($Identity.ProcessId) start time changed before exact tracked cleanup; refusing termination."
    }
    $process.Kill()
    [void]$process.WaitForExit(10000)
    return -not (Test-Task15ExactProcessIdentity -Identity $Identity)
}

function Write-Task15LineageEvidence {
    param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)]$Evidence)
    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    $json = $Evidence | ConvertTo-Json -Depth 8
    [IO.File]::WriteAllText($Path, $json, [Text.UTF8Encoding]::new($false))
}

function Complete-Task15ProcessLineageTracker {
    param(
        [Parameter(Mandatory)]$Tracker,
        [int]$GraceSeconds = 10,
        [switch]$TerminateTrackedSurvivors
    )
    $deadline = (Get-Date).AddSeconds([math]::Max(0, $GraceSeconds))
    do {
        Update-Task15ProcessLineageTracker -Tracker $Tracker
        $survivors = @(Get-Task15TrackedSurvivors -Tracker $Tracker)
        if ($survivors.Count -eq 0 -or (Get-Date) -ge $deadline) { break }
        Start-Sleep -Milliseconds 100
    } while ($true)
    $beforeCleanup = @(Get-Task15TrackedSurvivors -Tracker $Tracker)
    $terminated = [Collections.Generic.List[object]]::new()
    if ($TerminateTrackedSurvivors) {
        foreach ($identity in $beforeCleanup) {
            if (Stop-Task15TrackedIdentity -Identity $identity) { $terminated.Add($identity) }
        }
    }
    $afterCleanup = @(Get-Task15TrackedSurvivors -Tracker $Tracker)
    $completedAt = Get-Date
    $evidence = [pscustomobject][ordered]@{
        SchemaVersion = 1
        Status = if ($afterCleanup.Count -eq 0) { "PASS" } else { "FAIL" }
        StepName = $Tracker.StepName
        StartedAt = $Tracker.StartedAt.ToString("o")
        CompletedAt = $completedAt.ToString("o")
        SampleCount = [int]$Tracker.SampleCount
        RootIdentityKey = $Tracker.RootKey
        TrackedProcesses = @($Tracker.Records.Values | Sort-Object FirstSeenAt, ProcessId)
        SurvivorsBeforeCleanup = $beforeCleanup
        TerminatedProcesses = @($terminated)
        SurvivorsAfterCleanup = $afterCleanup
    }
    Write-Task15LineageEvidence -Path $Tracker.EvidencePath -Evidence $evidence
    if ($afterCleanup.Count -ne 0) { throw "Tracked process survivors remain for $($Tracker.StepName); see $($Tracker.EvidencePath)." }
    return $evidence
}

function Assert-Task15LineageEvidenceClean {
    param([Parameter(Mandatory)][string[]]$EvidencePaths)
    foreach ($path in $EvidencePaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing process-lineage evidence: $path" }
        $evidence = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        if ([string]$evidence.Status -cne "PASS" -or @($evidence.SurvivorsAfterCleanup).Count -ne 0) { throw "Unclean process-lineage evidence: $path" }
        foreach ($identity in @($evidence.TrackedProcesses)) {
            if (Test-Task15ExactProcessIdentity -Identity $identity) { throw "Exact tracked process remains: PID $($identity.ProcessId), creation $($identity.CreationDate), evidence $path" }
        }
    }
}

Export-ModuleMember -Function New-Task15ProcessLineageTracker,Update-Task15ProcessLineageTracker,Complete-Task15ProcessLineageTracker,Test-Task15ExactProcessIdentity,Test-Task15ValidLineageEdge,Assert-Task15LineageEvidenceClean
