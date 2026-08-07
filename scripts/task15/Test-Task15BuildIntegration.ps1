$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$buildScript = Join-Path $repositoryRoot "scripts\Build-Task15Installers.ps1"
$text = Get-Content -LiteralPath $buildScript -Raw

function Require([string] $Pattern, [string] $Description) {
    if ($text -notmatch $Pattern) { throw "Missing build integration: $Description" }
}

Require 'Acquire-TauriBundlerTools\.ps1' "official verified acquisition"
Require 'Start-TauriBundlerMirror\.ps1' "loopback mirror startup"
Require 'TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE' "child-only Tauri mirror environment"
Require 'http://127\.0\.0\.1:' "literal loopback mirror template"
Require 'useLocalToolsDir' "temporary merge override local-tools setting"
Require '"version":"0\.0\.9"' "explicit 0.0.9 merge override"
Require '"version":"0\.1\.0"' "explicit 0.1.0 merge override"
Require 'Remove-ExactLocalToolsDirectory' "bounded target .tauri cleanup"
Require 'Assert-MirrorRequests' "both exact Tauri mirror requests"
Require 'Stop-ExactMirror' "exact mirror shutdown"
Require 'tauri-cli 2\.11\.4' "exact CLI version gate"
Require 'Task15BuildSafety\.psm1' "safe filesystem and publication module"
Require 'Task15JobController\.psm1' "native controller bootstrap and identity validation"
Require 'Task15ControllerManifest\.psm1' "explicit phase controller-evidence manifest module"
Require 'Initialize-Task15JobController' "validated source-backed controller bootstrap"
Require 'Publish-Task15ControllerManifest' "phase-scoped controller manifest publication"
Require 'controller-manifest-gate\.json' "explicit Gate controller manifest"
Require 'controller-manifest-build\.json' "explicit Build controller manifest"
Require 'controller-manifest-all\.json' "explicit All controller manifest"
Require '\.controller\.json' "per-step kernel Job Object evidence"
Require '--evidence' "controller evidence argument"
Require '--timeout-ms' "native wall-clock timeout"
Require 'BinarySha256' "validated controller binary identity"
Require 'Remove-Task15SafeDirectory' "reparse-safe recursive deletion"
Require 'New-Task15ArtifactCandidate' "same-directory artifact candidate"
Require 'Publish-Task15ArtifactSetAtomically' "two-version atomic publication"
Require 'try\s*\{[\s\S]*Start-Task15GuardedProcess[\s\S]*\}\s*catch' "local mirror-start cleanup catch"

if ($text -match 'Copy-Item[^\r\n]+-Destination\s+\$destination\s+-Force') {
    throw "Final artifacts must not be published with Copy-Item -Force."
}

$auditPath = Join-Path $PSScriptRoot "Invoke-Task15FinalIntegrityAudit.ps1"
if (-not (Test-Path -LiteralPath $auditPath)) { throw "Missing reusable final integrity audit." }
$audit = Get-Content -LiteralPath $auditPath -Raw
foreach ($required in @('EvidenceDirectory','ExtractionDirectory','OutputPath','Task15LogDirectory','PSCommandPath')) {
    if ($audit -notmatch $required) { throw "Reusable audit lacks $required." }
}
if ($audit -match 'final-review-20260803-') { throw "Reusable audit embeds a stale evidence path." }
if ($audit -match 'work\\logs\\task15a\\(?:retry|13-cycle|15-cycle|00-protected|99-protected)') { throw "Reusable audit hardcodes mutable Task 15 log inputs." }
foreach ($required in @('Task15ProcessLineage.psm1','Assert-Task15LineageEvidenceClean','TrackedProcesses')) {
    if ($audit -notmatch [regex]::Escape($required)) { throw "Reusable audit lacks persisted lineage integration: $required" }
}
foreach ($required in @('Task15LineageManifest.psm1','GateLineageManifestPath','BuildLineageManifestPath','Read-Task15LineageManifest')) {
    if ($audit -notmatch [regex]::Escape($required)) { throw "Reusable audit lacks explicit phase lineage manifest integration: $required" }
}
foreach ($required in @('DiscoveryReason','BoundaryToleranceMilliseconds','InvalidLineageEdgeCount','ParentExitTime','ExitTimeAssuranceFailureCount','RetainedProcessHandle')) {
    if ($audit -notmatch $required) { throw "Reusable audit lacks boundary-lineage field: $required" }
}
if ($audit -match 'function\s+Get-ExactDescendants') { throw "Reusable audit must not reconstruct lineage only after process exit." }

if ($text -match 'function\s+Get-Task15DescendantProcesses') { throw "Build must not rely on final-snapshot descendant reconstruction." }
if ($text -match 'Get-ChildItem[^\r\n]+\*\.lineage\.json') { throw "Build must not audit arbitrary root lineage globs." }
foreach ($retired in @('Start-Process\s+-FilePath\s+"powershell\.exe"','Get-JobPreamble','New-Task15ProcessLineageTracker','Update-Task15ProcessLineageTracker','Complete-Task15ProcessLineageTracker','Stop-ProcessTree')) {
    if ($text -match $retired) { throw "Retired process-lineage containment remains active: $retired" }
}

if ($text -match 'Remove-Item[^\r\n]+work\\toolchain\\tauri-bundler-mirror') {
    throw "Build script must not delete the validated mirror cache."
}

"Task 15 build integration static test: PASS"
