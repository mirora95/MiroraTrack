$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$modulePath = Join-Path $PSScriptRoot "Task15BuildSafety.psm1"
Import-Module -Name $modulePath -Force
$testRoot = Join-Path $repositoryRoot "work\logs\task15a\quality-test-build-safety"

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw "ASSERTION FAILED: $Message" }
}
function Assert-Throws([scriptblock] $Action, [string] $Pattern, [string] $Message) {
    $threw = $false
    try { & $Action }
    catch {
        $threw = $true
        if ($_.Exception.Message -notmatch $Pattern) { throw }
    }
    if (-not $threw) { throw "ASSERTION FAILED: expected throw for $Message" }
}

if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
    $allowed = Join-Path $testRoot "allowed"
    $safe = Join-Path $allowed "version\.tauri"
    New-Item -ItemType Directory -Path $safe -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $safe "probe.txt"), "probe")
    Remove-Task15SafeDirectory -Path $safe -AllowedRoot $allowed
    Assert-True (-not (Test-Path -LiteralPath $safe)) "safe directory removed"
    Assert-Throws { Remove-Task15SafeDirectory -Path $testRoot -AllowedRoot $allowed } "outside|root" "outside-root deletion"

    $outside = Join-Path $testRoot "outside"
    New-Item -ItemType Directory -Path $outside | Out-Null
    $junction = Join-Path $allowed "junction"
    $junctionCreated = $false
    try { New-Item -ItemType Junction -Path $junction -Target $outside -ErrorAction Stop | Out-Null; $junctionCreated = $true } catch {}
    if ($junctionCreated) {
        Assert-Throws { Remove-Task15SafeDirectory -Path $junction -AllowedRoot $allowed } "reparse" "junction deletion"
        Assert-True (Test-Path -LiteralPath $outside) "junction target preserved"

        $outsideMarker = Join-Path $outside "must-survive.txt"
        [IO.File]::WriteAllText($outsideMarker, "preserve")
        $nestedTarget = Join-Path $allowed "nested-target"
        New-Item -ItemType Directory -Path $nestedTarget | Out-Null
        $nestedJunction = Join-Path $nestedTarget "nested-junction"
        New-Item -ItemType Junction -Path $nestedJunction -Target $outside -ErrorAction Stop | Out-Null
        Assert-Throws { Remove-Task15SafeDirectory -Path $nestedTarget -AllowedRoot $allowed } "reparse" "nested junction deletion"
        Assert-True ((Get-Content -LiteralPath $outsideMarker -Raw) -ceq "preserve") "nested junction target data preserved"
    }
    else {
        $moduleText = Get-Content -LiteralPath $modulePath -Raw
        Assert-True ($moduleText -match "ReparsePoint") "static reparse-point detection when junction creation unavailable"
    }

    $publish = Join-Path $testRoot "publish"
    New-Item -ItemType Directory -Path $publish | Out-Null
    $sourceA = Join-Path $publish "source-a.bin"; $sourceB = Join-Path $publish "source-b.bin"
    $finalA = Join-Path $publish "final-a.bin"; $finalB = Join-Path $publish "final-b.bin"
    [IO.File]::WriteAllText($sourceA, "new-a"); [IO.File]::WriteAllText($sourceB, "new-b")
    [IO.File]::WriteAllText($finalA, "old-a"); [IO.File]::WriteAllText($finalB, "old-b")
    $records = @(
        (New-Task15ArtifactCandidate -Version "a" -SourcePath $sourceA -DestinationPath $finalA),
        (New-Task15ArtifactCandidate -Version "b" -SourcePath $sourceB -DestinationPath $finalB)
    )
    [IO.File]::AppendAllText($records[1].CandidatePath, "tamper")
    Assert-Throws { Publish-Task15ArtifactSetAtomically -Records $records } "candidate|hash|size" "tampered candidate"
    Assert-True ((Get-Content -Raw $finalA) -ceq "old-a") "first prior final preserved on pre-publish tamper"
    Assert-True ((Get-Content -Raw $finalB) -ceq "old-b") "second prior final preserved on pre-publish tamper"

    $rejectPublishedB = {
        param($Path, $Version)
        if ([IO.Path]::GetFullPath($Path) -ieq [IO.Path]::GetFullPath($finalB)) { throw "simulated post-publication interruption" }
    }.GetNewClosure()
    $records = @(
        (New-Task15ArtifactCandidate -Version "a" -SourcePath $sourceA -DestinationPath $finalA),
        (New-Task15ArtifactCandidate -Version "b" -SourcePath $sourceB -DestinationPath $finalB -MetadataValidator $rejectPublishedB)
    )
    Assert-Throws { Publish-Task15ArtifactSetAtomically -Records $records } "publish|interruption" "mid-publication interruption"
    Assert-True ((Get-Content -Raw $finalA) -ceq "old-a") "first prior final rolled back"
    Assert-True ((Get-Content -Raw $finalB) -ceq "old-b") "locked prior final preserved"

    $records = @(
        (New-Task15ArtifactCandidate -Version "a" -SourcePath $sourceA -DestinationPath $finalA),
        (New-Task15ArtifactCandidate -Version "b" -SourcePath $sourceB -DestinationPath $finalB)
    )
    Publish-Task15ArtifactSetAtomically -Records $records
    Assert-True ((Get-Content -Raw $finalA) -ceq "new-a") "first final atomically published"
    Assert-True ((Get-Content -Raw $finalB) -ceq "new-b") "second final atomically published"

    $fakeServer = Join-Path $testRoot "fake-server.ps1"
    [IO.File]::WriteAllText($fakeServer, @'
param($ReadyPath)
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start()
$port=([Net.IPEndPoint]$listener.LocalEndpoint).Port
[IO.File]::WriteAllText($ReadyPath,(@{Pid=$PID;Address="127.0.0.2";Port=$port}|ConvertTo-Json))
try { while($true){Start-Sleep -Milliseconds 100} } finally {$listener.Stop()}
'@)
    $ready = Join-Path $testRoot "bad-ready.json"
    Assert-Throws { Start-Task15GuardedProcess -FilePath "powershell.exe" -Arguments @("-NoProfile","-File",$fakeServer,"-ReadyPath",$ready) -ReadyPath $ready -TimeoutSeconds 5 } "identity|address|ready" "invalid mirror readiness"
    $badReady = Get-Content -Raw $ready | ConvertFrom-Json
    Assert-True (-not (Get-Process -Id ([int]$badReady.Pid) -ErrorAction SilentlyContinue)) "invalid ready process terminated"
    Assert-True (@(Get-NetTCPConnection -State Listen -LocalPort ([int]$badReady.Port) -ErrorAction SilentlyContinue).Count -eq 0) "invalid ready listener terminated"
}
finally {
    $junction = Join-Path $testRoot "root\junction"
    if (Test-Path -LiteralPath $junction) { [IO.Directory]::Delete($junction, $false) }
    $nestedJunction = Join-Path $testRoot "allowed\nested-target\nested-junction"
    if (Test-Path -LiteralPath $nestedJunction) { [IO.Directory]::Delete($nestedJunction, $false) }
    $junction = Join-Path $testRoot "allowed\junction"
    if (Test-Path -LiteralPath $junction) { [IO.Directory]::Delete($junction, $false) }
    if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
}

"Task 15 build safety tests: PASS"
