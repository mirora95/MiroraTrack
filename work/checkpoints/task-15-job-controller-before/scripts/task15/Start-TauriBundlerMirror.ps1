param(
    [Parameter(Mandatory = $true)][string] $SpecificationsPath,
    [Parameter(Mandatory = $true)][string] $ReadyPath,
    [Parameter(Mandatory = $true)][string] $RequestLogPath,
    [Parameter(Mandatory = $true)][string] $StopPath
)

$ErrorActionPreference = "Stop"
$modulePath = Join-Path $PSScriptRoot "TauriBundlerMirror.psm1"
Import-Module -Name $modulePath -Force
$parsedSpecifications = Get-Content -LiteralPath $SpecificationsPath -Raw | ConvertFrom-Json
$specifications = @($parsedSpecifications | ForEach-Object { $_ })
if ($specifications.Count -ne 2) { throw "Mirror requires exactly two approved specifications." }
foreach ($specification in $specifications) {
    Assert-TauriAssetFile -Path $specification.LocalPath -Specification $specification
}

function Write-Utf8NoBom([string] $Path, [string] $Text) {
    [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Write-Response($Stream, [int] $Status, [string] $Reason, [byte[]] $Body, [string] $ContentType) {
    $header = "HTTP/1.1 $Status $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if ($Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
try {
    $endpoint = [Net.IPEndPoint] $listener.LocalEndpoint
    Write-Utf8NoBom $ReadyPath ([ordered]@{
        Pid = $PID
        Address = "127.0.0.1"
        Port = $endpoint.Port
        ApprovedPaths = @($specifications | ForEach-Object MirrorPath)
    } | ConvertTo-Json -Depth 4)

    while (-not (Test-Path -LiteralPath $StopPath)) {
        if (-not $listener.Pending()) { Start-Sleep -Milliseconds 50; continue }
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
            $requestLine = $reader.ReadLine()
            $headers = [ordered]@{}
            while ($null -ne ($line = $reader.ReadLine()) -and $line.Length -gt 0) {
                $colon = $line.IndexOf(":")
                if ($colon -gt 0) { $headers[$line.Substring(0, $colon)] = $line.Substring($colon + 1).Trim() }
            }
            $status = 404
            $rawPath = ""
            $bytesServed = 0
            if ($requestLine -match '^GET ([^ ]+) HTTP/1\.[01]$') {
                $rawPath = $Matches[1]
                try {
                    $specification = Resolve-TauriMirrorRequest -RawPath $rawPath -Specifications $specifications
                    $body = [IO.File]::ReadAllBytes($specification.LocalPath)
                    Write-Response $stream 200 "OK" $body "application/octet-stream"
                    $status = 200
                    $bytesServed = $body.Length
                }
                catch {
                    $body = [Text.Encoding]::UTF8.GetBytes("Not Found")
                    Write-Response $stream 404 "Not Found" $body "text/plain"
                }
            }
            else {
                $body = [Text.Encoding]::UTF8.GetBytes("Bad Request")
                Write-Response $stream 400 "Bad Request" $body "text/plain"
                $status = 400
            }
            $entry = [ordered]@{
                Timestamp = (Get-Date).ToString("o")
                Remote = $client.Client.RemoteEndPoint.ToString()
                RequestLine = $requestLine
                RawPath = $rawPath
                Headers = $headers
                Status = $status
                BytesServed = $bytesServed
            } | ConvertTo-Json -Compress
            [IO.File]::AppendAllText($RequestLogPath, $entry + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
        }
        finally { $client.Dispose() }
    }
}
finally { $listener.Stop() }
