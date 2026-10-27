param([string]$PipeName, [int]$ParentProcessId = 0, [ValidateSet('ownerOnly','allLocalUsers','selectedUsers')][string]$AccessMode='ownerOnly', [string]$SelectedSidsBase64='W10=', [switch]$ListLocalUsers)
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$parentProcess = if ($ParentProcessId -gt 0) { [Diagnostics.Process]::GetProcessById($ParentProcessId) } else { $null }
Add-Type -Path @((Join-Path $PSScriptRoot 'local-accounts.cs'),(Join-Path $PSScriptRoot 'pipe-security.cs'))
if($ListLocalUsers){[Console]::Out.WriteLine((ConvertTo-Json -InputObject @([LswbIpcV022.LocalAccounts]::Read()) -Compress -Depth 4));exit 0}
$selected=ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($SelectedSidsBase64)))
if($null -eq $selected){$selected=@()}
$localPipe = [LswbIpcV022.LocalPipe]::new($PipeName, $AccessMode, [string[]]$selected)
$pipe = $localPipe.Stream
$shell=@{actualExecutableName='unknown';version=$PSVersionTable.PSVersion.ToString();edition=[string]$PSVersionTable.PSEdition;effectiveExecutionPolicy='unknown';policyScopes=@{}}
try{$shell.actualExecutableName=[IO.Path]::GetFileName([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)}catch{}
# Read once in this already-running helper. This is not an external sandbox probe.
try{$shell.effectiveExecutionPolicy=(Get-ExecutionPolicy).ToString();foreach($policy in @(Get-ExecutionPolicy -List)){$shell.policyScopes[$policy.Scope.ToString()]=$policy.ExecutionPolicy.ToString()}}catch{}
$ready = @{kind='ready';shell=$shell;ipc=@{mode=$localPipe.Mode;allowedUsers=@($localPipe.AllowedUsers);selectionIssues=@($localPipe.SelectionIssues);localOnly=$true;sameWindowsSession=$true}}
[Console]::Out.WriteLine(($ready|ConvertTo-Json -Compress -Depth 4))
[Console]::Out.Flush()
function Wait-Task($Task, [int]$TimeoutMs) {
    $stopAt = if ($TimeoutMs -gt 0) { [DateTime]::UtcNow.AddMilliseconds($TimeoutMs) } else { [DateTime]::MaxValue }
    while (-not $Task.Wait(500)) {
        if ($null -ne $parentProcess -and $parentProcess.HasExited) { exit 0 }
        if ([DateTime]::UtcNow -gt $stopAt) { throw 'ipc_timeout' }
    }
}
while ($true) {
    $reader = $null; $writer = $null
    try {
        Wait-Task ($pipe.WaitForConnectionAsync()) 0
        $writer = [IO.StreamWriter]::new($pipe, $utf8, 4096, $true)
        $writer.AutoFlush = $true
        if (-not $localPipe.ClientIsInSession()) {
            $writer.WriteLine('{"ok":false,"error":{"code":"ipc_client_session_denied","message":"Bridge clients must be in the same Windows session."}}')
            $null=$localPipe.Drain(2000)
            continue
        }
        $readTask = [LswbIpcV022.LocalPipe]::ReadFrameAsync($pipe,2097152)
        Wait-Task $readTask 15000
        $line = $readTask.Result
        if ($null -eq $line -or $line.Length -gt 2097152) { throw 'invalid_frame' }
        try { $null = ConvertFrom-Json -InputObject $line } catch { throw 'invalid_json' }
        [Console]::Out.WriteLine('{"kind":"request","body":' + $line + '}')
        [Console]::Out.Flush()
        $replyTask = [Console]::In.ReadLineAsync()
        try { Wait-Task $replyTask 120000 } catch { [Console]::Error.WriteLine('ipc_dispatch_timeout: request outcome may be unknown'); exit 1 }
        $reply = $replyTask.Result
        if ($null -eq $reply) { exit 0 }
        $writer.WriteLine($reply)
        if (-not $localPipe.Drain(2000)) { [Console]::Error.WriteLine('pipe_client_drain_timeout') }
    } catch {
        [Console]::Error.WriteLine('pipe_connection_failed: ' + $_.Exception.GetType().Name)
    } finally {
        if ($null -ne $writer) { $writer.Dispose() }
        if ($null -ne $reader) { $reader.Dispose() }
        # Hold the sole server handle for the helper's lifetime; no re-creation gap.
        try { $localPipe.Disconnect() } catch { [Console]::Error.WriteLine('pipe_disconnect_failed'); exit 1 }
    }
}
