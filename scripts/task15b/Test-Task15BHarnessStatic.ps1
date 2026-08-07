[CmdletBinding()]
param(
    [string]$HarnessRoot
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($HarnessRoot)) { $HarnessRoot = $PSScriptRoot }
$failures = [System.Collections.Generic.List[string]]::new()

function Require([bool]$Condition, [string]$Message) {
    if (-not $Condition) { $script:failures.Add($Message) }
}

$required = @('Invoke-Task15B.ps1', 'sandbox.wsb.template', 'guest.ps1')
foreach ($name in $required) {
    Require (Test-Path -LiteralPath (Join-Path $HarnessRoot $name) -PathType Leaf) "missing required harness file: $name"
}

$templatePath = Join-Path $HarnessRoot 'sandbox.wsb.template'
if (Test-Path -LiteralPath $templatePath) {
    $raw = Get-Content -LiteralPath $templatePath -Raw
    try { [xml]$xml = $raw } catch { $xml = $null; $failures.Add("template is not valid XML: $($_.Exception.Message)") }
    if ($xml) {
        $config = $xml.Configuration
        Require ($config.Networking -eq 'Disable') 'Networking must be Disable'
        Require ($config.VGpu -eq 'Disable') 'VGpu must be Disable'
        Require ($config.AudioInput -eq 'Disable') 'AudioInput must be Disable'
        Require ($config.VideoInput -eq 'Disable') 'VideoInput must be Disable'
        Require ($config.PrinterRedirection -eq 'Disable') 'PrinterRedirection must be Disable'
        Require ($config.ClipboardRedirection -eq 'Disable') 'ClipboardRedirection must be Disable'
        $maps = @($config.MappedFolders.MappedFolder)
        Require ($maps.Count -eq 2) 'exactly two mapped folders are required'
        if ($maps.Count -eq 2) {
            Require ($maps[0].HostFolder -eq '{{MT_INPUT}}') 'input host path must be the run-specific placeholder'
            Require ($maps[0].SandboxFolder -eq 'C:\MTInput') 'input guest path must be C:\MTInput'
            Require ($maps[0].ReadOnly -eq 'true') 'input mapping must be read-only'
            Require ($maps[1].HostFolder -eq '{{MT_EVIDENCE}}') 'evidence host path must be the run-specific placeholder'
            Require ($maps[1].SandboxFolder -eq 'C:\MTEvidence') 'evidence guest path must be C:\MTEvidence'
            Require ($maps[1].ReadOnly -eq 'false') 'evidence mapping must be writable'
        }
        Require ($config.LogonCommand.Command -eq 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\MTInput\guest.ps1') 'LogonCommand must be the fixed guest launcher'
    }
}

$controllerPath = Join-Path $HarnessRoot 'Invoke-Task15B.ps1'
if (Test-Path -LiteralPath $controllerPath) {
    $controller = Get-Content -LiteralPath $controllerPath -Raw
    foreach ($needle in @(
        'wsb.exe', 'StartSandbox', 'ConnectToSandbox', 'ListRunningSandboxes', 'StopSandbox',
        '--id', '--config', 'result.json.tmp', 'result.json',
        'manifest.json', 'Task15InstallerPreflight.psm1', 'verify-installer.ps1',
        'Get-FileHash', 'Sha256', 'Previous', 'Current'
    )) { Require ($controller.Contains($needle)) "controller missing required token: $needle" }

    # The host must never build the installers it is verifying; 15B consumes
    # exactly the quarantined Task 15A artifacts.
    foreach ($banned in @('tauri build', 'npm run build', 'cargo build')) {
        Require (-not $controller.Contains($banned)) "controller must not build artifacts: $banned"
    }
}

$guestPath = Join-Path $HarnessRoot 'guest.ps1'
if (Test-Path -LiteralPath $guestPath) {
    $guest = Get-Content -LiteralPath $guestPath -Raw
    foreach ($needle in @(
        'WDAGUtilityAccount', 'result.json.tmp', 'result.json', 'NEEDS_USER',
        'verify-installer.ps1',
        'MiroraTrack_0.0.9_x64-setup.exe', 'MiroraTrack_0.1.0_x64-setup.exe',
        '/S',
        'UninstallString', 'NoModify', 'NoRepair', 'DisplayVersion',
        'EBWebView', 'com.miroratrack.desktop',
        'MiroraTrack\Backups',
        'Desktop', 'Start Menu',
        'Get-DataManifest', 'Assert-DataPreserved',
        'Invoke-Onboarding', 'Wait-ForAutomaticBackup', 'Assert-BackupLedger', 'SendKeys',
        'uninstallPreservation', 'upgradePreservation', 'reinstallPreservation',
        'reinstallAfterUninstall'
    )) { Require ($guest.Contains($needle)) "guest controller missing required token: $needle" }

    # Data preservation is the whole point of the task. The guest must never be
    # the thing that removes finance records or backups.
    foreach ($banned in @(
        'Remove-Item -LiteralPath $userDataRoot',
        'Remove-Item -LiteralPath $backupRoot',
        'Remove-Item -Recurse -Force $userDataRoot',
        'Remove-Item -Recurse -Force $backupRoot'
    )) { Require (-not $guest.Contains($banned)) "guest must never delete finance data or backups: $banned" }
}

foreach ($script in Get-ChildItem -LiteralPath $HarnessRoot -Filter '*.ps1' -File) {
    $tokens = $null; $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($script.FullName, [ref]$tokens, [ref]$parseErrors)
    Require ($parseErrors.Count -eq 0) "PowerShell parser errors in $($script.Name): $($parseErrors -join '; ')"
}

$forbidden = @(
    ([string][char]46 + [string][char]103 + [string][char]105 + [string][char]116),
    'netsh', 'Set-NetAdapter', 'Disable-NetAdapter', 'Enable-NetAdapter',
    'New-NetFirewallRule', 'Set-NetFirewallProfile', 'Set-DnsClientServerAddress',
    'InternetOpen', 'ProxyOverride', 'C:\Users\orasta', 'Documents\Projects',
    'HostFolder>C:\',
    'Start-BitsTransfer', 'DownloadFile', 'DownloadString', 'curl.exe', 'wget.exe',
    'msedge.sf.dl.delivery.mp.microsoft.com', 'go.microsoft.com/fwlink'
)
foreach ($file in Get-ChildItem -LiteralPath $HarnessRoot -File) {
    if ($file.Name -eq 'Test-Task15BHarnessStatic.ps1') { continue }
    $text = Get-Content -LiteralPath $file.FullName -Raw
    foreach ($needle in $forbidden) {
        Require (-not $text.Contains($needle)) "$($file.Name) contains forbidden token: $needle"
    }
}

if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}

Write-Output 'Task 15B static harness validation: PASS'
