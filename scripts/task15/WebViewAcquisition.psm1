$ErrorActionPreference = "Stop"

$script:WebViewDeliveryPrefix = "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/"
$script:WebViewAssetName = "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"

function Write-Task15Utf8NoBom([string] $Path, [string] $Text) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function New-WebViewBinding {
    param(
        [Parameter(Mandatory = $true)][string] $FinalUri,
        [Parameter(Mandatory = $true)][long] $ContentLength,
        [Parameter(Mandatory = $true)][string] $AcceptRanges,
        [Parameter(Mandatory = $true)][string] $ETag,
        [Parameter(Mandatory = $true)][string] $LastModified
    )
    if (-not $FinalUri.StartsWith($script:WebViewDeliveryPrefix, [StringComparison]::Ordinal)) {
        throw "Final URL does not use the required Microsoft delivery prefix."
    }
    $remainder = $FinalUri.Substring($script:WebViewDeliveryPrefix.Length)
    $segments = $remainder.Split('/')
    if ($segments.Count -ne 2 -or $segments[0] -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
        throw "Final Microsoft delivery URL must contain one GUID path segment."
    }
    if ($segments[1] -cne $script:WebViewAssetName) {
        throw "Final Microsoft delivery URL must use the exact x64 filename $script:WebViewAssetName."
    }
    if ($ContentLength -le 0) { throw "WebView response requires a positive Content-Length." }
    if ($AcceptRanges -cne "bytes") { throw "WebView response requires Accept-Ranges: bytes." }
    if ([string]::IsNullOrWhiteSpace($ETag)) { throw "WebView response requires an ETag." }
    if ([string]::IsNullOrWhiteSpace($LastModified)) { throw "WebView response requires Last-Modified." }
    return [pscustomobject][ordered]@{
        FinalUrl = $FinalUri
        Guid = $segments[0].ToLowerInvariant()
        AssetName = $segments[1]
        ETag = $ETag
        LastModified = $LastModified
        Size = $ContentLength
    }
}

function Test-WebViewBindingEqual([object] $Left, [object] $Right) {
    foreach ($field in @("FinalUrl", "Guid", "AssetName", "ETag", "LastModified", "Size")) {
        if ([string] $Left.$field -cne [string] $Right.$field) { return $false }
    }
    return $true
}

function Assert-WebViewRangeResponse {
    param(
        [int] $StatusCode, [string] $ContentRange,
        [long] $ExpectedStart, [long] $ExpectedEnd, [long] $TotalSize
    )
    if ($StatusCode -ne 206) { throw "Resumable WebView request requires exact HTTP 206." }
    $expected = "bytes $ExpectedStart-$ExpectedEnd/$TotalSize"
    if ($ContentRange -cne $expected) {
        throw "WebView Content-Range mismatch. Expected '$expected'; received '$ContentRange'."
    }
}

function Write-WebViewPartialState([string] $StatePath, [object] $Binding) {
    Write-Task15Utf8NoBom $StatePath ($Binding | ConvertTo-Json -Depth 4)
}

function Move-WebViewPartialToQuarantine([string] $Path, [string] $QuarantineRoot) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    New-Item -ItemType Directory -Force -Path $QuarantineRoot | Out-Null
    $name = "{0}-{1}" -f ([guid]::NewGuid().ToString("N")), (Split-Path -Leaf $Path)
    Move-Item -LiteralPath $Path -Destination (Join-Path $QuarantineRoot $name)
}

function Resolve-WebViewResume {
    param(
        [string] $PartialPath, [string] $StatePath, [object] $Binding,
        [string] $QuarantineRoot
    )
    $partialExists = Test-Path -LiteralPath $PartialPath
    $stateExists = Test-Path -LiteralPath $StatePath
    if (-not $partialExists -and -not $stateExists) { return 0L }
    $matches = $false
    if ($partialExists -and $stateExists) {
        try {
            $saved = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
            $matches = Test-WebViewBindingEqual $saved $Binding
        }
        catch { $matches = $false }
    }
    if (-not $matches) {
        Move-WebViewPartialToQuarantine $PartialPath $QuarantineRoot
        Move-WebViewPartialToQuarantine $StatePath $QuarantineRoot
        return 0L
    }
    $length = (Get-Item -LiteralPath $PartialPath).Length
    if ($length -gt [long] $Binding.Size) {
        Move-WebViewPartialToQuarantine $PartialPath $QuarantineRoot
        Move-WebViewPartialToQuarantine $StatePath $QuarantineRoot
        return 0L
    }
    return [long] $length
}

function Assert-OrQuarantineWebViewPartial {
    param([string]$PartialPath,[string]$StatePath,[string]$QuarantineRoot,[object]$Binding,[string]$ExpectedSha256,[object]$Signature)
    try { Assert-WebViewPayloadFile -Path $PartialPath -Binding $Binding -ExpectedSha256 $ExpectedSha256 -Signature $Signature | Out-Null }
    catch {
        Move-WebViewPartialToQuarantine $PartialPath $QuarantineRoot
        Move-WebViewPartialToQuarantine $StatePath $QuarantineRoot
        throw
    }
}

function Add-WebViewPartialBytes([string] $PartialPath, [long] $ExpectedOffset, [byte[]] $Bytes) {
    $actualOffset = if (Test-Path -LiteralPath $PartialPath) { (Get-Item -LiteralPath $PartialPath).Length } else { 0L }
    if ($actualOffset -ne $ExpectedOffset) {
        throw "WebView partial offset mismatch. Expected $ExpectedOffset; received $actualOffset."
    }
    $parent = Split-Path -Parent $PartialPath
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $stream = [IO.File]::Open($PartialPath, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::Read)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}

function Assert-WebViewSignature([object] $Signature) {
    if ([string] $Signature.Status -cne "Valid") {
        throw "WebView Authenticode status must be Valid; received '$($Signature.Status)'."
    }
    $subject = [string] $Signature.SignerCertificate.Subject
    if ($subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
        throw "WebView signer must be Microsoft Corporation; received '$subject'."
    }
}

function Assert-WebViewPayloadFile {
    param(
        [string] $Path, [object] $Binding, [string] $ExpectedSha256,
        [object] $Signature
    )
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "WebView payload is missing: $Path" }
    $length = (Get-Item -LiteralPath $Path).Length
    if ($length -ne [long] $Binding.Size) { throw "WebView payload size mismatch. Expected $($Binding.Size); received $length." }
    $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($hash -cne $ExpectedSha256) { throw "WebView payload SHA-256 mismatch. Expected $ExpectedSha256; received $hash." }
    Assert-WebViewSignature $Signature
    return $hash
}

function Publish-WebViewPayload {
    param(
        [string] $PartialPath, [string] $DestinationPath, [string] $ManifestPath,
        [object] $Binding, [string] $ExpectedSha256, [object] $Signature
    )
    Assert-WebViewPayloadFile -Path $PartialPath -Binding $Binding -ExpectedSha256 $ExpectedSha256 -Signature $Signature | Out-Null
    $parent = Split-Path -Parent $DestinationPath
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $candidate = "$DestinationPath.candidate-$([guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $PartialPath -Destination $candidate
    try {
        Assert-WebViewPayloadFile -Path $candidate -Binding $Binding -ExpectedSha256 $ExpectedSha256 -Signature $Signature | Out-Null
        Move-Item -LiteralPath $candidate -Destination $DestinationPath -Force
        $record = [ordered]@{
            Binding = $Binding
            Sha256 = $ExpectedSha256
            SignatureStatus = [string] $Signature.Status
            SignerSubject = [string] $Signature.SignerCertificate.Subject
            PromotedAt = (Get-Date).ToString("o")
        }
        Write-Task15Utf8NoBom $ManifestPath ($record | ConvertTo-Json -Depth 6)
    }
    finally { Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue }
    Assert-WebViewPayloadFile -Path $DestinationPath -Binding $Binding -ExpectedSha256 $ExpectedSha256 -Signature $Signature | Out-Null
}

function Stage-WebViewPayload {
    param(
        [string] $SourcePath, [string] $CargoTargetDirectory,
        [string] $AllowedBuildRoot, [object] $Binding,
        [string] $ExpectedSha256, [object] $Signature
    )
    $target = [IO.Path]::GetFullPath($CargoTargetDirectory).TrimEnd('\')
    $rootPrefix = [IO.Path]::GetFullPath($AllowedBuildRoot).TrimEnd('\') + '\'
    if (-not $target.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to stage WebView payload outside the isolated Task 15 build root."
    }
    Assert-WebViewPayloadFile -Path $SourcePath -Binding $Binding -ExpectedSha256 $ExpectedSha256 -Signature $Signature | Out-Null
    $destination = [IO.Path]::GetFullPath((Join-Path $target ".tauri\x64\$($Binding.Guid)\$($Binding.AssetName)"))
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $candidate = "$destination.partial-$([guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $SourcePath -Destination $candidate
    try {
        Assert-WebViewPayloadFile -Path $candidate -Binding $Binding -ExpectedSha256 $ExpectedSha256 -Signature $Signature | Out-Null
        Move-Item -LiteralPath $candidate -Destination $destination -Force
    }
    finally { Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue }
    Assert-WebViewPayloadFile -Path $destination -Binding $Binding -ExpectedSha256 $ExpectedSha256 -Signature $Signature | Out-Null
    return $destination
}

function Assert-WebViewBuildLogNoLargeGet([string] $LogText) {
    if ($LogText -match '(?im)^\s*Downloading\s+https://go\.microsoft\.com/' -or
        $LogText -match '(?im)^\s*Downloading\s+https://msedge\.sf\.dl\.delivery\.mp\.microsoft\.com/') {
        throw "Tauri attempted a forbidden large WebView GET instead of using the staged payload."
    }
}

function Assert-EmbeddedWebViewPayload {
    param([string] $ExtractedPath, [string] $ExpectedSha256, [long] $ExpectedSize, [object] $Signature)
    $binding = [pscustomobject]@{ Size = $ExpectedSize }
    Assert-WebViewPayloadFile -Path $ExtractedPath -Binding $binding -ExpectedSha256 $ExpectedSha256 -Signature $Signature | Out-Null
}

Export-ModuleMember -Function *
