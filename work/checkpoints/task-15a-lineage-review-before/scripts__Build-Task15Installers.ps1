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
$retryLogRoot = Join-Path $logRoot "retry"
$task15Scripts = Join-Path $repositoryRoot "scripts\task15"
$mirrorRoot = Join-Path $repositoryRoot "work\toolchain\tauri-bundler-mirror"
$webViewRoot = Join-Path $repositoryRoot "work\toolchain\webview-offline"
$webViewManifest = Join-Path $webViewRoot "binding.json"
$nativeWrapper = Join-Path $repositoryRoot "work\toolchain\Invoke-Task13bNative.ps1"
$protectedPaths = @(
    "package.json",
    "package-lock.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    "src-tauri/tauri.conf.json"
)

New-Item -ItemType Directory -Force -Path $logRoot, $retryLogRoot, $buildRoot, $artifactRoot, $mirrorRoot, $webViewRoot | Out-Null
Import-Module -Name (Join-Path $task15Scripts "WebViewAcquisition.psm1") -Force -DisableNameChecking
Import-Module -Name (Join-Path $task15Scripts "Task15BuildSafety.psm1") -Force -DisableNameChecking

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

function Get-Task15DescendantProcesses {
    $snapshot = @(Get-CimInstance Win32_Process)
    $known = [Collections.Generic.HashSet[int]]::new()
    [void] $known.Add([int] $PID)
    $descendants = [Collections.Generic.List[object]]::new()
    $added = $true
    while ($added) {
        $added = $false
        foreach ($process in $snapshot) {
            if (-not $known.Contains([int] $process.ProcessId) -and
                $known.Contains([int] $process.ParentProcessId)) {
                [void] $known.Add([int] $process.ProcessId)
                $descendants.Add($process)
                $added = $true
            }
        }
    }
    return @($descendants)
}

function Assert-NoRelatedOrphans {
    $descendantIds = [Collections.Generic.HashSet[int]]::new()
    foreach ($process in @(Get-Task15DescendantProcesses)) { [void] $descendantIds.Add([int] $process.ProcessId) }
    $related = @(Get-CimInstance Win32_Process | Where-Object {
        $descendantIds.Contains([int] $_.ProcessId) -or
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($repositoryRoot, [StringComparison]::OrdinalIgnoreCase))
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
    Invoke-Task15Step "04-playwright" "npm.cmd" @("run", "test:e2e", "--", "--timeout=60000") @{} 1800 | Out-Null
    Invoke-Task15Step "05-vite-build" "npm.cmd" @("run", "build") @{} 1200 | Out-Null
    Invoke-Task15Step "06-cargo-fmt" "cargo" @("fmt", "--manifest-path", "src-tauri/Cargo.toml", "--", "--check") @{} 600 | Out-Null
    Invoke-Task15Step "07-cargo-test" "cargo" @("test", "--locked", "--target", "x86_64-pc-windows-msvc", "--manifest-path", "src-tauri/Cargo.toml") @{} 2400 | Out-Null
    Invoke-Task15Step "08-cargo-clippy" "cargo" @("clippy", "--locked", "--target", "x86_64-pc-windows-msvc", "--manifest-path", "src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings") @{} 2400 | Out-Null
    Invoke-Task15Step "09-tauri-native-build" "npx.cmd" @("tauri", "build", "--debug", "--target", "x86_64-pc-windows-msvc", "--no-bundle", "--ci") @{} 3600 | Out-Null
    Assert-NoRelatedOrphans
}

function Write-VersionOverride([string] $Version) {
    $overridePath = Join-Path $buildRoot "$Version\tauri-version-override.json"
    New-Item -ItemType Directory -Force -Path (Split-Path $overridePath) | Out-Null
    if ($Version -eq "0.0.9") {
        Write-Utf8NoBom $overridePath '{"version":"0.0.9","bundle":{"useLocalToolsDir":true}}'
    }
    elseif ($Version -eq "0.1.0") {
        Write-Utf8NoBom $overridePath '{"version":"0.1.0","bundle":{"useLocalToolsDir":true}}'
    }
    else { throw "Unsupported Task 15 installer version: $Version" }
    return $overridePath
}

function Assert-TauriCliVersion {
    $version = (& npx.cmd tauri --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -cne "tauri-cli 2.11.4") {
        throw "Expected exact tauri-cli 2.11.4; received '$version'."
    }
}

function Remove-ExactLocalToolsDirectory([string] $TargetDirectory) {
    $resolvedTarget = [IO.Path]::GetFullPath($TargetDirectory).TrimEnd('\')
    $expectedRoot = [IO.Path]::GetFullPath($buildRoot).TrimEnd('\') + '\'
    if (-not $resolvedTarget.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing local-tools cleanup outside the quarantined Task 15 build root: $resolvedTarget"
    }
    $toolsDirectory = [IO.Path]::GetFullPath((Join-Path $resolvedTarget ".tauri"))
    if ((Split-Path $toolsDirectory -Leaf) -cne ".tauri" -or
        -not $toolsDirectory.StartsWith($resolvedTarget + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing unresolved local-tools cleanup path: $toolsDirectory"
    }
    Remove-Task15SafeDirectory -Path $toolsDirectory -AllowedRoot $buildRoot
}

function Start-ExactMirror([object[]] $Specifications) {
    $specificationsPath = Join-Path $retryLogRoot "mirror-specifications.json"
    $readyPath = Join-Path $retryLogRoot "mirror-ready.json"
    $requestLogPath = Join-Path $retryLogRoot "mirror-requests.jsonl"
    $stopPath = Join-Path $retryLogRoot "mirror.stop"
    $stdoutPath = Join-Path $retryLogRoot "mirror-server.stdout.log"
    $stderrPath = Join-Path $retryLogRoot "mirror-server.stderr.log"
    Remove-Item -LiteralPath $readyPath, $requestLogPath, $stopPath, $stdoutPath, $stderrPath -Force -ErrorAction SilentlyContinue
    Write-Utf8NoBom $specificationsPath ($Specifications | ConvertTo-Json -Depth 8)
    $serverScript = Join-Path $task15Scripts "Start-TauriBundlerMirror.ps1"
    $process = $null
    try {
        $guarded = Start-Task15GuardedProcess -FilePath "powershell.exe" -Arguments @(
            "-NoLogo", "-NoProfile", "-NonInteractive", "-File", $serverScript,
            "-SpecificationsPath", $specificationsPath, "-ReadyPath", $readyPath,
            "-RequestLogPath", $requestLogPath, "-StopPath", $stopPath
        ) -ReadyPath $readyPath -WorkingDirectory $repositoryRoot `
          -StandardOutputPath $stdoutPath -StandardErrorPath $stderrPath -TimeoutSeconds 15
        $process = $guarded.Process
        $ready = $guarded.Ready
    }
    catch {
        if ($process) { Stop-Task15ExactProcess $process }
        throw
    }
    return [pscustomobject]@{
        Process = $process; Port = [int] $ready.Port; RequestLogPath = $requestLogPath
        StopPath = $stopPath; ReadyPath = $readyPath
    }
}

function Assert-MirrorRequests([object] $Mirror, [object[]] $Specifications) {
    if (-not (Test-Path -LiteralPath $Mirror.RequestLogPath)) { throw "Mirror received no Tauri requests." }
    $requests = @(Get-Content -LiteralPath $Mirror.RequestLogPath | Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
    $approvedPaths = @($Specifications | ForEach-Object { [string] $_.MirrorPath })
    foreach ($request in $requests) {
        if ([int] $request.Status -ne 200 -or [string] $request.RawPath -cnotin $approvedPaths) {
            throw "Mirror received an unapproved request: $($request.RawPath) ($($request.Status))."
        }
    }
    foreach ($approvedPath in $approvedPaths) {
        if (@($requests | Where-Object RawPath -CEQ $approvedPath).Count -lt 1) {
            throw "Mirror did not receive required exact request: $approvedPath"
        }
    }
}

function Stop-ExactMirror([object] $Mirror) {
    if ($null -eq $Mirror) { return }
    Write-Utf8NoBom $Mirror.StopPath "stop"
    if (-not $Mirror.Process.WaitForExit(10000)) {
        Stop-Process -Id $Mirror.Process.Id -Force -ErrorAction SilentlyContinue
        $Mirror.Process.WaitForExit(10000) | Out-Null
    }
    if (Get-Process -Id $Mirror.Process.Id -ErrorAction SilentlyContinue) {
        throw "Exact loopback mirror PID remained after shutdown."
    }
    if (@(Get-NetTCPConnection -State Listen -LocalPort $Mirror.Port -ErrorAction SilentlyContinue).Count -ne 0) {
        throw "Loopback mirror listener remained after shutdown."
    }
}

function Invoke-WebViewAcquisition([string] $StepName, [switch] $VerifyBindingOnly) {
    $evidencePath = Join-Path $retryLogRoot "$StepName.json"
    $arguments = @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
        (Join-Path $task15Scripts "Acquire-WebViewOfflineInstaller.ps1"),
        "-DestinationRoot", $webViewRoot, "-EvidencePath", $evidencePath,
        "-ExpectedManifestPath", $webViewManifest
    )
    if ($VerifyBindingOnly) { $arguments += "-VerifyBindingOnly" }
    Invoke-Task15Step $StepName "powershell.exe" $arguments @{} 5700 360 | Out-Null
    return Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
}

function Get-ValidatedWebViewRecord {
    $record = Get-Content -LiteralPath $webViewManifest -Raw | ConvertFrom-Json
    $signature = Get-AuthenticodeSignature -LiteralPath ([string] $record.Path)
    Assert-WebViewPayloadFile -Path ([string] $record.Path) -Binding $record.Binding `
        -ExpectedSha256 ([string] $record.Sha256) -Signature $signature | Out-Null
    return $record
}

function Stage-ExactWebViewPayload([string] $Version, [string] $TargetDirectory, [object] $Record) {
    $sourceSignature = Get-AuthenticodeSignature -LiteralPath ([string] $Record.Path)
    $staged = Stage-WebViewPayload -SourcePath ([string] $Record.Path) `
        -CargoTargetDirectory $TargetDirectory -AllowedBuildRoot $buildRoot `
        -Binding $Record.Binding -ExpectedSha256 ([string] $Record.Sha256) `
        -Signature $sourceSignature
    $expected = [IO.Path]::GetFullPath((Join-Path $TargetDirectory ".tauri\x64\$($Record.Binding.Guid)\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"))
    if ($staged -cne $expected) { throw "Unexpected staged WebView path for $Version`: $staged" }
    return $staged
}

function Assert-WebViewBuildUse([string] $Version, [string] $StagedPath, [object] $Record, [string] $StderrPath) {
    $text = Get-Content -LiteralPath $stderrPath -Raw
    Assert-WebViewBuildLogNoLargeGet -LogText $text
    $signature = Get-AuthenticodeSignature -LiteralPath $StagedPath
    Assert-WebViewPayloadFile -Path $StagedPath -Binding $Record.Binding `
        -ExpectedSha256 ([string] $Record.Sha256) -Signature $signature | Out-Null
}

function Test-CurrentWebViewBinding([string] $StepName) {
    try { Invoke-WebViewAcquisition $StepName -VerifyBindingOnly | Out-Null; return $true }
    catch {
        $stderrPath = Join-Path $logRoot "$StepName.stderr.log"
        $stderr = if (Test-Path -LiteralPath $stderrPath) { Get-Content -LiteralPath $stderrPath -Raw } else { "" }
        if ($stderr -match "binding changed") { return $false }
        throw
    }
}

function Assert-InstallerEmbeddedWebView {
    param([string] $Version, [string] $InstallerPath, [object] $Record)
    $visualStudio7Zip = @(Get-ChildItem -Path (Join-Path $env:ProgramFiles "Microsoft Visual Studio") `
        -Filter "7z.exe" -Recurse -ErrorAction SilentlyContinue | Where-Object {
            $_.FullName -match '\\7-Zip\\7z\.exe$'
        } | Select-Object -First 1 -ExpandProperty FullName)
    $extractor = @(
        (Get-Command "7z.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
        (Join-Path $repositoryRoot "work\toolchain\7zip\7z.exe"),
        $visualStudio7Zip
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
    if (-not $extractor) { throw "A validated 7z.exe inspection tool is required to extract the NSIS installer." }
    $inspectionRoot = [IO.Path]::GetFullPath((Join-Path $buildRoot "inspection\$Version"))
    $requiredPrefix = [IO.Path]::GetFullPath($buildRoot).TrimEnd('\') + '\'
    if (-not $inspectionRoot.StartsWith($requiredPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing installer extraction outside the quarantined build root."
    }
    Remove-Task15SafeDirectory -Path $inspectionRoot -AllowedRoot $buildRoot
    New-Item -ItemType Directory -Force -Path $inspectionRoot | Out-Null
    & $extractor x -y "-o$inspectionRoot" $InstallerPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "NSIS extraction failed for $Version with exit $LASTEXITCODE." }
    $payloads = @(Get-ChildItem -LiteralPath $inspectionRoot -Recurse -File -Filter "MicrosoftEdgeWebView2RuntimeInstaller.exe")
    if ($payloads.Count -ne 1) { throw "Expected exactly one embedded WebView payload for $Version; found $($payloads.Count)." }
    $signature = Get-AuthenticodeSignature -LiteralPath $payloads[0].FullName
    Assert-EmbeddedWebViewPayload -ExtractedPath $payloads[0].FullName `
        -ExpectedSha256 ([string] $Record.Sha256) -ExpectedSize ([long] $Record.Binding.Size) `
        -Signature $signature
    return $payloads[0].FullName
}

function New-ExactInstallerCandidate([string] $Version, [string] $TargetDirectory) {
    $sourceDirectory = Join-Path $TargetDirectory "x86_64-pc-windows-msvc\release\bundle\nsis"
    $installers = @(Get-ChildItem -LiteralPath $sourceDirectory -File -Filter "*.exe")
    if ($installers.Count -ne 1) {
        throw "Expected exactly one NSIS installer for $Version in $sourceDirectory; found $($installers.Count)."
    }
    $destinationDirectory = Join-Path $artifactRoot $Version
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    $expectedName = "MiroraTrack_${Version}_x64-setup.exe"
    if ($installers[0].Name -cne $expectedName) { throw "Unexpected source installer name for $Version`: $($installers[0].Name)" }
    $destination = Join-Path $destinationDirectory $expectedName
    $validator = {
        param($Path,$ExpectedVersion)
        $info=[Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
        if($info.FileVersion-cne$ExpectedVersion -or $info.ProductVersion-cne$ExpectedVersion){throw "Installer metadata version mismatch for $ExpectedVersion."}
        if((Get-AuthenticodeSignature -LiteralPath $Path).Status.ToString()-cne"NotSigned"){throw "Installer signature state mismatch for $ExpectedVersion."}
    }
    return New-Task15ArtifactCandidate -Version $Version -SourcePath $installers[0].FullName -DestinationPath $destination -MetadataValidator $validator
}

function Invoke-InstallerBuilds {
    Assert-TauriCliVersion
    $acquisitionPath = Join-Path $retryLogRoot "acquisition-build.json"
    Invoke-Task15Step "10-acquire-bundler-tools" "powershell.exe" @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-File",
        (Join-Path $task15Scripts "Acquire-TauriBundlerTools.ps1"),
        "-DestinationRoot", $mirrorRoot, "-EvidencePath", $acquisitionPath
    ) @{} 600 | Out-Null
    $acquisition = Get-Content -LiteralPath $acquisitionPath -Raw | ConvertFrom-Json
    $specifications = @($acquisition.Assets)
    if ($specifications.Count -ne 2) { throw "Acquisition did not validate exactly two bundler assets." }

    Invoke-WebViewAcquisition "11-acquire-webview-offline" | Out-Null

    $override009 = Write-VersionOverride "0.0.9"
    $override010 = Write-VersionOverride "0.1.0"
    $target009 = Join-Path $buildRoot "0.0.9\target"
    $target010 = Join-Path $buildRoot "0.1.0\target"
    New-Item -ItemType Directory -Force -Path $target009, $target010 | Out-Null

    $built = $false
    for ($bindingCycle = 1; $bindingCycle -le 2 -and -not $built; $bindingCycle++) {
        $record = Get-ValidatedWebViewRecord
        $mirror = $null
        $bindingChanged = $false
        try {
            $mirror = Start-ExactMirror $specifications
            $mirrorTemplate = "http://127.0.0.1:$($mirror.Port)/<owner>/<repo>/releases/download/<version>/<asset>"

            if (-not (Test-CurrentWebViewBinding "12-cycle-$bindingCycle-verify-webview-0.0.9")) { $bindingChanged = $true }
            if (-not $bindingChanged) {
                Remove-ExactLocalToolsDirectory $target009
                $staged009 = Stage-ExactWebViewPayload "0.0.9" $target009 $record
                $step009 = "13-cycle-$bindingCycle-tauri-nsis-0.0.9"
                Invoke-Task15Step $step009 "npx.cmd" @(
                    "tauri", "build", "--config", $override009, "--bundles", "nsis",
                    "--target", "x86_64-pc-windows-msvc", "--ci"
                ) -Environment @{
                    CARGO_TARGET_DIR = $target009
                    TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE = $mirrorTemplate
                } -TimeoutSeconds 7200 -NoProgressSeconds 900 | Out-Null
                Assert-WebViewBuildUse "0.0.9" $staged009 $record (Join-Path $logRoot "$step009.stderr.log")
            }

            if (-not $bindingChanged -and -not (Test-CurrentWebViewBinding "14-cycle-$bindingCycle-verify-webview-0.1.0")) { $bindingChanged = $true }
            if (-not $bindingChanged) {
                Remove-ExactLocalToolsDirectory $target010
                $staged010 = Stage-ExactWebViewPayload "0.1.0" $target010 $record
                $step010 = "15-cycle-$bindingCycle-tauri-nsis-0.1.0"
                Invoke-Task15Step $step010 "npx.cmd" @(
                    "tauri", "build", "--config", $override010, "--bundles", "nsis",
                    "--target", "x86_64-pc-windows-msvc", "--ci"
                ) -Environment @{
                    CARGO_TARGET_DIR = $target010
                    TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE = $mirrorTemplate
                } -TimeoutSeconds 7200 -NoProgressSeconds 900 | Out-Null
                Assert-WebViewBuildUse "0.1.0" $staged010 $record (Join-Path $logRoot "$step010.stderr.log")
                Assert-MirrorRequests $mirror $specifications
                $built = $true
            }
        }
        finally { Stop-ExactMirror $mirror }
        if ($bindingChanged) {
            if ($bindingCycle -eq 2) { throw "Microsoft WebView binding changed twice; both-version rebuild bound exhausted." }
            Invoke-WebViewAcquisition "16-cycle-$bindingCycle-reacquire-webview" | Out-Null
        }
    }
    if (-not $built) { throw "Both installer versions were not built from one unchanged WebView binding." }

    $source009 = @(Get-ChildItem -LiteralPath (Join-Path $target009 "x86_64-pc-windows-msvc\release\bundle\nsis") -File -Filter "*.exe")
    $source010 = @(Get-ChildItem -LiteralPath (Join-Path $target010 "x86_64-pc-windows-msvc\release\bundle\nsis") -File -Filter "*.exe")
    if ($source009.Count -ne 1 -or $source010.Count -ne 1) { throw "Expected one source installer for each version before payload inspection." }
    Assert-InstallerEmbeddedWebView "0.0.9" $source009[0].FullName $record | Out-Null
    Assert-InstallerEmbeddedWebView "0.1.0" $source010[0].FullName $record | Out-Null
    $candidates = @(
        (New-ExactInstallerCandidate "0.0.9" $target009),
        (New-ExactInstallerCandidate "0.1.0" $target010)
    )
    Publish-Task15ArtifactSetAtomically -Records $candidates
    $installer009 = $candidates[0].DestinationPath
    $installer010 = $candidates[1].DestinationPath

    $artifactManifest = [ordered]@{ SchemaVersion=1; Architecture="x64"; GeneratedAt=(Get-Date).ToString("o"); Installers=@(
        [ordered]@{Role="Previous";Version="0.0.9";Name=(Split-Path -Leaf $installer009);Size=(Get-Item $installer009).Length;Sha256=(Get-FileHash $installer009 -Algorithm SHA256).Hash;Authenticode=(Get-AuthenticodeSignature $installer009).Status.ToString()},
        [ordered]@{Role="Current";Version="0.1.0";Name=(Split-Path -Leaf $installer010);Size=(Get-Item $installer010).Length;Sha256=(Get-FileHash $installer010 -Algorithm SHA256).Hash;Authenticode=(Get-AuthenticodeSignature $installer010).Status.ToString()}
    )}
    Write-Task15FileAtomically -Path (Join-Path $artifactRoot "manifest.json") -Content ($artifactManifest|ConvertTo-Json -Depth 6)

    Write-Utf8NoBom (Join-Path $logRoot "13-copied-installers.json") `
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
