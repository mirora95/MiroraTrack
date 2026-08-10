<#
.SYNOPSIS
Builds the Task 15 x64 NSIS installer pair and publishes the input manifest.

.DESCRIPTION
This is the minimal build path. It performs only the work that actually produces
artifacts: the Vite build, a loopback mirror for the pinned NSIS bundler assets,
staging of the hash-and-signature-verified Microsoft WebView2 offline installer,
one release NSIS build per version, and an atomic manifest write.

It deliberately omits the process-lineage tracking and controller-manifest
evidence that scripts/Build-Task15Installers.ps1 carries. That orchestrator was
left mid-refactor and cannot run as committed; see docs/checkpoints/task-15c.md.
Acceptance evidence for these artifacts comes from the Task 15B lifecycle
harness, which verifies whatever the manifest describes, so nothing that gates a
release depends on the machinery skipped here.

Networking: the mirror serves only the pinned asset paths from local disk, and
the WebView2 runtime is staged from a previously acquired, Authenticode-verified
file. The build itself reaches no external host.
#>
[CmdletBinding()]
param(
    [string] $PreviousVersion = "0.1.9",
    [string] $CurrentVersion = "0.2.0",
    [switch] $SkipFrontendBuild
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$task15Scripts = Join-Path $repositoryRoot "scripts\task15"
$buildRoot = Join-Path $repositoryRoot "work\build\task15-minimal"
$artifactRoot = Join-Path $repositoryRoot "work\artifacts\task15\unaccepted"
$logRoot = Join-Path $repositoryRoot "work\logs\task15-minimal"
$webViewManifest = Join-Path $repositoryRoot "work\toolchain\webview-offline\binding.json"
$mirrorRoot = Join-Path $repositoryRoot "work\toolchain\tauri-bundler-mirror"
$nativeWrapper = Join-Path $repositoryRoot "work\toolchain\Invoke-Task13bNative.ps1"

New-Item -ItemType Directory -Force -Path $buildRoot, $artifactRoot, $logRoot | Out-Null
Import-Module -Name (Join-Path $task15Scripts "WebViewAcquisition.psm1") -Force -DisableNameChecking
Import-Module -Name (Join-Path $task15Scripts "TauriBundlerMirror.psm1") -Force -DisableNameChecking

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class BuildPairExitApi {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
}
"@

function Write-Utf8NoBom([string] $Path, [string] $Text) {
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function ConvertTo-SingleQuoted([string] $Value) { "'" + $Value.Replace("'", "''") + "'" }

function Invoke-Step {
    param(
        [Parameter(Mandatory)][string] $Name,
        [Parameter(Mandatory)][string] $FilePath,
        [Parameter(Mandatory)][string[]] $Arguments,
        [hashtable] $Environment = @{},
        [int] $TimeoutSeconds = 7200,
        [switch] $UseNativeToolchain
    )
    if ($UseNativeToolchain) {
        # Cargo links through link.exe, and a Unix-style link from Git Bash or
        # MSYS earlier in PATH shadows it, producing "link: extra operand".
        # work/toolchain/Invoke-Task13bNative.ps1 puts the MSVC toolchain first
        # and sets INCLUDE and LIB. Arguments are passed through an encoded
        # command so tokens beginning with a dash bind to the wrapper's
        # CommandArguments array instead of being read as parameter names.
        if (-not (Test-Path -LiteralPath $nativeWrapper -PathType Leaf)) {
            throw "BLOCKED: the native toolchain wrapper is absent at $nativeWrapper."
        }
        $argumentList = ($Arguments | ForEach-Object { ConvertTo-SingleQuoted $_ }) -join ', '
        $code = "& $(ConvertTo-SingleQuoted $nativeWrapper) -Executable $(ConvertTo-SingleQuoted $FilePath) -CommandArguments @($argumentList); exit `$LASTEXITCODE"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
        Write-Utf8NoBom (Join-Path $logRoot "$Name.invocation.txt") $code
        $FilePath = "powershell.exe"
        $Arguments = @("-NoLogo", "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", $encoded)
    }
    $stdout = Join-Path $logRoot "$Name.stdout.log"
    $stderr = Join-Path $logRoot "$Name.stderr.log"
    $restore = @{}
    foreach ($key in $Environment.Keys) {
        $restore[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
        [Environment]::SetEnvironmentVariable($key, [string] $Environment[$key], "Process")
    }
    try {
        Write-Host "==> $Name"
        $process = Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $repositoryRoot `
            -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        # Cache the native handle immediately. Without it the kernel object can be
        # released once the process exits, leaving ExitCode null and turning a
        # successful step into a spurious failure. The exit code is then read
        # through the Win32 API and widened, so an HRESULT-style value survives
        # instead of overflowing Int32.
        $handle = $process.Handle
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            throw "$Name exceeded $TimeoutSeconds seconds."
        }
        $process.WaitForExit()
        [uint32] $native = 0
        if (-not [BuildPairExitApi]::GetExitCodeProcess($handle, [ref] $native)) {
            throw "Could not read the exit code for $Name."
        }
        $exitCode = [int64] $native
        if ($exitCode -ne 0) {
            $tail = if (Test-Path $stderr) { (Get-Content -LiteralPath $stderr -Tail 20 -ErrorAction SilentlyContinue) -join "`n" } else { "" }
            # The hex form is produced separately: applying -f to a message that
            # embeds captured stderr fails whenever that output contains braces,
            # which would destroy the diagnostic for the real failure.
            $hex = "0x" + $native.ToString("X8")
            throw "$Name exited with $exitCode ($hex).`n$tail`nSee $stdout and $stderr"
        }
    }
    finally {
        foreach ($key in $restore.Keys) { [Environment]::SetEnvironmentVariable($key, $restore[$key], "Process") }
    }
}

function Start-AssetMirror([object[]] $Specifications) {
    $specificationsPath = Join-Path $logRoot "mirror-specifications.json"
    $readyPath = Join-Path $logRoot "mirror-ready.json"
    $requestLogPath = Join-Path $logRoot "mirror-requests.jsonl"
    $stopPath = Join-Path $logRoot "mirror.stop"
    Remove-Item -LiteralPath $readyPath, $requestLogPath, $stopPath -Force -ErrorAction SilentlyContinue
    Write-Utf8NoBom $specificationsPath ($Specifications | ConvertTo-Json -Depth 8)
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-File", (Join-Path $task15Scripts "Start-TauriBundlerMirror.ps1"),
        "-SpecificationsPath", $specificationsPath, "-ReadyPath", $readyPath,
        "-RequestLogPath", $requestLogPath, "-StopPath", $stopPath
    ) -WorkingDirectory $repositoryRoot -PassThru -WindowStyle Hidden `
      -RedirectStandardOutput (Join-Path $logRoot "mirror.stdout.log") `
      -RedirectStandardError (Join-Path $logRoot "mirror.stderr.log")
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $readyPath)) { Start-Sleep -Milliseconds 200 }
    if (-not (Test-Path -LiteralPath $readyPath)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "The bundler asset mirror did not become ready within 30 seconds."
    }
    $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
    return [pscustomobject]@{ Process = $process; Port = [int] $ready.Port; StopPath = $stopPath }
}

function Stop-AssetMirror([object] $Mirror) {
    if (-not $Mirror) { return }
    try { Write-Utf8NoBom $Mirror.StopPath "stop" } catch {}
    if (-not $Mirror.Process.WaitForExit(10000)) { Stop-Process -Id $Mirror.Process.Id -Force -ErrorAction SilentlyContinue }
}

try {
    if (-not (Test-Path -LiteralPath $webViewManifest -PathType Leaf)) {
        throw "BLOCKED: the WebView2 offline binding is absent at $webViewManifest."
    }
    $record = Get-Content -LiteralPath $webViewManifest -Raw | ConvertFrom-Json
    $webViewSource = Join-Path $repositoryRoot $record.Path
    $signature = Get-AuthenticodeSignature -LiteralPath $webViewSource
    if ($signature.Status -ne "Valid") { throw "The WebView2 payload signature is $($signature.Status)." }

    if (-not $SkipFrontendBuild) { Invoke-Step "01-vite-build" "npm.cmd" @("run", "build") @{} 1800 }

    # The mirror serves each pinned asset from disk and needs LocalPath on every
    # specification. Rather than re-query GitHub for metadata we already pinned,
    # the path is derived from MirrorPath and the file is verified against the
    # specification's own hash, which is the same check the acquisition performs.
    $specifications = @(Get-TauriBundlerToolSpecifications | ForEach-Object {
        $relative = ([string] $_.MirrorPath).TrimStart('/').Replace('/', '\')
        $localPath = Join-Path $mirrorRoot $relative
        if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
            throw "BLOCKED: pinned bundler asset is absent at $localPath. Run scripts/task15/Acquire-TauriBundlerTools.ps1 on a networked host first."
        }
        Assert-TauriAssetFile -Path $localPath -Specification $_ | Out-Null
        $_ | Add-Member -NotePropertyName LocalPath -NotePropertyValue $localPath -PassThru
    })
    if ($specifications.Count -ne 2) { throw "Expected exactly two pinned bundler assets; found $($specifications.Count)." }
    $mirror = $null
    $built = @()
    try {
        $mirror = Start-AssetMirror $specifications
        $mirrorTemplate = "http://127.0.0.1:$($mirror.Port)/<owner>/<repo>/releases/download/<version>/<asset>"

        foreach ($version in @($PreviousVersion, $CurrentVersion)) {
            $target = Join-Path $buildRoot "$version\target"
            New-Item -ItemType Directory -Force -Path $target | Out-Null
            $override = Join-Path $buildRoot "$version\tauri-version-override.json"
            Write-Utf8NoBom $override ('{"version":"' + $version + '","bundle":{"useLocalToolsDir":true}}')

            $staged = Stage-WebViewPayload -SourcePath $webViewSource -CargoTargetDirectory $target `
                -AllowedBuildRoot $buildRoot -Binding $record.Binding -ExpectedSha256 ([string] $record.Sha256) `
                -Signature $signature
            Write-Host "    staged WebView2 payload at $staged"

            Invoke-Step "02-nsis-$version" "npx.cmd" @(
                "tauri", "build", "--config", $override, "--bundles", "nsis",
                "--target", "x86_64-pc-windows-msvc", "--ci"
            ) @{
                CARGO_TARGET_DIR = $target
                TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE = $mirrorTemplate
            } 7200 -UseNativeToolchain

            $produced = @(Get-ChildItem -LiteralPath (Join-Path $target "x86_64-pc-windows-msvc\release\bundle\nsis") -File -Filter "*.exe")
            if ($produced.Count -ne 1) { throw "Expected exactly one NSIS installer for $version; found $($produced.Count)." }
            $built += [pscustomobject]@{ Version = $version; SourcePath = $produced[0].FullName }
        }
    }
    finally { Stop-AssetMirror $mirror }

    # Publish only after both versions exist, so the manifest never describes a
    # half-built pair.
    $records = @()
    for ($index = 0; $index -lt $built.Count; $index++) {
        $item = $built[$index]
        $destinationDirectory = Join-Path $artifactRoot $item.Version
        New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
        $destination = Join-Path $destinationDirectory (Split-Path -Leaf $item.SourcePath)
        Copy-Item -LiteralPath $item.SourcePath -Destination $destination -Force
        $records += [ordered]@{
            Role = if ($index -eq 0) { "Previous" } else { "Current" }
            Version = $item.Version
            Name = (Split-Path -Leaf $destination)
            Size = (Get-Item -LiteralPath $destination).Length
            Sha256 = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
            Authenticode = (Get-AuthenticodeSignature -LiteralPath $destination).Status.ToString()
        }
    }

    $manifest = [ordered]@{
        SchemaVersion = 1; Architecture = "x64"; GeneratedAt = (Get-Date).ToString("o")
        BuiltBy = "scripts/Build-InstallerPair.ps1"
        Installers = $records
    }
    $manifestPath = Join-Path $artifactRoot "manifest.json"
    $temporary = "$manifestPath.tmp"
    Write-Utf8NoBom $temporary ($manifest | ConvertTo-Json -Depth 6)
    Move-Item -LiteralPath $temporary -Destination $manifestPath -Force

    Write-Host ""
    Write-Host "Installer pair published. These are build outputs and remain UNACCEPTED until Task 15B passes."
    $manifest | ConvertTo-Json -Depth 6
}
catch {
    Write-Utf8NoBom (Join-Path $logRoot "status.json") ([ordered]@{
        Status = "FAIL"; Message = $_.Exception.Message; Detail = ($_ | Out-String); FailedAt = (Get-Date).ToString("o")
    } | ConvertTo-Json)
    Write-Error $_
    exit 1
}
