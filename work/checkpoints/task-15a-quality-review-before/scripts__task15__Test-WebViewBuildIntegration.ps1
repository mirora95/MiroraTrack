$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$acquirePath = Join-Path $PSScriptRoot "Acquire-WebViewOfflineInstaller.ps1"
$buildPath = Join-Path $repositoryRoot "scripts\Build-Task15Installers.ps1"

function Require-Text([string] $Text, [string] $Pattern, [string] $Description) {
    if ($Text -notmatch $Pattern) { throw "Missing WebView integration: $Description" }
}

if (-not (Test-Path -LiteralPath $acquirePath)) { throw "Missing WebView integration: acquisition script" }
$acquire = Get-Content -LiteralPath $acquirePath -Raw
$module = Get-Content -LiteralPath (Join-Path $PSScriptRoot "WebViewAcquisition.psm1") -Raw
$transport = $acquire + [Environment]::NewLine + $module
$build = Get-Content -LiteralPath $buildPath -Raw

Require-Text $acquire 'https://go\.microsoft\.com/fwlink/\?linkid=2124701' "official fwlink"
Require-Text $acquire 'Add-Type\s+-AssemblyName\s+System\.Net\.Http' "Windows PowerShell HttpClient assembly load"
Require-Text $acquire 'HttpMethod\]::Head|HttpMethod\("HEAD"\)' "immediate binding HEAD"
Require-Text $acquire 'LastModified\.ToString\("R"\)' "Windows PowerShell DateTimeOffset Last-Modified normalization"
if ($acquire -match 'LastModified\.Value') { throw "WebView integration must not dereference DateTimeOffset.LastModified.Value in Windows PowerShell." }
Require-Text $acquire 'Range' "range request"
Require-Text $acquire 'If-Range' "If-Range binding"
Require-Text $transport '206' "exact partial-content requirement"
Require-Text $transport 'Content-Range' "exact content-range validation"
Require-Text $acquire '30' "30-second connect/progress bound"
Require-Text $acquire '300' "five-minute no-byte bound"
Require-Text $acquire '90' "90-minute overall bound"
Require-Text $acquire 'Get-AuthenticodeSignature' "real Authenticode validation"
Require-Text $transport 'Microsoft Corporation' "Microsoft signer requirement"
Require-Text $transport '\.partial' "partial staging"
Require-Text $transport 'quarantine' "changed-binding quarantine"

Require-Text $build 'Acquire-WebViewOfflineInstaller\.ps1' "pre-acquisition"
Require-Text $build 'VerifyBindingOnly' "binding HEAD before each version"
Require-Text $build 'Stage-WebViewPayload' "isolated payload staging"
Require-Text $build '\.tauri\\x64' "exact local payload location"
Require-Text $build 'Assert-WebViewBuildLogNoLargeGet' "no Tauri large GET assertion"
Require-Text $build 'Assert-EmbeddedWebViewPayload' "extracted payload equality"
Require-Text $build 'Filter\s+"MicrosoftEdgeWebView2RuntimeInstaller\.exe"' "NSIS oname payload extraction"
Require-Text $build '0\.0\.9' "0.0.9 binding/staging build"
Require-Text $build '0\.1\.0' "0.1.0 binding/staging build"

"Task 15 WebView build integration static test: PASS"
