[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$inputRoot = 'C:\MTInput'
$evidenceRoot = 'C:\MTEvidence'
$finalPath = Join-Path $evidenceRoot 'result.json'
$finalTemporaryName = 'result.json.tmp'
$startedAt = Get-Date
$phases = [ordered]@{}

# This guest prepares an isolated environment for a person and then stops. It
# deliberately does not automate the interface, does not assert ledger values,
# and never powers the sandbox off, because the verifier needs the environment
# alive to work in.
$userDataRoot = Join-Path $env:LOCALAPPDATA 'com.miroratrack.desktop'
$backupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MiroraTrack\Backups'
$desktop = [Environment]::GetFolderPath('Desktop')
$desktopShortcut = Join-Path $desktop 'MiroraTrack.lnk'
$startMenuShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MiroraTrack.lnk'
$previousInstaller = Join-Path $inputRoot 'MiroraTrack_0.0.9_x64-setup.exe'
$currentInstaller = Join-Path $inputRoot 'MiroraTrack_0.1.0_x64-setup.exe'

function Write-AtomicJson([string]$Path, $Value) {
    $temporary = "$Path.tmp"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false)) }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

function Get-ArpEntry {
    foreach ($root in @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
            $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
            if ($properties.DisplayName -eq 'MiroraTrack') {
                return [ordered]@{
                    DisplayVersion = [string]$properties.DisplayVersion
                    InstallLocation = [string]$properties.InstallLocation
                    UninstallString = [string]$properties.UninstallString
                    NoModify = $properties.NoModify; NoRepair = $properties.NoRepair
                }
            }
        }
    }
    return $null
}

try {
    Remove-Item -LiteralPath $finalPath, "$finalPath.tmp" -Force -ErrorAction SilentlyContinue
    Assert-True (Test-Path -LiteralPath $inputRoot -PathType Container) 'Read-only staged input is missing.'
    Assert-True (Test-Path -LiteralPath $evidenceRoot -PathType Container) 'Writable evidence mapping is missing.'
    Assert-True ($env:USERNAME -eq 'WDAGUtilityAccount') "Refusing to run installer verification as '$env:USERNAME'; Windows Sandbox is required."

    $defaultRoutes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Alive' })
    Assert-True ($defaultRoutes.Count -eq 0) 'A usable non-loopback default route exists in the isolated guest.'
    $phases.network = [ordered]@{ usableDefaultRoutes = 0 }

    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $inputRoot 'verify-installer.ps1') `
        -PreviousInstaller $previousInstaller -CurrentInstaller $currentInstaller `
        -EvidenceDirectory $evidenceRoot -ExpectedManifestPath (Join-Path $inputRoot 'manifest.json') | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Installer input preflight failed with exit $LASTEXITCODE."
    $phases.inputPreflight = 'PASS'

    Assert-True ($null -eq (Get-ArpEntry)) 'MiroraTrack was already registered before installation.'
    Assert-True (-not (Test-Path -LiteralPath $userDataRoot)) 'Finance data directory existed before installation.'

    $installer = Start-Process -FilePath $previousInstaller -ArgumentList @('/S') -PassThru
    Assert-True ($installer.WaitForExit(900000)) 'The 0.0.9 installer did not finish within fifteen minutes.'
    $installer.Refresh()
    Assert-True ([int]$installer.ExitCode -eq 0) "The 0.0.9 installer exited with $($installer.ExitCode)."
    $deadline = (Get-Date).AddSeconds(300)
    while ((Get-Date) -lt $deadline -and $null -eq (Get-ArpEntry)) { Start-Sleep -Milliseconds 500 }
    $arp = Get-ArpEntry
    Assert-True ($null -ne $arp) '0.0.9 did not register an Add/Remove Programs entry.'
    Assert-True ($arp.DisplayVersion -eq '0.0.9') "Expected DisplayVersion 0.0.9 but found '$($arp.DisplayVersion)'."
    Assert-True (Test-Path -LiteralPath $desktopShortcut -PathType Leaf) 'Desktop shortcut was not created.'
    Assert-True (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf) 'Start Menu shortcut was not created.'
    $phases.install = $arp

    # Helper commands so the verifier never has to retype a path or guess a flag.
    # These are built from literal here-strings with placeholders substituted
    # afterwards, so PowerShell cannot expand the batch and PowerShell variables
    # that belong to the generated files.
    $installCmd = @'
@echo off
echo Installing MiroraTrack 0.1.0 silently. This takes about a minute.
"__CURRENT__" /S
echo Done. Reopen MiroraTrack from the Start menu.
pause
'@
    Write-Utf8 (Join-Path $desktop 'Install-Current.cmd') ($installCmd.Replace('__CURRENT__', $currentInstaller))

    $uninstallCmd = @'
@echo off
echo Uninstalling MiroraTrack silently. Finance data and backups must survive.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$e = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' | Where-Object DisplayName -eq 'MiroraTrack'; if (-not $e) { Write-Host 'MiroraTrack is not installed.'; exit 1 }; $u = $e.UninstallString.Trim([char]34); Start-Process -FilePath $u -ArgumentList '/S' -Wait"
echo Done. Now run Show-Data.cmd and compare the counts.
pause
'@
    Write-Utf8 (Join-Path $desktop 'Uninstall.cmd') $uninstallCmd

    $showDataCmd = @'
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach ($r in @('__DATA__','__BACKUPS__')) { if (Test-Path -LiteralPath $r) { $f = @(Get-ChildItem -LiteralPath $r -Recurse -File -Force -ErrorAction SilentlyContinue); Write-Host ('{0} : {1} files' -f $r, $f.Count) } else { Write-Host ('{0} : MISSING' -f $r) } }"
pause
'@
    Write-Utf8 (Join-Path $desktop 'Show-Data.cmd') ($showDataCmd.Replace('__DATA__', $userDataRoot).Replace('__BACKUPS__', $backupRoot))
    Copy-Item -LiteralPath (Join-Path $inputRoot 'CHECKLIST.txt') -Destination (Join-Path $desktop 'CHECKLIST.txt') -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $evidenceRoot 'AltBackups') | Out-Null

    Write-AtomicJson $finalPath ([ordered]@{
        status = 'MANUAL-READY'
        startedAt = $startedAt.ToString('o')
        readyAt = (Get-Date).ToString('o')
        phases = $phases
        instructions = 'MiroraTrack 0.0.9 is installed and the shortcuts exist. Follow CHECKLIST.txt on the Desktop. Save screenshots and manual-results.md into C:\MTEvidence, then close the sandbox window.'
        evidenceMapping = $evidenceRoot
        note = 'The sandbox is intentionally left running for manual verification and will not power itself off.'
    })
} catch {
    Write-AtomicJson $finalPath ([ordered]@{
        status = 'BLOCKED'; startedAt = $startedAt.ToString('o'); failedAt = (Get-Date).ToString('o')
        message = $_.Exception.Message; detail = ($_ | Out-String); phases = $phases; guestPreserved = $true
    })
    exit 1
}
