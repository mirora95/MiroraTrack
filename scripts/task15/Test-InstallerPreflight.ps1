$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Import-Module (Join-Path $PSScriptRoot "Task15InstallerPreflight.psm1") -Force
$testRoot = Join-Path $repositoryRoot "work\logs\task15a\quality-test-preflight"

function Assert-Throws([scriptblock] $Action, [string] $Pattern) {
    try { & $Action; throw "expected throw" } catch { if ($_.Exception.Message -notmatch $Pattern) { throw } }
}
if (Test-Path $testRoot) { Remove-Item $testRoot -Recurse -Force }
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $previous = Join-Path $repositoryRoot "work\artifacts\task15\unaccepted\0.0.9\MiroraTrack_0.0.9_x64-setup.exe"
    $current = Join-Path $repositoryRoot "work\artifacts\task15\unaccepted\0.1.0\MiroraTrack_0.1.0_x64-setup.exe"
    $manifest = [ordered]@{ SchemaVersion=1; Architecture="x64"; Installers=@(
        [ordered]@{Role="Previous";Version="0.0.9";Name="MiroraTrack_0.0.9_x64-setup.exe";Size=(Get-Item $previous).Length;Sha256=(Get-FileHash $previous -Algorithm SHA256).Hash;Authenticode="NotSigned"},
        [ordered]@{Role="Current";Version="0.1.0";Name="MiroraTrack_0.1.0_x64-setup.exe";Size=(Get-Item $current).Length;Sha256=(Get-FileHash $current -Algorithm SHA256).Hash;Authenticode="NotSigned"}
    )}
    $manifestPath=Join-Path $testRoot "manifest.json"; [IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 5))
    $ready=Test-Task15InstallerPair -PreviousInstaller $previous -CurrentInstaller $current -ExpectedManifestPath $manifestPath
    if($ready.Status -cne "READY_FOR_TASK_15B"){throw "valid pair not ready"}
    Assert-Throws { Test-Task15InstallerPair -PreviousInstaller $current -CurrentInstaller $previous -ExpectedManifestPath $manifestPath } "name|version|role"
    Assert-Throws { Test-Task15InstallerPair -PreviousInstaller $previous -CurrentInstaller $previous -ExpectedManifestPath $manifestPath } "distinct"
    $wrongName=Join-Path $testRoot "wrong.exe"; Copy-Item $previous $wrongName
    Assert-Throws { Test-Task15InstallerPair -PreviousInstaller $wrongName -CurrentInstaller $current -ExpectedManifestPath $manifestPath } "name"
    Assert-Throws { Test-Task15InstallerPair -PreviousInstaller "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -CurrentInstaller $current -ExpectedManifestPath $manifestPath } "name|size|hash|version"
    $badHash=$manifest|ConvertTo-Json -Depth 5|ConvertFrom-Json; $badHash.Installers[0].Sha256="0"*64; $badHashPath=Join-Path $testRoot "bad-hash.json";[IO.File]::WriteAllText($badHashPath,($badHash|ConvertTo-Json -Depth 5))
    Assert-Throws { Test-Task15InstallerPair -PreviousInstaller $previous -CurrentInstaller $current -ExpectedManifestPath $badHashPath } "SHA-256"
    $badVersion=$manifest|ConvertTo-Json -Depth 5|ConvertFrom-Json; $badVersion.Installers[0].Version="9.9.9"; $badVersionPath=Join-Path $testRoot "bad-version.json";[IO.File]::WriteAllText($badVersionPath,($badVersion|ConvertTo-Json -Depth 5))
    Assert-Throws { Test-Task15InstallerPair -PreviousInstaller $previous -CurrentInstaller $current -ExpectedManifestPath $badVersionPath } "version"
    $badSign=$manifest|ConvertTo-Json -Depth 5|ConvertFrom-Json; $badSign.Installers[0].Authenticode="Valid"; $badSignPath=Join-Path $testRoot "bad-sign.json";[IO.File]::WriteAllText($badSignPath,($badSign|ConvertTo-Json -Depth 5))
    Assert-Throws { Test-Task15InstallerPair -PreviousInstaller $previous -CurrentInstaller $current -ExpectedManifestPath $badSignPath } "Authenticode"
}
finally { if(Test-Path $testRoot){Remove-Item $testRoot -Recurse -Force} }
"Task 15 installer preflight tests: PASS"
