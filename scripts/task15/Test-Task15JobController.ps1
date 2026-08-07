$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$modulePath = Join-Path $PSScriptRoot "Task15JobController.psm1"
$projectPath = Join-Path $PSScriptRoot "native-controller\Cargo.toml"

function Assert-True([bool]$Condition, [string]$Description) {
    if (-not $Condition) { throw "Assertion failed: $Description" }
}

Assert-True (Test-Path -LiteralPath $modulePath -PathType Leaf) "controller bootstrap module exists"
Assert-True (Test-Path -LiteralPath $projectPath -PathType Leaf) "source-backed native controller project exists"
Import-Module $modulePath -Force
$identity = Initialize-Task15JobController -RepositoryRoot $repositoryRoot
Assert-True ($identity.BinarySha256 -match '^[0-9A-F]{64}$') "binary SHA-256 recorded"
Assert-True ($identity.SourceSha256 -match '^[0-9A-F]{64}$') "source SHA-256 recorded"
Assert-True ($identity.CargoLockSha256 -match '^[0-9A-F]{64}$') "Cargo.lock SHA-256 recorded"
Assert-True ($identity.PeMachine -ceq '0x8664') "controller is x64 PE"
Assert-True ($identity.RustHost -ceq 'x86_64-pc-windows-msvc') "controller toolchain host is x64 MSVC"

$testRoot = Join-Path $repositoryRoot "work\logs\task15a\job-controller-test"
if (Test-Path -LiteralPath $testRoot) { Remove-Item -LiteralPath $testRoot -Recurse -Force }
New-Item -ItemType Directory -Path $testRoot | Out-Null
$controller = $identity.BinaryPath

function Write-Fixture([string]$Name, [string]$Content) {
    $path = Join-Path $testRoot $Name
    [IO.File]::WriteAllText($path, $Content, [Text.UTF8Encoding]::new($false))
    return $path
}

function Invoke-Controller([string]$Name, [string[]]$ControllerArguments, [string[]]$CommandArguments) {
    $evidence = Join-Path $testRoot "$Name.controller.json"
    $stdout = Join-Path $testRoot "$Name.stdout.log"
    $stderr = Join-Path $testRoot "$Name.stderr.log"
    $arguments = @("--evidence",$evidence,"--stdout",$stdout,"--stderr",$stderr,"--cwd",$repositoryRoot) + $ControllerArguments + @("--") + $CommandArguments
    & $controller @arguments
    $exit = $LASTEXITCODE
    $record = if (Test-Path -LiteralPath $evidence) { Get-Content -LiteralPath $evidence -Raw | ConvertFrom-Json } else { $null }
    return [pscustomobject]@{ ExitCode=$exit; Evidence=$record; EvidencePath=$evidence; Stdout=$stdout; Stderr=$stderr }
}

$unicode = Invoke-Controller "unicode" @("--timeout-ms","10000","--env","TASK15_UNICODE=Mirora-`u{0416}") @(
    "powershell.exe","-NoLogo","-NoProfile","-NonInteractive","-Command",'[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write($env:TASK15_UNICODE); exit 0'
)
Assert-True ($unicode.ExitCode -eq 0) "normal controller invocation exits zero"
Assert-True ((Get-Content -LiteralPath $unicode.Stdout -Raw -Encoding UTF8) -ceq "Mirora-`u{0416}") "Unicode environment and output survive CreateProcessW"
foreach ($property in @("ControllerProcessId","ControllerCreationFiletime","RootProcessId","RootCreationFiletime","RequestedLimitFlags","EffectiveLimitFlags","AssignmentSucceeded","MembershipVerified","Resumed","RootExitCode","CompletionEventsDiagnostic","FinalAccounting","PidListQueries","TerminateJobAttempted","TerminateJobSucceeded","Errors","StartedAtUnixMs","CompletedAtUnixMs")) {
    Assert-True ($unicode.Evidence.PSObject.Properties.Name -contains $property) "evidence contains $property"
}
Assert-True ($unicode.Evidence.Status -ceq "PASS" -and $unicode.Evidence.AssignmentSucceeded -and $unicode.Evidence.MembershipVerified -and $unicode.Evidence.Resumed) "normal root was assigned, verified, and resumed"
Assert-True ([int]$unicode.Evidence.EffectiveLimitFlags -eq 0x2000 -and $unicode.Evidence.BreakawayFlagsAbsent) "effective flags are kill-on-close without breakaway"
Assert-True ($unicode.Evidence.FinalAccounting.ActiveProcesses -eq 0 -and $unicode.Evidence.FinalPidListEmpty) "normal job drains to kernel-confirmed empty"

$sentinel = Join-Path $testRoot "assignment-failure.sentinel"
$sentinelScript = Write-Fixture "assignment-failure.ps1" "[IO.File]::WriteAllText('$($sentinel.Replace("'","''"))','BAD'); Start-Sleep -Seconds 5"
$assignmentFailure = Invoke-Controller "assignment-failure" @("--timeout-ms","10000","--test-force-assignment-failure") @("powershell.exe","-NoLogo","-NoProfile","-NonInteractive","-File",$sentinelScript)
Assert-True ($assignmentFailure.ExitCode -ne 0) "forced assignment failure fails controller"
Assert-True (-not (Test-Path -LiteralPath $sentinel)) "assignment failure never executes sentinel"
Assert-True (-not $assignmentFailure.Evidence.Resumed -and -not $assignmentFailure.Evidence.AssignmentSucceeded) "assignment failure is fail-before-resume"
Assert-True ($assignmentFailure.Evidence.TerminateJobAttempted -and $assignmentFailure.Evidence.FinalPidListEmpty) "assignment failure still terminates and drains job"

$descendantPidPath = Join-Path $testRoot "late-child.pid"
$lateScript = Write-Fixture "late-child.ps1" @"
1..80 | ForEach-Object { & powershell.exe -NoLogo -NoProfile -NonInteractive -Command 'exit 0' }
`$child = Start-Process powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru
[IO.File]::WriteAllText('$($descendantPidPath.Replace("'","''"))', [string]`$child.Id)
exit 0
"@
$late = Invoke-Controller "late-child" @("--timeout-ms","30000") @("powershell.exe","-NoLogo","-NoProfile","-NonInteractive","-File",$lateScript)
$latePid = [int](Get-Content -LiteralPath $descendantPidPath -Raw)
Assert-True ($late.ExitCode -eq 0 -and $late.Evidence.FinalAccounting.TotalProcesses -ge 82) "many short-lived processes are accounted"
Assert-True (-not (Get-Process -Id $latePid -ErrorAction SilentlyContinue)) "late long-lived child is removed with the job"

$preexisting = Start-Process powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru
try {
    $control = Invoke-Controller "same-name-control" @("--timeout-ms","10000") @("powershell.exe","-NoLogo","-NoProfile","-NonInteractive","-Command","exit 0")
    Assert-True ($control.ExitCode -eq 0) "same-name control invocation succeeds"
    Assert-True ([bool](Get-Process -Id $preexisting.Id -ErrorAction SilentlyContinue)) "preexisting same-name process survives; no PID ledger kill"
}
finally { Stop-Process -Id $preexisting.Id -Force -ErrorAction SilentlyContinue }

$timeoutPidPath = Join-Path $testRoot "timeout-child.pid"
$timeoutScript = Write-Fixture "timeout.ps1" @"
`$child = Start-Process powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30') -PassThru
[IO.File]::WriteAllText('$($timeoutPidPath.Replace("'","''"))', [string]`$child.Id)
Start-Sleep -Seconds 30
"@
$timeout = Invoke-Controller "timeout" @("--timeout-ms","1000") @("powershell.exe","-NoLogo","-NoProfile","-NonInteractive","-File",$timeoutScript)
$timeoutPid = [int](Get-Content -LiteralPath $timeoutPidPath -Raw)
Assert-True ($timeout.ExitCode -ne 0 -and $timeout.Evidence.TimedOut) "timeout is captured as failure"
Assert-True (-not (Get-Process -Id $timeoutPid -ErrorAction SilentlyContinue)) "timeout kills descendant through job only"
Assert-True ($timeout.Evidence.FinalAccounting.ActiveProcesses -eq 0 -and $timeout.Evidence.FinalPidListEmpty) "timeout job drains to empty"

$cancelFile = Join-Path $testRoot "cancel.request"
$cancelScript = Write-Fixture "cancel.ps1" "Start-Sleep -Seconds 30"
$cancelController = Start-Process -FilePath $controller -ArgumentList @('--evidence',(Join-Path $testRoot 'cancel.controller.json'),'--stdout',(Join-Path $testRoot 'cancel.stdout.log'),'--stderr',(Join-Path $testRoot 'cancel.stderr.log'),'--cwd',$repositoryRoot,'--timeout-ms','30000','--cancel-file',$cancelFile,'--','powershell.exe','-NoLogo','-NoProfile','-NonInteractive','-File',$cancelScript) -PassThru -NoNewWindow
Start-Sleep -Milliseconds 500
[IO.File]::WriteAllText($cancelFile, "cancel")
$cancelController.WaitForExit()
$cancelEvidence = Get-Content -LiteralPath (Join-Path $testRoot 'cancel.controller.json') -Raw | ConvertFrom-Json
Assert-True ($cancelController.ExitCode -ne 0 -and $cancelEvidence.Cancelled) "explicit cancellation is captured"
Assert-True ($cancelEvidence.FinalPidListEmpty) "cancelled job drains to empty"

$crashPidPath = Join-Path $testRoot "crash-child.pid"
$crashScript = Write-Fixture "crash.ps1" "[IO.File]::WriteAllText('$($crashPidPath.Replace("'","''"))',[string]`$PID); Start-Sleep -Seconds 30"
$crash = Invoke-Controller "crash" @("--timeout-ms","30000","--test-crash-after-resume") @("powershell.exe","-NoLogo","-NoProfile","-NonInteractive","-File",$crashScript)
Assert-True ($crash.ExitCode -eq 86) "test controller exits abruptly"
Assert-True (Test-Path -LiteralPath $crashPidPath) "crash child ran before abrupt controller exit"
$crashPid = [int](Get-Content -LiteralPath $crashPidPath -Raw)
Start-Sleep -Milliseconds 250
Assert-True (-not (Get-Process -Id $crashPid -ErrorAction SilentlyContinue)) "KILL_ON_JOB_CLOSE removes root after controller crash"

$limitations = [ordered]@{
    SchemaVersion = 1
    NestedJobs = "Environment-limited: the current Codex host job policy is externally owned and cannot be safely reconfigured to manufacture both compatible and incompatible nesting cases; deterministic fail-before-resume injection covers the safety boundary."
    BreakawayNegativeControl = "Not run in this first controller revision: enabling breakaway would intentionally create a process outside the job; Task 15 never kills such an external PID. Production denial is asserted from effective kernel flags and a direct breakaway-attempt test is added before release acceptance."
    BrokerOrWmiEscape = "Outside guarantee by architecture; no broker/WMI escape process is launched or killed."
}
[IO.File]::WriteAllText((Join-Path $testRoot "environment-limitations.json"), ($limitations | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))

"Task 15 native Job controller test: PASS"
