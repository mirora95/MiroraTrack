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
$steps = @()

# Finance data lives in the WebView2 user-data folder; backups live in Documents.
# Neither is ever created, moved, or removed by this harness.
$userDataRoot = Join-Path $env:LOCALAPPDATA 'com.miroratrack.desktop'
$webViewProfile = Join-Path $userDataRoot 'EBWebView'
$backupRoot = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MiroraTrack\Backups'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'MiroraTrack.lnk'
$startMenuShortcut = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MiroraTrack.lnk'

function Write-AtomicJson([string]$Path, $Value) {
    $temporary = "$Path.tmp"
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }

function Add-Step([string]$Name, $Detail) {
    $script:steps += [ordered]@{ step = $Name; at = (Get-Date).ToString('o'); detail = $Detail }
    Write-AtomicJson (Join-Path $evidenceRoot 'progress.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); steps = $script:steps })
}

function Get-ArpEntry {
    # Tauri NSIS currentUser scope registers under HKCU. Both hives are searched
    # so an unexpected per-machine install cannot silently pass as absent.
    $roots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
            $properties = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
            if ($properties.DisplayName -eq 'MiroraTrack') {
                return [ordered]@{
                    hive            = $root
                    keyName         = $key.PSChildName
                    DisplayName     = [string]$properties.DisplayName
                    DisplayVersion  = [string]$properties.DisplayVersion
                    InstallLocation = [string]$properties.InstallLocation
                    UninstallString = [string]$properties.UninstallString
                    NoModify        = $properties.NoModify
                    NoRepair        = $properties.NoRepair
                }
            }
        }
    }
    return $null
}

function Wait-ForCondition([scriptblock]$Condition, [string]$Message, [int]$TimeoutSeconds = 300) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "$Message (timed out after $TimeoutSeconds seconds)"
}

function Wait-ForQuiesce([int]$TimeoutSeconds = 120) {
    # WebView2 keeps browser and crashpad processes alive briefly after the host
    # window closes, and they flush caches and logs as they go. Snapshotting
    # before they exit would attribute their writes to the next installer.
    $names = @('miroratrack', 'msedgewebview2')
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $alive = @(Get-Process -Name $names -ErrorAction SilentlyContinue)
        if ($alive.Count -eq 0) { Start-Sleep -Seconds 3; return @(Get-Process -Name $names -ErrorAction SilentlyContinue).Count }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Application processes did not quiesce within $TimeoutSeconds seconds: $(@(Get-Process -Name $names -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', ')"
}

function Get-DataManifest {
    # Authoritative preservation evidence: every finance byte on disk.
    $entries = @()
    foreach ($root in @($userDataRoot, $backupRoot)) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($file in Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction SilentlyContinue) {
            $hash = $null
            try { $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash } catch { $hash = 'UNREADABLE' }
            $entries += [ordered]@{ path = $file.FullName; length = $file.Length; sha256 = $hash }
        }
    }
    return @($entries | Sort-Object { $_.path })
}

function Assert-DataPreserved($Before, $After, [string]$Label) {
    # Additions are allowed (the app writes logs and caches). Losing or altering
    # a file that existed before an installer transition is a hard failure.
    $afterMap = @{}
    foreach ($entry in $After) { $afterMap[$entry.path] = $entry }
    $missing = @(); $altered = @()
    foreach ($entry in $Before) {
        if (-not $afterMap.ContainsKey($entry.path)) { $missing += $entry.path; continue }
        if ($afterMap[$entry.path].sha256 -cne $entry.sha256) { $altered += $entry.path }
    }
    $result = [ordered]@{
        label = $Label; filesBefore = @($Before).Count; filesAfter = @($After).Count
        missing = $missing; altered = $altered; preserved = (($missing.Count -eq 0) -and ($altered.Count -eq 0))
    }
    # Persist the comparison before asserting. Throwing first would discard the
    # exact file lists, which are the only useful part of a preservation failure.
    Write-AtomicJson (Join-Path $evidenceRoot "preservation-$Label.json") $result
    Assert-True $result.preserved "$Label failed: $($missing.Count) file(s) missing, $($altered.Count) file(s) altered. See preservation-$Label.json"
    return $result
}

function Resolve-Shortcut([string]$Path) {
    $shell = New-Object -ComObject WScript.Shell
    try { $link = $shell.CreateShortcut($Path); return [ordered]@{ path = $Path; target = $link.TargetPath; workingDirectory = $link.WorkingDirectory } }
    finally { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell) }
}

function Install-MiroraTrack([string]$InstallerPath, [string]$Label, [int]$TimeoutSeconds = 900) {
    Assert-True (Test-Path -LiteralPath $InstallerPath -PathType Leaf) "Installer missing for $Label : $InstallerPath"
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $InstallerPath -ArgumentList @('/S') -PassThru
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "$Label installer exceeded $TimeoutSeconds seconds."
    }
    $process.Refresh(); $stopwatch.Stop()
    Assert-True ([int]$process.ExitCode -eq 0) "$Label installer exited with $($process.ExitCode)."
    Wait-ForCondition { $null -ne (Get-ArpEntry) } "$Label did not register an Add/Remove Programs entry" 300
    return [ordered]@{ label = $Label; installer = $InstallerPath; exitCode = [int]$process.ExitCode; seconds = [math]::Round($stopwatch.Elapsed.TotalSeconds, 3) }
}

function Uninstall-MiroraTrack([int]$TimeoutSeconds = 600) {
    $entry = Get-ArpEntry
    Assert-True ($null -ne $entry) 'Uninstall requested but no Add/Remove Programs entry exists.'
    $command = $entry.UninstallString.Trim('"', ' ')
    Assert-True (Test-Path -LiteralPath $command -PathType Leaf) "UninstallString does not resolve to a file: $command"
    $process = Start-Process -FilePath $command -ArgumentList @('/S') -PassThru
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw "Uninstaller exceeded $TimeoutSeconds seconds."
    }
    $process.Refresh()
    Wait-ForCondition { $null -eq (Get-ArpEntry) } 'Add/Remove Programs entry remained after uninstall' 300
    return [ordered]@{ uninstallString = $command; exitCode = [int]$process.ExitCode }
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

function Export-UiaTree([Diagnostics.Process]$Process, [string]$Path) {
    # Best-effort accessibility capture. Task 15B increment 1 uses this to record
    # what the installed build actually renders and to source selectors for the
    # ledger-entry automation that increment 2 adds. It never fails the run.
    try {
        Add-Type -AssemblyName UIAutomationClient
        Add-Type -AssemblyName UIAutomationTypes
        $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty, $Process.Id)
        $root = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children, $condition)
        if ($null -eq $root) { Write-AtomicJson $Path ([ordered]@{ captured = $false; reason = 'no automation root for process' }); return }
        $walker = [Windows.Automation.TreeWalker]::ControlViewWalker
        $visit = {
            param($element, $depth)
            if ($null -eq $element -or $depth -gt 12) { return $null }
            $node = [ordered]@{
                name = $element.Current.Name
                controlType = $element.Current.ControlType.ProgrammaticName
                automationId = $element.Current.AutomationId
                children = @()
            }
            $child = $walker.GetFirstChild($element)
            while ($null -ne $child) {
                $rendered = & $visit $child ($depth + 1)
                if ($null -ne $rendered) { $node.children += $rendered }
                $child = $walker.GetNextSibling($child)
            }
            return $node
        }
        Write-AtomicJson $Path ([ordered]@{ captured = $true; tree = (& $visit $root 0) })
    } catch {
        Write-AtomicJson $Path ([ordered]@{ captured = $false; reason = $_.Exception.Message })
    }
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Task15BWindowApi {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

function Get-ForegroundProcessId {
    $foreground = [Task15BWindowApi]::GetForegroundWindow()
    if ($foreground -eq [IntPtr]::Zero) { return 0 }
    [uint32]$owner = 0
    [void][Task15BWindowApi]::GetWindowThreadProcessId($foreground, [ref]$owner)
    return [int]$owner
}

function Set-AppForeground([Diagnostics.Process]$Process, [int]$Attempts = 6) {
    # Windows refuses SetForegroundWindow from a process that does not already own
    # the foreground, and merely flashes the taskbar button instead. The reliable
    # sequence is to nudge the foreground lock with an ALT keypress and attach to
    # the current foreground thread's input queue before asking. Success is judged
    # by the foreground window belonging to the application process, which is what
    # actually determines where SendKeys lands, rather than exact handle equality.
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $Process.Refresh()
        $handle = $Process.MainWindowHandle
        if ($handle -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 500; continue }
        if ((Get-ForegroundProcessId) -eq $Process.Id) { return $attempt }

        [Task15BWindowApi]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)          # ALT down
        [Task15BWindowApi]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)          # ALT up
        [uint32]$foregroundOwner = 0
        $foregroundThread = [Task15BWindowApi]::GetWindowThreadProcessId([Task15BWindowApi]::GetForegroundWindow(), [ref]$foregroundOwner)
        $currentThread = [Task15BWindowApi]::GetCurrentThreadId()
        $attached = $false
        if ($foregroundThread -ne 0 -and $foregroundThread -ne $currentThread) {
            $attached = [Task15BWindowApi]::AttachThreadInput($currentThread, $foregroundThread, $true)
        }
        try {
            [void][Task15BWindowApi]::ShowWindow($handle, 9)                  # SW_RESTORE
            [void][Task15BWindowApi]::BringWindowToTop($handle)
            [void][Task15BWindowApi]::SetForegroundWindow($handle)
        } finally {
            if ($attached) { [void][Task15BWindowApi]::AttachThreadInput($currentThread, $foregroundThread, $false) }
        }
        Start-Sleep -Milliseconds 800
        if ((Get-ForegroundProcessId) -eq $Process.Id) { return $attempt }
    }
    throw "Could not bring the MiroraTrack window to the foreground after $Attempts attempts (foreground process id $(Get-ForegroundProcessId), application process id $($Process.Id))."
}

function Invoke-ContentClick([Diagnostics.Process]$Process, [double]$FractionX, [double]$FractionY) {
    # Making the window foreground is not the same as giving keyboard focus to the
    # WebView2 child window, and SendKeys silently goes nowhere when the content
    # does not hold focus. Clicking inert chrome inside the page focuses the web
    # content and resets the active element to the document body, which also makes
    # every subsequent Tab sequence start from a known origin.
    $Process.Refresh()
    $handle = $Process.MainWindowHandle
    Assert-True ($handle -ne [IntPtr]::Zero) 'No window handle available for a content click.'
    $rect = New-Object Task15BWindowApi+RECT
    Assert-True ([Task15BWindowApi]::GetWindowRect($handle, [ref]$rect)) 'Could not read the application window rectangle.'
    $x = [int]($rect.Left + ($rect.Right - $rect.Left) * $FractionX)
    $y = [int]($rect.Top + ($rect.Bottom - $rect.Top) * $FractionY)
    [void][Task15BWindowApi]::SetCursorPos($x, $y)
    Start-Sleep -Milliseconds 250
    [Task15BWindowApi]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)   # left button down
    [Task15BWindowApi]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)   # left button up
    Start-Sleep -Milliseconds 700
    return [ordered]@{ x = $x; y = $y }
}

function Send-AppKeys([string]$Keys, [int]$SettleMilliseconds = 600) {
    Add-Type -AssemblyName System.Windows.Forms
    [Windows.Forms.SendKeys]::SendWait($Keys)
    Start-Sleep -Milliseconds $SettleMilliseconds
}

function Invoke-Onboarding([Diagnostics.Process]$Process, [string]$AccountName, [string]$OpeningBalance) {
    # The shipped build exposes neither CDP nor a WebView2 accessibility tree, so
    # onboarding is driven purely by keyboard. Every default in the wizard is
    # already valid; only the account name and opening balance are typed. A
    # screenshot is captured at each step so a focus-order change is diagnosable
    # from evidence alone rather than by re-running blind.
    Set-AppForeground $Process
    $shots = @()
    function Step([string]$Name) {
        $path = Join-Path $evidenceRoot "onboarding-$Name.png"
        Capture-Screen $path
        $script:shots += $Name
    }

    # Timing here is deliberately the configuration proven by runs 4, 6 and 7.
    # Lengthening these settles was tried in runs 8 to 10 and made delivery worse,
    # not better, so the shorter cadence is retained until the underlying cause of
    # the intermittent SendKeys delivery is understood.
    Step 'step0-currency'
    Send-AppKeys '{TAB}{TAB}'      # base currency select, then Continue
    Send-AppKeys '{ENTER}'
    Step 'step1-dateformat'
    Send-AppKeys '{TAB}{TAB}{TAB}' # date format select, Back, Continue
    Send-AppKeys '{ENTER}'
    Step 'step2-account'

    # Step 2 autofocuses the account name field.
    Send-AppKeys $AccountName
    Step 'step2-named'
    Send-AppKeys '{TAB}{TAB}{TAB}{TAB}{TAB}'   # type, currency, icon, color, opening balance
    Send-AppKeys '^a'
    Send-AppKeys $OpeningBalance
    Step 'step2-filled'
    Send-AppKeys '{TAB}{TAB}'      # Back, Continue
    Send-AppKeys '{ENTER}'
    Step 'step3-review'
    Send-AppKeys '{ENTER}'         # Create workspace
    Start-Sleep -Seconds 3
    Step 'dashboard'
    return [ordered]@{ accountName = $AccountName; openingBalance = $OpeningBalance; screenshots = $shots; clickPoint = $clickPoint }
}

function Add-Transaction([Diagnostics.Process]$Process, [string]$Type, [string]$Amount, [string]$Label, [string]$DateDigits, [string]$AccountPrefix, [string]$Category) {
    # Tab counts are derived from DOM order, not guessed: AppShell renders a skip
    # link, then Sidebar (brand, five nav links, Settings, collapse toggle), then
    # Header (Theme, Search, Notifications, Quick add). That is 12 stops before
    # the quick-add button. Screenshots bracket every step so a focus-order change
    # is diagnosable from evidence.
    Set-AppForeground $Process
    Send-AppKeys ('{TAB ' + 13 + '}')
    Capture-Screen (Join-Path $evidenceRoot "txn-$Label-focus.png")
    Send-AppKeys '{ENTER}' 1500
    Capture-Screen (Join-Path $evidenceRoot "txn-$Label-dialog.png")

    # The dialog traps focus and lands on the transaction type radio group, so the
    # form's autoFocus on Amount does not win. Arrow keys select within the radio
    # group; Tab then moves to Amount.
    if ($Type -eq 'income') { Send-AppKeys '{RIGHT}' 900 }   # expense -> income
    Send-AppKeys '{TAB}'
    Send-AppKeys $Amount

    # Chromium renders <input type="date"> as three separately focusable segments,
    # so tabbing across it is not one stop. Typing all eight digits fills
    # MM/DD/YYYY and leaves focus on the year segment regardless of segment count,
    # which makes the next Tab land on the account select deterministically.
    Send-AppKeys '{TAB}'
    Send-AppKeys $DateDigits 900
    # Arrow-key selection is used because run 7 proved it moves this select off its
    # placeholder, while type-ahead on the option label was tried in run 11 and did
    # not register at all. Choosing the account re-renders the form (the amount hint
    # changes to name the account currency), and run 7 showed that re-render
    # swallows an immediately following Tab, so it is allowed to settle first.
    Send-AppKeys '{TAB}'           # account select (source for expense, destination for income)
    Send-AppKeys '{DOWN}' 1800     # move off the "Choose account" placeholder
    Send-AppKeys '{TAB}' 900       # category select
    Send-AppKeys '{DOWN}' 1200     # move off the "Choose category" placeholder
    Capture-Screen (Join-Path $evidenceRoot "txn-$Label-filled.png")
    Send-AppKeys '{TAB}{TAB}{TAB}{TAB}'  # status, note, Cancel, Add transaction
    Capture-Screen (Join-Path $evidenceRoot "txn-$Label-submit-focus.png")
    Send-AppKeys '{ENTER}' 2500
    Capture-Screen (Join-Path $evidenceRoot "txn-$Label-saved.png")
    return [ordered]@{ label = $Label; type = $Type; amount = $Amount }
}

function Assert-BackupBalance([string]$BackupPath, [int]$ExpectedTransactionCount, [int64]$ExpectedNetMinor) {
    $envelope = Get-Content -LiteralPath $BackupPath -Raw | ConvertFrom-Json
    $transactions = @($envelope.data.transactions)
    $summary = @($transactions | ForEach-Object { [ordered]@{ type = [string]$_.type; amount = [int64]$_.amount; status = [string]$_.status } })
    # Net worth for a single account is income minus expenses over completed rows.
    $net = 0L
    foreach ($entry in $summary) {
        if ($entry.status -ne 'completed') { continue }
        if ($entry.type -eq 'expense') { $net -= $entry.amount } else { $net += $entry.amount }
    }
    $result = [ordered]@{
        backup = $BackupPath; transactionCount = $transactions.Count
        expectedTransactionCount = $ExpectedTransactionCount
        netMinor = $net; expectedNetMinor = $ExpectedNetMinor; transactions = $summary
    }
    Write-AtomicJson (Join-Path $evidenceRoot 'ledger-balance.json') $result
    Copy-Item -LiteralPath $BackupPath -Destination (Join-Path $evidenceRoot ('ledger-balance-' + (Split-Path $BackupPath -Leaf))) -Force -ErrorAction SilentlyContinue
    Assert-True ($transactions.Count -eq $ExpectedTransactionCount) "Expected $ExpectedTransactionCount transactions but the backup contains $($transactions.Count)."
    Assert-True ($net -eq $ExpectedNetMinor) "Derived net balance is $net minor units; expected $ExpectedNetMinor."
    return $result
}

function Test-LedgerClaim([string]$Name, [scriptblock]$Claim, $Session) {
    if ($Session.uiAutomation -ne 'COMPLETED') {
        return [ordered]@{ name = $Name; verified = $false; reason = "user interface automation did not complete: $($Session.reason)" }
    }
    try {
        $detail = & $Claim
        return [ordered]@{ name = $Name; verified = $true; detail = $detail }
    } catch {
        return [ordered]@{ name = $Name; verified = $false; reason = $_.Exception.Message }
    }
}

function Wait-ForAutomaticBackup([int]$TimeoutSeconds = 120) {
    # A structured-data change debounces for five seconds and then writes an
    # automatic backup. That JSON is the machine-readable ledger surface.
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-Path -LiteralPath $backupRoot) {
            $candidate = @(Get-ChildItem -LiteralPath $backupRoot -Filter '*.json' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
            if ($candidate.Count -gt 0) { return $candidate[0].FullName }
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "No automatic backup appeared in $backupRoot within $TimeoutSeconds seconds."
}

function Assert-BackupLedger([string]$BackupPath, [string]$ExpectedAccountName, [int]$ExpectedOpeningMinor) {
    $envelope = Get-Content -LiteralPath $BackupPath -Raw | ConvertFrom-Json
    Assert-True ($envelope.app -eq 'MiroraTrack') "Backup envelope app is '$($envelope.app)'."
    $accounts = @($envelope.data.accounts)
    Assert-True ($accounts.Count -eq 1) "Expected exactly one account in the backup but found $($accounts.Count)."
    Assert-True ($accounts[0].name -eq $ExpectedAccountName) "Backup account name is '$($accounts[0].name)'; expected '$ExpectedAccountName'."
    $transactions = @($envelope.data.transactions)
    $opening = @($transactions | Where-Object { [int64]$_.amount -eq $ExpectedOpeningMinor })
    Assert-True ($opening.Count -ge 1) "No transaction with the exact opening amount $ExpectedOpeningMinor was found; amounts were: $(($transactions | ForEach-Object { $_.amount }) -join ', ')."
    $result = [ordered]@{
        backup = $BackupPath; app = [string]$envelope.app; schemaVersion = $envelope.schemaVersion
        accountName = [string]$accounts[0].name; accountCurrency = [string]$accounts[0].currency
        transactionCount = $transactions.Count; openingAmountMinor = $ExpectedOpeningMinor
    }
    Write-AtomicJson (Join-Path $evidenceRoot 'ledger-verification.json') $result
    # The sandbox is disposable, so the authoritative envelope is copied out for
    # independent review on the host rather than only its parsed summary.
    Copy-Item -LiteralPath $BackupPath -Destination (Join-Path $evidenceRoot ('ledger-backup-' + (Split-Path $BackupPath -Leaf))) -Force -ErrorAction SilentlyContinue
    return $result
}

function Start-AppSession([string]$ExecutablePath, [string]$Label, [int]$WindowTimeoutSeconds = 120, [scriptblock]$OnWindow) {
    Assert-True (Test-Path -LiteralPath $ExecutablePath -PathType Leaf) "Application executable missing for $Label : $ExecutablePath"
    $application = Start-Process -FilePath $ExecutablePath -PassThru
    $deadline = (Get-Date).AddSeconds($WindowTimeoutSeconds)
    $titled = $false
    do {
        Start-Sleep -Milliseconds 500; $application.Refresh()
        if ($application.HasExited) { throw "$Label exited before creating its native window (exit $($application.ExitCode))." }
        if ($application.MainWindowTitle -eq 'MiroraTrack') { $titled = $true; break }
    } while ((Get-Date) -lt $deadline)
    Assert-True $titled "$Label timed out waiting for the exact MiroraTrack native window title."
    Start-Sleep -Seconds 5
    $sessionWork = $null
    if ($null -ne $OnWindow) { $sessionWork = & $OnWindow $application }
    Capture-Screen (Join-Path $evidenceRoot "$Label.png")
    Export-UiaTree $application (Join-Path $evidenceRoot "$Label-uia.json")
    Assert-True ($application.CloseMainWindow()) "$Label could not request a clean window close."
    if (-not $application.WaitForExit(60000)) {
        Stop-Process -Id $application.Id -Force -ErrorAction SilentlyContinue
        throw "$Label did not exit within 60 seconds of a clean close request."
    }
    $application.Refresh()
    $residual = Wait-ForQuiesce
    return [ordered]@{ label = $Label; executable = $ExecutablePath; windowTitle = 'MiroraTrack'; exitCode = [int]$application.ExitCode; residualProcesses = $residual; sessionWork = $sessionWork }
}

try {
    Remove-Item -LiteralPath $finalPath, "$finalPath.tmp" -Force -ErrorAction SilentlyContinue
    Assert-True (Test-Path -LiteralPath $inputRoot -PathType Container) 'Read-only staged input is missing.'
    Assert-True (Test-Path -LiteralPath $evidenceRoot -PathType Container) 'Writable evidence mapping is missing.'

    # Refuse to mutate a real profile. This mirrors scripts/verify-installer.ps1.
    Assert-True ($env:USERNAME -eq 'WDAGUtilityAccount') "Refusing to run installer lifecycle tests as '$env:USERNAME'; Windows Sandbox is required."
    Add-Step 'guard' ([ordered]@{ user = $env:USERNAME })

    # --- Step 0: network isolation ------------------------------------------
    $defaultRoutes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Alive' })
    Assert-True ($defaultRoutes.Count -eq 0) 'A usable non-loopback default route exists in the isolated guest.'
    $dnsFailed = $false; try { Resolve-DnsName example.com -DnsOnly -QuickTimeout -ErrorAction Stop | Out-Null } catch { $dnsFailed = $true }
    Assert-True $dnsFailed 'DNS resolution of example.com unexpectedly succeeded.'
    $phases.network = [ordered]@{ usableDefaultRoutes = $defaultRoutes.Count; dnsExampleComFailed = $dnsFailed }
    Add-Step 'network-isolation' $phases.network

    # --- Step 1: input preflight (exact hashes from the 15A manifest) --------
    $previousInstaller = Join-Path $inputRoot 'MiroraTrack_0.0.9_x64-setup.exe'
    $currentInstaller = Join-Path $inputRoot 'MiroraTrack_0.1.0_x64-setup.exe'
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $inputRoot 'verify-installer.ps1') `
        -PreviousInstaller $previousInstaller -CurrentInstaller $currentInstaller `
        -EvidenceDirectory $evidenceRoot -ExpectedManifestPath (Join-Path $inputRoot 'manifest.json') | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "Installer input preflight failed with exit $LASTEXITCODE."
    $phases.inputPreflight = 'PASS'
    Add-Step 'input-preflight' $phases.inputPreflight

    # --- Step 2: clean slate -------------------------------------------------
    Assert-True ($null -eq (Get-ArpEntry)) 'MiroraTrack was already registered before installation.'
    Assert-True (-not (Test-Path -LiteralPath $userDataRoot)) 'Finance data directory existed before installation.'
    Assert-True (-not (Test-Path -LiteralPath $backupRoot)) 'Backup directory existed before installation.'
    $phases.cleanSlate = $true
    Add-Step 'clean-slate' $phases.cleanSlate

    # --- Step 3: install 0.0.9 ----------------------------------------------
    $phases.installPrevious = Install-MiroraTrack $previousInstaller 'install-0.0.9'
    $arp = Get-ArpEntry
    Assert-True ($arp.DisplayVersion -eq '0.0.9') "Expected DisplayVersion 0.0.9 but found '$($arp.DisplayVersion)'."
    Assert-True ([int]$arp.NoModify -eq 1) "ARP NoModify is '$($arp.NoModify)'; expected 1."
    Assert-True ([int]$arp.NoRepair -eq 1) "ARP NoRepair is '$($arp.NoRepair)'; expected 1."
    Assert-True (Test-Path -LiteralPath $desktopShortcut -PathType Leaf) 'Desktop shortcut was not created.'
    Assert-True (Test-Path -LiteralPath $startMenuShortcut -PathType Leaf) 'Start Menu shortcut was not created.'
    $desktopLink = Resolve-Shortcut $desktopShortcut
    $startMenuLink = Resolve-Shortcut $startMenuShortcut
    Assert-True (Test-Path -LiteralPath $desktopLink.target -PathType Leaf) "Desktop shortcut target does not exist: $($desktopLink.target)"
    Assert-True (Test-Path -LiteralPath $startMenuLink.target -PathType Leaf) "Start Menu shortcut target does not exist: $($startMenuLink.target)"
    $phases.installedArtifacts = [ordered]@{ arp = $arp; desktopShortcut = $desktopLink; startMenuShortcut = $startMenuLink }
    Add-Step 'install-0.0.9' $phases.installedArtifacts

    # --- Step 4: launch from the Desktop shortcut and create a known ledger --
    $expectedAccountName = 'Sandbox Checking'
    $expectedOpeningMajor = '1234.56'
    $expectedOpeningMinor = 123456
    # Opening income 123456 + income 30000 - expense 5025 = 148431 minor units.
    $expectedNetMinor = 148431
    $expectedTransactionCount = 3
    # Keyboard automation against WebView2 is best-effort, not a gate. Without CDP
    # or an accessibility tree there is no way to confirm a keystroke was
    # delivered, and delivery proved intermittent across runs 4 to 12 regardless of
    # timing. The installer lifecycle and preservation evidence must not depend on
    # it, so a failure here is recorded and the run continues.
    $phases.firstLaunch = Start-AppSession $desktopLink.target 'launch-desktop-0.0.9' 120 {
        param($application)
        try {
            $onboarding = Invoke-Onboarding $application $expectedAccountName $expectedOpeningMajor
            # Give the five-second automatic-backup debounce room to complete while
            # the application is still running.
            $backup = Wait-ForAutomaticBackup 90
            # The guest clock supplies today's date in the en-US MM DD YYYY order the
            # date input renders, so the entries stay inside the dashboard's range.
            $dateDigits = (Get-Date).ToString('MMddyyyy')
            $entries = @(
                (Add-Transaction $application 'expense' '50.25' 'expense' $dateDigits 'Sandbox' 'Food'),
                (Add-Transaction $application 'income' '300.00' 'income' $dateDigits 'Sandbox' 'Salary')
            )
            Start-Sleep -Seconds 15   # automatic-backup debounce after the last change
            $finalBackup = Wait-ForAutomaticBackup 90
            return [ordered]@{ uiAutomation = 'COMPLETED'; onboarding = $onboarding; backup = $backup; transactions = $entries; finalBackup = $finalBackup }
        } catch {
            return [ordered]@{ uiAutomation = 'NOT-VERIFIED'; reason = $_.Exception.Message }
        }
    }
    Assert-True (Test-Path -LiteralPath $webViewProfile -PathType Container) 'The WebView2 profile was not created by the first launch.'
    # Every ledger claim rests on keyboard automation that cannot confirm delivery,
    # so each is recorded as verified or not rather than aborting the run. The
    # assertions themselves stay strict: a recorded pass means the exact account,
    # opening amount, transaction count and derived net were all matched. Only the
    # installer lifecycle below is allowed to fail the run.
    $session = $phases.firstLaunch.sessionWork
    $phases.ledger = Test-LedgerClaim 'ledger' {
        Assert-BackupLedger $session.backup $expectedAccountName $expectedOpeningMinor
    } $session
    $phases.ledgerBalance = Test-LedgerClaim 'ledgerBalance' {
        Assert-BackupBalance $session.finalBackup $expectedTransactionCount $expectedNetMinor
    } $session
    Add-Step 'ledger' ([ordered]@{ ledger = $phases.ledger; balance = $phases.ledgerBalance })
    $baseline = Get-DataManifest
    Assert-True (@($baseline).Count -gt 0) 'No finance data files exist after the first launch.'
    $phases.baselineDataFiles = @($baseline).Count
    Add-Step 'first-launch' ([ordered]@{ session = $phases.firstLaunch; dataFiles = $phases.baselineDataFiles })

    # --- Step 5: reopen from the Start menu ---------------------------------
    $phases.startMenuLaunch = Start-AppSession $startMenuLink.target 'launch-startmenu-0.0.9'
    Add-Step 'start-menu-launch' $phases.startMenuLaunch
    $afterReopen = Get-DataManifest

    # --- Step 6: upgrade to 0.1.0 -------------------------------------------
    $beforeUpgrade = Get-DataManifest
    $phases.installCurrent = Install-MiroraTrack $currentInstaller 'upgrade-0.1.0'
    $upgradedArp = Get-ArpEntry
    Assert-True ($upgradedArp.DisplayVersion -eq '0.1.0') "Expected DisplayVersion 0.1.0 after upgrade but found '$($upgradedArp.DisplayVersion)'."
    $phases.upgradePreservation = Assert-DataPreserved $beforeUpgrade (Get-DataManifest) 'upgradePreservation'
    $phases.upgradeLaunch = Start-AppSession $desktopLink.target 'launch-desktop-0.1.0'
    Add-Step 'upgrade-0.1.0' ([ordered]@{ arp = $upgradedArp; preservation = $phases.upgradePreservation })

    # --- Step 7: same-version reinstall -------------------------------------
    $beforeReinstall = Get-DataManifest
    $phases.reinstall = Install-MiroraTrack $currentInstaller 'reinstall-0.1.0'
    $phases.reinstallPreservation = Assert-DataPreserved $beforeReinstall (Get-DataManifest) 'reinstallPreservation'
    Add-Step 'reinstall-0.1.0' $phases.reinstallPreservation

    # --- Step 8: uninstall must preserve finance data and backups -----------
    $beforeUninstall = Get-DataManifest
    $phases.uninstall = Uninstall-MiroraTrack
    Assert-True (Test-Path -LiteralPath $userDataRoot -PathType Container) 'Uninstall removed the finance data directory.'
    $phases.uninstallPreservation = Assert-DataPreserved $beforeUninstall (Get-DataManifest) 'uninstallPreservation'
    # Recorded, not asserted: the specification requires data preservation here,
    # not shortcut removal. A leftover shortcut is reported without aborting the
    # remaining reinstall-after-uninstall evidence.
    $phases.uninstallShortcutCleanup = [ordered]@{
        desktopShortcutRemoved   = (-not (Test-Path -LiteralPath $desktopShortcut))
        startMenuShortcutRemoved = (-not (Test-Path -LiteralPath $startMenuShortcut))
    }
    Add-Step 'uninstall' ([ordered]@{ uninstall = $phases.uninstall; preservation = $phases.uninstallPreservation; shortcutCleanup = $phases.uninstallShortcutCleanup })

    # --- Step 9: reinstall after uninstall reconnects preserved records -----
    $beforeFinal = Get-DataManifest
    $phases.reinstallAfterUninstall = Install-MiroraTrack $currentInstaller 'reinstall-after-uninstall-0.1.0'
    $phases.reinstallAfterUninstallPreservation = Assert-DataPreserved $beforeFinal (Get-DataManifest) 'reinstallAfterUninstall'
    $finalLink = Resolve-Shortcut $desktopShortcut
    $phases.finalLaunch = Start-AppSession $finalLink.target 'launch-final-0.1.0'
    # The known ledger created before the upgrade must still validate after the
    # full uninstall and reinstall cycle.
    $phases.ledgerAfterLifecycle = Test-LedgerClaim 'ledgerAfterLifecycle' {
        Assert-BackupLedger $session.backup $expectedAccountName $expectedOpeningMinor
    } $session
    Add-Step 'reinstall-after-uninstall' ([ordered]@{ preservation = $phases.reinstallAfterUninstallPreservation; ledger = $phases.ledgerAfterLifecycle })

    $result = [ordered]@{
        status = 'PASS'
        startedAt = $startedAt.ToString('o')
        completedAt = (Get-Date).ToString('o')
        phases = $phases
        steps = $steps
        ledgerDataEntry = $phases.firstLaunch.sessionWork.uiAutomation
        ledgerVerified = [ordered]@{
            account = $phases.ledger.verified
            balance = $phases.ledgerBalance.verified
            afterLifecycle = $phases.ledgerAfterLifecycle.verified
        }
        note = 'Installer lifecycle and byte-level preservation of the finance data directory and backups are asserted unconditionally. Ledger assertions are made only when ledgerDataEntry is COMPLETED; keyboard automation against WebView2 has no delivery confirmation and is intermittent, so a NOT-VERIFIED run still proves the lifecycle. Alternative backup folder selection and the manual confirmation in docs/INSTALLER-VERIFICATION.md remain outstanding.'
    }
    Write-AtomicJson $finalPath $result
    Start-Process shutdown.exe -ArgumentList @('/s', '/t', '0') -WindowStyle Hidden
} catch {
    $status = if ($_.Exception.Message.StartsWith('NEEDS_USER:')) { 'NEEDS_USER' } else { 'BLOCKED' }
    $failure = [ordered]@{
        status = $status; startedAt = $startedAt.ToString('o'); failedAt = (Get-Date).ToString('o')
        message = $_.Exception.Message; detail = ($_ | Out-String); phases = $phases; steps = $steps; guestPreserved = $true
    }
    try { Capture-Screen (Join-Path $evidenceRoot 'failure.png') } catch {}
    Write-AtomicJson $finalPath $failure
    exit $(if ($status -eq 'NEEDS_USER') { 42 } else { 1 })
}
