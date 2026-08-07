$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$buildScript = Join-Path $repositoryRoot "scripts\Build-Task15Installers.ps1"
$text = Get-Content -LiteralPath $buildScript -Raw

function Require([string] $Pattern, [string] $Description) {
    if ($text -notmatch $Pattern) { throw "Missing build integration: $Description" }
}

Require 'Acquire-TauriBundlerTools\.ps1' "official verified acquisition"
Require 'Start-TauriBundlerMirror\.ps1' "loopback mirror startup"
Require 'TAURI_BUNDLER_TOOLS_GITHUB_MIRROR_TEMPLATE' "child-only Tauri mirror environment"
Require 'http://127\.0\.0\.1:' "literal loopback mirror template"
Require 'useLocalToolsDir' "temporary merge override local-tools setting"
Require '"version":"0\.0\.9"' "explicit 0.0.9 merge override"
Require '"version":"0\.1\.0"' "explicit 0.1.0 merge override"
Require 'Remove-ExactLocalToolsDirectory' "bounded target .tauri cleanup"
Require 'Assert-MirrorRequests' "both exact Tauri mirror requests"
Require 'Stop-ExactMirror' "exact mirror shutdown"
Require 'tauri-cli 2\.11\.4' "exact CLI version gate"

if ($text -match 'Remove-Item[^\r\n]+work\\toolchain\\tauri-bundler-mirror') {
    throw "Build script must not delete the validated mirror cache."
}

"Task 15 build integration static test: PASS"
