param(
    [ValidateSet("Gate", "Build", "All")]
    [string] $Phase = "All"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logRoot = Join-Path $repositoryRoot "work\logs\task15a"
$buildRoot = Join-Path $repositoryRoot "work\build\task15"
$artifactRoot = Join-Path $repositoryRoot "work\artifacts\task15\unaccepted"
$nativeWrapper = Join-Path $repositoryRoot "work\toolchain\Invoke-Task13bNative.ps1"
$protectedPaths = @(
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json"
)

New-Item -ItemType Directory -Force -Path $logRoot, $buildRoot, $artifactRoot | Out-Null

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Task15ExitApi {
  [DllImport("kernel32.dll", SetLastError=true)]
  public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
}
'@

function Write-Utf8NoBom([string] $Path, [string] $Text) {
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Get-ProtectedHashes {
    $result = [ordered]@{}
    foreach ($relativePath in $protectedPaths) {
        $absolutePath = Join-Path $repositoryRoot $relativePath
        $result[$relativePath] = (Get-FileHash -LiteralPath $absolutePath -Algorithm SHA256).Hash
    }
    $result["work/toolchain/Invoke-Task13bNative.ps1"] =
        (Get-FileHash -LiteralPath $nativeWrapper -Algorithm SHA256).Hash
    return $result
}

$baselineHashes = Get-ProtectedHashes
Write-Utf8NoBom (Join-Path $logRoot "00-protected-hashes-before.json") `
    ($baselineHashes | ConvertTo-Json)

function Assert-ProtectedHashes([string] $Context) {
    $current = Get-ProtectedHashes
    foreach ($path in $baselineHashes.Keys) {
        if ($current[$path] -cne $baselineHashes[$path]) {
            throw "Protected file changed $Context`: $path"
        }
    }
}

function Stop-ProcessTree([int] $RootPid) {
    $children = @(Get-CimInstance Win32_Process | Where-Object ParentProcessId -eq $RootPid)
    foreach ($child in $children) {
        Stop-ProcessTree ([int] $child.ProcessId)
    }
    Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue
}

function Wait-RedirectStable([string[]] $Paths) {
    foreach ($path in $Paths) {
        $lastLength = -1L
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            if (-not (Test-Path -LiteralPath $path)) {
                Start-Sleep -Milliseconds 100
                continue
            }
            $length = (Get-Item -LiteralPath $path).Length
            try {
                $stream = [IO.File]::Open($path, "Open", "Read", "ReadWrite")
                $stream.Dispose()
            }
            catch {
                Start-Sleep -Milliseconds 100
                continue
            }
            if ($length -eq $lastLength) { break }
            $lastLength = $length
            Start-Sleep -Milliseconds 100
        }
    }
}

function Get-JobPreamble {
    return @'
$ProgressPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Task15JobApi {
 [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
 [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; }
 [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
 [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr attrs, string name);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
 [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
}
"@
$job = [Task15JobApi]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { throw "CreateJobObject failed" }
if (-not [Task15JobApi]::SetHandleInformation($job, 1, 0)) { throw "SetHandleInformation failed" }
$info = New-Object Task15JobApi+JOBOBJECT_EXTENDED_LIMIT_INFORMATION
$info.BasicLimitInformation.LimitFlags = 0x2000
$size = [Runtime.InteropServices.Marshal]::SizeOf($info)
$ptr = [Runtime.InteropServices.Marshal]::AllocHGlobal($size)
try {
    [Runtime.InteropServices.Marshal]::StructureToPtr($info, $ptr, $false)
    if (-not [Task15JobApi]::SetInformationJobObject($job, 9, $ptr, [uint32] $size)) {
        throw "SetInformationJobObject failed"
    }
}
finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($ptr) }
if (-not [Task15JobApi]::AssignProcessToJobObject($job, [Task15JobApi]::GetCurrentProcess())) {
    throw "AssignProcessToJobObject failed"
}
'@
}

function Invoke-Task15Step {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Executable,
        [string[]] $CommandArguments = @(),
        [hashtable] $Environment = @{},
        [int] $TimeoutSeconds = 3600,
        [int] $NoProgressSeconds = 0
    )

    $logical = [ordered]@{
        Wrapper = $nativeWrapper
        Executable = $Executable
        CommandArguments = [string[]] $CommandArguments
        Environment = $Environment
    } | ConvertTo-Json -Compress -Depth 5
    $token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($logical))
    $childCode = (Get-JobPreamble) + @'
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$invocation = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("__TOKEN__")) | ConvertFrom-Json
[string] $wrapper = $invocation.Wrapper
[string] $executable = $invocation.Executable
[string[]] $commandArguments = @($invocation.CommandArguments | ForEach-Object { [string] $_ })
foreach ($property in $invocation.Environment.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($property.Name, [string] $property.Value, "Process")
}
try {
    & $wrapper -Executable $executable -CommandArguments $commandArguments
    if ($null -eq $LASTEXITCODE) { $exitCode = 0 } else { $exitCode = [int] $LASTEXITCODE }
}
finally {
    if ($job -ne [IntPtr]::Zero) {
        [Task15JobApi]::CloseHandle($job) | Out-Null
        $job = [IntPtr]::Zero
    }
}
exit $exitCode
'@
    $childCode = $childCode.Replace("__TOKEN__", $token)
    $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))
    $stdoutPath = Join-Path $logRoot "$Name.stdout.log"
    $stderrPath = Join-Path $logRoot "$Name.stderr.log"
    $resultPath = Join-Path $logRoot "$Name.result.json"
    $logicalPath = Join-Path $logRoot "$Name.logical-argv.json"
    Remove-Item -LiteralPath $stdoutPath, $stderrPath, $resultPath, $logicalPath -Force -ErrorAction SilentlyContinue
    Write-Utf8NoBom $logicalPath $logical

    $startedAt = Get-Date
    $startedProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text",
        "-EncodedCommand", $encodedCommand
    ) -WorkingDirectory $repositoryRoot -NoNewWindow -PassThru `
        -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    $process = Get-Process -Id $startedProcess.Id
    $processHandle = $process.Handle
    $deadline = $startedAt.AddSeconds($TimeoutSeconds)
    $lastProgressAt = $startedAt
    $lastOutputLength = -1L
    $terminationReason = $null
    while (-not $process.WaitForExit(1000)) {
        $outputLength = 0L
        foreach ($path in @($stdoutPath, $stderrPath)) {
            if (Test-Path -LiteralPath $path) { $outputLength += (Get-Item -LiteralPath $path).Length }
        }
        if ($outputLength -ne $lastOutputLength) {
            $lastOutputLength = $outputLength
            $lastProgressAt = Get-Date
        }
        if ((Get-Date) -ge $deadline) {
            $terminationReason = "wall-clock timeout after $TimeoutSeconds seconds"
            break
        }
        if ($NoProgressSeconds -gt 0 -and ((Get-Date) - $lastProgressAt).TotalSeconds -ge $NoProgressSeconds) {
            $terminationReason = "no stdout/stderr progress for $NoProgressSeconds seconds"
            break
        }
    }
    if ($terminationReason) {
        Stop-ProcessTree ([int] $process.Id)
        $process.WaitForExit(30000) | Out-Null
    }
    $process.WaitForExit()
    $process.Refresh()
    [uint32] $nativeExitCode = 0
    if (-not [Task15ExitApi]::GetExitCodeProcess($processHandle, [ref] $nativeExitCode)) {
        throw "GetExitCodeProcess failed for $Name"
    }
    $exitCode = if ($nativeExitCode -le [int]::MaxValue) {
        [int] $nativeExitCode
    }
    else {
        [BitConverter]::ToInt32([BitConverter]::GetBytes($nativeExitCode), 0)
    }
    Wait-RedirectStable @($stdoutPath, $stderrPath)
    $endedAt = Get-Date
    $result = [ordered]@{
        Name = $Name
        StartedAt = $startedAt.ToString("o")
        EndedAt = $endedAt.ToString("o")
        DurationSeconds = [math]::Round(($endedAt - $startedAt).TotalSeconds, 3)
        ExitCode = $exitCode
        ExitCodeCapture = "GetExitCodeProcess"
        TerminationReason = $terminationReason
        Stdout = $stdoutPath
        Stderr = $stderrPath
        LogicalInvocation = $logicalPath
    }
    Write-Utf8NoBom $resultPath ($result | ConvertTo-Json)
    Assert-ProtectedHashes "after $Name"
    if ($terminationReason) { throw "$Name stopped: $terminationReason" }
    if ($exitCode -ne 0) { throw "$Name exited with numeric code $exitCode" }
    return [pscustomobject] $result
}

function Assert-NoRelatedOrphans {
    $related = @(Get-CimInstance Win32_Process | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($repositoryRoot, [StringComparison]::OrdinalIgnoreCase)) -or
        ($_.CommandLine -and $_.CommandLine.IndexOf($repositoryRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $_.ProcessId -ne $PID)
    })
    if ($related.Count -gt 0) {
        $details = $related | Select-Object ProcessId, Name, ExecutablePath, CommandLine
        Write-Utf8NoBom (Join-Path $logRoot "orphan-processes.json") ($details | ConvertTo-Json -Depth 4)
        throw "Repository-attributable processes remain after the gate."
    }
}

function Invoke-HostGate {
    Invoke-Task15Step "01-npm-ci" "npm.cmd" @("ci", "--cache", "work/npm-cache")  @{} 1200 | Out-Null
    Invoke-Task15Step "02-typecheck" "npm.cmd" @("run", "typecheck") @{} 600 | Out-Null
    Invoke-Task15Step "03-vitest" "npm.cmd" @("test", "--", "--run") @{} 1200 | Out-Null
    Invoke-Task15Step "04-playwright" "npm.cmd" @("run", "test:e2e") @{} 1800 | Out-Null
    Invoke-Task15Step "05-vite-build" "npm.cmd" @("run", "build") @{} 1200 | Out-Null
    Invoke-Task15Step "06-cargo-fmt" "cargo" @("fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check") @{} 600 | Out-Null
    Invoke-Task15Step "07-cargo-test" "cargo" @("test", "--locked", "--target", "x86_64-pc-windows-msvc", "--manifest-path", "src-tauri/Cargo.toml") @{} 2400 | Out-Null
    Invoke-Task15Step "08-cargo-clippy" "cargo" @("clippy", "--locked", "--target", "x86_64-pc-windows-msvc", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings") @{} 2400 | Out-Null
    Invoke-Task15Step "09-tauri-native-build" "npx.cmd" @("tauri", "build", "--debug", "--target", "x86_64-pc-windows-msvc", "--no-bundle", "--ci") @{} 3600 | Out-Null
    Assert-NoRelatedOrphans
}

function Write-VersionOverride {
    $overridePath = Join-Path $buildRoot "0.0.9\tauri-version-override.json"
    New-Item -ItemType Directory -Force -Path (Split-Path $overridePath) | Out-Null
    Write-Utf8NoBom $overridePath '{"version":"0.0.9"}'
    return $overridePath
}

function Copy-ExactInstaller([string] $Version, [string] $TargetDirectory) {
    $sourceDirectory = Join-Path $TargetDirectory "x86_64-pc-windows-msvc\release\bundle\nsis"
    $installers = @(Get-ChildItem -LiteralPath $sourceDirectory -File -Filter "*.exe")
    if ($installers.Count -ne 1) {
        throw "Expected exactly one NSIS installer for $Version in $sourceDirectory; found $($installers.Count)."
    }
    $destinationDirectory = Join-Path $artifactRoot $Version
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    $destination = Join-Path $destinationDirectory $installers[0].Name
    Copy-Item -LiteralPath $installers[0].FullName -Destination $destination -Force
    $sourceHash = (Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256).Hash
    $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    if ($sourceHash -cne $destinationHash) { throw "Artifact copy hash mismatch for $Version" }
    return $destination
}

function Invoke-InstallerBuilds {
    $overridePath = Write-VersionOverride
    $target009 = Join-Path $buildRoot "0.0.9\target"
    $target010 = Join-Path $buildRoot "0.1.0\target"
    New-Item -ItemType Directory -Force -Path $target009, $target010 | Out-Null

    Invoke-Task15Step "10-tauri-nsis-0.0.9" "npx.cmd" @(
        "tauri", "build", "--config", $overridePath, "--bundles", "nsis",
        "--target", "x86_64-pc-windows-msvc", "--ci"
    ) -Environment @{ CARGO_TARGET_DIR = $target009 } -TimeoutSeconds 7200 -NoProgressSeconds 900 | Out-Null
    $installer009 = Copy-ExactInstaller "0.0.9" $target009

    Invoke-Task15Step "11-tauri-nsis-0.1.0" "npx.cmd" @(
        "tauri", "build", "--bundles", "nsis", "--target", "x86_64-pc-windows-msvc", "--ci"
    ) -Environment @{ CARGO_TARGET_DIR = $target010 } -TimeoutSeconds 7200 -NoProgressSeconds 900 | Out-Null
    $installer010 = Copy-ExactInstaller "0.1.0" $target010

    Write-Utf8NoBom (Join-Path $logRoot "12-copied-installers.json") `
        ([ordered]@{ "0.0.9" = $installer009; "0.1.0" = $installer010 } | ConvertTo-Json)
    Assert-NoRelatedOrphans
}

try {
    if ($Phase -in @("Gate", "All")) { Invoke-HostGate }
    if ($Phase -in @("Build", "All")) { Invoke-InstallerBuilds }
    Assert-ProtectedHashes "at finalization"
    Write-Utf8NoBom (Join-Path $logRoot "99-protected-hashes-after.json") `
        ((Get-ProtectedHashes) | ConvertTo-Json)
    Write-Utf8NoBom (Join-Path $logRoot "99-status.json") `
        ([ordered]@{ Status = "PASS"; Phase = $Phase; CompletedAt = (Get-Date).ToString("o") } | ConvertTo-Json)
}
catch {
    Write-Utf8NoBom (Join-Path $logRoot "99-status.json") `
        ([ordered]@{ Status = "FAIL"; Phase = $Phase; Message = $_.Exception.Message; Detail = ($_ | Out-String); FailedAt = (Get-Date).ToString("o") } | ConvertTo-Json)
    exit 1
}
