Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:Task15BoundaryToleranceMilliseconds = 0

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
    $childTicks = Get-Task15CreationUtcTicks ([datetime]$ChildProcess.CreationDate)
    if ($childTicks -lt (Get-Task15CreationUtcTicks $ParentIdentity.CreationDate)) { return $false }
    if ($ParentIdentity.PSObject.Properties.Name -contains "ExitTime" -and $ParentIdentity.ExitTime) {
        return $childTicks -le (Get-Task15CreationUtcTicks $ParentIdentity.ExitTime)
    }
    return $true
}

function Test-Task15HistoricalLineageEdge {
    param([Parameter(Mandatory)]$ParentIdentity,[Parameter(Mandatory)]$ChildProcess)
    if ([int]$ChildProcess.ParentProcessId -ne [int]$ParentIdentity.ProcessId) { return $false }
    $childTicks = Get-Task15CreationUtcTicks ([datetime]$ChildProcess.CreationDate)
    $parentCreationTicks = Get-Task15CreationUtcTicks $ParentIdentity.CreationDate
    if ($ParentIdentity.PSObject.Properties.Name -notcontains "ExitTime" -or -not $ParentIdentity.ExitTime) { return $false }
    if ($ParentIdentity.PSObject.Properties.Name -notcontains "ExitTimeSource" -or [string]$ParentIdentity.ExitTimeSource -cne "RetainedProcessHandle") { return $false }
    $exitTicks = Get-Task15CreationUtcTicks $ParentIdentity.ExitTime
    return $childTicks -ge $parentCreationTicks -and $childTicks -le $exitTicks
}

function Add-Task15ExitTimeAssuranceFailure {
    param([Parameter(Mandatory)]$Tracker,[Parameter(Mandatory)]$Identity,[Parameter(Mandatory)][string]$Reason)
    $key = Get-Task15ProcessIdentityKey $Identity
    if (@($Tracker.ExitTimeAssuranceFailures | Where-Object { [string]$_.IdentityKey -ceq $key }).Count -eq 0) {
        $Tracker.ExitTimeAssuranceFailures.Add([pscustomobject][ordered]@{
            IdentityKey = $key
            ProcessId = [int]$Identity.ProcessId
            CreationDate = [string]$Identity.CreationDate
            Name = [string]$Identity.Name
            Reason = $Reason
        })
    }
}

function Add-Task15RetainedProcessHandle {
    param([Parameter(Mandatory)]$Tracker,[Parameter(Mandatory)]$Identity)
    $key = Get-Task15ProcessIdentityKey $Identity
    if ($Tracker.RetainedHandles.ContainsKey($key)) { return }
    $process = $null
    try {
        $process = [Diagnostics.Process]::GetProcessById([int]$Identity.ProcessId)
        [void]$process.Handle
        $startTime = $process.StartTime
        $delta = [math]::Abs($startTime.ToUniversalTime().Ticks - (Get-Task15CreationUtcTicks $Identity.CreationDate))
        if ($delta -gt [TimeSpan]::TicksPerMillisecond) {
            throw "PID/start-time mismatch while retaining exact process handle (delta ticks $delta)."
        }
        $Tracker.RetainedHandles[$key] = [pscustomobject]@{
            IdentityKey = $key
            Process = $process
            StartTime = $startTime.ToString("o")
            ExitTimeCaptured = $false
            LastExitTimeError = $null
            Disposed = $false
        }
        $Tracker.RetainedHandleCount = [int]$Tracker.RetainedHandleCount + 1
    }
    catch {
        if ($process) { $process.Dispose() }
        $Identity.ExitTimeSource = "Unavailable"
        Add-Task15ExitTimeAssuranceFailure -Tracker $Tracker -Identity $Identity -Reason ("Unable to retain exact process handle: " + $_.Exception.Message)
    }
}

function Update-Task15RetainedExitTimes {
    param([Parameter(Mandatory)]$Tracker)
    foreach ($state in @($Tracker.RetainedHandles.Values)) {
        if ($state.ExitTimeCaptured -or $state.Disposed) { continue }
        $record = $Tracker.Records[[string]$state.IdentityKey]
        try {
            $state.Process.Refresh()
            if ($state.Process.HasExited) {
                $record.ExitTime = $state.Process.ExitTime.ToString("o")
                $record.ExitTimeSource = "RetainedProcessHandle"
                $state.ExitTimeCaptured = $true
                $state.LastExitTimeError = $null
            }
        }
        catch {
            $state.LastExitTimeError = $_.Exception.Message
        }
    }
}

function Set-Task15ParentExitTimeEvidence {
    param([Parameter(Mandatory)]$Tracker)
    foreach ($record in @($Tracker.Records.Values)) {
        if (-not $record.DiscoveredFrom) { continue }
        $parent = $Tracker.Records[[string]$record.DiscoveredFrom]
        $record.ParentExitTime = if ($parent -and $parent.ExitTime) { [string]$parent.ExitTime } else { $null }
    }
}

function Dispose-Task15RetainedProcessHandles {
    param([Parameter(Mandatory)]$Tracker)
    if ($Tracker.HandlesDisposed) { return }
    foreach ($state in @($Tracker.RetainedHandles.Values)) {
        if ($state.Disposed) { continue }
        try { $state.Process.Dispose() }
        finally {
            $state.Disposed = $true
            $Tracker.DisposedHandleCount = [int]$Tracker.DisposedHandleCount + 1
        }
    }
    $Tracker.HandlesDisposed = $true
}

function Add-Task15TrackedIdentity {
    param([Parameter(Mandatory)]$Tracker,[Parameter(Mandatory)]$Process,$DiscoveredFrom,[string]$DiscoveryReason="LiveParent")
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
            DiscoveryReason = $DiscoveryReason
            FirstSeenAt = $now
            LastSeenAt = $now
            ExitTime = $null
            ExitTimeSource = $null
            ParentExitTime = $null
        }
        Add-Task15RetainedProcessHandle -Tracker $Tracker -Identity $Tracker.Records[$key]
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
        RetainedHandles = @{}
        ExitTimeAssuranceFailures = [Collections.Generic.List[object]]::new()
        RetainedHandleCount = 0
        DisposedHandleCount = 0
        HandlesDisposed = $false
        SampleCount = 0
        LastSampleAt = $null
    }
    $tracker.RootKey = Add-Task15TrackedIdentity -Tracker $tracker -Process $root -DiscoveredFrom $null -DiscoveryReason "Root"
    Update-Task15ProcessLineageTracker -Tracker $tracker
    return $tracker
}

function Update-Task15ProcessLineageTracker {
    param([Parameter(Mandatory)]$Tracker,[switch]$AllowHistoricalParentBoundary,[object[]]$ProcessSnapshot)
    Update-Task15RetainedExitTimes -Tracker $Tracker
    $snapshot = if ($PSBoundParameters.ContainsKey("ProcessSnapshot")) { @($ProcessSnapshot) } else { @(Get-CimInstance Win32_Process) }
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
            if ($liveTrackedPids.Contains($pid)) { continue }
            $parentPid = [int]$process.ParentProcessId
            $parentRecord = @()
            $reason = $null
            if ($liveTrackedPids.Contains($parentPid)) {
                $parentRecord = @($Tracker.Records.Values | Where-Object {
                    [int]$_.ProcessId -eq $parentPid -and
                    (Get-Task15CreationUtcTicks $_.CreationDate) -eq (Get-Task15CreationUtcTicks ([datetime]$byPid[$parentPid].CreationDate)) -and
                    (Test-Task15ValidLineageEdge -ParentIdentity $_ -ChildProcess $process)
                })
                $reason = "LiveParent"
            }
            elseif ($AllowHistoricalParentBoundary -and -not $byPid.ContainsKey($parentPid)) {
                $parentRecord = @($Tracker.Records.Values | Where-Object {
                    [int]$_.ProcessId -eq $parentPid -and
                    (Test-Task15HistoricalLineageEdge -ParentIdentity $_ -ChildProcess $process)
                })
                $reason = "ParentExitBoundary"
            }
            if ($parentRecord.Count -ne 1) { continue }
            $parentKey = Get-Task15ProcessIdentityKey $parentRecord[0]
            [void](Add-Task15TrackedIdentity -Tracker $Tracker -Process $process -DiscoveredFrom $parentKey -DiscoveryReason $reason)
            [void]$liveTrackedPids.Add($pid)
            $added = $true
        }
    }
    $Tracker.SampleCount = [int]$Tracker.SampleCount + 1
    $Tracker.LastSampleAt = Get-Date
    Update-Task15RetainedExitTimes -Tracker $Tracker
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
    if ([math]::Abs($startTicks - (Get-Task15CreationUtcTicks $Identity.CreationDate)) -gt [TimeSpan]::TicksPerMillisecond) {
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
    $completionSamplingStarted = Get-Date
    $beforeCleanup = @()
    $afterCleanup = @()
    $terminated = [Collections.Generic.List[object]]::new()
    $evidence = $null
    try {
        $deadline = $completionSamplingStarted.AddSeconds([math]::Max(0, $GraceSeconds))
        do {
            Update-Task15ProcessLineageTracker -Tracker $Tracker -AllowHistoricalParentBoundary
            [void]@(Get-Task15TrackedSurvivors -Tracker $Tracker)
            if ((Get-Date) -ge $deadline) { break }
            Start-Sleep -Milliseconds 100
        } while ($true)
        $beforeCleanup = @(Get-Task15TrackedSurvivors -Tracker $Tracker)
        if ($TerminateTrackedSurvivors) {
            foreach ($identity in $beforeCleanup) {
                if (Stop-Task15TrackedIdentity -Identity $identity) { $terminated.Add($identity) }
            }
        }
        $afterCleanup = @(Get-Task15TrackedSurvivors -Tracker $Tracker)
        Update-Task15RetainedExitTimes -Tracker $Tracker
        foreach ($record in @($Tracker.Records.Values)) {
            if (-not (Test-Task15ExactProcessIdentity -Identity $record) -and -not $record.ExitTime) {
                $key = Get-Task15ProcessIdentityKey $record
                $state = $Tracker.RetainedHandles[$key]
                $detail = if ($state -and $state.LastExitTimeError) { [string]$state.LastExitTimeError } else { "Exact ExitTime was unavailable after process exit." }
                $record.ExitTimeSource = "Unavailable"
                Add-Task15ExitTimeAssuranceFailure -Tracker $Tracker -Identity $record -Reason $detail
            }
        }
        Set-Task15ParentExitTimeEvidence -Tracker $Tracker
        Dispose-Task15RetainedProcessHandles -Tracker $Tracker
        $completedAt = Get-Date
        $assuranceFailures = @($Tracker.ExitTimeAssuranceFailures)
        $evidence = [pscustomobject][ordered]@{
            SchemaVersion = 1
            Status = if ($afterCleanup.Count -eq 0 -and $assuranceFailures.Count -eq 0) { "PASS" } else { "FAIL" }
            StepName = $Tracker.StepName
            StartedAt = $Tracker.StartedAt.ToString("o")
            CompletedAt = $completedAt.ToString("o")
            SampleCount = [int]$Tracker.SampleCount
            BoundaryToleranceMilliseconds = $script:Task15BoundaryToleranceMilliseconds
            CompletionGraceSeconds = $GraceSeconds
            CompletionSamplingDurationMilliseconds = [math]::Round(($completedAt - $completionSamplingStarted).TotalMilliseconds, 3)
            RootIdentityKey = $Tracker.RootKey
            TrackedProcesses = @($Tracker.Records.Values | Sort-Object FirstSeenAt, ProcessId)
            SurvivorsBeforeCleanup = $beforeCleanup
            TerminatedProcesses = @($terminated)
            SurvivorsAfterCleanup = $afterCleanup
            ExitTimeAssuranceFailures = $assuranceFailures
            ExitTimeAssuranceFailureCount = $assuranceFailures.Count
            RetainedHandleCount = [int]$Tracker.RetainedHandleCount
            DisposedHandleCount = [int]$Tracker.DisposedHandleCount
            HandlesDisposed = [bool]$Tracker.HandlesDisposed
        }
        Write-Task15LineageEvidence -Path $Tracker.EvidencePath -Evidence $evidence
        if ($assuranceFailures.Count -ne 0) { throw "Exact process ExitTime assurance failed for $($Tracker.StepName); see $($Tracker.EvidencePath)." }
        if ($afterCleanup.Count -ne 0) { throw "Tracked process survivors remain for $($Tracker.StepName); see $($Tracker.EvidencePath)." }
        return $evidence
    }
    finally {
        if (-not $Tracker.HandlesDisposed) { Dispose-Task15RetainedProcessHandles -Tracker $Tracker }
    }
}

function Get-Task15InvalidLineageEdges {
    param([Parameter(Mandatory)]$Evidence)
    $records = @($Evidence.TrackedProcesses)
    $byKey = @{}
    foreach ($record in $records) { $byKey[(Get-Task15ProcessIdentityKey $record)] = $record }
    $invalid = [Collections.Generic.List[object]]::new()
    foreach ($record in $records) {
        if ($record.PSObject.Properties.Name -notcontains "ExitTime" -or -not $record.ExitTime -or
            $record.PSObject.Properties.Name -notcontains "ExitTimeSource" -or [string]$record.ExitTimeSource -cne "RetainedProcessHandle") {
            $invalid.Add([pscustomobject]@{ProcessId=$record.ProcessId;CreationDate=$record.CreationDate;Reason="missing exact retained-handle ExitTime assurance"})
            continue
        }
        if (-not $record.DiscoveredFrom) {
            if ([string]$record.DiscoveryReason -cne "Root" -or (Get-Task15ProcessIdentityKey $record) -cne [string]$Evidence.RootIdentityKey) {
                $invalid.Add([pscustomobject]@{ProcessId=$record.ProcessId;CreationDate=$record.CreationDate;Reason="invalid root identity/reason"})
            }
            continue
        }
        $parent = $byKey[[string]$record.DiscoveredFrom]
        if (-not $parent) {
            $invalid.Add([pscustomobject]@{ProcessId=$record.ProcessId;CreationDate=$record.CreationDate;Reason="missing exact parent identity"})
            continue
        }
        if ($record.PSObject.Properties.Name -notcontains "ParentExitTime" -or -not $record.ParentExitTime -or
            (Get-Task15CreationUtcTicks $record.ParentExitTime) -ne (Get-Task15CreationUtcTicks $parent.ExitTime)) {
            $invalid.Add([pscustomobject]@{ProcessId=$record.ProcessId;CreationDate=$record.CreationDate;ParentIdentityKey=$record.DiscoveredFrom;DiscoveryReason=$record.DiscoveryReason;Reason="missing or mismatched exact ParentExitTime evidence"})
            continue
        }
        $valid = switch ([string]$record.DiscoveryReason) {
            "LiveParent" { Test-Task15ValidLineageEdge -ParentIdentity $parent -ChildProcess $record; break }
            "ParentExitBoundary" { Test-Task15HistoricalLineageEdge -ParentIdentity $parent -ChildProcess $record; break }
            default { $false }
        }
        if (-not $valid) {
            $invalid.Add([pscustomobject]@{ProcessId=$record.ProcessId;CreationDate=$record.CreationDate;ParentIdentityKey=$record.DiscoveredFrom;DiscoveryReason=$record.DiscoveryReason;Reason="invalid lineage edge"})
        }
    }
    return @($invalid)
}

function Assert-Task15LineageEvidenceClean {
    param([Parameter(Mandatory)][string[]]$EvidencePaths)
    foreach ($path in $EvidencePaths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing process-lineage evidence: $path" }
        $evidence = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        foreach ($property in @("ExitTimeAssuranceFailures", "ExitTimeAssuranceFailureCount", "RetainedHandleCount", "DisposedHandleCount", "HandlesDisposed")) {
            if ($evidence.PSObject.Properties.Name -notcontains $property) { throw "Missing exact ExitTime assurance schema '$property': $path" }
        }
        if ([int]$evidence.ExitTimeAssuranceFailureCount -ne 0 -or @($evidence.ExitTimeAssuranceFailures).Count -ne 0) { throw "Exact ExitTime assurance failed: $path" }
        if (-not [bool]$evidence.HandlesDisposed -or [int]$evidence.RetainedHandleCount -ne [int]$evidence.DisposedHandleCount) { throw "Retained process handles were not fully disposed: $path" }
        if ([string]$evidence.Status -cne "PASS" -or @($evidence.SurvivorsAfterCleanup).Count -ne 0) { throw "Unclean process-lineage evidence: $path" }
        $invalidEdges = @(Get-Task15InvalidLineageEdges -Evidence $evidence)
        if ($invalidEdges.Count -ne 0) { throw "Invalid lineage edge or boundary in evidence: $path" }
        foreach ($identity in @($evidence.TrackedProcesses)) {
            if (Test-Task15ExactProcessIdentity -Identity $identity) { throw "Exact tracked process remains: PID $($identity.ProcessId), creation $($identity.CreationDate), evidence $path" }
        }
    }
}

Export-ModuleMember -Function New-Task15ProcessLineageTracker,Update-Task15ProcessLineageTracker,Complete-Task15ProcessLineageTracker,Test-Task15ExactProcessIdentity,Test-Task15ValidLineageEdge,Test-Task15HistoricalLineageEdge,Get-Task15InvalidLineageEdges,Assert-Task15LineageEvidenceClean
