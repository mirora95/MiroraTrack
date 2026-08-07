param(
    [Parameter(Mandatory = $true)]
    [string] $PreviousInstaller,

    [Parameter(Mandatory = $true)]
    [string] $CurrentInstaller,

    [Parameter(Mandatory = $true)]
    [string] $EvidenceDirectory,

    [string] $ExpectedManifestPath
)

$ErrorActionPreference = "Stop"

# Installer lifecycle verification changes the current user's installed apps,
# shortcuts, WebView profile, and finance-data directories. It must never run
# against a normal user profile.
$isWindowsSandbox = $env:USERNAME -eq "WDAGUtilityAccount" -and
    (Test-Path -LiteralPath "C:\Users\WDAGUtilityAccount")
if (-not $isWindowsSandbox) {
    throw "Refusing to run outside Windows Sandbox. See docs/INSTALLER-VERIFICATION.md."
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $ExpectedManifestPath) { $ExpectedManifestPath = Join-Path $repositoryRoot "work\artifacts\task15\unaccepted\manifest.json" }
Import-Module (Join-Path $PSScriptRoot "task15\Task15InstallerPreflight.psm1") -Force
$report = Test-Task15InstallerPair -PreviousInstaller $PreviousInstaller -CurrentInstaller $CurrentInstaller -ExpectedManifestPath $ExpectedManifestPath

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$resolvedEvidence = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$report.Environment = "Windows Sandbox"
$report.Note = "READY only after exact name, distinct role, version, x64 manifest, size, SHA-256, and NotSigned checks. Task 15B still supplies lifecycle verification."

$reportPath = Join-Path $resolvedEvidence "installer-input-preflight.json"
[IO.File]::WriteAllText(
    $reportPath,
    ($report | ConvertTo-Json -Depth 6),
    [Text.UTF8Encoding]::new($false)
)
$report | ConvertTo-Json -Depth 6
