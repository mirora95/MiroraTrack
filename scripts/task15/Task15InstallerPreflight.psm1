Set-StrictMode -Version Latest
$ErrorActionPreference="Stop"

function Get-Task15ExpectedInstallerRecords([string]$ManifestPath){
    if(-not(Test-Path -LiteralPath $ManifestPath -PathType Leaf)){throw "Expected installer manifest is missing: $ManifestPath"}
    $manifest=Get-Content -LiteralPath $ManifestPath -Raw|ConvertFrom-Json
    if([int]$manifest.SchemaVersion-ne 1 -or [string]$manifest.Architecture-cne'x64'){throw "Expected manifest schema/architecture mismatch."}
    $records=@($manifest.Installers);if($records.Count-ne 2){throw "Expected manifest must contain exactly two installers."}
    foreach($role in @('Previous','Current')){if(@($records|Where-Object Role -CEQ $role).Count-ne 1){throw "Expected manifest role mismatch: $role"}}
    return $records
}

function Assert-Task15InstallerInput([string]$Path,$Expected){
    $item=Get-Item -LiteralPath (Resolve-Path -LiteralPath $Path)
    if($item.PSIsContainer -or $item.Name-cne[string]$Expected.Name){throw "Installer name mismatch for $($Expected.Role). Expected $($Expected.Name)."}
    if([long]$item.Length-ne[long]$Expected.Size){throw "Installer size mismatch for $($Expected.Role)."}
    $hash=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash
    if($hash-cne[string]$Expected.Sha256){throw "Installer SHA-256 mismatch for $($Expected.Role)."}
    $info=[Diagnostics.FileVersionInfo]::GetVersionInfo($item.FullName)
    if($info.FileVersion-cne[string]$Expected.Version -or $info.ProductVersion-cne[string]$Expected.Version){throw "Installer version mismatch for $($Expected.Role)."}
    $signature=(Get-AuthenticodeSignature -LiteralPath $item.FullName).Status.ToString()
    if($signature-cne[string]$Expected.Authenticode){throw "Installer Authenticode mismatch for $($Expected.Role)."}
    return [ordered]@{Role=[string]$Expected.Role;Path=$item.FullName;Name=$item.Name;Version=$info.FileVersion;Architecture='x64';Length=$item.Length;SHA256=$hash;Authenticode=$signature}
}

function Test-Task15InstallerPair {
    param([Parameter(Mandatory)][string]$PreviousInstaller,[Parameter(Mandatory)][string]$CurrentInstaller,[Parameter(Mandatory)][string]$ExpectedManifestPath)
    $previousPath=(Resolve-Path -LiteralPath $PreviousInstaller).Path;$currentPath=(Resolve-Path -LiteralPath $CurrentInstaller).Path
    if($previousPath-ceq$currentPath){throw "Previous and current installer inputs must be distinct."}
    $records=Get-Task15ExpectedInstallerRecords $ExpectedManifestPath
    $previousExpected=$records|Where-Object Role -CEQ 'Previous';$currentExpected=$records|Where-Object Role -CEQ 'Current'
    if([string]$previousExpected.Version-cne'0.0.9' -or [string]$currentExpected.Version-cne'0.1.0'){throw "Expected manifest version roles must be 0.0.9 and 0.1.0."}
    return [ordered]@{Status='READY_FOR_TASK_15B';Architecture='x64';ExpectedManifest=(Resolve-Path $ExpectedManifestPath).Path;PreviousInstaller=Assert-Task15InstallerInput $previousPath $previousExpected;CurrentInstaller=Assert-Task15InstallerInput $currentPath $currentExpected}
}
Export-ModuleMember -Function *
