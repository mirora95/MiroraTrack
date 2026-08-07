[CmdletBinding()]
param(
    [string]$RepositoryRoot,
    [int]$TimeoutSeconds = 1800
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) { $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }
$wsbExecutable = (Get-Command wsb.exe -ErrorAction SilentlyContinue).Source
$nativeWrapper = Join-Path $RepositoryRoot 'work\toolchain\Invoke-Task13bNative.ps1'
$runId = '{0}-{1}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'),([guid]::NewGuid().ToString('N').Substring(0,8))
$runRoot = Join-Path $RepositoryRoot "work\sandbox\task14e\$runId"
$inputRoot = Join-Path $runRoot 'input'
$evidenceRoot = Join-Path $runRoot 'evidence'
$hostLogRoot = Join-Path $RepositoryRoot 'work\logs\task14e'
$controllerLog = Join-Path $hostLogRoot "controller-$runId.json"
$atomicFinalTemporaryName = 'result.json.tmp'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Task14EExitApi {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
}
'@

function Write-Utf8([string]$Path, [string]$Text) { [IO.File]::WriteAllText($Path,$Text,[Text.UTF8Encoding]::new($false)) }
function Write-AtomicJson([string]$Path, $Value) { $temp="$Path.tmp"; Write-Utf8 $temp ($Value|ConvertTo-Json -Depth 15); Move-Item -LiteralPath $temp -Destination $Path -Force }
function Stop-ExactTree([int]$RootPid) { foreach($child in @(Get-CimInstance Win32_Process|Where-Object ParentProcessId -eq $RootPid)){Stop-ExactTree ([int]$child.ProcessId)}; Stop-Process -Id $RootPid -Force -ErrorAction SilentlyContinue }

function Get-RunningSandboxIds {
    $raw = & $wsbExecutable ListRunningSandboxes --raw
    if ($LASTEXITCODE -ne 0) { throw 'ListRunningSandboxes failed.' }
    $parsed = ($raw -join [Environment]::NewLine) | ConvertFrom-Json
    return @($parsed.WindowsSandboxEnvironments | ForEach-Object { [string]$_.Id })
}

function Stop-ExactSandbox([string]$SandboxId) {
    & $wsbExecutable StopSandbox --id $SandboxId --raw | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "StopSandbox failed for exact ID $SandboxId." }
}

function Invoke-Captured {
    param([string]$Name,[string]$FilePath,[string[]]$Arguments,[int]$Limit=900,[string]$WorkingDirectory=$RepositoryRoot)
    $out=Join-Path $hostLogRoot "$runId-$Name.stdout.log"; $err=Join-Path $hostLogRoot "$runId-$Name.stderr.log"
    $start=Get-Date; $started=Start-Process -FilePath $FilePath -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -PassThru -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err
    $process=Get-Process -Id $started.Id; $handle=$process.Handle
    if(-not $process.WaitForExit($Limit*1000)){Stop-ExactTree $process.Id;throw "$Name exceeded $Limit seconds; its exact process tree was terminated."}
    $process.WaitForExit(); [uint32]$native=0
    if(-not [Task14EExitApi]::GetExitCodeProcess($handle,[ref]$native)){throw "Could not capture numeric exit for $Name."}
    $result=[ordered]@{name=$Name;started=$start.ToString('o');ended=(Get-Date).ToString('o');exitCode=[int]$native;stdout=$out;stderr=$err}
    if([int]$native-ne0){throw "$Name exited with numeric code $native. See $out and $err"}
    return $result
}

function Job-Preamble {
@'
$ProgressPreference='SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class JobApi {
 [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
 [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; }
 [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr a,string n);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr j,int c,IntPtr i,uint l);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetHandleInformation(IntPtr h,uint m,uint f);
 [DllImport("kernel32.dll")] public static extern IntPtr GetCurrentProcess();
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
}
"@
$job=[JobApi]::CreateJobObject([IntPtr]::Zero,$null);if($job-eq[IntPtr]::Zero){throw 'CreateJobObject failed'}
if(-not[JobApi]::SetHandleInformation($job,1,0)){throw 'non-inheritable Job Object handle failed'}
$info=New-Object JobApi+JOBOBJECT_EXTENDED_LIMIT_INFORMATION;$info.BasicLimitInformation.LimitFlags=0x2000 # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
$size=[Runtime.InteropServices.Marshal]::SizeOf($info);$ptr=[Runtime.InteropServices.Marshal]::AllocHGlobal($size)
try{[Runtime.InteropServices.Marshal]::StructureToPtr($info,$ptr,$false);if(-not[JobApi]::SetInformationJobObject($job,9,$ptr,[uint32]$size)){throw 'SetInformationJobObject failed'}}finally{[Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)}
if(-not[JobApi]::AssignProcessToJobObject($job,[JobApi]::GetCurrentProcess())){throw 'AssignProcessToJobObject failed'}
'@
}

function Invoke-NativeBuild {
    $logical=[ordered]@{Wrapper=$nativeWrapper;Executable='npx.cmd';CommandArguments=@('tauri','build','--debug','--target','x86_64-pc-windows-msvc','--no-bundle','--ci')}|ConvertTo-Json -Compress
    $token=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($logical))
    $code=(Job-Preamble)+@'
$ErrorActionPreference='Stop';$i=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__TOKEN__'))|ConvertFrom-Json
try{[string[]]$a=@($i.CommandArguments|ForEach-Object{[string]$_});& ([string]$i.Wrapper) -Executable ([string]$i.Executable) -CommandArguments $a;$exit=if($null-eq$LASTEXITCODE){0}else{[int]$LASTEXITCODE}}finally{if($job-ne[IntPtr]::Zero){[JobApi]::CloseHandle($job)|Out-Null}}
exit $exit
'@
    $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code.Replace('__TOKEN__',$token)))
    Write-Utf8 (Join-Path $hostLogRoot "$runId-native-build.logical-argv.json") $logical
    Invoke-Captured 'native-build' 'powershell.exe' @('-NoLogo','-NoProfile','-NonInteractive','-OutputFormat','Text','-EncodedCommand',$encoded) 1800
}

function Get-StagedWebView2Runtime {
    # The Microsoft-signed Evergreen offline installer is acquired on the host by
    # Task 15 and staged read-only into the guest. This is the identical payload the
    # NSIS bundle embeds under webviewInstallMode "offlineInstaller". The guest
    # installs from this file and never downloads a runtime.
    $bindingPath = Join-Path $RepositoryRoot 'work\toolchain\webview-offline\binding.json'
    if (-not (Test-Path -LiteralPath $bindingPath -PathType Leaf)) {
        throw "BLOCKED: the host WebView2 offline binding is absent at $bindingPath. Run scripts\task15\Acquire-WebViewOfflineInstaller.ps1 on a networked host first."
    }
    $binding = Get-Content -LiteralPath $bindingPath -Raw | ConvertFrom-Json
    $installer = Join-Path $RepositoryRoot $binding.Path
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "BLOCKED: the bound WebView2 offline installer is absent at $installer." }
    if ($binding.Binding.AssetName -cne 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe') { throw "Unexpected WebView2 asset name: $($binding.Binding.AssetName)." }

    $actualLength = (Get-Item -LiteralPath $installer).Length
    if ($actualLength -ne [int64]$binding.Binding.Size) { throw "WebView2 installer length $actualLength does not match the bound size $($binding.Binding.Size)." }
    $actualHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
    if ($actualHash -cne $binding.Sha256) { throw "WebView2 installer SHA-256 $actualHash does not match the bound hash $($binding.Sha256)." }

    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid') { throw "WebView2 installer Authenticode status is $($signature.Status); only a Valid Microsoft signature may be staged." }
    if ($signature.SignerCertificate.Subject -notlike 'CN=Microsoft Corporation, O=Microsoft Corporation*') { throw "WebView2 installer signer is unexpected: $($signature.SignerCertificate.Subject)." }

    Copy-Item -LiteralPath $installer -Destination (Join-Path $inputRoot 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe')
    return [ordered]@{
        source = $binding.Path
        assetName = $binding.Binding.AssetName
        length = $actualLength
        sha256 = $actualHash
        signatureStatus = [string]$signature.Status
        signerSubject = [string]$signature.SignerCertificate.Subject
        stagedAs = 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
    }
}

function Get-HostOfflineAudit {
    $config=Get-Content -LiteralPath (Join-Path $RepositoryRoot 'src-tauri\tauri.conf.json') -Raw|ConvertFrom-Json
    $literals=@();$networkSinks=@()
    foreach($root in @((Join-Path $RepositoryRoot 'dist'),(Join-Path $RepositoryRoot 'src-tauri\tauri.conf.json'))){
        $files=if((Get-Item $root).PSIsContainer){Get-ChildItem $root -File -Recurse}else{Get-Item $root}
        foreach($file in $files){
            $text=Get-Content -LiteralPath $file.FullName -Raw
            foreach($match in ([regex]'https?://[^\s"''<>)]+' ).Matches($text)){
                $url=$match.Value.TrimEnd(';',',');$classification=switch -Regex ($url) {
                    '^http://www\.w3\.org/' {'standards-namespace';break}
                    '^https://json-schema\.org/' {'schema-namespace';break}
                    '^http://ipc\.localhost' {'tauri-ipc';break}
                    '^http://localhost(?::5173)?' {'development-only-local-url';break}
                    '^http://\[\$\{' {'dependency-url-template';break}
                    '^https?://(redux\.js\.org|redux-toolkit\.js\.org|react\.dev|reactrouter\.com|bit\.ly|tinyurl\.com|github\.com/ungap)/' {'dependency-diagnostic-documentation';break}
                    default {'unclassified-remote-literal'}
                }
                $literals+=[ordered]@{file=$file.FullName.Substring($RepositoryRoot.Length+1);url=$url;classification=$classification}
            }
            foreach($pattern in @('fetch\(\s*["'']https?://','new\s+WebSocket\(\s*["'']https?://','new\s+EventSource\(\s*["'']https?://','(?:src|href)\s*=\s*["'']https?://')){
                foreach($match in ([regex]$pattern).Matches($text)){$networkSinks+=[ordered]@{file=$file.FullName.Substring($RepositoryRoot.Length+1);match=$match.Value}}
            }
        }
    }
    $rejected=@($literals|Where-Object classification -eq 'unclassified-remote-literal')
    $hosting=Test-Path (Join-Path $RepositoryRoot '.openai\hosting.json')
    $audit=[ordered]@{frontendDist=$config.build.frontendDist;csp=$config.app.security.csp;allUrlLiterals=$literals;unclassifiedRemoteLiterals=$rejected;executableRemoteNetworkSinks=$networkSinks;hostingConfigurationPresent=$hosting;pass=($rejected.Count-eq0-and$networkSinks.Count-eq0-and-not$hosting)}
    if(-not$audit.pass){throw "Host offline audit found $($rejected.Count) unclassified remote literal(s), $($networkSinks.Count) executable remote network sink(s), or hosting configuration."};return $audit
}

try {
    New-Item -ItemType Directory -Force -Path $inputRoot,$evidenceRoot,$hostLogRoot | Out-Null
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'Test-HarnessStatic.ps1')
    if($LASTEXITCODE-ne0){throw 'Static harness validation failed before execution.'}
    if([string]::IsNullOrWhiteSpace($wsbExecutable)-or-not(Test-Path -LiteralPath $wsbExecutable)){throw 'BLOCKED: wsb.exe is absent.'}
    if(-not(Test-Path -LiteralPath $nativeWrapper)){throw 'The proven native wrapper is absent.'}
    $build=@();$build+=Invoke-Captured 'frontend-build' 'npm.cmd' @('run','build') 900
    $build+=Invoke-NativeBuild
    $hostAudit=Get-HostOfflineAudit
    $app=Join-Path $RepositoryRoot 'src-tauri\target\x86_64-pc-windows-msvc\debug\miroratrack.exe'
    $node=(Get-Command node.exe -ErrorAction Stop).Source
    foreach($pair in @(@($app,'miroratrack.exe'),@($node,'node.exe'),@((Join-Path $PSScriptRoot 'guest.ps1'),'guest.ps1'),@((Join-Path $PSScriptRoot 'guest.js'),'guest.js'),@((Join-Path $PSScriptRoot 'dialog-watcher.ps1'),'dialog-watcher.ps1'))){Copy-Item -LiteralPath $pair[0] -Destination (Join-Path $inputRoot $pair[1])}
    Copy-Item -LiteralPath (Join-Path $RepositoryRoot 'node_modules\playwright-core') -Destination (Join-Path $inputRoot 'pw') -Recurse
    $webView2=Get-StagedWebView2Runtime
    $files=@(Get-ChildItem -LiteralPath $inputRoot -File -Recurse|ForEach-Object{[ordered]@{path=$_.FullName.Substring($inputRoot.Length+1);length=$_.Length;sha256=(Get-FileHash $_.FullName -Algorithm SHA256).Hash}})
    $manifest=[ordered]@{runId=$runId;createdAt=(Get-Date).ToString('o');files=$files;build=$build;hostAudit=$hostAudit;application=[ordered]@{sha256=(Get-FileHash $app -Algorithm SHA256).Hash;length=(Get-Item $app).Length};node=[ordered]@{sha256=(Get-FileHash $node -Algorithm SHA256).Hash;version=(& $node --version)};webView2=$webView2}
    Write-Utf8 (Join-Path $inputRoot 'manifest.json') ($manifest|ConvertTo-Json -Depth 12)
    Write-AtomicJson (Join-Path $evidenceRoot 'host-staging.json') ([ordered]@{runId=$runId;input=$inputRoot;evidence=$evidenceRoot;manifestFileCount=$files.Count;hostAudit=$hostAudit})
    $template=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'sandbox.wsb.template') -Raw
    $escape={param($value)[Security.SecurityElement]::Escape($value)}
    $configuration=$template.Replace('{{MT_INPUT}}',(& $escape $inputRoot)).Replace('{{MT_EVIDENCE}}',(& $escape $evidenceRoot))
    $wsb=Join-Path $runRoot 'task14e.wsb';Write-Utf8 $wsb $configuration
    [xml]$check=Get-Content -LiteralPath $wsb -Raw
    if(@($check.Configuration.MappedFolders.MappedFolder).Count-ne2){throw 'Generated sandbox configuration mapping count is not exactly two.'}
    $before=@(Get-RunningSandboxIds)
    $sandboxId=[guid]::NewGuid().ToString()
    $compactConfiguration=($configuration -replace '[\r\n]+',' ' -replace '>\s+<','><').Trim()
    $startResult=Invoke-Captured 'sandbox-start' $wsbExecutable @('StartSandbox','--id',$sandboxId,"--config=`"$compactConfiguration`"",'--raw') 120
    $launched=@(Get-RunningSandboxIds)
    if($sandboxId-notin$launched){throw "StartSandbox did not expose exact run ID $sandboxId."}
    $connectResult=Invoke-Captured 'sandbox-connect' $wsbExecutable @('ConnectToSandbox','--id',$sandboxId,'--raw') 120
    $deadline=(Get-Date).AddSeconds($TimeoutSeconds);$resultPath=Join-Path $evidenceRoot 'result.json'
    while((Get-Date)-lt$deadline-and-not(Test-Path -LiteralPath $resultPath)){
        if($sandboxId-notin@(Get-RunningSandboxIds)){throw "Windows Sandbox ID $sandboxId stopped before atomic final evidence appeared."};Start-Sleep -Seconds 1
    }
    if(-not(Test-Path -LiteralPath $resultPath)){
        Stop-ExactSandbox $sandboxId
        throw "Task 14E exceeded $TimeoutSeconds seconds; only exact run Sandbox ID $sandboxId was terminated."
    }
    $result=Get-Content -LiteralPath $resultPath -Raw|ConvertFrom-Json
    # The guest powers itself off only on PASS. Windows Sandbox is single-instance,
    # so any other outcome must still release the environment or every later run
    # fails with CO_E_APPSINGLEUSE. Evidence already lives on the host mapping.
    Start-Sleep -Seconds 5
    $cleanup=$null
    try{ if($sandboxId -in @(Get-RunningSandboxIds)){ Stop-ExactSandbox $sandboxId; $cleanup=[ordered]@{sandboxId=$sandboxId;stopped=$true} } else { $cleanup=[ordered]@{sandboxId=$sandboxId;stopped=$false;reason='already exited'} } }catch{ $cleanup=[ordered]@{sandboxId=$sandboxId;stopped=$false;reason=$_.Exception.Message} }
    $record=[ordered]@{runId=$runId;runRoot=$runRoot;sandboxId=$sandboxId;preexistingSandboxIds=$before;startResult=$startResult;connectResult=$connectResult;result=$result;cleanup=$cleanup;completedAt=(Get-Date).ToString('o')};Write-AtomicJson $controllerLog $record
    Write-Output ($record|ConvertTo-Json -Depth 15)
    if($result.status-ne'PASS'){exit $(if($result.status-eq'NEEDS_USER'){42}else{1})}
} catch {
    $record=[ordered]@{runId=$runId;runRoot=$runRoot;status=if($_.Exception.Message.StartsWith('NEEDS_USER:')){'NEEDS_USER'}else{'BLOCKED'};message=$_.Exception.Message;detail=($_|Out-String);failedAt=(Get-Date).ToString('o')};Write-AtomicJson $controllerLog $record;Write-Error $_;exit 1
}
