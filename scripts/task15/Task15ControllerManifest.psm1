Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Task15ExpectedControllerSteps {
    param([Parameter(Mandatory)][ValidateSet("Gate", "Build", "All")][string]$Phase)
    $gate = @("01-npm-ci","02-typecheck","03-vitest","04-playwright","05-vite-build","06-cargo-fmt","07-cargo-test","08-cargo-clippy","09-tauri-native-build")
    $build = @("10-acquire-bundler-tools","11-acquire-webview-offline","12-cycle-1-verify-webview-0.0.9","13-cycle-1-tauri-nsis-0.0.9","14-cycle-1-verify-webview-0.1.0","15-cycle-1-tauri-nsis-0.1.0")
    switch ($Phase) { Gate { $gate } Build { $build } All { @($gate + $build) } }
}

function Assert-Task15ControllerEvidence {
    param([Parameter(Mandatory)]$Evidence,[Parameter(Mandatory)][string]$ExpectedStepName,[Parameter(Mandatory)][datetime]$NotBefore,[Parameter(Mandatory)][string]$Path)
    foreach($property in @("SchemaVersion","Status","StepName","ControllerProcessId","ControllerCreationFiletime","RootProcessId","RootCreationFiletime","RequestedLimitFlags","EffectiveLimitFlags","BreakawayFlagsAbsent","CompletionPortAssociated","ProcessCreatedSuspended","AssignmentSucceeded","MembershipVerified","Resumed","RootExitCode","TerminateJobAttempted","TerminateJobSucceeded","FinalAccounting","PidListQueries","FinalPidListEmpty","CompletionEventsDiagnostic","ControllerIdentity","StartedAt","CompletedAt","Errors")) {
        if($Evidence.PSObject.Properties.Name -notcontains $property){throw "Controller evidence schema is missing '$property' for $ExpectedStepName`: $Path"}
    }
    if([int]$Evidence.SchemaVersion-ne 1 -or [string]$Evidence.Status-cne "PASS" -or [string]$Evidence.StepName-cne $ExpectedStepName){throw "Controller evidence identity/status failed for $ExpectedStepName`: $Path"}
    if([datetime]$Evidence.StartedAt-lt $NotBefore -or [datetime]$Evidence.CompletedAt-lt [datetime]$Evidence.StartedAt){throw "Controller evidence timestamps are stale/invalid for $ExpectedStepName`: $Path"}
    if([uint32]$Evidence.RequestedLimitFlags-ne 0x2000 -or [uint32]$Evidence.EffectiveLimitFlags-ne 0x2000 -or -not $Evidence.BreakawayFlagsAbsent){throw "Controller effective Job Object flags failed for $ExpectedStepName`: $Path"}
    if(-not $Evidence.CompletionPortAssociated -or -not $Evidence.ProcessCreatedSuspended -or -not $Evidence.AssignmentSucceeded -or -not $Evidence.MembershipVerified -or -not $Evidence.Resumed){throw "Controller assign-before-resume proof failed for $ExpectedStepName`: $Path"}
    if(-not $Evidence.TerminateJobAttempted -or -not $Evidence.TerminateJobSucceeded -or [int]$Evidence.FinalAccounting.ActiveProcesses-ne 0 -or -not $Evidence.FinalPidListEmpty){throw "Controller final kernel cleanup proof failed for $ExpectedStepName`: $Path"}
    if(@($Evidence.Errors).Count-ne 0){throw "Controller evidence contains errors for $ExpectedStepName`: $Path"}
    if([string]$Evidence.ControllerIdentity.BinarySha256 -notmatch '^[0-9A-F]{64}$' -or [string]$Evidence.ControllerIdentity.SourceSha256 -notmatch '^[0-9A-F]{64}$' -or [string]$Evidence.ControllerIdentity.PeMachine-cne '0x8664'){throw "Controller binary/source identity failed for $ExpectedStepName`: $Path"}
}

function Publish-Task15ControllerManifest {
    param([Parameter(Mandatory)][ValidateSet("Gate","Build","All")][string]$Phase,[Parameter(Mandatory)][string]$LogDirectory,[Parameter(Mandatory)][string]$OutputPath,[Parameter(Mandatory)][string]$RunId,[Parameter(Mandatory)][datetime]$PhaseStartedAt)
    $logRoot=[IO.Path]::GetFullPath($LogDirectory).TrimEnd('\')
    $expected=@(Get-Task15ExpectedControllerSteps -Phase $Phase)
    $entries=foreach($step in $expected){
        $path=Join-Path $logRoot "$step.controller.json"
        if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Missing expected controller evidence for $step`: $path"}
        $evidence=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
        Assert-Task15ControllerEvidence -Evidence $evidence -ExpectedStepName $step -NotBefore $PhaseStartedAt -Path $path
        [ordered]@{StepName=$step;ControllerEvidencePath=[IO.Path]::GetFullPath($path);Sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;SchemaVersion=[int]$evidence.SchemaVersion;Status=[string]$evidence.Status;StartedAt=[string]$evidence.StartedAt;CompletedAt=[string]$evidence.CompletedAt}
    }
    $manifest=[ordered]@{SchemaVersion=1;ManifestKind="Task15JobControllerPhase";Phase=$Phase;Status="PASS";RunId=$RunId;PhaseStartedAt=$PhaseStartedAt.ToString("o");CompletedAt=(Get-Date).ToString("o");ExpectedSteps=$expected;Entries=@($entries)}
    [IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputPath),($manifest|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
    Read-Task15ControllerManifest -ManifestPath $OutputPath -ExpectedPhase $Phase -LogDirectory $logRoot
}

function Read-Task15ControllerManifest {
    param([Parameter(Mandatory)][string]$ManifestPath,[Parameter(Mandatory)][ValidateSet("Gate","Build","All")][string]$ExpectedPhase,[Parameter(Mandatory)][string]$LogDirectory)
    $path=[IO.Path]::GetFullPath($ManifestPath); $logRoot=[IO.Path]::GetFullPath($LogDirectory).TrimEnd('\')
    if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Missing controller manifest: $path"}
    $manifest=Get-Content -LiteralPath $path -Raw|ConvertFrom-Json
    if([int]$manifest.SchemaVersion-ne 1 -or [string]$manifest.ManifestKind-cne "Task15JobControllerPhase" -or [string]$manifest.Phase-cne $ExpectedPhase -or [string]$manifest.Status-cne "PASS"){throw "Invalid controller phase manifest: $path"}
    $expected=@(Get-Task15ExpectedControllerSteps -Phase $ExpectedPhase); $entries=@($manifest.Entries)
    if($entries.Count-ne $expected.Count){throw "Controller manifest entry count mismatch: $path"}
    foreach($step in $expected){
        $matches=@($entries|Where-Object StepName -CEQ $step); if($matches.Count-ne 1){throw "Missing or duplicate controller manifest entry for $step"}
        $entry=$matches[0]; $evidencePath=[IO.Path]::GetFullPath([string]$entry.ControllerEvidencePath); $wanted=[IO.Path]::GetFullPath((Join-Path $logRoot "$step.controller.json"))
        if(-not $evidencePath.Equals($wanted,[StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $evidencePath -Algorithm SHA256).Hash -cne [string]$entry.Sha256){throw "Controller evidence path/hash mismatch for $step"}
        Assert-Task15ControllerEvidence -Evidence (Get-Content -LiteralPath $evidencePath -Raw|ConvertFrom-Json) -ExpectedStepName $step -NotBefore ([datetime]$manifest.PhaseStartedAt) -Path $evidencePath
    }
    $manifest
}

Export-ModuleMember -Function Get-Task15ExpectedControllerSteps,Assert-Task15ControllerEvidence,Publish-Task15ControllerManifest,Read-Task15ControllerManifest

