[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$ApplicationProcessId,
    [string]$RequestPath = 'C:\MTEvidence\dialog-request.json',
    [string]$ResponsePath = 'C:\MTEvidence\dialog-response.json'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms

function Write-AtomicJson([string]$Path, $Value) {
    $temp = "$Path.tmp"
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination $Path -Force
}

function Descendant-Pids([int]$RootPid) {
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($RootPid)
    do {
        $added = $false
        foreach ($process in Get-CimInstance Win32_Process) {
            if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) { $added = $true }
        }
    } while ($added)
    return $ids
}

function Find-Dialog([datetime]$Deadline) {
    while ((Get-Date) -lt $Deadline) {
        $pids = Descendant-Pids $ApplicationProcessId
        $windows = [Windows.Automation.AutomationElement]::RootElement.FindAll(
            [Windows.Automation.TreeScope]::Children,
            [Windows.Automation.Condition]::TrueCondition
        )
        foreach ($window in $windows) {
            if ($pids.Contains($window.Current.ProcessId) -and
                $window.Current.ControlType -eq [Windows.Automation.ControlType]::Window -and
                $window.Current.ClassName -eq '#32770') { return $window }
        }
        Start-Sleep -Milliseconds 200
    }
    throw 'Timed out waiting for the native Windows file dialog.'
}

function Find-One($Root, [Windows.Automation.ControlType]$Type, [string[]]$Names, [string[]]$AutomationIds = @()) {
    $elements = $Root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
    foreach ($element in $elements) {
        if ($element.Current.ControlType -ne $Type) { continue }
        if ($Names -contains $element.Current.Name -or $AutomationIds -contains $element.Current.AutomationId) { return $element }
    }
    return $null
}

function Set-EditValue($Edit, [string]$Value) {
    if (-not $Edit.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        throw "The exact file-name edit control does not expose ValuePattern."
    }
    $pattern.SetValue($Value)
}

function Invoke-Button($Button) {
    if (-not $Button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        throw "The exact dialog button '$($Button.Current.Name)' does not expose InvokePattern."
    }
    $pattern.Invoke()
}

$lastId = ''
while (Get-Process -Id $ApplicationProcessId -ErrorAction SilentlyContinue) {
    if (-not (Test-Path -LiteralPath $RequestPath)) { Start-Sleep -Milliseconds 150; continue }
    try { $request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json } catch { Start-Sleep -Milliseconds 100; continue }
    if ([string]::IsNullOrWhiteSpace($request.id) -or $request.id -eq $lastId) { Start-Sleep -Milliseconds 100; continue }
    $lastId = [string]$request.id
    $response = [ordered]@{ id=$lastId; status='failed'; kind=$request.kind; target=$request.target; timestamp=(Get-Date).ToString('o') }
    try {
        $dialog = Find-Dialog (Get-Date).AddSeconds(30)
        $dialog.SetFocus()
        if ($request.kind -eq 'folder') {
            [Windows.Forms.SendKeys]::SendWait('^l')
            Start-Sleep -Milliseconds 250
            [Windows.Forms.SendKeys]::SendWait([string]$request.target)
            [Windows.Forms.SendKeys]::SendWait('{ENTER}')
            Start-Sleep -Milliseconds 500
            $button = Find-One $dialog ([Windows.Automation.ControlType]::Button) @('Select Folder','Select folder','Choose this folder','OK')
        } elseif ($request.kind -in @('save','open')) {
            $edit = Find-One $dialog ([Windows.Automation.ControlType]::Edit) @('File name:','File name') @('1001','FileNameControlHost')
            if (-not $edit) { throw 'The exact native file-name edit control was not found.' }
            Set-EditValue $edit ([string]$request.target)
            $buttonNames = if ($request.kind -eq 'save') { @('Save') } else { @('Open') }
            $button = Find-One $dialog ([Windows.Automation.ControlType]::Button) $buttonNames @('1')
        } else {
            throw "Unknown dialog request kind '$($request.kind)'."
        }
        if (-not $button) { throw "The exact native dialog confirmation control for '$($request.kind)' was not found." }
        Invoke-Button $button
        $response.status = 'completed'
        $response.dialogTitle = $dialog.Current.Name
        $response.button = $button.Current.Name
    } catch {
        $response.error = $_.Exception.Message
    }
    Write-AtomicJson $ResponsePath $response
}
