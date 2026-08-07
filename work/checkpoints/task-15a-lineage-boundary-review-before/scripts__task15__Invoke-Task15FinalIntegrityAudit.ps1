param(
    [Parameter(Mandatory)][string]$EvidenceDirectory,
    [Parameter(Mandatory)][string]$ExtractionDirectory,
    [Parameter(Mandatory)][string]$OutputPath,
    [string]$ExpectedManifestPath,
    [string]$Task15LogDirectory
)
$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$evidenceRoot=[IO.Path]::GetFullPath($EvidenceDirectory).TrimEnd('\')
$extractionRoot=[IO.Path]::GetFullPath($ExtractionDirectory).TrimEnd('\')
$resolvedOutput=[IO.Path]::GetFullPath($OutputPath)
if(-not(Test-Path -LiteralPath $evidenceRoot -PathType Container)){throw "EvidenceDirectory must already exist."}
if(-not $extractionRoot.StartsWith($evidenceRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $resolvedOutput.StartsWith($evidenceRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw "ExtractionDirectory and OutputPath must be inside EvidenceDirectory."}
if(Test-Path -LiteralPath $resolvedOutput){throw "Fresh OutputPath already exists: $resolvedOutput"}
if(-not $ExpectedManifestPath){$ExpectedManifestPath=Join-Path $repositoryRoot "work\artifacts\task15\unaccepted\manifest.json"}
if(-not $Task15LogDirectory){$Task15LogDirectory=Join-Path $repositoryRoot "work\logs\task15a"}
$task15LogRoot=[IO.Path]::GetFullPath($Task15LogDirectory).TrimEnd('\')
if(-not(Test-Path -LiteralPath $task15LogRoot -PathType Container)){throw "Task15LogDirectory does not exist: $task15LogRoot"}
Import-Module (Join-Path $PSScriptRoot "Task15ProcessLineage.psm1") -Force
$artifactManifest=Get-Content -LiteralPath $ExpectedManifestPath -Raw|ConvertFrom-Json
$expectedInstallers=[ordered]@{}
foreach($entry in @($artifactManifest.Installers)){$expectedInstallers[[string]$entry.Version]=[ordered]@{Size=[long]$entry.Size;Sha256=[string]$entry.Sha256;Name=[string]$entry.Name;Authenticode=[string]$entry.Authenticode}}
if($expectedInstallers.Count-ne 2 -or -not $expectedInstallers.Contains('0.0.9') -or -not $expectedInstallers.Contains('0.1.0')){throw "Authoritative manifest lacks exact 0.0.9/0.1.0 records."}
$payloadManifest=Get-Content -LiteralPath (Join-Path $repositoryRoot "work\toolchain\webview-offline\binding.json") -Raw|ConvertFrom-Json
$expectedPayloadSize=[long]$payloadManifest.Binding.Size
$expectedPayloadHash=[string]$payloadManifest.Sha256

function Get-PeMachine([string] $Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        $stream.Position = 0x3c
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550) { throw "Not a PE file: $Path" }
        return ("0x{0:X4}" -f $reader.ReadUInt16())
    }
    finally { $stream.Dispose() }
}

$visualStudio7Zip = Get-ChildItem -Path (Join-Path $env:ProgramFiles "Microsoft Visual Studio") `
    -Filter "7z.exe" -Recurse -ErrorAction SilentlyContinue | Where-Object {
        $_.FullName -match '\\7-Zip\\7z\.exe$'
    } | Select-Object -First 1 -ExpandProperty FullName
if (-not $visualStudio7Zip) { throw "Validated Visual Studio 7-Zip was not found." }
if (Test-Path -LiteralPath $extractionRoot) { throw "Fresh extraction root already exists: $extractionRoot" }
New-Item -ItemType Directory -Path $extractionRoot | Out-Null

$versionResults = [ordered]@{}
foreach ($version in $expectedInstallers.Keys) {
    $artifact = Join-Path $repositoryRoot "work\artifacts\task15\unaccepted\$version\MiroraTrack_${version}_x64-setup.exe"
    $source = Join-Path $repositoryRoot "work\build\task15\$version\target\x86_64-pc-windows-msvc\release\bundle\nsis\MiroraTrack_${version}_x64-setup.exe"
    $output = Join-Path $extractionRoot $version
    New-Item -ItemType Directory -Path $output | Out-Null
    $sevenZipStdout = Join-Path $evidenceRoot "audit-7zip-$version.stdout.log"
    $sevenZipStderr = Join-Path $evidenceRoot "audit-7zip-$version.stderr.log"
    $sevenZipArguments = @("x", "-y", "-o$output", $artifact)
    & $visualStudio7Zip @sevenZipArguments 1> $sevenZipStdout 2> $sevenZipStderr
    $sevenZipExitCode = [int] $LASTEXITCODE
    if ($sevenZipExitCode -ne 0) { throw "7-Zip failed for $version with exit $sevenZipExitCode." }

    $artifactItem = Get-Item -LiteralPath $artifact
    $sourceItem = Get-Item -LiteralPath $source
    $artifactHash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $wrapperInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($artifact)
    $wrapperSignature = Get-AuthenticodeSignature -LiteralPath $artifact
    $payloads = @(Get-ChildItem -LiteralPath $output -Recurse -File -Filter "MicrosoftEdgeWebView2RuntimeInstaller.exe")
    $applications = @(Get-ChildItem -LiteralPath $output -File -Filter "miroratrack.exe")
    if ($payloads.Count -ne 1) { throw "Expected one embedded WebView payload for $version; found $($payloads.Count)." }
    if ($applications.Count -ne 1) { throw "Expected one embedded application for $version; found $($applications.Count)." }
    $payload = $payloads[0]
    $payloadHash = (Get-FileHash -LiteralPath $payload.FullName -Algorithm SHA256).Hash
    $payloadSignature = Get-AuthenticodeSignature -LiteralPath $payload.FullName
    $application = $applications[0]
    $applicationInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($application.FullName)

    $nsiPath = Join-Path $repositoryRoot "work\build\task15\$version\target\x86_64-pc-windows-msvc\release\nsis\x64\installer.nsi"
    $nsiText = Get-Content -LiteralPath $nsiPath -Raw
    $nsiAssertions = [ordered]@{
        Version = $nsiText -match ('!define VERSION "' + [regex]::Escape($version) + '"')
        ArchX64 = $nsiText -match '!define ARCH "x64"'
        CurrentUser = $nsiText -match '!define INSTALLMODE "currentUser"' -and $nsiText -match 'RequestExecutionLevel user'
        OfflineWebView = $nsiText -match '!define INSTALLWEBVIEW2MODE "offlineInstaller"'
        DowngradesDisabled = $nsiText -match '!define ALLOWDOWNGRADES "false"'
        NoModify = $nsiText -match '"NoModify" "1"'
        NoRepair = $nsiText -match '"NoRepair" "1"'
        StartMenuShortcut = $nsiText -match 'CreateShortcut "\$SMPROGRAMS'
        DesktopShortcut = $nsiText -match 'CreateShortcut "\$DESKTOP'
        HkcuUninstall = $nsiText -match 'DeleteRegKey HKCU'
    }

    if ($artifactItem.Length -ne $expectedInstallers[$version].Size -or
        $artifactHash -cne $expectedInstallers[$version].Sha256 -or
        $sourceItem.Length -ne $artifactItem.Length -or $sourceHash -cne $artifactHash) {
        throw "Installer identity or source-copy equality failed for $version."
    }
    if ($wrapperInfo.FileVersion -cne $version -or $wrapperInfo.ProductVersion -cne $version -or
        $wrapperSignature.Status -ne "NotSigned") { throw "Wrapper metadata failed for $version." }
    if ($payload.Length -ne $expectedPayloadSize -or $payloadHash -cne $expectedPayloadHash -or
        $payloadSignature.Status -ne "Valid" -or
        $payloadSignature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
        throw "Embedded WebView identity or signature failed for $version."
    }
    if ((Get-PeMachine $application.FullName) -cne "0x8664" -or
        $applicationInfo.FileVersion -cne $version -or $applicationInfo.ProductVersion -cne $version) {
        throw "Embedded application architecture or version failed for $version."
    }
    if (@($nsiAssertions.GetEnumerator() | Where-Object { -not $_.Value }).Count -ne 0) {
        throw "Generated NSIS assertions failed for $version."
    }

    $versionResults[$version] = [ordered]@{
        ArtifactPath = $artifact
        ArtifactSize = $artifactItem.Length
        ArtifactSha256 = $artifactHash
        SourcePath = $source
        SourceSize = $sourceItem.Length
        SourceSha256 = $sourceHash
        CopyMatchesSource = $artifactHash -ceq $sourceHash
        SevenZip = [ordered]@{
            Executable = $visualStudio7Zip
            Arguments = $sevenZipArguments
            Command = $visualStudio7Zip + ' x -y "-o' + $output + '" "' + $artifact + '"'
            NumericExitCode = $sevenZipExitCode
            Stdout = Split-Path $sevenZipStdout -Leaf
            Stderr = Split-Path $sevenZipStderr -Leaf
        }
        ExtractedFileCount = @(Get-ChildItem -LiteralPath $output -Recurse -File).Count
        WrapperFileVersion = $wrapperInfo.FileVersion
        WrapperProductVersion = $wrapperInfo.ProductVersion
        WrapperAuthenticode = [string] $wrapperSignature.Status
        EmbeddedApplicationPath = $application.FullName
        EmbeddedApplicationSize = $application.Length
        EmbeddedApplicationSha256 = (Get-FileHash -LiteralPath $application.FullName -Algorithm SHA256).Hash
        EmbeddedApplicationPeMachine = Get-PeMachine $application.FullName
        EmbeddedApplicationFileVersion = $applicationInfo.FileVersion
        EmbeddedApplicationProductVersion = $applicationInfo.ProductVersion
        EmbeddedPayloadPath = $payload.FullName
        EmbeddedPayloadSize = $payload.Length
        EmbeddedPayloadSha256 = $payloadHash
        EmbeddedPayloadAuthenticode = [string] $payloadSignature.Status
        EmbeddedPayloadSigner = $payloadSignature.SignerCertificate.Subject
        NsisScriptPath = $nsiPath
        NsisScriptSha256 = (Get-FileHash -LiteralPath $nsiPath -Algorithm SHA256).Hash
        NsisAssertions = $nsiAssertions
    }
}

$before = Get-Content -LiteralPath (Join-Path $task15LogRoot "00-protected-hashes-before.json") -Raw | ConvertFrom-Json
$after = Get-Content -LiteralPath (Join-Path $task15LogRoot "99-protected-hashes-after.json") -Raw | ConvertFrom-Json
$protected = [ordered]@{}
foreach ($property in $before.PSObject.Properties) {
    $current = (Get-FileHash -LiteralPath (Join-Path $repositoryRoot $property.Name) -Algorithm SHA256).Hash
    $protected[$property.Name] = [ordered]@{
        Before = $property.Value
        After = $after.($property.Name)
        Current = $current
        AllEqual = $property.Value -ceq $after.($property.Name) -and $property.Value -ceq $current
    }
}
if (@($protected.GetEnumerator() | Where-Object { -not $_.Value.AllEqual }).Count -ne 0) {
    throw "Protected-file integrity failed."
}

$requests = @(Get-Content -LiteralPath (Join-Path $task15LogRoot "retry\mirror-requests.jsonl") |
    Where-Object { $_ } | ForEach-Object { $_ | ConvertFrom-Json })
$approved = [ordered]@{
    "/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip" = 2361546L
    "/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll" = 34304L
}
if ($requests.Count -ne 4) { throw "Expected four exact mirror requests; found $($requests.Count)." }
foreach ($request in $requests) {
    if (-not $approved.Contains([string] $request.RawPath) -or [int] $request.Status -ne 200 -or
        [long] $request.BytesServed -ne $approved[[string] $request.RawPath] -or
        [string] $request.Headers.'user-agent' -cne "tauri-bundler/2.9.4") {
        throw "Unapproved or mismatched mirror request: $($request.RawPath)"
    }
}
foreach ($path in $approved.Keys) {
    if (@($requests | Where-Object RawPath -CEQ $path).Count -ne 2) { throw "Mirror path count failed: $path" }
}

$buildLogs = Get-Content -LiteralPath `
    (Join-Path $task15LogRoot "13-cycle-1-tauri-nsis-0.0.9.stderr.log"), `
    (Join-Path $task15LogRoot "15-cycle-1-tauri-nsis-0.1.0.stderr.log") -Raw
$largeWebViewGetAbsent = -not ($buildLogs -match 'go\.microsoft\.com/fwlink|msedge\.sf\.dl\.delivery\.mp\.microsoft\.com|Downloading .*MicrosoftEdgeWebView2')
if (-not $largeWebViewGetAbsent) { throw "A Tauri large WebView GET appears in final build logs." }

$mirrorReady = Get-Content -LiteralPath (Join-Path $task15LogRoot "retry\mirror-ready.json") -Raw | ConvertFrom-Json
$mirrorProcess = Get-Process -Id ([int] $mirrorReady.Pid) -ErrorAction SilentlyContinue
$mirrorListeners = @(Get-NetTCPConnection -State Listen -LocalPort ([int] $mirrorReady.Port) -ErrorAction SilentlyContinue)
$requiredLineageSteps = @(
    "01-npm-ci", "02-typecheck", "03-vitest", "04-playwright", "05-vite-build",
    "06-cargo-fmt", "07-cargo-test", "08-cargo-clippy", "09-tauri-native-build",
    "10-acquire-bundler-tools", "11-acquire-webview-offline",
    "12-cycle-1-verify-webview-0.0.9", "13-cycle-1-tauri-nsis-0.0.9",
    "14-cycle-1-verify-webview-0.1.0", "15-cycle-1-tauri-nsis-0.1.0"
)
$lineagePaths = @($requiredLineageSteps | ForEach-Object { Join-Path $task15LogRoot "$_.lineage.json" })
Assert-Task15LineageEvidenceClean -EvidencePaths $lineagePaths
$lineageEvidence = @($lineagePaths | ForEach-Object { Get-Content -LiteralPath $_ -Raw | ConvertFrom-Json })
$trackedProcesses = @($lineageEvidence | ForEach-Object { @($_.TrackedProcesses) })
$terminatedProcesses = @($lineageEvidence | ForEach-Object { @($_.TerminatedProcesses) })
$trackedSurvivors = @($trackedProcesses | Where-Object { Test-Task15ExactProcessIdentity -Identity $_ })
if ($mirrorProcess -or $mirrorListeners.Count -ne 0 -or $trackedSurvivors.Count -ne 0) {
    throw "Final process or listener cleanup failed."
}

$result = [ordered]@{
    Status = "PASS"
    Command = 'powershell.exe -NoLogo -NoProfile -NonInteractive -File "'+$PSCommandPath+'" -EvidenceDirectory "'+$evidenceRoot+'" -ExtractionDirectory "'+$extractionRoot+'" -OutputPath "'+$resolvedOutput+'" -ExpectedManifestPath "'+([IO.Path]::GetFullPath($ExpectedManifestPath))+'" -Task15LogDirectory "'+$task15LogRoot+'"'
    CompletedAt = (Get-Date).ToString("o")
    SevenZipVersion = (& $visualStudio7Zip | Select-Object -First 2 | Select-Object -Last 1)
    Versions = $versionResults
    ProtectedFiles = $protected
    Mirror = [ordered]@{
        ExactRequestCount = $requests.Count
        Requests = @($requests | Select-Object RawPath, Status, BytesServed, @{ Name = "UserAgent"; Expression = { $_.Headers.'user-agent' } })
        LargeWebViewGetAbsent = $largeWebViewGetAbsent
        RecordedPid = [int] $mirrorReady.Pid
        RecordedPort = [int] $mirrorReady.Port
        ExactProcessPresent = [bool] $mirrorProcess
        ListenerCount = $mirrorListeners.Count
    }
    ProcessLineage = [ordered]@{
        EvidenceCount = $lineageEvidence.Count
        Steps = @($lineageEvidence | Select-Object StepName, Status, SampleCount, @{Name="TrackedProcessCount";Expression={@($_.TrackedProcesses).Count}}, @{Name="TerminatedProcessCount";Expression={@($_.TerminatedProcesses).Count}}, @{Name="SurvivorsAfterCleanupCount";Expression={@($_.SurvivorsAfterCleanup).Count}})
        TrackedProcesses = $trackedProcesses
        TerminatedProcesses = $terminatedProcesses
        ExactTrackedSurvivorCount = $trackedSurvivors.Count
    }
}
$resultPath = $resolvedOutput
[IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
"Final Task 15A integrity audit: PASS"
"Evidence: $resultPath"
