param(
    [Parameter(Mandatory = $true)]
    [string] $PreviousInstaller,

    [Parameter(Mandatory = $true)]
    [string] $CurrentInstaller,

    [Parameter(Mandatory = $true)]
    [string] $EvidenceDirectory
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

$previous = Get-Item -LiteralPath (Resolve-Path -LiteralPath $PreviousInstaller)
$current = Get-Item -LiteralPath (Resolve-Path -LiteralPath $CurrentInstaller)
if ($previous.Extension -cne ".exe" -or $current.Extension -cne ".exe") {
    throw "Both inputs must be exact .exe installer files."
}

New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$resolvedEvidence = (Resolve-Path -LiteralPath $EvidenceDirectory).Path
$report = [ordered]@{
    Status = "READY_FOR_TASK_15B"
    Environment = "Windows Sandbox"
    PreviousInstaller = [ordered]@{
        Path = $previous.FullName
        Length = $previous.Length
        SHA256 = (Get-FileHash -LiteralPath $previous.FullName -Algorithm SHA256).Hash
        Authenticode = (Get-AuthenticodeSignature -LiteralPath $previous.FullName).Status.ToString()
    }
    CurrentInstaller = [ordered]@{
        Path = $current.FullName
        Length = $current.Length
        SHA256 = (Get-FileHash -LiteralPath $current.FullName -Algorithm SHA256).Hash
        Authenticode = (Get-AuthenticodeSignature -LiteralPath $current.FullName).Status.ToString()
    }
    Note = "This guard validates exact inputs only. Task 15B supplies the isolated install, UI persistence, upgrade, same-version reinstall, uninstall-preservation, and reinstall test controller."
}

$reportPath = Join-Path $resolvedEvidence "installer-input-preflight.json"
[IO.File]::WriteAllText(
    $reportPath,
    ($report | ConvertTo-Json -Depth 6),
    [Text.UTF8Encoding]::new($false)
)
$report | ConvertTo-Json -Depth 6

