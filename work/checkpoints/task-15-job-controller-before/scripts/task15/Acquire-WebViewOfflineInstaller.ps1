param(
    [string] $DestinationRoot,
    [string] $EvidencePath,
    [switch] $VerifyBindingOnly,
    [string] $ExpectedManifestPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -AssemblyName System.Net.Http
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $DestinationRoot) { $DestinationRoot = Join-Path $repositoryRoot "work\toolchain\webview-offline" }
if (-not $EvidencePath) { $EvidencePath = Join-Path $repositoryRoot "work\logs\task15a\retry\webview-acquisition.json" }
if (-not $ExpectedManifestPath) { $ExpectedManifestPath = Join-Path $DestinationRoot "binding.json" }
$modulePath = Join-Path $PSScriptRoot "WebViewAcquisition.psm1"
Import-Module -Name $modulePath -Force -DisableNameChecking

$fwlink = "https://go.microsoft.com/fwlink/?linkid=2124701"
$connectTimeoutSeconds = 30
$noByteTimeoutSeconds = 300
$overallTimeoutMinutes = 90
$progressIntervalSeconds = 30
$maximumAttempts = 8
$overallDeadline = (Get-Date).AddMinutes($overallTimeoutMinutes)

function Write-Utf8NoBom([string] $Path, [string] $Text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function New-HttpClient {
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $true
    $handler.MaxAutomaticRedirections = 5
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [Threading.Timeout]::InfiniteTimeSpan
    $client.DefaultRequestHeaders.UserAgent.ParseAdd("MiroraTrack-Task15A/1.0")
    return $client
}

function Invoke-WebViewHead([Net.Http.HttpClient] $Client) {
    $lastError = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if ((Get-Date) -ge $overallDeadline) { throw "WebView acquisition exceeded the 90-minute overall bound." }
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Head, $fwlink)
        $cts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($connectTimeoutSeconds))
        try {
            $response = $Client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cts.Token).GetAwaiter().GetResult()
            try {
                if (-not $response.IsSuccessStatusCode) { throw "WebView HEAD returned HTTP $([int] $response.StatusCode)." }
                $ranges = @($response.Headers.AcceptRanges | ForEach-Object { [string] $_ }) -join ","
                $etag = if ($response.Headers.ETag) { $response.Headers.ETag.ToString() } else { "" }
                $lastModified = if ($response.Content.Headers.LastModified) { $response.Content.Headers.LastModified.ToString("R") } else { "" }
                return New-WebViewBinding -FinalUri $response.RequestMessage.RequestUri.AbsoluteUri `
                    -ContentLength ([long] $response.Content.Headers.ContentLength) `
                    -AcceptRanges $ranges -ETag $etag -LastModified $lastModified
            }
            finally { $response.Dispose() }
        }
        catch { $lastError = $_; if ($attempt -lt 3) { Start-Sleep -Seconds $attempt } }
        finally { $cts.Dispose(); $request.Dispose() }
    }
    throw "WebView HEAD failed after bounded retries: $($lastError.Exception.Message)"
}

function Get-RealSignature([string] $Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    Assert-WebViewSignature -Signature $signature
    return $signature
}

function Read-ValidatedManifest([string] $Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Expected WebView binding manifest is missing: $Path" }
    $manifest = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    foreach ($field in @("Binding", "Sha256", "Path")) {
        if ($null -eq $manifest.$field) { throw "WebView binding manifest lacks $field." }
    }
    return $manifest
}

function Assert-ManifestPayload([object] $Manifest) {
    $signature = Get-RealSignature ([string] $Manifest.Path)
    Assert-WebViewPayloadFile -Path ([string] $Manifest.Path) -Binding $Manifest.Binding `
        -ExpectedSha256 ([string] $Manifest.Sha256) -Signature $signature | Out-Null
    return $signature
}

New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null
$client = New-HttpClient
try {
    $binding = Invoke-WebViewHead $client
    $knownSha256 = $null
    if ($VerifyBindingOnly) {
        $manifest = Read-ValidatedManifest $ExpectedManifestPath
        if (-not (Test-WebViewBindingEqual $binding $manifest.Binding)) {
            throw "Current Microsoft WebView binding changed; old partial or staged payload must not be reused."
        }
        $signature = Assert-ManifestPayload $manifest
        $result = [ordered]@{
            Status = "PASS"; Mode = "VerifyBindingOnly"; Binding = $binding
            Sha256 = [string] $manifest.Sha256; Path = [string] $manifest.Path
            SignatureStatus = [string] $signature.Status
            SignerSubject = [string] $signature.SignerCertificate.Subject
            VerifiedAt = (Get-Date).ToString("o")
        }
        Write-Utf8NoBom $EvidencePath ($result | ConvertTo-Json -Depth 8)
        $result | ConvertTo-Json -Depth 8
        exit 0
    }

    if (Test-Path -LiteralPath $ExpectedManifestPath) {
        try {
            $existing = Read-ValidatedManifest $ExpectedManifestPath
            if (Test-WebViewBindingEqual $binding $existing.Binding) {
                $knownSha256 = [string] $existing.Sha256
                $existingSignature = Assert-ManifestPayload $existing
                $result = [ordered]@{
                    Status = "PASS"; Mode = "ValidatedExisting"; Binding = $binding
                    Sha256 = [string] $existing.Sha256; Path = [string] $existing.Path
                    SignatureStatus = [string] $existingSignature.Status
                    SignerSubject = [string] $existingSignature.SignerCertificate.Subject
                    VerifiedAt = (Get-Date).ToString("o")
                }
                Write-Utf8NoBom $EvidencePath ($result | ConvertTo-Json -Depth 8)
                $result | ConvertTo-Json -Depth 8
                exit 0
            }
        }
        catch {
            # Preserve the existing promoted asset and attempt a separately staged replacement.
        }
    }

    $downloadRoot = Join-Path $DestinationRoot "download"
    $partialPath = Join-Path $downloadRoot "MicrosoftEdgeWebView2RuntimeInstallerX64.exe.partial"
    $statePath = "$partialPath.json"
    $quarantineRoot = Join-Path $DestinationRoot "quarantine"
    New-Item -ItemType Directory -Force -Path $downloadRoot | Out-Null
    $offset = Resolve-WebViewResume -PartialPath $partialPath -StatePath $statePath `
        -Binding $binding -QuarantineRoot $quarantineRoot
    if ($offset -eq 0) { Write-WebViewPartialState -StatePath $statePath -Binding $binding }

    $lastProgress = Get-Date
    $attempt = 0
    while ($offset -lt [long] $binding.Size) {
        if ((Get-Date) -ge $overallDeadline) { throw "WebView acquisition exceeded the 90-minute overall bound." }
        $attempt++
        if ($attempt -gt $maximumAttempts) { throw "WebView acquisition exceeded $maximumAttempts bounded range attempts." }
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $binding.FinalUrl)
        $request.Headers.Range = [Net.Http.Headers.RangeHeaderValue]::new($offset, ([long] $binding.Size - 1))
        [void] $request.Headers.TryAddWithoutValidation("If-Range", [string] $binding.ETag)
        $headerCts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($connectTimeoutSeconds))
        $response = $null
        try {
            $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $headerCts.Token).GetAwaiter().GetResult()
            $rangeText = if ($response.Content.Headers.ContentRange) { $response.Content.Headers.ContentRange.ToString() } else { "" }
            Assert-WebViewRangeResponse -StatusCode ([int] $response.StatusCode) -ContentRange $rangeText `
                -ExpectedStart $offset -ExpectedEnd ([long] $binding.Size - 1) -TotalSize ([long] $binding.Size)
            $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
            $file = [IO.File]::Open($partialPath, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            try {
                $buffer = New-Object byte[] (1024 * 1024)
                while ($offset -lt [long] $binding.Size) {
                    $remaining = [long] $binding.Size - $offset
                    $count = [int] [Math]::Min([long] $buffer.Length, $remaining)
                    $readCts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($noByteTimeoutSeconds))
                    try { $read = $stream.ReadAsync($buffer, 0, $count, $readCts.Token).GetAwaiter().GetResult() }
                    finally { $readCts.Dispose() }
                    if ($read -le 0) { throw "WebView range ended before the bound payload size." }
                    $file.Write($buffer, 0, $read)
                    $file.Flush($true)
                    $offset += $read
                    if (((Get-Date) - $lastProgress).TotalSeconds -ge $progressIntervalSeconds) {
                        $percent = [Math]::Round(($offset * 100.0) / [long] $binding.Size, 2)
                        Write-Output ("WebView progress: {0}/{1} bytes ({2}%)" -f $offset, $binding.Size, $percent)
                        $lastProgress = Get-Date
                    }
                }
            }
            finally { $file.Dispose(); $stream.Dispose() }
        }
        catch {
            $offset = if (Test-Path -LiteralPath $partialPath) { (Get-Item -LiteralPath $partialPath).Length } else { 0L }
            if ($attempt -ge $maximumAttempts) { throw }
            Write-Output "WebView range attempt $attempt interrupted at byte $offset; resuming."
            Start-Sleep -Seconds ([Math]::Min(10, $attempt * 2))
        }
        finally {
            if ($response) { $response.Dispose() }
            $headerCts.Dispose()
            $request.Dispose()
        }
    }

    if ((Get-Item -LiteralPath $partialPath).Length -ne [long] $binding.Size) {
        throw "WebView partial is truncated after acquisition."
    }
    $actualSha256 = (Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash
    $sha256 = if ($knownSha256) { $knownSha256 } else { $actualSha256 }
    $signature = Get-AuthenticodeSignature -LiteralPath $partialPath
    Assert-OrQuarantineWebViewPartial -PartialPath $partialPath -StatePath $statePath `
        -QuarantineRoot $quarantineRoot -Binding $binding -ExpectedSha256 $sha256 -Signature $signature
    $destination = Join-Path $DestinationRoot "$($binding.Guid)\$($binding.AssetName)"
    Publish-WebViewPayload -PartialPath $partialPath -DestinationPath $destination `
        -ManifestPath (Join-Path $downloadRoot "promotion.json") -Binding $binding `
        -ExpectedSha256 $sha256 -Signature $signature
    $promotedSignature = Get-RealSignature $destination
    Assert-WebViewPayloadFile -Path $destination -Binding $binding -ExpectedSha256 $sha256 `
        -Signature $promotedSignature | Out-Null
    $manifestRecord = [ordered]@{
        Binding = $binding; Sha256 = $sha256; Path = $destination
        SignatureStatus = [string] $promotedSignature.Status
        SignerSubject = [string] $promotedSignature.SignerCertificate.Subject
        CompletedAt = (Get-Date).ToString("o")
    }
    Write-Utf8NoBom $ExpectedManifestPath ($manifestRecord | ConvertTo-Json -Depth 8)
    Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    $result = [ordered]@{ Status = "PASS"; Mode = "Acquired" } + $manifestRecord
    Write-Utf8NoBom $EvidencePath ($result | ConvertTo-Json -Depth 8)
    $result | ConvertTo-Json -Depth 8
}
finally { $client.Dispose() }
