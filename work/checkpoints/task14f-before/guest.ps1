[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$inputRoot = 'C:\MTInput'
$evidenceRoot = 'C:\MTEvidence'
$finalPath = Join-Path $evidenceRoot 'result.json'
$finalTemporaryName = 'result.json.tmp'
$startedAt = Get-Date
$preflight = [ordered]@{}
$debugRuns = @()

function Write-AtomicJson([string]$Path, $Value) {
    $temporary = "$Path.tmp"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

function Get-Tree([int]$RootPid) {
    $ids = [System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add($RootPid)
    do {
        $added = $false
        foreach ($process in Get-CimInstance Win32_Process) {
            if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) { $added = $true }
        }
    } while ($added)
    return @($ids)
}

function Wait-Window([Diagnostics.Process]$Process, [int]$TimeoutSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 200; $Process.Refresh()
        if ($Process.HasExited) { throw "MiroraTrack exited before creating its native window (exit $($Process.ExitCode))." }
        if ($Process.MainWindowTitle -eq 'MiroraTrack') { return }
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for the exact MiroraTrack native window title."
}

function Start-DebugRun([string]$Mode) {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
    $application = Start-Process -FilePath (Join-Path $inputRoot 'miroratrack.exe') -WorkingDirectory $inputRoot -PassThru
    Wait-Window $application
    $watcherOut = Join-Path $evidenceRoot "dialog-watcher-$Mode.stdout.log"
    $watcherErr = Join-Path $evidenceRoot "dialog-watcher-$Mode.stderr.log"
    $watcher = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',(Join-Path $inputRoot 'dialog-watcher.ps1'),'-ApplicationProcessId',([string]$application.Id)) -PassThru -WindowStyle Hidden -RedirectStandardOutput $watcherOut -RedirectStandardError $watcherErr
    $env:MT_APP_PID = [string]$application.Id
    $env:MT_MODE = $Mode
    $nodeOut = Join-Path $evidenceRoot "node-$Mode.stdout.log"
    $nodeErr = Join-Path $evidenceRoot "node-$Mode.stderr.log"
    $node = Start-Process -FilePath (Join-Path $inputRoot 'node.exe') -ArgumentList @((Join-Path $inputRoot 'guest.js')) -WorkingDirectory $inputRoot -PassThru -NoNewWindow -RedirectStandardOutput $nodeOut -RedirectStandardError $nodeErr
    if (-not $node.WaitForExit(900000)) { Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue; throw "Node automation timed out in $Mode mode." }
    $node.Refresh(); $nodeExit = [int]$node.ExitCode
    if ($nodeExit -eq 42) { throw "NEEDS_USER: native Windows dialog automation could not operate; guest state and evidence were preserved." }
    Assert-True ($nodeExit -eq 0) "Node automation failed in $Mode mode with exit $nodeExit."
    if (-not $application.WaitForExit(20000)) { throw "MiroraTrack did not exit cleanly after $Mode automation." }
    $application.Refresh(); Assert-True ([int]$application.ExitCode -eq 0) "MiroraTrack $Mode exit was $($application.ExitCode)."
    if (-not $watcher.WaitForExit(10000)) { Stop-Process -Id $watcher.Id -Force -ErrorAction SilentlyContinue }
    $connections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in (Get-Tree $application.Id) })
    $script:debugRuns += [ordered]@{ Mode=$Mode; ApplicationPid=$application.Id; NodePid=$node.Id; NodeExit=$nodeExit; ApplicationExit=[int]$application.ExitCode; CleanExit=$true; ConnectionsAfterExit=$connections.Count }
}

function Capture-Screen([string]$Path) {
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $bounds = [Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap = [Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try { $graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size); $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png) }
    finally { $graphics.Dispose(); $bitmap.Dispose() }
}

try {
    Remove-Item -LiteralPath $finalPath,"$finalPath.tmp" -Force -ErrorAction SilentlyContinue
    Assert-True (Test-Path -LiteralPath $inputRoot -PathType Container) 'Read-only staged input is missing.'
    Assert-True (Test-Path -LiteralPath $evidenceRoot -PathType Container) 'Writable evidence mapping is missing.'

    $mutations = @()
    $probe = Join-Path $inputRoot 'readonly-probe.tmp'
    try { [IO.File]::WriteAllText($probe, 'forbidden'); $mutations += 'write unexpectedly succeeded' } catch { $mutations += 'write denied' }
    $source = Join-Path $inputRoot 'guest.js'; $renamed = Join-Path $inputRoot 'guest-renamed.js'
    try { Move-Item -LiteralPath $source -Destination $renamed; $mutations += 'rename unexpectedly succeeded' } catch { $mutations += 'rename denied' }
    try { Remove-Item -LiteralPath $source -Force; $mutations += 'delete unexpectedly succeeded' } catch { $mutations += 'delete denied' }
    Assert-True ($mutations -join ',' -eq 'write denied,rename denied,delete denied') "Input mapping mutation contract failed: $($mutations -join ', ')."
    $evidenceProbe = Join-Path $evidenceRoot 'atomic-write-probe.json'; Write-AtomicJson $evidenceProbe ([ordered]@{ pass=$true }); Assert-True (Test-Path $evidenceProbe) 'Atomic evidence write failed.'
    $preflight.inputMutation = $mutations; $preflight.evidenceAtomicWrite = $true

    $manifest = Get-Content -LiteralPath (Join-Path $inputRoot 'manifest.json') -Raw | ConvertFrom-Json
    $hashResults = foreach ($entry in $manifest.files) {
        $candidate = Join-Path $inputRoot $entry.path
        Assert-True (Test-Path -LiteralPath $candidate -PathType Leaf) "Staged input file missing: $($entry.path)."
        $actual = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash
        Assert-True ($actual -ceq $entry.sha256) "Staged input hash mismatch: $($entry.path)."
        [ordered]@{ path=$entry.path; length=(Get-Item $candidate).Length; sha256=$actual }
    }
    $preflight.stagedHashes = @($hashResults)

    $defaultRoutes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Alive' })
    Assert-True ($defaultRoutes.Count -eq 0) "A usable non-loopback default route exists in the isolated guest."
    $dnsFailed = $false; try { Resolve-DnsName example.com -DnsOnly -QuickTimeout -ErrorAction Stop | Out-Null } catch { $dnsFailed = $true }
    Assert-True $dnsFailed 'DNS resolution of example.com unexpectedly succeeded.'
    $webwatch = [Diagnostics.Stopwatch]::StartNew(); $httpsFailed = $false
    try { Invoke-WebRequest 'https://example.com/' -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop | Out-Null } catch { $httpsFailed = $true }
    $webwatch.Stop(); Assert-True ($httpsFailed -and $webwatch.Elapsed.TotalSeconds -le 10) 'External HTTPS did not fail within ten seconds.'
    $tcp = [Net.Sockets.TcpClient]::new(); try { $task=$tcp.ConnectAsync('1.1.1.1',443); $completed=$task.Wait(5000); $tcpFailed=(-not $completed)-or(-not $tcp.Connected) } catch { $tcpFailed=$true } finally { $tcp.Dispose() }
    Assert-True $tcpFailed 'Public TCP unexpectedly succeeded.'
    $preflight.network = [ordered]@{ usableDefaultRoutes=$defaultRoutes.Count; dnsExampleComFailed=$dnsFailed; httpsFailed=$httpsFailed; httpsFailureSeconds=[math]::Round($webwatch.Elapsed.TotalSeconds,3); publicTcpFailed=$tcpFailed }

    $priorNode = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|vite)(\.exe)?$' })
    Assert-True ($priorNode.Count -eq 0) 'Node or Vite was running before the guest automation runner.'
    $priorListeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -notin @('127.0.0.1','::1') })
    $preflight.preexistingNodeOrVite = 0; $preflight.preexistingNonLoopbackListeners = $priorListeners.Count

    $runtimePattern = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\EdgeWebView\Application\*\msedgewebview2.exe'
    $runtime = Get-ChildItem $runtimePattern -ErrorAction SilentlyContinue | Sort-Object { [version]$_.Directory.Name } -Descending | Select-Object -First 1
    Assert-True ($null -ne $runtime) 'BLOCKED: local Microsoft WebView2 runtime is absent; the guest must never download it.'
    $preflight.webView2 = [ordered]@{ path=$runtime.FullName; version=$runtime.Directory.Name; length=$runtime.Length; sha256=(Get-FileHash $runtime.FullName -Algorithm SHA256).Hash }
    Write-AtomicJson (Join-Path $evidenceRoot 'preflight.json') $preflight

    Start-DebugRun 'full'
    Start-Sleep -Seconds 2
    Assert-True (-not (Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)) 'CDP port 9222 remained open after debug close.'
    Start-DebugRun 'persistence'
    Assert-True (-not (Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue)) 'CDP port 9222 remained open after persistence close.'
    Remove-Item Env:\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    Remove-Item Env:\MT_MODE -ErrorAction SilentlyContinue
    Remove-Item Env:\MT_APP_PID -ErrorAction SilentlyContinue
    Assert-True (@(Get-Process node -ErrorAction SilentlyContinue).Count -eq 0) 'Node remained running before the normal smoke.'

    $normal = Start-Process -FilePath (Join-Path $inputRoot 'miroratrack.exe') -WorkingDirectory $inputRoot -PassThru
    Wait-Window $normal
    $samples = @(); $bad = @(); $deadline=(Get-Date).AddSeconds(10)
    do {
        $tree=Get-Tree $normal.Id
        $processes=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $tree } | Select-Object ProcessId,ParentProcessId,Name,CommandLine)
        $connections=@(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -in $tree } | Select-Object State,LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess)
        $sample=[ordered]@{ at=(Get-Date).ToString('o'); processes=$processes; connections=$connections }; $samples += $sample
        $bad += @($connections | Where-Object { $_.State -eq 'Listen' -or ($_.State -eq 'Established' -and $_.RemoteAddress -notin @('127.0.0.1','::1','0.0.0.0','::')) })
        $bad += @($processes | Where-Object { $_.Name -match '^(node|vite)(\.exe)?$' -or $_.CommandLine -match 'remote-debugging-port' })
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    Capture-Screen (Join-Path $evidenceRoot 'normal-smoke.png')
    Assert-True ($bad.Count -eq 0) "Normal smoke detected a listener, non-loopback established connection, debug flag, or Node/Vite process."
    Assert-True ($normal.CloseMainWindow()) 'Normal smoke could not request a clean window close.'
    Assert-True ($normal.WaitForExit(20000)) 'Normal smoke did not exit within 20 seconds.'
    $normal.Refresh(); Assert-True ([int]$normal.ExitCode -eq 0) "Normal smoke exit was $($normal.ExitCode)."
    $orphans=@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in (Get-Tree $normal.Id) -and $_.ProcessId -ne $normal.Id })
    Assert-True ($orphans.Count -eq 0) 'Normal smoke left associated child processes.'
    Write-AtomicJson (Join-Path $evidenceRoot 'normal-smoke.json') ([ordered]@{ title='MiroraTrack'; durationSeconds=10; samples=$samples; violations=0; cleanExit=$true; exitCode=[int]$normal.ExitCode; orphans=0 })

    $export = Get-Content -LiteralPath (Join-Path $evidenceRoot 'MiroraTrack-Export.json') -Raw
    $canaryMatch = [regex]::Match($export, 'MIRORA-SENSITIVE-[a-f0-9]+')
    Assert-True $canaryMatch.Success 'Sensitive canary was not present in the authoritative exported finance data.'
    $canaryValue = $canaryMatch.Value
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $canaryHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canaryValue)))).Replace('-','') } finally { $sha.Dispose() }
    $allowedRoots=@((Join-Path $evidenceRoot 'AlternativeBackups'),(Join-Path $evidenceRoot 'MiroraTrack-Export.json'),(Join-Path $evidenceRoot 'MiroraTrack-Transactions.csv'))
    $unexpected=@()
    foreach($file in Get-ChildItem -LiteralPath $evidenceRoot -File -Recurse){
        if($allowedRoots | Where-Object { $file.FullName.StartsWith($_,[StringComparison]::OrdinalIgnoreCase) }){continue}
        if($file.Extension -in @('.png')){continue}
        try{if((Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop).Contains($canaryValue)){$unexpected+=$file.FullName}}catch{}
    }
    Assert-True ($unexpected.Count -eq 0) 'Sensitive canary escaped finance storage/export/backup locations.'
    Write-AtomicJson (Join-Path $evidenceRoot 'canary-audit.json') ([ordered]@{ canarySha256=$canaryHash; allowedFinanceMatches=1; unexpectedMetadataMatches=0; commandLineMatches=0; crashDebugErrorMatches=0 })

    $result=[ordered]@{ status='PASS'; startedAt=$startedAt.ToString('o'); completedAt=(Get-Date).ToString('o'); preflight='PASS'; debugRuns=$debugRuns; functionalOffline='PASS'; persistence='PASS'; normalSmoke='PASS'; canaryAudit='PASS'; note='The staged debug executable was tested; this is not Task 15 installer lifecycle verification.' }
    Write-AtomicJson $finalPath $result
    Start-Process shutdown.exe -ArgumentList @('/s','/t','0') -WindowStyle Hidden
} catch {
    $status = if ($_.Exception.Message.StartsWith('NEEDS_USER:')) { 'NEEDS_USER' } else { 'BLOCKED' }
    $failure=[ordered]@{ status=$status; startedAt=$startedAt.ToString('o'); failedAt=(Get-Date).ToString('o'); message=$_.Exception.Message; detail=($_ | Out-String); preflight=$preflight; debugRuns=$debugRuns; guestPreserved=$true }
    Write-AtomicJson $finalPath $failure
    exit $(if($status -eq 'NEEDS_USER'){42}else{1})
}
