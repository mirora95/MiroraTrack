param(
    [string] $DestinationRoot,
    [string] $EvidencePath
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $DestinationRoot) { $DestinationRoot = Join-Path $repositoryRoot "work\toolchain\tauri-bundler-mirror" }
if (-not $EvidencePath) { $EvidencePath = Join-Path $repositoryRoot "work\logs\task15a\retry\acquisition.json" }
Import-Module (Join-Path $PSScriptRoot "TauriBundlerMirror.psm1") -Force

function Write-Utf8NoBom([string] $Path, [string] $Text) {
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

$headers = @{
    "User-Agent" = "MiroraTrack-Task15A"
    "Accept" = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}
$records = @()
foreach ($specification in @(Get-TauriBundlerToolSpecifications)) {
    $releaseUri = "https://api.github.com/repos/$($specification.Owner)/$($specification.Repo)/releases/tags/$($specification.TagName)"
    $release = Invoke-RestMethod -Uri $releaseUri -Headers $headers -TimeoutSec 30
    $assetMatches = @($release.assets | Where-Object { $_.id -eq $specification.AssetId })
    if ($assetMatches.Count -ne 1) { throw "Pinned asset ID not unique in official release metadata." }
    $asset = $assetMatches[0]
    $metadata = [pscustomobject]@{
        Owner = $specification.Owner
        Repo = $specification.Repo
        TagName = $release.tag_name
        Asset = [pscustomobject]@{
            Id = $asset.id
            Name = $asset.name
            Size = $asset.size
            Digest = $asset.digest
            State = $asset.state
            CreatedAt = ([datetime] $asset.created_at).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            UpdatedAt = ([datetime] $asset.updated_at).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
            ApiUrl = $asset.url
            BrowserDownloadUrl = $asset.browser_download_url
        }
    }
    Assert-TauriReleaseMetadata -Metadata $metadata -Specification $specification

    $destinationDirectory = Join-Path $DestinationRoot "$($specification.Owner)\$($specification.Repo)\releases\download\$($specification.TagName)"
    $destinationPath = Join-Path $destinationDirectory $specification.AssetName
    $range = "bytes=0-$($specification.Size - 1)"
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
    if (Test-Path -LiteralPath $destinationPath) {
        Assert-TauriAssetFile -Path $destinationPath -Specification $specification
        $source = "validated-existing"
    }
    else {
        $partialPath = $destinationPath + ".partial"
        Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
        Invoke-TauriRestAssetDownload -Uri $specification.ApiUrl -DestinationPath $partialPath -ExpectedSize $specification.Size -TimeoutSeconds 240
        Publish-TauriAssetAtomically -PartialPath $partialPath -DestinationPath $destinationPath -Specification $specification
        $source = "official-github-rest"
    }
    $specification | Add-Member -NotePropertyName LocalPath -NotePropertyValue $destinationPath -Force
    $records += [ordered]@{
        Owner = $specification.Owner
        Repo = $specification.Repo
        TagName = $specification.TagName
        AssetId = $specification.AssetId
        AssetName = $specification.AssetName
        Size = $specification.Size
        Sha256 = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash
        Sha1 = (Get-FileHash -LiteralPath $destinationPath -Algorithm SHA1).Hash
        ZipEntryCount = $specification.ZipEntryCount
        State = "uploaded"
        CreatedAt = $specification.CreatedAt
        UpdatedAt = $specification.UpdatedAt
        Range = $range
        Source = $source
        LocalPath = $destinationPath
        MirrorPath = $specification.MirrorPath
    }
}

Write-Utf8NoBom $EvidencePath ([ordered]@{
    Status = "PASS"
    CompletedAt = (Get-Date).ToString("o")
    GitHubAccept = "application/octet-stream"
    Assets = $records
} | ConvertTo-Json -Depth 8)
$records | ConvertTo-Json -Depth 8
