[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [int]$TimeoutSeconds = 5400
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) { $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
$wsbExecutable = (Get-Command wsb.exe -ErrorAction SilentlyContinue).Source
$runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$runRoot = Join-Path $RepositoryRoot "work\sandbox\task15b\$runId"
$inputRoot = Join-Path $runRoot 'input'
$evidenceRoot = Join-Path $runRoot 'evidence'
$hostLogRoot = Join-Path $RepositoryRoot 'work\logs\task15b'
$controllerLog = Join-Path $hostLogRoot "controller-$runId.json"
$artifactRoot = Join-Path $RepositoryRoot 'work\artifacts\task15\unaccepted'
$atomicFinalTemporaryName = 'result.json.tmp'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Task15BExitApi {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
}
'@

function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false)) }
function Write-AtomicJson([string]$Path, $Value) { $temp = "$Path.tmp"; Write-Utf8 $temp ($Value | ConvertTo-Json -Depth 15); Move-Item -LiteralPath $temp -Destination $Path -Force }
function Stop-ExactTree([int]$RootPid) { foreach ($child in @(Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq $RootPid)) { Stop-ExactTree ([int]$child.ProcessId) }; Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue }

function Get-RunningSandboxIds {
    $raw = & $wsbExecutable ListRunningSandboxes --raw
    if ($LASTEXITCODE -ne 0) { throw 'ListRunningSandboxes failed.' }
    $parsed = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
    return @($parsed.WindowsSandboxEnvironments | ForEach-Object { [string]$_.Id })
}

function Stop-ExactSandbox([string]$SandboxId) {
    & $wsbExecutable StopSandbox --id $SandboxId --raw | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "StopSandbox failed for exact ID $SandboxId." }
}

function Stop-OwnSandboxIfRunning([string]$SandboxId) {
    # Evidence is written through the host mapping and survives the environment,
    # so releasing this run's own sandbox never discards results. Only the exact
    # ID this run created is ever stopped.
    if ([string]::IsNullOrWhiteSpace($SandboxId)) { return $null }
    try {
        if ($SandboxId -notin @(Get-RunningSandboxIds)) { return [ordered]@{ sandboxId = $SandboxId; stopped = $false; reason = 'already exited' } }
        Stop-ExactSandbox $SandboxId
        return [ordered]@{ sandboxId = $SandboxId; stopped = $true }
    } catch {
        return [ordered]@{ sandboxId = $SandboxId; stopped = $false; reason = $_.Exception.Message }
    }
}

function Invoke-Captured {
    param([string]$Name, [string]$FilePath, [string[]]$Arguments, [int]$Limit = 900, [string]$WorkingDirectory = $RepositoryRoot)
    $out = Join-Path $hostLogRoot "$runId-$Name.stdout.log"; $err = Join-Path $hostLogRoot "$runId-$Name.stderr.log"
    $start = Get-Date; $started = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
    $process = Get-Process -Id $started.Id; $handle = $process.Handle
    if (-not $process.WaitForExit($Limit * 1000)) { Stop-ExactTree $process.Id; throw "$Name exceeded $Limit seconds; its exact process tree was terminated." }
    $process.WaitForExit(); [uint32]$native = 0
    if (-not [Task15BExitApi]::GetExitCodeProcess($handle, [ref]$native)) { throw "Could not capture numeric exit for $Name." }
    # HRESULT-style exit codes (0x8...) overflow Int32. Widening keeps the real
    # failure visible instead of replacing it with a cast exception.
    $exitCode = [int64]$native
    $result = [ordered]@{ name = $Name; started = $start.ToString('o'); ended = (Get-Date).ToString('o'); exitCode = $exitCode; exitCodeHex = ('0x{0:X8}' -f $native); stdout = $out; stderr = $err }
    if ($exitCode -ne 0) {
        $detail = if (Test-Path -LiteralPath $err) { (Get-Content -LiteralPath $err -Raw).Trim() } else { '' }
        throw "$Name exited with numeric code $exitCode (0x{0:X8}). $detail See $out and $err" -f $native
    }
    return $result
}

function Copy-StagedInstaller([string]$Role) {
    # 15B verifies exactly the quarantined Task 15A artifacts. It never rebuilds
    # them, and it refuses to stage anything the manifest does not describe.
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
    return [ordered]@{ role = $Role; version = [string]$record.Version; name = [string]$record.Name; length = $length; sha256 = $hash; authenticode = [string]$record.Authenticode }
}

try {
    New-Item -ItemType Directory -Force -Path $inputRoot, $evidenceRoot, $hostLogRoot | Out-Null
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-Task15BHarnessStatic.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Static harness validation failed before execution.' }
    if ([string]::IsNullOrWhiteSpace($wsbExecutable) -or -not (Test-Path -LiteralPath $wsbExecutable)) { throw 'BLOCKED: wsb.exe is absent.' }

    $installers = @((Copy-StagedInstaller 'Previous'), (Copy-StagedInstaller 'Current'))
    Copy-Item -LiteralPath (Join-Path $artifactRoot 'manifest.json') -Destination (Join-Path $inputRoot 'manifest.json')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'guest.ps1') -Destination (Join-Path $inputRoot 'guest.ps1')
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\verify-installer.ps1') -Destination (Join-Path $inputRoot 'verify-installer.ps1')
    # verify-installer.ps1 resolves its module relative to its own directory.
    New-Item -ItemType Directory -Force -Path (Join-Path $inputRoot 'task15') | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'scripts\task15\Task15InstallerPreflight.psm1') -Destination (Join-Path $inputRoot 'task15\Task15InstallerPreflight.psm1')

    $files = @(Get-ChildItem -LiteralPath $inputRoot -File -Recurse | ForEach-Object { [ordered]@{ path = $_.FullName.Substring($inputRoot.Length + 1); length = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash } })
    $stagingManifest = [ordered]@{ runId = $runId; createdAt = (Get-Date).ToString('o'); files = $files; installers = $installers }
    Write-Utf8 (Join-Path $inputRoot 'staging.json') ($stagingManifest | ConvertTo-Json -Depth 12)
    Write-AtomicJson (Join-Path $evidenceRoot 'host-staging.json') $stagingManifest

    $template = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sandbox.wsb.template') -Raw
    $escape = { param($value) [Security.SecurityElement]::Escape($value) }
    $configuration = $template.Replace('{{MT_INPUT}}', (& $escape $inputRoot)).Replace('{{MT_EVIDENCE}}', (& $escape $evidenceRoot))
    $wsb = Join-Path $runRoot 'task15b.wsb'; Write-Utf8 $wsb $configuration
    [xml]$check = Get-Content -LiteralPath $wsb -Raw
    if (@($check.Configuration.MappedFolders.MappedFolder).Count -ne 2) { throw 'Generated sandbox configuration mapping count is not exactly two.' }

    # Windows Sandbox is single-instance. A leftover environment makes StartSandbox
    # fail with CO_E_APPSINGLEUSE, so this reports the exact blocking ID rather
    # than an opaque HRESULT. Foreign environments are never stopped automatically.
    $before = @(Get-RunningSandboxIds)
    if ($before.Count -gt 0) {
        throw "BLOCKED: Windows Sandbox is single-instance and $($before.Count) environment(s) are already running: $($before -join ', '). Preserve any evidence, then stop by exact ID with: wsb.exe StopSandbox --id <id> --raw"
    }
    $sandboxId = [guid]::NewGuid().ToString()
    $compactConfiguration = ($configuration -replace '[\r\n]+', ' ' -replace '>\s+<', '><').Trim()
    $startResult = Invoke-Captured 'sandbox-start' $wsbExecutable @('StartSandbox', '--id', $sandboxId, "--config=`"$compactConfiguration`"", '--raw') 120
    $launched = @(Get-RunningSandboxIds)
    if ($sandboxId -notin $launched) { throw "StartSandbox did not expose exact run ID $sandboxId." }
    $connectResult = Invoke-Captured 'sandbox-connect' $wsbExecutable @('ConnectToSandbox', '--id', $sandboxId, '--raw') 120

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds); $resultPath = Join-Path $evidenceRoot 'result.json'
    while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $resultPath)) {
        if ($sandboxId -notin @(Get-RunningSandboxIds)) { throw "Windows Sandbox ID $sandboxId stopped before atomic final evidence appeared." }
        Start-Sleep -Seconds 2
    }
    if (-not (Test-Path -LiteralPath $resultPath)) {
        Stop-ExactSandbox $sandboxId
        throw "Task 15B exceeded $TimeoutSeconds seconds; only exact run Sandbox ID $sandboxId was terminated."
    }

    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    # The guest only powers itself off on PASS; every other path would otherwise
    # leave the single available sandbox slot occupied.
    Start-Sleep -Seconds 5
    $cleanup = Stop-OwnSandboxIfRunning $sandboxId
    $record = [ordered]@{ runId = $runId; runRoot = $runRoot; sandboxId = $sandboxId; preexistingSandboxIds = $before; installers = $installers; startResult = $startResult; connectResult = $connectResult; result = $result; cleanup = $cleanup; completedAt = (Get-Date).ToString('o') }
    Write-AtomicJson $controllerLog $record
    Write-Output ($record | ConvertTo-Json -Depth 15)
    if ($result.status -ne 'PASS') { exit $(if ($result.status -eq 'NEEDS_USER') { 42 } else { 1 }) }
} catch {
    $cleanup = if ($null -ne (Get-Variable -Name sandboxId -Scope Script -ErrorAction SilentlyContinue) -or $null -ne $sandboxId) { Stop-OwnSandboxIfRunning $sandboxId } else { $null }
    $record = [ordered]@{ runId = $runId; runRoot = $runRoot; status = if ($_.Exception.Message.StartsWith('NEEDS_USER:')) { 'NEEDS_USER' } else { 'BLOCKED' }; message = $_.Exception.Message; detail = ($_ | Out-String); cleanup = $cleanup; failedAt = (Get-Date).ToString('o') }
    Write-AtomicJson $controllerLog $record; Write-Error $_; exit 1
}
