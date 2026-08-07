Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "Task15ProcessLineage.psm1")

function Get-Task15ExpectedLineageSteps {
    param([Parameter(Mandatory)][ValidateSet("Gate", "Build", "All")][string] $Phase)
    $gate = @(
        "01-npm-ci", "02-typecheck", "03-vitest", "04-playwright", "05-vite-build",
        "06-cargo-fmt", "07-cargo-test", "08-cargo-clippy", "09-tauri-native-build"
    )
    $build = @(
        "10-acquire-bundler-tools", "11-acquire-webview-offline",
        "12-cycle-1-verify-webview-0.0.9", "13-cycle-1-tauri-nsis-0.0.9",
        "14-cycle-1-verify-webview-0.1.0", "15-cycle-1-tauri-nsis-0.1.0"
    )
    switch ($Phase) {
        "Gate" { return $gate }
        "Build" { return $build }
        "All" { return @($gate + $build) }
    }
}

function Assert-Task15LineageLedgerSchema {
    param(
        [Parameter(Mandatory)] $Evidence,
        [Parameter(Mandatory)][string] $ExpectedStepName,
        [Parameter(Mandatory)][datetime] $NotBefore,
        [Parameter(Mandatory)][string] $Path
    )
    foreach ($property in @(
        "SchemaVersion", "Status", "StepName", "StartedAt", "CompletedAt", "SampleCount",
        "BoundaryToleranceMilliseconds", "CompletionGraceSeconds", "CompletionSamplingDurationMilliseconds",
        "RootIdentityKey", "TrackedProcesses", "SurvivorsBeforeCleanup", "TerminatedProcesses", "SurvivorsAfterCleanup",
        "ExitTimeAssuranceFailures", "ExitTimeAssuranceFailureCount", "RetainedHandleCount", "DisposedHandleCount", "HandlesDisposed"
    )) {
        if ($Evidence.PSObject.Properties.Name -notcontains $property) {
            throw "Lineage ledger schema is missing '$property' for $ExpectedStepName`: $Path"
        }
    }
    if ([int] $Evidence.SchemaVersion -ne 1) { throw "Unsupported lineage ledger schema for $ExpectedStepName`: $Path" }
    if ([string] $Evidence.Status -cne "PASS") { throw "Lineage ledger status is not PASS for $ExpectedStepName`: $Path" }
    if ([string] $Evidence.StepName -cne $ExpectedStepName) { throw "Lineage ledger step mismatch for $ExpectedStepName`: $Path" }
    if ([double] $Evidence.BoundaryToleranceMilliseconds -ne 0) { throw "Lineage ledger boundary tolerance is not zero for $ExpectedStepName`: $Path" }
    if ([datetime] $Evidence.StartedAt -lt $NotBefore) { throw "Lineage ledger is stale for current run step $ExpectedStepName`: $Path" }
    if ([datetime] $Evidence.CompletedAt -lt [datetime] $Evidence.StartedAt) { throw "Lineage ledger completion precedes start for $ExpectedStepName`: $Path" }
    foreach ($identity in @($Evidence.TrackedProcesses)) {
        foreach ($property in @(
            "ProcessId", "ParentProcessId", "CreationDate", "Name", "ExecutablePath", "CommandLine",
            "DiscoveredFrom", "DiscoveryReason", "FirstSeenAt", "LastSeenAt", "ExitTime", "ExitTimeSource", "ParentExitTime"
        )) {
            if ($identity.PSObject.Properties.Name -notcontains $property) {
                throw "Lineage identity schema is missing '$property' for $ExpectedStepName`: $Path"
            }
        }
        if ([string] $identity.DiscoveryReason -cnotin @("Root", "LiveParent", "ParentExitBoundary")) {
            throw "Invalid lineage discovery reason for $ExpectedStepName`: $Path"
        }
    }
    Assert-Task15LineageEvidenceClean -EvidencePaths @($Path)
}

function Publish-Task15LineageManifest {
    param(
        [Parameter(Mandatory)][ValidateSet("Gate", "Build", "All")][string] $Phase,
        [Parameter(Mandatory)][string] $LogDirectory,
        [Parameter(Mandatory)][string] $OutputPath,
        [Parameter(Mandatory)][string] $RunId,
        [Parameter(Mandatory)][datetime] $PhaseStartedAt
    )
    if (-not $RunId) { throw "RunId is required for a phase lineage manifest." }
    $logRoot = [IO.Path]::GetFullPath($LogDirectory).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $logRoot -PathType Container)) { throw "Lineage log directory does not exist: $logRoot" }
    $expectedSteps = @(Get-Task15ExpectedLineageSteps -Phase $Phase)
    $entries = @()
    foreach ($step in $expectedSteps) {
        $path = [IO.Path]::GetFullPath((Join-Path $logRoot "$step.lineage.json"))
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing expected lineage ledger for $step`: $path" }
        $evidence = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        Assert-Task15LineageLedgerSchema -Evidence $evidence -ExpectedStepName $step -NotBefore $PhaseStartedAt -Path $path
        $entries += [ordered]@{
            StepName = $step
            LineagePath = $path
            Sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
            SchemaVersion = [int] $evidence.SchemaVersion
            Status = [string] $evidence.Status
            StartedAt = [string] $evidence.StartedAt
            CompletedAt = [string] $evidence.CompletedAt
        }
    }
    $manifest = [ordered]@{
        SchemaVersion = 1
        ManifestKind = "Task15ProcessLineagePhase"
        Phase = $Phase
        Status = "PASS"
        RunId = $RunId
        PhaseStartedAt = $PhaseStartedAt.ToString("o")
        CompletedAt = (Get-Date).ToString("o")
        ExpectedSteps = $expectedSteps
        Entries = $entries
    }
    $resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
    $outputDirectory = Split-Path $resolvedOutput -Parent
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $outputDirectory | Out-Null
    }
    [IO.File]::WriteAllText($resolvedOutput, ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    return Read-Task15LineageManifest -ManifestPath $resolvedOutput -ExpectedPhase $Phase -LogDirectory $logRoot
}

function Read-Task15LineageManifest {
    param(
        [Parameter(Mandatory)][string] $ManifestPath,
        [Parameter(Mandatory)][ValidateSet("Gate", "Build", "All")][string] $ExpectedPhase,
        [Parameter(Mandatory)][string] $LogDirectory
    )
    $resolvedManifest = [IO.Path]::GetFullPath($ManifestPath)
    $logRoot = [IO.Path]::GetFullPath($LogDirectory).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $resolvedManifest -PathType Leaf)) { throw "Missing lineage manifest: $resolvedManifest" }
    $manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
    foreach ($property in @("SchemaVersion", "ManifestKind", "Phase", "Status", "RunId", "PhaseStartedAt", "CompletedAt", "ExpectedSteps", "Entries")) {
        if ($manifest.PSObject.Properties.Name -notcontains $property) { throw "Lineage manifest schema is missing '$property': $resolvedManifest" }
    }
    if ([int] $manifest.SchemaVersion -ne 1 -or [string] $manifest.ManifestKind -cne "Task15ProcessLineagePhase") {
        throw "Unsupported lineage manifest schema: $resolvedManifest"
    }
    if ([string] $manifest.Phase -cne $ExpectedPhase) { throw "Lineage manifest phase mismatch: expected $ExpectedPhase." }
    if ([string] $manifest.Status -cne "PASS") { throw "Lineage manifest status is not PASS: $resolvedManifest" }
    if (-not [string] $manifest.RunId) { throw "Lineage manifest RunId is empty: $resolvedManifest" }

    $expectedSteps = @(Get-Task15ExpectedLineageSteps -Phase $ExpectedPhase)
    $declaredSteps = @($manifest.ExpectedSteps | ForEach-Object { [string] $_ })
    $entries = @($manifest.Entries)
    $entrySteps = @($entries | ForEach-Object { [string] $_.StepName })
    $duplicateDeclared = @($declaredSteps | Group-Object -CaseSensitive | Where-Object Count -gt 1)
    $duplicateEntries = @($entrySteps | Group-Object -CaseSensitive | Where-Object Count -gt 1)
    if ($duplicateDeclared.Count -ne 0 -or $duplicateEntries.Count -ne 0) { throw "Duplicate current-run lineage manifest entry: $resolvedManifest" }
    foreach ($step in $expectedSteps) {
        if ($declaredSteps -cnotcontains $step -or $entrySteps -cnotcontains $step) { throw "Missing expected lineage manifest entry for $step`: $resolvedManifest" }
    }
    foreach ($step in @($declaredSteps + $entrySteps)) {
        if ($expectedSteps -cnotcontains $step) { throw "Unexpected current-run lineage manifest entry $step`: $resolvedManifest" }
    }
    if ($declaredSteps.Count -ne $expectedSteps.Count -or $entries.Count -ne $expectedSteps.Count) {
        throw "Lineage manifest entry count mismatch: $resolvedManifest"
    }

    $seenPaths = @{}
    foreach ($step in $expectedSteps) {
        $entry = @($entries | Where-Object { [string] $_.StepName -ceq $step })[0]
        foreach ($property in @("StepName", "LineagePath", "Sha256", "SchemaVersion", "Status", "StartedAt", "CompletedAt")) {
            if ($entry.PSObject.Properties.Name -notcontains $property) { throw "Lineage manifest entry schema is missing '$property' for $step." }
        }
        $expectedPath = [IO.Path]::GetFullPath((Join-Path $logRoot "$step.lineage.json"))
        $actualPath = [IO.Path]::GetFullPath([string] $entry.LineagePath)
        if (-not $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase)) { throw "Lineage manifest path mismatch for $step." }
        $pathKey = $actualPath.ToUpperInvariant()
        if ($seenPaths.ContainsKey($pathKey)) { throw "Duplicate lineage manifest path for $step." }
        $seenPaths[$pathKey] = $true
        if (-not (Test-Path -LiteralPath $actualPath -PathType Leaf)) { throw "Missing expected lineage ledger for $step`: $actualPath" }
        $hash = (Get-FileHash -LiteralPath $actualPath -Algorithm SHA256).Hash
        if ($hash -cne [string] $entry.Sha256) { throw "Lineage manifest hash mismatch for $step." }
        $evidence = Get-Content -LiteralPath $actualPath -Raw | ConvertFrom-Json
        Assert-Task15LineageLedgerSchema -Evidence $evidence -ExpectedStepName $step -NotBefore ([datetime] $manifest.PhaseStartedAt) -Path $actualPath
        if ([int] $entry.SchemaVersion -ne [int] $evidence.SchemaVersion -or [string] $entry.Status -cne [string] $evidence.Status -or
            [string] $entry.StartedAt -cne [string] $evidence.StartedAt -or [string] $entry.CompletedAt -cne [string] $evidence.CompletedAt) {
            throw "Lineage manifest entry metadata mismatch for $step."
        }
    }
    return $manifest
}

Export-ModuleMember -Function Get-Task15ExpectedLineageSteps,Publish-Task15LineageManifest,Read-Task15LineageManifest
