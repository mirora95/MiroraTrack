Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Task15SafeDirectoryPath {
    param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$AllowedRoot)
    $fullPath=[IO.Path]::GetFullPath($Path).TrimEnd('\')
    $fullRoot=[IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\')
    if($fullPath -ceq $fullRoot -or -not $fullPath.StartsWith($fullRoot+'\',[StringComparison]::OrdinalIgnoreCase)){
        throw "Refusing recursive operation outside or at the allowed root: $fullPath"
    }
    $segments=[Collections.Generic.List[string]]::new();$cursor=$fullPath
    $driveRoot=[IO.Path]::GetPathRoot($fullPath).TrimEnd('\')
    while($cursor){
        $segments.Add($cursor)
        if($cursor.TrimEnd('\')-ieq$driveRoot){break}
        $parent=[IO.Directory]::GetParent($cursor)
        if($null-eq$parent){break}
        $cursor=$parent.FullName
    }
    foreach($segment in @($segments|Sort-Object Length)){
        if(Test-Path -LiteralPath $segment){
            $item=Get-Item -LiteralPath $segment -Force
            if(($item.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne 0){throw "Refusing recursive operation through reparse point: $segment"}
            $resolved=(Resolve-Path -LiteralPath $segment).ProviderPath.TrimEnd('\')
            if(-not $resolved.Equals([IO.Path]::GetFullPath($segment).TrimEnd('\'),[StringComparison]::OrdinalIgnoreCase)){throw "Physical path mismatch: $segment -> $resolved"}
        }
    }
    return $fullPath
}

function Remove-Task15SafeDirectory {
    param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$AllowedRoot)
    $validated=Assert-Task15SafeDirectoryPath -Path $Path -AllowedRoot $AllowedRoot
    if(-not(Test-Path -LiteralPath $validated)){return}
    $directories=[Collections.Generic.List[string]]::new()
    $files=[Collections.Generic.List[string]]::new()
    $pending=[Collections.Generic.Stack[string]]::new()
    $pending.Push($validated)
    while($pending.Count-ne 0){
        $current=$pending.Pop()
        $currentItem=Get-Item -LiteralPath $current -Force
        if(-not$currentItem.PSIsContainer){throw "Recursive deletion target is not a directory: $current"}
        if(($currentItem.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne 0){throw "Refusing recursive operation through reparse point: $current"}
        $directories.Add($current)
        foreach($childPath in [IO.Directory]::EnumerateFileSystemEntries($current)){
            $child=Get-Item -LiteralPath $childPath -Force
            if(($child.Attributes-band[IO.FileAttributes]::ReparsePoint)-ne 0){throw "Refusing recursive operation through reparse point: $childPath"}
            if($child.PSIsContainer){$pending.Push($child.FullName)}else{$files.Add($child.FullName)}
        }
    }
    foreach($file in $files){
        $attributes=[IO.File]::GetAttributes($file)
        if(($attributes-band[IO.FileAttributes]::ReadOnly)-ne 0){[IO.File]::SetAttributes($file,$attributes-band(-bnot[IO.FileAttributes]::ReadOnly))}
        [IO.File]::Delete($file)
    }
    foreach($directory in @($directories|Sort-Object {$_.Length} -Descending)){[IO.Directory]::Delete($directory,$false)}
}

function Assert-Task15ArtifactRecord {
    param([Parameter(Mandatory)]$Record,[string]$Path=$Record.CandidatePath)
    if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){throw "Artifact candidate is missing: $Path"}
    $item=Get-Item -LiteralPath $Path
    if($item.Length-ne[long]$Record.ExpectedSize){throw "Artifact candidate size mismatch for $($Record.Version)."}
    $hash=(Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if($hash-cne[string]$Record.ExpectedSha256){throw "Artifact candidate hash mismatch for $($Record.Version)."}
    if($Record.MetadataValidator){& $Record.MetadataValidator $Path $Record.Version}
}

function New-Task15ArtifactCandidate {
    param([Parameter(Mandatory)][string]$Version,[Parameter(Mandatory)][string]$SourcePath,[Parameter(Mandatory)][string]$DestinationPath,[scriptblock]$MetadataValidator)
    $source=(Resolve-Path -LiteralPath $SourcePath).Path
    $destination=[IO.Path]::GetFullPath($DestinationPath)
    $directory=Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $directory|Out-Null
    $candidate=Join-Path $directory ((Split-Path -Leaf $destination)+'.candidate-'+[guid]::NewGuid().ToString('N'))
    Copy-Item -LiteralPath $source -Destination $candidate
    $record=[pscustomobject][ordered]@{Version=$Version;SourcePath=$source;DestinationPath=$destination;CandidatePath=$candidate;ExpectedSize=(Get-Item $source).Length;ExpectedSha256=(Get-FileHash $source -Algorithm SHA256).Hash;MetadataValidator=$MetadataValidator}
    try{Assert-Task15ArtifactRecord $record;return $record}catch{Remove-Item -LiteralPath $candidate -Force -ErrorAction SilentlyContinue;throw}
}

function Publish-Task15ArtifactSetAtomically {
    param([Parameter(Mandatory)][object[]]$Records)
    if($Records.Count-lt 1){throw "No artifact candidates supplied."}
    foreach($record in $Records){Assert-Task15ArtifactRecord $record}
    $published=@()
    try{
        foreach($record in $Records){
            $backup=$record.DestinationPath+'.rollback-'+[guid]::NewGuid().ToString('N')
            $hadExisting=Test-Path -LiteralPath $record.DestinationPath
            if($hadExisting){[IO.File]::Replace($record.CandidatePath,$record.DestinationPath,$backup,$true)}else{[IO.File]::Move($record.CandidatePath,$record.DestinationPath)}
            $published += [pscustomobject]@{Record=$record;Backup=$backup;HadExisting=$hadExisting}
            Assert-Task15ArtifactRecord -Record $record -Path $record.DestinationPath
        }
    }catch{
        $cause=$_.Exception.Message
        $rollbackErrors=@()
        for($index=$published.Count-1;$index-ge 0;$index--){$entry=$published[$index]
            $discard=$entry.Record.DestinationPath+'.rollback-discard-'+[guid]::NewGuid().ToString('N')
            try{if($entry.HadExisting -and (Test-Path -LiteralPath $entry.Backup)){if(Test-Path -LiteralPath $entry.Record.DestinationPath){[IO.File]::Replace($entry.Backup,$entry.Record.DestinationPath,$discard,$true)}else{[IO.File]::Move($entry.Backup,$entry.Record.DestinationPath)}}elseif(Test-Path -LiteralPath $entry.Record.DestinationPath){Remove-Item -LiteralPath $entry.Record.DestinationPath -Force}}catch{$rollbackErrors += $_.Exception.Message}finally{Remove-Item -LiteralPath $discard -Force -ErrorAction SilentlyContinue}
        }
        if($rollbackErrors.Count-ne 0){throw "Atomic artifact publish failed; rollback also failed: $cause | $($rollbackErrors -join ' | ')"}
        throw "Atomic artifact publish failed and prior finals were restored: $cause"
    }finally{
        foreach($record in $Records){Remove-Item -LiteralPath $record.CandidatePath -Force -ErrorAction SilentlyContinue}
    }
    foreach($entry in $published){Remove-Item -LiteralPath $entry.Backup -Force -ErrorAction SilentlyContinue}
}

function Write-Task15FileAtomically {
    param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$Content)
    $destination=[IO.Path]::GetFullPath($Path);$directory=Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $directory|Out-Null
    $candidate=Join-Path $directory ((Split-Path -Leaf $destination)+'.candidate-'+[guid]::NewGuid().ToString('N'))
    $backup=$destination+'.rollback-'+[guid]::NewGuid().ToString('N')
    try{[IO.File]::WriteAllText($candidate,$Content,[Text.UTF8Encoding]::new($false));if(Test-Path -LiteralPath $destination){[IO.File]::Replace($candidate,$destination,$backup,$true);Remove-Item -LiteralPath $backup -Force}else{[IO.File]::Move($candidate,$destination)}}finally{Remove-Item -LiteralPath $candidate,$backup -Force -ErrorAction SilentlyContinue}
}

function Stop-Task15ExactProcess {
    param([Diagnostics.Process]$Process)
    if(-not $Process){return}
    if(-not $Process.HasExited){Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue}
    [void]$Process.WaitForExit(10000)
    if(Get-Process -Id $Process.Id -ErrorAction SilentlyContinue){throw "Exact process $($Process.Id) remained after cleanup."}
}

function Start-Task15GuardedProcess {
    param([Parameter(Mandatory)][string]$FilePath,[string[]]$Arguments=@(),[Parameter(Mandatory)][string]$ReadyPath,[string]$WorkingDirectory=(Get-Location).Path,[string]$StandardOutputPath,[string]$StandardErrorPath,[int]$TimeoutSeconds=15)
    $start=@{FilePath=$FilePath;ArgumentList=$Arguments;WorkingDirectory=$WorkingDirectory;WindowStyle='Hidden';PassThru=$true}
    if($StandardOutputPath){$start.RedirectStandardOutput=$StandardOutputPath};if($StandardErrorPath){$start.RedirectStandardError=$StandardErrorPath}
    $process=$null
    try{
        $process=Start-Process @start;$deadline=(Get-Date).AddSeconds($TimeoutSeconds)
        while(-not(Test-Path -LiteralPath $ReadyPath)-and(Get-Date)-lt$deadline){if($process.HasExited){throw "process exited before ready"};Start-Sleep -Milliseconds 100}
        if(-not(Test-Path -LiteralPath $ReadyPath)){throw "ready timeout"}
        $ready=Get-Content -LiteralPath $ReadyPath -Raw|ConvertFrom-Json
        if([int]$ready.Pid-ne$process.Id -or [string]$ready.Address-cne'127.0.0.1'){throw "ready identity/address mismatch"}
        $listeners=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$ready.Port) -ErrorAction Stop)
        if($listeners.Count-ne 1 -or $listeners[0].LocalAddress-cne'127.0.0.1' -or [int]$listeners[0].OwningProcess-ne$process.Id){throw "listener identity mismatch"}
        return [pscustomobject]@{Process=$process;Ready=$ready;Port=[int]$ready.Port}
    }catch{Stop-Task15ExactProcess $process;throw "Guarded process readiness/identity validation failed: $($_.Exception.Message)"}
}

Export-ModuleMember -Function *
