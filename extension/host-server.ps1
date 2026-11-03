param(
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)][int]$Port,
    [int]$PortAttempts = 5,
    [string]$WorkspaceRoot,
    [int]$IdleTimeoutMs = 1800000,
    [int]$DefaultTimeout = 120000,
    [int]$OutputLimit = 65536,
    [int]$TransferTtl = 120000,
    [int]$ChunkBytes = 32768
)
# Foreground loopback TCP helper. It runs visibly in the Host shared terminal
# and exits on Ctrl+C, terminal close, idle timeout or a shutdown request.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') {
    throw 'unsupported_host_platform: This release requires a Windows Host.'
}
if ([string]::IsNullOrWhiteSpace($Token)) {
    throw 'invalid_host_token: A nonempty token is required.'
}
if ($Port -lt 1 -or $Port -gt 65535 -or $PortAttempts -lt 1) {
    throw 'invalid_host_port: Port must be 1..65535 and PortAttempts at least 1.'
}
if ($IdleTimeoutMs -lt 1000) {
    throw 'invalid_idle_timeout: IdleTimeoutMs must be at least 1000.'
}

$script:protocolVersion = 3
$script:requestLimitBytes = 2097152
$script:responseLimitBytes = 4194304
$script:readTimeoutMs = 15000
$script:writeTimeoutMs = 30000
$script:drainTimeoutMs = 2000
$script:utf8 = [Text.UTF8Encoding]::new($false)
$script:strictUtf8 = [Text.UTF8Encoding]::new($false, $true)
$script:tokenBytes = $script:utf8.GetBytes($Token)
$script:pendingAccept = $null
$script:pendingIo = $null

# The only place that knows where the shared core and C# runtime come from.
# The single-file renderer (host-bootstrap.cjs) replaces the marked body with
# the inlined core and an embedded runtime, so nothing is read from disk.
function Import-HostCore {
    #__LSWB_IMPORT_CORE_BEGIN__#
    if (-not ('LswbHostV020.Job' -as [type])) {
        Add-Type -Path (Join-Path $PSScriptRoot 'host-runtime.cs')
    }
    . (Join-Path $PSScriptRoot 'host-core.ps1')
    #__LSWB_IMPORT_CORE_END__#
}

function Resolve-HostRoot([string]$Requested) {
    if ([string]::IsNullOrEmpty($Requested)) {
        $Requested = (Get-Location).ProviderPath
    }
    $resolved = [IO.Path]::GetFullPath($Requested).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
        throw 'host_root_not_found'
    }
    return $resolved
}

function Write-HostLine([string]$Text) {
    [Console]::Out.WriteLine($Text)
    [Console]::Out.Flush()
}

function Get-SocketError($Exception) {
    $current = $Exception
    while ($null -ne $current) {
        if ($current -is [Net.Sockets.SocketException]) {
            return $current.SocketErrorCode.ToString()
        }
        $current = $current.InnerException
    }
    return $null
}

function New-LoopbackListener([int]$Candidate) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Candidate)
    $listener.ExclusiveAddressUse = $true
    try {
        $listener.Start()
        return $listener
    } catch {
        $socketError = Get-SocketError $_.Exception
        if ($socketError -in @('AddressAlreadyInUse', 'AccessDenied')) {
            return $null
        }
        throw
    }
}

function Start-LoopbackListener([int]$FirstPort, [int]$Attempts) {
    for ($offset = 0; $offset -lt $Attempts; $offset++) {
        $candidate = $FirstPort + $offset
        if ($candidate -gt 65535) {
            break
        }
        $listener = New-LoopbackListener $candidate
        if ($null -ne $listener) {
            return $listener
        }
    }
    Fail 'host_port_unavailable' ('No free loopback port from ' + $FirstPort + ' in ' + $Attempts + ' attempts.')
}

function Write-ListeningBanner([int]$ActualPort) {
    $banner = [ordered]@{
        port = $ActualPort
        protocol = $script:protocolVersion
        token = $Token.Substring(0, [Math]::Min(8, $Token.Length))
    }
    $json = ConvertTo-Json -InputObject $banner -Compress
    $culture = [Globalization.CultureInfo]::InvariantCulture
    $minutes = ($IdleTimeoutMs / 60000.0).ToString('0.#', $culture)
    Write-HostLine ('LSWB_LISTENING:' + $json)
    Write-HostLine ('Live Share Workspace Bridge host helper listening on 127.0.0.1:' + $ActualPort + '. Idle exit after ' + $minutes + ' minutes. Press Ctrl+C to stop.')
}

# Short waits keep Ctrl+C responsive: PowerShell stops between statements.
function Wait-TaskUntil($Task, [DateTime]$Deadline) {
    while (-not $Task.Wait(500)) {
        if ([DateTime]::UtcNow -ge $Deadline) {
            return $false
        }
    }
    return $true
}

function Watch-PendingTask($Task) {
    if ($null -eq $Task) {
        return
    }
    try {
        $null = $Task.Wait(1000)
    } catch {
    }
    if ($Task.IsFaulted) {
        $null = $Task.Exception
    }
}

function Read-Chunk($Stream, [byte[]]$Buffer, [DateTime]$Deadline) {
    $task = $Stream.ReadAsync($Buffer, 0, $Buffer.Length)
    $script:pendingIo = $task
    if (-not (Wait-TaskUntil $task $Deadline)) {
        Fail 'request_timeout' 'The request line was not received in time.'
    }
    $script:pendingIo = $null
    return $task.Result
}

function Read-RequestBytes($Stream) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($script:readTimeoutMs)
    $buffer = [byte[]]::new(65536)
    $collected = [IO.MemoryStream]::new()
    try {
        while ($true) {
            $count = Read-Chunk $Stream $buffer $deadline
            if ($count -eq 0) {
                break
            }
            $newline = [Array]::IndexOf($buffer, [byte]10, 0, $count)
            $take = $count
            if ($newline -ge 0) {
                $take = $newline
            }
            if ($collected.Length + $take -gt $script:requestLimitBytes) {
                Fail 'request_limit' 'The request line exceeds 2 MiB.'
            }
            $collected.Write($buffer, 0, $take)
            if ($newline -ge 0) {
                break
            }
        }
        return ,$collected.ToArray()
    } finally {
        $collected.Dispose()
    }
}

function Read-RequestLine($Stream) {
    $bytes = Read-RequestBytes $Stream
    if ($bytes.Length -gt 0 -and $bytes[$bytes.Length - 1] -eq 13) {
        # Resize, not a range slice: 0..-1 would yield two elements.
        $trimmed = [byte[]]$bytes
        [Array]::Resize([ref]$trimmed, $trimmed.Length - 1)
        $bytes = $trimmed
    }
    if ($bytes.Length -eq 0) {
        Fail 'invalid_frame' 'The request line is empty.'
    }
    try {
        return $script:strictUtf8.GetString([byte[]]$bytes)
    } catch {
        Fail 'invalid_frame' 'The request line is not valid UTF-8.'
    }
}

function Test-Token($Candidate) {
    if ($Candidate -isnot [string]) {
        return $false
    }
    $expected = $script:tokenBytes
    $actual = $script:utf8.GetBytes($Candidate)
    $difference = $expected.Length -bxor $actual.Length
    for ($index = 0; $index -lt $expected.Length; $index++) {
        $other = 0
        if ($index -lt $actual.Length) {
            $other = $actual[$index]
        }
        $difference = $difference -bor ($expected[$index] -bxor $other)
    }
    return ($difference -eq 0)
}

function New-Reply($Nonce, $Body) {
    $reply = [ordered]@{}
    if ($null -ne $Nonce) {
        $reply.nonce = $Nonce
    }
    $reply.ok = $Body.ok
    if ($Body.ok) {
        $reply.result = $Body.result
    } else {
        $reply.error = $Body.error
    }
    return $reply
}

function New-ErrorBody([string]$Code, [string]$Message) {
    return @{ok = $false; error = @{code = $Code; message = $Message}}
}

function ConvertFrom-RequestLine([string]$Line) {
    try {
        $request = ConvertFrom-Json -InputObject $Line
    } catch {
        Fail 'invalid_json' 'The request line is not valid JSON.'
    }
    if ($request -isnot [Management.Automation.PSCustomObject]) {
        Fail 'invalid_request' 'The request must be a JSON object.'
    }
    return $request
}

function Assert-RequestShape($Request) {
    $nonce = $Request.nonce
    if ($nonce -isnot [string] -or $nonce -notmatch '^[A-Za-z0-9_-]{1,128}$') {
        Fail 'invalid_request' 'The request needs a nonce of 1..128 letters, digits, - or _.'
    }
    if ($Request.action -isnot [string] -or [string]::IsNullOrEmpty($Request.action)) {
        Fail 'invalid_request' 'The request needs a nonempty action.'
    }
}

function Invoke-HostAction($Request, $Outcome) {
    if ($Request.action -eq 'shutdown') {
        $Outcome.stop = $true
        return @{stopping = $true}
    }
    Assert-InspectionLimit $Request
    $result = Process-Request $Request
    Add-TextStates $Request $result
    if ($Request.action -eq 'hello') {
        $result.transport = 'tcp'
        $result.protocol = $script:protocolVersion
    }
    return $result
}

function Invoke-AuthorizedRequest($Request, $Outcome) {
    $nonce = $Request.nonce
    $Request.PSObject.Properties.Remove('token')
    $Request.PSObject.Properties.Remove('nonce')
    try {
        $result = Invoke-HostAction $Request $Outcome
        return New-Reply $nonce @{ok = $true; result = $result}
    } catch {
        return New-Reply $nonce (Get-ErrorReply $_)
    }
}

function Get-LogText($Value, [int]$Limit) {
    if ($Value -isnot [string] -or $Value.Length -eq 0) {
        return $null
    }
    $clean = $Value -replace '[\x00-\x1f\x7f]', '?'
    if ($clean.Length -gt $Limit) {
        $clean = $clean.Substring(0, $Limit)
    }
    return $clean
}

function Get-LogPath($Value) {
    $text = Get-LogText $Value 120
    if ($null -eq $text -or $text -match '^[\\/]|:') {
        return $null
    }
    return $text
}

function Invoke-ServerRequest([string]$Line, $Outcome) {
    $request = ConvertFrom-RequestLine $Line
    if (-not (Test-Token $request.token)) {
        $body = New-ErrorBody 'host_token_rejected' 'The request token does not match this host helper.'
        $Outcome.reply = New-Reply $null $body
        return
    }
    Assert-RequestShape $request
    $Outcome.action = Get-LogText $request.action 40
    $Outcome.path = Get-LogPath $request.path
    $Outcome.reply = Invoke-AuthorizedRequest $request $Outcome
}

function Write-RequestLog($Outcome) {
    $stamp = [DateTime]::Now.ToString('HH:mm:ss', [Globalization.CultureInfo]::InvariantCulture)
    $status = 'ok'
    if (-not $Outcome.reply.ok) {
        $status = 'error ' + (Get-LogText ([string]$Outcome.reply.error.code) 60)
    }
    $line = '[' + $stamp + '] ' + $Outcome.action + ' ' + $status
    if ($null -ne $Outcome.path) {
        $line += ' ' + $Outcome.path
    }
    Write-HostLine $line
}

function ConvertTo-ResponseBytes($Reply) {
    $json = ConvertTo-Json -InputObject $Reply -Compress -Depth 30
    $bytes = $script:utf8.GetBytes($json + "`n")
    if ($bytes.Length -le $script:responseLimitBytes) {
        return ,$bytes
    }
    $body = New-ErrorBody 'response_limit' 'The Host response exceeds 4 MiB and was not sent.'
    $limited = New-Reply $Reply.nonce $body
    $json = ConvertTo-Json -InputObject $limited -Compress -Depth 30
    return ,$script:utf8.GetBytes($json + "`n")
}

# Read and discard input the client is still sending so Close does not reset
# the connection before the client has read the response.
function Clear-IncomingData($Stream) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($script:drainTimeoutMs)
    $buffer = [byte[]]::new(65536)
    try {
        while ($true) {
            $task = $Stream.ReadAsync($buffer, 0, $buffer.Length)
            $script:pendingIo = $task
            if (-not (Wait-TaskUntil $task $deadline)) {
                return
            }
            $script:pendingIo = $null
            if ($task.Result -eq 0) {
                return
            }
        }
    } catch {
    }
}

function Send-Response($Client, $Stream, [byte[]]$Bytes) {
    $deadline = [DateTime]::UtcNow.AddMilliseconds($script:writeTimeoutMs)
    $task = $Stream.WriteAsync($Bytes, 0, $Bytes.Length)
    $script:pendingIo = $task
    if (-not (Wait-TaskUntil $task $deadline)) {
        Fail 'response_timeout' 'The client did not accept the response in time.'
    }
    $script:pendingIo = $null
    $null = $task.Result
    $Client.Client.Shutdown([Net.Sockets.SocketShutdown]::Send)
    Clear-IncomingData $Stream
}

function Get-ConnectionOutcome($Stream) {
    $outcome = @{reply = $null; stop = $false; action = '-'; path = $null}
    try {
        $line = Read-RequestLine $Stream
        Invoke-ServerRequest $line $outcome
    } catch {
        $outcome.reply = New-Reply $null (Get-ErrorReply $_)
    }
    return $outcome
}

function Invoke-Connection($Client) {
    $stop = $false
    try {
        $stream = $Client.GetStream()
        $outcome = Get-ConnectionOutcome $stream
        $stop = $outcome.stop
        Write-RequestLog $outcome
        Send-Response $Client $stream (ConvertTo-ResponseBytes $outcome.reply)
    } catch {
        [Console]::Error.WriteLine('host_connection_failed: ' + $_.Exception.GetType().Name)
    } finally {
        $Client.Close()
        Watch-PendingTask $script:pendingIo
        $script:pendingIo = $null
    }
    return $stop
}

function Invoke-ServeLoop($Listener) {
    $idleDeadline = [DateTime]::UtcNow.AddMilliseconds($IdleTimeoutMs)
    while ($true) {
        $script:pendingAccept = $Listener.AcceptTcpClientAsync()
        if (-not (Wait-TaskUntil $script:pendingAccept $idleDeadline)) {
            Write-HostLine 'Idle timeout reached; host helper is stopping.'
            return
        }
        $client = $script:pendingAccept.Result
        $script:pendingAccept = $null
        if (Invoke-Connection $client) {
            Write-HostLine 'Shutdown requested; host helper is stopping.'
            return
        }
        $idleDeadline = [DateTime]::UtcNow.AddMilliseconds($IdleTimeoutMs)
    }
}

function Stop-HostServer($Listener) {
    if ($null -ne $Listener) {
        $Listener.Stop()
    }
    Watch-PendingTask $script:pendingAccept
    $script:pendingAccept = $null
    Close-HostResources
    Write-HostLine 'Live Share Workspace Bridge host helper stopped.'
}

. Import-HostCore
$resolvedRoot = Resolve-HostRoot $WorkspaceRoot
$sessionState = @{
    Root = $resolvedRoot
    Jobs = @{}
    Uploads = @{}
    Readers = @{}
    DefaultTimeout = $DefaultTimeout
    OutputLimit = $OutputLimit
    TransferTtl = $TransferTtl
    ChunkBytes = $ChunkBytes
    FunctionName = $null
}
$listener = $null
try {
    $listener = Start-LoopbackListener $Port $PortAttempts
    Write-ListeningBanner $listener.LocalEndpoint.Port
    Invoke-ServeLoop $listener
} finally {
    Stop-HostServer $listener
}
