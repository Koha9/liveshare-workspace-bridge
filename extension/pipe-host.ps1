param([Parameter(Mandatory)][string]$PipeName, [int]$ParentProcessId = 0)
$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$announced = $false
$parentProcess = if ($ParentProcessId -gt 0) { [Diagnostics.Process]::GetProcessById($ParentProcessId) } else { $null }
function Wait-Task($Task, [int]$TimeoutMs) {
    $stopAt = if ($TimeoutMs -gt 0) { [DateTime]::UtcNow.AddMilliseconds($TimeoutMs) } else { [DateTime]::MaxValue }
    while (-not $Task.Wait(500)) {
        if ($null -ne $parentProcess -and $parentProcess.HasExited) { exit 0 }
        if ([DateTime]::UtcNow -gt $stopAt) { throw 'ipc_timeout' }
    }
}
while ($true) {
    $pipe = $null
    try {
        if ([Enum]::GetNames([IO.Pipes.PipeOptions]) -contains 'CurrentUserOnly') {
            $options = [IO.Pipes.PipeOptions]::CurrentUserOnly -bor [IO.Pipes.PipeOptions]::Asynchronous
            $pipe = [IO.Pipes.NamedPipeServerStream]::new($PipeName, [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, $options)
        } else {
            # Windows PowerShell 5.1 / .NET Framework: explicit owner-only DACL.
            $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
            $security = [IO.Pipes.PipeSecurity]::new()
            $security.SetAccessRuleProtection($true, $false)
            $security.SetOwner($ownerSid)
            $security.AddAccessRule([IO.Pipes.PipeAccessRule]::new($ownerSid, [IO.Pipes.PipeAccessRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
            $pipe = [IO.Pipes.NamedPipeServerStream]::new($PipeName, [IO.Pipes.PipeDirection]::InOut, 1, [IO.Pipes.PipeTransmissionMode]::Byte, [IO.Pipes.PipeOptions]::Asynchronous, 4096, 4096, $security)
        }
        if (-not $announced) {
            [Console]::Out.WriteLine('{"kind":"ready"}')
            [Console]::Out.Flush()
            $announced = $true
        }
        Wait-Task ($pipe.WaitForConnectionAsync()) 0
        $reader = [IO.StreamReader]::new($pipe, $utf8, $false, 4096, $true)
        $writer = [IO.StreamWriter]::new($pipe, $utf8, 4096, $true)
        $writer.AutoFlush = $true
        $readTask = $reader.ReadLineAsync()
        Wait-Task $readTask 15000
        $line = $readTask.Result
        if ($null -eq $line -or $line.Length -gt 2097152) { throw 'invalid_frame' }
        try { $null = ConvertFrom-Json -InputObject $line } catch { throw 'invalid_json' }
        [Console]::Out.WriteLine('{"kind":"request","body":' + $line + '}')
        [Console]::Out.Flush()
        $replyTask = [Console]::In.ReadLineAsync()
        Wait-Task $replyTask 120000
        $reply = $replyTask.Result
        if ($null -eq $reply) { exit 0 }
        $writer.WriteLine($reply)
        $writer.Dispose()
        $reader.Dispose()
    } catch {
        [Console]::Error.WriteLine('pipe_connection_failed: ' + $_.Exception.GetType().Name)
    } finally {
        if ($null -ne $pipe) { $pipe.Dispose() }
    }
}
