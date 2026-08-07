Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-TauriBundlerToolSpecifications {
    @(
        [pscustomobject]@{
            Owner = "tauri-apps"
            Repo = "binary-releases"
            TagName = "nsis-3.11"
            AssetName = "nsis-3.11.zip"
            AssetId = 317051073
            Size = 2361546
            Sha256 = "C7D27F780DDB6CFFB4730138CD1591E841F4B7EDB155856901CDF5F214394FA1"
            Sha1 = "EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D"
            CreatedAt = "2025-11-16T12:28:51Z"
            UpdatedAt = "2025-11-16T12:28:53Z"
            ApiUrl = "https://api.github.com/repos/tauri-apps/binary-releases/releases/assets/317051073"
            BrowserDownloadUrl = "https://github.com/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip"
            MirrorPath = "/tauri-apps/binary-releases/releases/download/nsis-3.11/nsis-3.11.zip"
            ZipEntryCount = 441
        },
        [pscustomobject]@{
            Owner = "tauri-apps"
            Repo = "nsis-tauri-utils"
            TagName = "nsis_tauri_utils-v0.5.3"
            AssetName = "nsis_tauri_utils.dll"
            AssetId = 345882097
            Size = 34304
            Sha256 = "5BA143B5DB4A87D32D6E7802E033330AAE56CBCEABE0D1E3BA41948385AD4709"
            Sha1 = "75197FEE3C6A814FE035788D1C34EAD39349B860"
            CreatedAt = "2026-01-26T02:39:00Z"
            UpdatedAt = "2026-01-26T02:39:00Z"
            ApiUrl = "https://api.github.com/repos/tauri-apps/nsis-tauri-utils/releases/assets/345882097"
            BrowserDownloadUrl = "https://github.com/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll"
            MirrorPath = "/tauri-apps/nsis-tauri-utils/releases/download/nsis_tauri_utils-v0.5.3/nsis_tauri_utils.dll"
            ZipEntryCount = $null
        }
    )
}

function Assert-ExactValue([object] $Actual, [object] $Expected, [string] $Name) {
    if ([string] $Actual -cne [string] $Expected) {
        throw "$Name mismatch. Expected '$Expected'; received '$Actual'."
    }
}

function Assert-TauriReleaseMetadata {
    param(
        [Parameter(Mandatory = $true)] $Metadata,
        [Parameter(Mandatory = $true)] $Specification
    )

    Assert-ExactValue $Metadata.Owner $Specification.Owner "owner"
    Assert-ExactValue $Metadata.Repo $Specification.Repo "repository"
    Assert-ExactValue $Metadata.TagName $Specification.TagName "tag"
    Assert-ExactValue $Metadata.Asset.Id $Specification.AssetId "asset id"
    Assert-ExactValue $Metadata.Asset.Name $Specification.AssetName "asset name"
    Assert-ExactValue $Metadata.Asset.Size $Specification.Size "asset size"
    Assert-ExactValue $Metadata.Asset.Digest ("sha256:" + $Specification.Sha256.ToLowerInvariant()) "GitHub digest"
    Assert-ExactValue $Metadata.Asset.State "uploaded" "asset state"
    Assert-ExactValue $Metadata.Asset.CreatedAt $Specification.CreatedAt "asset uploaded/created timestamp"
    Assert-ExactValue $Metadata.Asset.UpdatedAt $Specification.UpdatedAt "asset updated timestamp"
    Assert-ExactValue $Metadata.Asset.ApiUrl $Specification.ApiUrl "asset API URL"
    Assert-ExactValue $Metadata.Asset.BrowserDownloadUrl $Specification.BrowserDownloadUrl "asset browser URL"
}

function Assert-TauriAssetFile {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)] $Specification
    )

    $item = Get-Item -LiteralPath $Path
    if ($item.PSIsContainer) { throw "Asset is not a file: $Path" }
    Assert-ExactValue $item.Length $Specification.Size "asset byte length"
    Assert-ExactValue (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash $Specification.Sha256 "asset SHA-256"
    Assert-ExactValue (Get-FileHash -LiteralPath $Path -Algorithm SHA1).Hash $Specification.Sha1 "Tauri SHA-1"

    if ($null -ne $Specification.ZipEntryCount) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $archive = [IO.Compression.ZipFile]::OpenRead($item.FullName)
        try { Assert-ExactValue $archive.Entries.Count $Specification.ZipEntryCount "ZIP entry count" }
        finally { $archive.Dispose() }
    }
}

function Publish-TauriAssetAtomically {
    param(
        [Parameter(Mandatory = $true)][string] $PartialPath,
        [Parameter(Mandatory = $true)][string] $DestinationPath,
        [Parameter(Mandatory = $true)] $Specification
    )

    if (-not $PartialPath.EndsWith(".partial", [StringComparison]::Ordinal)) {
        throw "Download candidate must have a .partial suffix."
    }
    Assert-TauriAssetFile -Path $PartialPath -Specification $Specification
    $destinationDirectory = Split-Path -Parent $DestinationPath
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    if (Test-Path -LiteralPath $DestinationPath) {
        throw "Refusing to overwrite an existing promoted asset: $DestinationPath"
    }
    [IO.File]::Move((Resolve-Path -LiteralPath $PartialPath).Path, $DestinationPath)
    Assert-TauriAssetFile -Path $DestinationPath -Specification $Specification
}

function Resolve-TauriMirrorRequest {
    param(
        [Parameter(Mandatory = $true)][string] $RawPath,
        [Parameter(Mandatory = $true)][object[]] $Specifications
    )

    $decoded = [Uri]::UnescapeDataString($RawPath)
    if ($decoded.Contains("..") -or $decoded.Contains("\") -or $decoded -cne $RawPath) {
        throw "Rejected encoded or traversal mirror request."
    }
    $matches = @($Specifications | Where-Object { $_.MirrorPath -ceq $RawPath })
    if ($matches.Count -ne 1) { throw "Unknown mirror request path: $RawPath" }
    return $matches[0]
}

function Invoke-TauriRestAssetDownload {
    param(
        [Parameter(Mandatory = $true)][string] $Uri,
        [Parameter(Mandatory = $true)][string] $DestinationPath,
        [Parameter(Mandatory = $true)][long] $ExpectedSize,
        [int] $TimeoutSeconds = 240
    )

    if (-not $DestinationPath.EndsWith(".partial", [StringComparison]::Ordinal)) {
        throw "REST download destination must have a .partial suffix."
    }
    if ($ExpectedSize -le 0) { throw "Expected size must be positive." }
    Add-Type -AssemblyName System.Net.Http
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $true
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $Uri)
    [void] $request.Headers.TryAddWithoutValidation("Accept", "application/octet-stream")
    [void] $request.Headers.TryAddWithoutValidation("X-GitHub-Api-Version", "2022-11-28")
    [void] $request.Headers.TryAddWithoutValidation("User-Agent", "MiroraTrack-Task15A")
    [void] $request.Headers.TryAddWithoutValidation("Range", "bytes=0-$($ExpectedSize - 1)")
    $response = $null
    $inputStream = $null
    $outputStream = $null
    try {
        $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        [void] $response.EnsureSuccessStatusCode()
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [IO.File]::Open($DestinationPath, "CreateNew", "Write", "None")
        $inputStream.CopyTo($outputStream)
        $outputStream.Flush($true)
    }
    finally {
        if ($outputStream) { $outputStream.Dispose() }
        if ($inputStream) { $inputStream.Dispose() }
        if ($response) { $response.Dispose() }
        $request.Dispose()
        $client.Dispose()
        $handler.Dispose()
    }
    $actualSize = (Get-Item -LiteralPath $DestinationPath).Length
    if ($actualSize -ne $ExpectedSize) {
        throw "REST asset length mismatch. Expected $ExpectedSize; received $actualSize."
    }
}

Export-ModuleMember -Function Get-TauriBundlerToolSpecifications, Assert-TauriReleaseMetadata, Assert-TauriAssetFile, Publish-TauriAssetAtomically, Resolve-TauriMirrorRequest, Invoke-TauriRestAssetDownload
