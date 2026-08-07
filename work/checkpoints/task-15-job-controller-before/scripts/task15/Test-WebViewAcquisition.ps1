$ErrorActionPreference = "Stop"
$modulePath = Join-Path $PSScriptRoot "WebViewAcquisition.psm1"
Import-Module -Name $modulePath -Force -DisableNameChecking

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "Assertion failed: $Message" }
}

function Assert-Throws([scriptblock] $Action, [string] $Pattern, [string] $Message) {
    try { & $Action; throw "Action did not throw" }
    catch {
        if ($_.Exception.Message -eq "Action did not throw" -or $_.Exception.Message -notmatch $Pattern) {
            throw "Assertion failed: $Message. Received: $($_.Exception.Message)"
        }
    }
}

function New-ValidBinding {
    New-WebViewBinding `
        -FinalUri "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/05320a5b-d0ef-46cd-b938-672f3258dc27/MicrosoftEdgeWebView2RuntimeInstallerX64.exe" `
        -ContentLength 16 -AcceptRanges "bytes" -ETag '"binding-etag"' `
        -LastModified "Fri, 31 Jul 2026 21:01:52 GMT"
}

$binding = New-ValidBinding
Assert-True ($binding.Guid -ceq "05320a5b-d0ef-46cd-b938-672f3258dc27") "exact GUID is bound"
Assert-True ($binding.AssetName -ceq "MicrosoftEdgeWebView2RuntimeInstallerX64.exe") "exact x64 filename is bound"
Assert-True ($binding.Size -eq 16) "positive content length is bound"

Assert-Throws { New-WebViewBinding -FinalUri "https://example.com/filestreamingservice/files/05320a5b-d0ef-46cd-b938-672f3258dc27/MicrosoftEdgeWebView2RuntimeInstallerX64.exe" -ContentLength 16 -AcceptRanges bytes -ETag x -LastModified y } "Microsoft delivery prefix" "non-Microsoft host rejected"
Assert-Throws { New-WebViewBinding -FinalUri "https://msedge.sf.dl.delivery.mp.microsoft.com/other/files/05320a5b-d0ef-46cd-b938-672f3258dc27/MicrosoftEdgeWebView2RuntimeInstallerX64.exe" -ContentLength 16 -AcceptRanges bytes -ETag x -LastModified y } "Microsoft delivery prefix" "wrong Microsoft path rejected"
Assert-Throws { New-WebViewBinding -FinalUri "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/not-a-guid/MicrosoftEdgeWebView2RuntimeInstallerX64.exe" -ContentLength 16 -AcceptRanges bytes -ETag x -LastModified y } "GUID" "invalid GUID rejected"
Assert-Throws { New-WebViewBinding -FinalUri "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/05320a5b-d0ef-46cd-b938-672f3258dc27/MicrosoftEdgeWebView2RuntimeInstallerARM64.exe" -ContentLength 16 -AcceptRanges bytes -ETag x -LastModified y } "x64 filename" "wrong architecture rejected"
Assert-Throws { New-WebViewBinding -FinalUri "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/05320a5b-d0ef-46cd-b938-672f3258dc27/renamed.exe" -ContentLength 16 -AcceptRanges bytes -ETag x -LastModified y } "x64 filename" "renamed payload rejected"
Assert-Throws { New-WebViewBinding -FinalUri $binding.FinalUrl -ContentLength 0 -AcceptRanges bytes -ETag x -LastModified y } "positive Content-Length" "zero size rejected"
Assert-Throws { New-WebViewBinding -FinalUri $binding.FinalUrl -ContentLength 16 -AcceptRanges none -ETag x -LastModified y } "Accept-Ranges" "missing byte ranges rejected"

Assert-WebViewRangeResponse -StatusCode 206 -ContentRange "bytes 4-15/16" -ExpectedStart 4 -ExpectedEnd 15 -TotalSize 16
Assert-Throws { Assert-WebViewRangeResponse -StatusCode 200 -ContentRange "bytes 4-15/16" -ExpectedStart 4 -ExpectedEnd 15 -TotalSize 16 } "206" "range request requires 206"
Assert-Throws { Assert-WebViewRangeResponse -StatusCode 206 -ContentRange "bytes 0-15/16" -ExpectedStart 4 -ExpectedEnd 15 -TotalSize 16 } "Content-Range" "wrong resume start rejected"
Assert-Throws { Assert-WebViewRangeResponse -StatusCode 206 -ContentRange "bytes 4-14/16" -ExpectedStart 4 -ExpectedEnd 15 -TotalSize 16 } "Content-Range" "truncated response range rejected"

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("miroratrack-webview-test-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $partial = Join-Path $testRoot "payload.partial"
    $state = Join-Path $testRoot "payload.partial.json"
    $quarantine = Join-Path $testRoot "quarantine"
    Write-WebViewPartialState -StatePath $state -Binding $binding
    Add-WebViewPartialBytes -PartialPath $partial -ExpectedOffset 0 -Bytes ([byte[]](0..3))
    Assert-True ((Get-Item $partial).Length -eq 4) "interrupted first range remains resumable"
    Assert-True ((Resolve-WebViewResume -PartialPath $partial -StatePath $state -Binding $binding -QuarantineRoot $quarantine) -eq 4) "resume offset equals existing bytes"
    Add-WebViewPartialBytes -PartialPath $partial -ExpectedOffset 4 -Bytes ([byte[]](4..15))
    Assert-True ((Get-Item $partial).Length -eq 16) "resumed bytes append exactly"
    Assert-Throws { Add-WebViewPartialBytes -PartialPath $partial -ExpectedOffset 4 -Bytes ([byte[]](1,2)) } "offset" "stale resume offset rejected"

    foreach ($field in @("FinalUrl", "Guid", "AssetName", "ETag", "LastModified", "Size")) {
        $changed = New-ValidBinding | Select-Object *
        switch ($field) {
            "FinalUrl" { $changed.FinalUrl = $changed.FinalUrl.Replace($changed.Guid, "15320a5b-d0ef-46cd-b938-672f3258dc27"); $changed.Guid = "15320a5b-d0ef-46cd-b938-672f3258dc27" }
            "Guid" { $changed.Guid = "15320a5b-d0ef-46cd-b938-672f3258dc27" }
            "AssetName" { $changed.AssetName = "changed.exe" }
            "ETag" { $changed.ETag = '"changed"' }
            "LastModified" { $changed.LastModified = "Sat, 01 Aug 2026 00:00:00 GMT" }
            "Size" { $changed.Size = 17 }
        }
        Copy-Item $partial (Join-Path $testRoot "$field.partial")
        Write-WebViewPartialState -StatePath (Join-Path $testRoot "$field.json") -Binding $binding
        $offset = Resolve-WebViewResume -PartialPath (Join-Path $testRoot "$field.partial") -StatePath (Join-Path $testRoot "$field.json") -Binding $changed -QuarantineRoot $quarantine
    Assert-True ($offset -eq 0) "$field binding change restarts acquisition"
        Assert-True (-not (Test-Path (Join-Path $testRoot "$field.partial"))) "$field old partial removed from active path"
    }
    Assert-True (@(Get-ChildItem $quarantine -File).Count -ge 12) "changed partials and metadata quarantined"

    $validSignature = [pscustomobject]@{ Status = "Valid"; SignerCertificate = [pscustomobject]@{ Subject = "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US" } }
    $wrongSigner = [pscustomobject]@{ Status = "Valid"; SignerCertificate = [pscustomobject]@{ Subject = "CN=Example Corp, O=Example Corp" } }
    $invalidSignature = [pscustomobject]@{ Status = "HashMismatch"; SignerCertificate = [pscustomobject]@{ Subject = "CN=Microsoft Corporation, O=Microsoft Corporation" } }

    $fullPartial = Join-Path $testRoot "full-size.partial"
    $fullState = Join-Path $testRoot "full-size.partial.json"
    [IO.File]::WriteAllBytes($fullPartial, [byte[]](0..15))
    Write-WebViewPartialState -StatePath $fullState -Binding $binding
    Assert-True ((Resolve-WebViewResume -PartialPath $fullPartial -StatePath $fullState -Binding $binding -QuarantineRoot $quarantine) -eq 16) "matching full-size partial resumes at full size"
    Assert-Throws { Assert-OrQuarantineWebViewPartial -PartialPath $fullPartial -StatePath $fullState -QuarantineRoot $quarantine -Binding $binding -ExpectedSha256 ("0"*64) -Signature $validSignature } "SHA-256" "full-size invalid payload rejected"
    Assert-True (-not (Test-Path $fullPartial) -and -not (Test-Path $fullState)) "invalid full-size partial and state removed from active paths"

    Assert-WebViewSignature -Signature $validSignature
    Assert-Throws { Assert-WebViewSignature -Signature $wrongSigner } "Microsoft Corporation" "non-Microsoft signer rejected"
    Assert-Throws { Assert-WebViewSignature -Signature $invalidSignature } "Authenticode.*Valid" "invalid signature rejected"

    $source = Join-Path $testRoot "complete.partial"
    [IO.File]::WriteAllBytes($source, [byte[]](0..15))
    $sha = (Get-FileHash $source -Algorithm SHA256).Hash
    $destination = Join-Path $testRoot "validated\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
    $manifest = Join-Path $testRoot "validated\binding.json"
    Assert-Throws { Publish-WebViewPayload -PartialPath $source -DestinationPath $destination -ManifestPath $manifest -Binding $binding -ExpectedSha256 ("0" * 64) -Signature $validSignature } "SHA-256" "tampered hash rejected"
    Assert-True (-not (Test-Path $destination)) "destination absent until validation"
    [IO.File]::WriteAllBytes($source, [byte[]](0..14))
    Assert-Throws { Publish-WebViewPayload -PartialPath $source -DestinationPath $destination -ManifestPath $manifest -Binding $binding -ExpectedSha256 $sha -Signature $validSignature } "size" "truncation rejected"
    Assert-True (-not (Test-Path $destination)) "truncation never promoted"
    [IO.File]::WriteAllBytes($source, [byte[]](0..15))
    Publish-WebViewPayload -PartialPath $source -DestinationPath $destination -ManifestPath $manifest -Binding $binding -ExpectedSha256 $sha -Signature $validSignature
    Assert-True ((Get-FileHash $destination -Algorithm SHA256).Hash -ceq $sha) "validated payload atomically promoted"
    $preserved = [IO.File]::ReadAllBytes($destination)
    [IO.File]::WriteAllBytes($source, [byte[]](15..0))
    Assert-Throws { Publish-WebViewPayload -PartialPath $source -DestinationPath $destination -ManifestPath $manifest -Binding $binding -ExpectedSha256 $sha -Signature $validSignature } "SHA-256" "failed replacement rejected"
    Assert-True ([Convert]::ToBase64String([IO.File]::ReadAllBytes($destination)) -ceq [Convert]::ToBase64String($preserved)) "existing valid asset preserved on replacement failure"

    $buildRoot = Join-Path $testRoot "work\build\task15"
    $target = Join-Path $buildRoot "0.0.9\target"
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    $staged = Stage-WebViewPayload -SourcePath $destination -CargoTargetDirectory $target -AllowedBuildRoot $buildRoot -Binding $binding -ExpectedSha256 $sha -Signature $validSignature
    $expectedStage = Join-Path $target ".tauri\x64\$($binding.Guid)\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"
    Assert-True ($staged -ceq [IO.Path]::GetFullPath($expectedStage)) "exact isolated .tauri stage path"
    Assert-True ((Get-FileHash $staged -Algorithm SHA256).Hash -ceq $sha) "staged payload revalidated"
    Assert-Throws { Stage-WebViewPayload -SourcePath $destination -CargoTargetDirectory (Join-Path $testRoot "outside") -AllowedBuildRoot $buildRoot -Binding $binding -ExpectedSha256 $sha -Signature $validSignature } "outside" "stage outside isolated build rejected"

    Assert-WebViewBuildLogNoLargeGet -LogText "Info Target: x64`nBundling MiroraTrack"
    Assert-Throws { Assert-WebViewBuildLogNoLargeGet -LogText "Downloading https://go.microsoft.com/fwlink/?linkid=2124701" } "large WebView GET" "fwlink GET rejected"
    Assert-Throws { Assert-WebViewBuildLogNoLargeGet -LogText "Downloading $($binding.FinalUrl)" } "large WebView GET" "delivery GET rejected"

    $extracted = Join-Path $testRoot "extracted.exe"
    Copy-Item $destination $extracted
    Assert-EmbeddedWebViewPayload -ExtractedPath $extracted -ExpectedSha256 $sha -ExpectedSize 16 -Signature $validSignature
    [IO.File]::WriteAllBytes($extracted, [byte[]](1..16))
    Assert-Throws { Assert-EmbeddedWebViewPayload -ExtractedPath $extracted -ExpectedSha256 $sha -ExpectedSize 16 -Signature $validSignature } "SHA-256" "embedded payload mismatch rejected"
}
finally { Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue }

"Task 15 WebView acquisition tests: PASS"
