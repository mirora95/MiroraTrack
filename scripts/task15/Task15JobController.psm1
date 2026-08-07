Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Task15PeMachine([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $reader = [IO.BinaryReader]::new($stream)
        $stream.Position = 0x3c
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x4550) { throw "Not a PE file: $Path" }
        return ("0x{0:X4}" -f $reader.ReadUInt16())
    }
    finally { $stream.Dispose() }
}

function Get-Task15ControllerSourceHash([string]$ProjectRoot) {
    $lines = foreach ($path in @(Get-ChildItem -LiteralPath $ProjectRoot -File -Recurse | Where-Object Name -in @("Cargo.toml", "Cargo.lock", "main.rs") | Sort-Object FullName)) {
        "$($path.FullName.Substring($ProjectRoot.Length + 1).Replace('\','/'))`0$((Get-FileHash -LiteralPath $path.FullName -Algorithm SHA256).Hash)"
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join "`n")))).Replace("-", "")) }
    finally { $sha.Dispose() }
}

function Initialize-Task15JobController {
    param([Parameter(Mandatory)][string]$RepositoryRoot)
    $root = [IO.Path]::GetFullPath($RepositoryRoot).TrimEnd('\')
    $projectRoot = Join-Path $root "scripts\task15\native-controller"
    $manifest = Join-Path $projectRoot "Cargo.toml"
    $lock = Join-Path $projectRoot "Cargo.lock"
    $targetRoot = Join-Path $root "work\toolchain\task15-job-controller\target"
    $binary = Join-Path $targetRoot "x86_64-pc-windows-msvc\release\task15-job-controller.exe"
    $bootstrapEvidence = Join-Path $root "work\toolchain\task15-job-controller\bootstrap.json"
    $nativeToolchain = Join-Path $root "work\toolchain\Invoke-Task13bNative.ps1"
    if (-not (Test-Path -LiteralPath $lock -PathType Leaf)) { throw "Controller Cargo.lock is missing: $lock" }
    $sourceHash = Get-Task15ControllerSourceHash -ProjectRoot $projectRoot
    $mustBuild = -not (Test-Path -LiteralPath $binary -PathType Leaf)
    if (-not $mustBuild -and (Test-Path -LiteralPath $bootstrapEvidence -PathType Leaf)) {
        $prior = Get-Content -LiteralPath $bootstrapEvidence -Raw | ConvertFrom-Json
        $mustBuild = [string]$prior.SourceSha256 -cne $sourceHash -or [string]$prior.BinarySha256 -cne (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
    }
    elseif (-not $mustBuild) { $mustBuild = $true }
    if ($mustBuild) {
        New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null
        & powershell.exe -NoLogo -NoProfile -NonInteractive -File $nativeToolchain cargo build --offline --locked --release --target x86_64-pc-windows-msvc --target-dir $targetRoot --manifest-path $manifest
        if ($LASTEXITCODE -ne 0) { throw "Native controller bootstrap build failed with exit $LASTEXITCODE." }
    }
    $rust = (& rustc -Vv | Out-String)
    $cargo = (& cargo -V | Out-String).Trim()
    $hostLine = @($rust -split "`r?`n" | Where-Object { $_ -match '^host:\s+' })[0]
    $identity = [ordered]@{
        SchemaVersion = 1
        BootstrapScope = "Controller compilation only; outside claimed Task15 Gate/Build containment"
        ProjectPath = $projectRoot
        SourceSha256 = $sourceHash
        CargoLockSha256 = (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash
        RustVersion = (@($rust -split "`r?`n")[0]).Trim()
        RustHost = ($hostLine -replace '^host:\s+', '').Trim()
        CargoVersion = $cargo
        Target = "x86_64-pc-windows-msvc"
        BinaryPath = $binary
        BinarySha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash
        PeMachine = Get-Task15PeMachine -Path $binary
        ValidatedAt = (Get-Date).ToString("o")
    }
    if ($identity.RustHost -cne "x86_64-pc-windows-msvc" -or $identity.PeMachine -cne "0x8664") { throw "Native controller architecture validation failed." }
    [IO.File]::WriteAllText($bootstrapEvidence, ($identity | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    return [pscustomobject]$identity
}

Export-ModuleMember -Function Initialize-Task15JobController
