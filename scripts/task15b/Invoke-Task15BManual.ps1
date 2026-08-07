[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [int]$ReadyTimeoutSeconds = 1800
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) { $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
$wsbExecutable = (Get-Command wsb.exe -ErrorAction SilentlyContinue).Source
$runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$runRoot = Join-Path $RepositoryRoot "work\sandbox\task15b-manual\$runId"
$inputRoot = Join-Path $runRoot 'input'
$evidenceRoot = Join-Path $runRoot 'evidence'
$hostLogRoot = Join-Path $RepositoryRoot 'work\logs\task15b-manual'
$artifactRoot = Join-Path $RepositoryRoot 'work\artifacts\task15\unaccepted'

function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false)) }
function Write-AtomicJson([string]$Path, $Value) { $temp = "$Path.tmp"; Write-Utf8 $temp ($Value | ConvertTo-Json -Depth 15); Move-Item -LiteralPath $temp -Destination $Path -Force }

function Get-RunningSandboxIds {
    $raw = & $wsbExecutable ListRunningSandboxes --raw
    if ($LASTEXITCODE -ne 0) { throw 'ListRunningSandboxes failed.' }
    return @((($raw -join [Environment]::NewLine) | ConvertFrom-Json).WindowsSandboxEnvironments | ForEach-Object { [string]$_.Id })
}

function Copy-StagedInstaller([string]$Role) {
    $manifestPath = Join-Path $artifactRoot 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "BLOCKED: the Task 15A input manifest is absent at $manifestPath." }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $record = @($manifest.Installers | Where-Object { $_.Role -eq $Role })
    if ($record.Count -ne 1) { throw "The manifest does not contain exactly one '$Role' installer." }
    $record = $record[0]
    $source = Join-Path $artifactRoot (Join-Path $record.Version $record.Name)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "BLOCKED: the $Role installer is absent at $source." }
    $length = (Get-Item -LiteralPath $source).Length
    if ($length -ne [int64]$record.Size) { throw "$Role installer length $length does not match the manifest size $($record.Size)." }
    $hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ($hash -cne $record.Sha256) { throw "$Role installer SHA-256 $hash does not match the manifest hash $($record.Sha256)." }
    Copy-Item -LiteralPath $source -Destination (Join-Path $inputRoot $record.Name)
    return [ordered]@{ role = $Role; version = [string]$record.Version; name = [string]$record.Name; length = $length; sha256 = $hash }
}

try {
    New-Item -ItemType Directory -Force -Path $inputRoot, $evidenceRoot, $hostLogRoot | Out-Null
    if ([string]::IsNullOrWhiteSpace($wsbExecutable) -or -not (Test-Path -LiteralPath $wsbExecutable)) { throw 'BLOCKED: wsb.exe is absent.' }

    $installers = @((Copy-StagedInstaller 'Previous'), (Copy-StagedInstaller 'Current'))
    Copy-Item -LiteralPath (Join-Path $artifactRoot 'manifest.json') -Destination (Join-Path $inputRoot 'manifest.json')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'guest-manual.ps1') -Destination (Join-Path $inputRoot 'guest.ps1')
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\verify-installer.ps1') -Destination (Join-Path $inputRoot 'verify-installer.ps1')
    New-Item -ItemType Directory -Force -Path (Join-Path $inputRoot 'task15') | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\task15\Task15InstallerPreflight.psm1') -Destination (Join-Path $inputRoot 'task15\Task15InstallerPreflight.psm1')
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'docs\MANUAL-VERIFICATION.md') -Destination (Join-Path $inputRoot 'CHECKLIST.txt')

    Write-AtomicJson (Join-Path $evidenceRoot 'host-staging.json') ([ordered]@{ runId = $runId; installers = $installers; createdAt = (Get-Date).ToString('o') })

    $template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sandbox.wsb.template') -Raw
    $escape = { param($value) [Security.SecurityElement]::Escape($value) }
    $configuration = $template.Replace('{{MT_INPUT}}', (& $escape $inputRoot)).Replace('{{MT_EVIDENCE}}', (& $escape $evidenceRoot))
    [xml]$check = $configuration
    if (@($check.Configuration.MappedFolders.MappedFolder).Count -ne 2) { throw 'Generated sandbox configuration mapping count is not exactly two.' }
    Write-Utf8 (Join-Path $runRoot 'task15b-manual.wsb') $configuration

    $before = @(Get-RunningSandboxIds)
    if ($before.Count -gt 0) {
        throw "BLOCKED: Windows Sandbox is single-instance and $($before.Count) environment(s) are already running: $($before -join ', '). Stop by exact ID with: wsb.exe StopSandbox --id <id> --raw"
    }

    $sandboxId = [guid]::NewGuid().ToString()
    $compact = ($configuration -replace '[\r\n]+', ' ' -replace '>\s+<', '><').Trim()
    & $wsbExecutable StartSandbox --id $sandboxId "--config=`"$compact`"" --raw | Out-Null
    if ($sandboxId -notin @(Get-RunningSandboxIds)) { throw "StartSandbox did not expose exact run ID $sandboxId." }
    & $wsbExecutable ConnectToSandbox --id $sandboxId --raw | Out-Null

    $resultPath = Join-Path $evidenceRoot 'result.json'
    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
    while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $resultPath)) {
        if ($sandboxId -notin @(Get-RunningSandboxIds)) { throw "Windows Sandbox ID $sandboxId stopped before the environment was ready." }
        Start-Sleep -Seconds 2
    }
    if (-not (Test-Path -LiteralPath $resultPath)) { throw "Preparation exceeded $ReadyTimeoutSeconds seconds. The sandbox is still running as ID $sandboxId." }
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json

    Write-AtomicJson (Join-Path $hostLogRoot "controller-$runId.json") ([ordered]@{ runId = $runId; runRoot = $runRoot; sandboxId = $sandboxId; installers = $installers; result = $result; readyAt = (Get-Date).ToString('o') })

    if ($result.status -ne 'MANUAL-READY') {
        Write-Warning "Preparation did not complete: $($result.message)"
        Write-Warning "The sandbox is still running as ID $sandboxId so the failure can be inspected."
        exit 1
    }

    # The sandbox is deliberately left running. Stopping it here would destroy the
    # environment the verifier is about to work in.
    Write-Output ''
    Write-Output 'MiroraTrack 0.0.9 is installed in an isolated offline sandbox and ready for manual verification.'
    Write-Output ''
    Write-Output "  Sandbox ID : $sandboxId"
    Write-Output "  Evidence   : $evidenceRoot"
    Write-Output '  Checklist  : CHECKLIST.txt on the sandbox Desktop'
    Write-Output '  Helpers    : Install-Current.cmd, Uninstall.cmd, Show-Data.cmd on the Desktop'
    Write-Output ''
    Write-Output 'Save screenshots and manual-results.md into C:\MTEvidence inside the sandbox;'
    Write-Output 'that folder is written straight back to the host path above.'
    Write-Output ''
    Write-Output 'When finished, close the sandbox window, or run:'
    Write-Output "  wsb.exe StopSandbox --id $sandboxId --raw"
    Write-Output ''
} catch {
    Write-AtomicJson (Join-Path $hostLogRoot "controller-$runId.json") ([ordered]@{ runId = $runId; runRoot = $runRoot; status = 'BLOCKED'; message = $_.Exception.Message; detail = ($_ | Out-String); failedAt = (Get-Date).ToString('o') })
    Write-Error $_
    exit 1
}
