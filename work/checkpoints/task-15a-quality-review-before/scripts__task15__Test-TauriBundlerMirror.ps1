$ErrorActionPreference = "Stop"

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$modulePath = Join-Path $PSScriptRoot "TauriBundlerMirror.psm1"
$serverPath = Join-Path $PSScriptRoot "Start-TauriBundlerMirror.ps1"
$testRoot = Join-Path $repositoryRoot "work\logs\task15a\retry\test-temp"

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}

function Assert-Throws([scriptblock] $Action, [string] $Message) {
    $threw = $false
    try { & $Action } catch { $threw = $true }
    if (-not $threw) { throw "ASSERTION FAILED: expected rejection for $Message" }
}

function Copy-Object($Value) {
    return ($Value | ConvertTo-Json -Depth 10 | ConvertFrom-Json)
}

Import-Module -Name $modulePath -Force

$specifications = @(Get-TauriBundlerToolSpecifications)
Assert-True ($specifications.Count -eq 2) "exactly two approved tools"
$nsis = $specifications | Where-Object AssetId -eq 317051073
$utility = $specifications | Where-Object AssetId -eq 345882097
Assert-True ($nsis.Size -eq 2361546) "pinned NSIS size"
Assert-True ($nsis.Sha256 -ceq "C7D27F780DDB6CFFB4730138CD1591E841F4B7EDB155856901CDF5F214394FA1") "pinned NSIS SHA-256"
Assert-True ($nsis.Sha1 -ceq "EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D") "pinned NSIS SHA-1"
Assert-True ($utility.Size -eq 34304) "pinned utility size"
Assert-True ($utility.Sha256 -ceq "5BA143B5DB4A87D32D6E7802E033330AAE56CBCEABE0D1E3BA41948385AD4709") "pinned utility SHA-256"
Assert-True ($utility.Sha1 -ceq "75197FEE3C6A814FE035788D1C34EAD39349B860") "pinned utility SHA-1"

$metadata = [pscustomobject]@{
    Owner = $nsis.Owner
    Repo = $nsis.Repo
    TagName = $nsis.TagName
    Asset = [pscustomobject]@{
        Id = $nsis.AssetId
        Name = $nsis.AssetName
        Size = $nsis.Size
        Digest = "sha256:$($nsis.Sha256.ToLowerInvariant())"
        State = "uploaded"
        CreatedAt = $nsis.CreatedAt
        UpdatedAt = $nsis.UpdatedAt
        ApiUrl = $nsis.ApiUrl
        BrowserDownloadUrl = $nsis.BrowserDownloadUrl
    }
}
Assert-TauriReleaseMetadata -Metadata $metadata -Specification $nsis

$mutations = @(
    @("Owner", "evil-owner"),
    @("Repo", "evil-repo"),
    @("TagName", "wrong-tag"),
    @("Asset.Id", 1),
    @("Asset.Name", "wrong.bin"),
    @("Asset.Size", 3),
    @("Asset.Digest", "sha256:00"),
    @("Asset.State", "new"),
    @("Asset.CreatedAt", "2000-01-01T00:00:00Z"),
    @("Asset.UpdatedAt", "2000-01-01T00:00:00Z"),
    @("Asset.ApiUrl", "https://api.github.com/repos/evil/evil/releases/assets/1"),
    @("Asset.BrowserDownloadUrl", "https://example.com/evil")
)
foreach ($mutation in $mutations) {
    $changed = Copy-Object $metadata
    if ($mutation[0].StartsWith("Asset.")) {
        $property = $mutation[0].Substring(6)
        $changed.Asset.$property = $mutation[1]
    } else {
        $changed.($mutation[0]) = $mutation[1]
    }
    Assert-Throws { Assert-TauriReleaseMetadata -Metadata $changed -Specification $nsis } $mutation[0]
}

if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
$fixtureRoot = Join-Path $testRoot "fixtures"
New-Item -ItemType Directory -Force -Path $fixtureRoot | Out-Null
$assetOne = Join-Path $fixtureRoot "one.bin"
$assetTwo = Join-Path $fixtureRoot "two.bin"
[IO.File]::WriteAllBytes($assetOne, [byte[]] (0..255))
[IO.File]::WriteAllBytes($assetTwo, [Text.Encoding]::UTF8.GetBytes("exact utility fixture"))

function New-FixtureSpecification([string] $Owner, [string] $Repo, [string] $Tag, [string] $Name, [int] $Id, [string] $Path) {
    [pscustomobject]@{
        Owner = $Owner
        Repo = $Repo
        TagName = $Tag
        AssetName = $Name
        AssetId = $Id
        Size = (Get-Item -LiteralPath $Path).Length
        Sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
        Sha1 = (Get-FileHash -LiteralPath $Path -Algorithm SHA1).Hash
        CreatedAt = "2026-01-01T00:00:00Z"
        UpdatedAt = "2026-01-01T00:00:00Z"
        ApiUrl = "https://api.github.com/repos/$Owner/$Repo/releases/assets/$Id"
        BrowserDownloadUrl = "https://github.com/$Owner/$Repo/releases/download/$Tag/$Name"
        MirrorPath = "/$Owner/$Repo/releases/download/$Tag/$Name"
        LocalPath = $Path
        ZipEntryCount = $null
    }
}

$fixtureSpecs = @(
    (New-FixtureSpecification "tauri-apps" "binary-releases" "fixture-v1" "one.bin" 10 $assetOne),
    (New-FixtureSpecification "tauri-apps" "nsis-tauri-utils" "fixture-v2" "two.bin" 11 $assetTwo)
)

Assert-TauriAssetFile -Path $assetOne -Specification $fixtureSpecs[0]
$truncated = Join-Path $testRoot "truncated.partial"
[IO.File]::WriteAllBytes($truncated, [byte[]] (0..20))
Assert-Throws { Assert-TauriAssetFile -Path $truncated -Specification $fixtureSpecs[0] } "truncated asset"
$tampered = Join-Path $testRoot "tampered.partial"
Copy-Item -LiteralPath $assetOne -Destination $tampered
$tamperedBytes = [IO.File]::ReadAllBytes($tampered)
$tamperedBytes[5] = $tamperedBytes[5] -bxor 0xFF
[IO.File]::WriteAllBytes($tampered, $tamperedBytes)
Assert-Throws { Assert-TauriAssetFile -Path $tampered -Specification $fixtureSpecs[0] } "tampered asset"

$destination = Join-Path $testRoot "promoted\one.bin"
Assert-Throws { Publish-TauriAssetAtomically -PartialPath $tampered -DestinationPath $destination -Specification $fixtureSpecs[0] } "tampered partial promotion"
Assert-True (-not (Test-Path -LiteralPath $destination)) "invalid .partial was not promoted"
$validPartial = Join-Path $testRoot "valid.partial"
Copy-Item -LiteralPath $assetOne -Destination $validPartial
Publish-TauriAssetAtomically -PartialPath $validPartial -DestinationPath $destination -Specification $fixtureSpecs[0]
Assert-True ((Get-FileHash $destination -Algorithm SHA256).Hash -ceq $fixtureSpecs[0].Sha256) "valid partial atomically promoted"
Assert-True (-not (Test-Path -LiteralPath $validPartial)) "partial name removed after promotion"

Assert-True ((Resolve-TauriMirrorRequest -RawPath $fixtureSpecs[0].MirrorPath -Specifications $fixtureSpecs).AssetId -eq 10) "exact mirror path resolves"
foreach ($badPath in @(
    "/unknown/path",
    "/tauri-apps/binary-releases/releases/download/fixture-v1/../one.bin",
    "/tauri-apps/binary-releases/releases/download/fixture-v1/%2e%2e/one.bin",
    "/tauri-apps/binary-releases/releases/download/fixture-v1/one.bin/extra"
)) {
    Assert-Throws { Resolve-TauriMirrorRequest -RawPath $badPath -Specifications $fixtureSpecs } "unknown/traversal path $badPath"
}

$serverSpecPath = Join-Path $testRoot "server-specifications.json"
$readyPath = Join-Path $testRoot "mirror-ready.json"
$requestLog = Join-Path $testRoot "mirror-requests.jsonl"
$stopPath = Join-Path $testRoot "mirror.stop"
$fixtureSpecs | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $serverSpecPath -Encoding UTF8
$server = Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoLogo", "-NoProfile", "-NonInteractive", "-File", $serverPath,
    "-SpecificationsPath", $serverSpecPath, "-ReadyPath", $readyPath,
    "-RequestLogPath", $requestLog, "-StopPath", $stopPath
) -WorkingDirectory $repositoryRoot -PassThru -WindowStyle Hidden
try {
    $deadline = (Get-Date).AddSeconds(15)
    while (-not (Test-Path -LiteralPath $readyPath) -and (Get-Date) -lt $deadline) {
        if ($server.HasExited) { throw "mirror server exited before ready" }
        Start-Sleep -Milliseconds 100
    }
    Assert-True (Test-Path -LiteralPath $readyPath) "mirror ready file"
    $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
    Assert-True ($ready.Address -ceq "127.0.0.1") "loopback-only advertised address"
    $listeners = @(Get-NetTCPConnection -State Listen -OwningProcess $server.Id -ErrorAction Stop)
    Assert-True ($listeners.Count -eq 1) "one listener"
    Assert-True ($listeners[0].LocalAddress -ceq "127.0.0.1") "listener is loopback-only"

    foreach ($fixture in $fixtureSpecs) {
        $responsePath = Join-Path $testRoot ("served-" + $fixture.AssetName)
        Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}{1}" -f $ready.Port, $fixture.MirrorPath) -OutFile $responsePath -TimeoutSec 10
        Assert-True ((Get-Item $responsePath).Length -eq $fixture.Size) "served exact size for $($fixture.AssetName)"
        Assert-True ((Get-FileHash $responsePath -Algorithm SHA256).Hash -ceq $fixture.Sha256) "served exact hash for $($fixture.AssetName)"
    }
    $rangeDownload = Join-Path $testRoot "range-download.partial"
    Invoke-TauriRestAssetDownload -Uri ("http://127.0.0.1:{0}{1}" -f $ready.Port, $fixtureSpecs[0].MirrorPath) -DestinationPath $rangeDownload -ExpectedSize $fixtureSpecs[0].Size -TimeoutSeconds 10
    Assert-True ((Get-FileHash $rangeDownload -Algorithm SHA256).Hash -ceq $fixtureSpecs[0].Sha256) "REST downloader streams exact bytes"
    $rangeRequest = Get-Content -LiteralPath $requestLog | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object RawPath -eq $fixtureSpecs[0].MirrorPath | Select-Object -Last 1
    Assert-True ($rangeRequest.Headers.Accept -ceq "application/octet-stream") "REST downloader sends exact Accept"
    Assert-True ($rangeRequest.Headers.Range -ceq ("bytes=0-{0}" -f ($fixtureSpecs[0].Size - 1))) "REST downloader sends exact full Range"
    foreach ($badPath in @("/unknown", "/%2e%2e/secret")) {
        Assert-Throws { Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:{0}{1}" -f $ready.Port, $badPath) -TimeoutSec 5 } "server rejects $badPath"
    }
}
finally {
    New-Item -ItemType File -Force -Path $stopPath | Out-Null
    if (-not $server.WaitForExit(10000)) { Stop-Process -Id $server.Id -Force }
}
Assert-True (-not (Get-Process -Id $server.Id -ErrorAction SilentlyContinue)) "mirror process stopped"

$cliVersion = (& npx.cmd tauri --version).Trim()
Assert-True ($cliVersion -ceq "tauri-cli 2.11.4") "exact Tauri CLI 2.11.4"

"Task 15 Tauri bundler mirror tests: PASS"
