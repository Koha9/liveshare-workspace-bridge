param([string]$FunctionName, [string]$WorkspaceRoot, [int]$DefaultTimeout = 120000, [int]$OutputLimit = 65536, [int]$TransferTtl = 120000, [int]$ChunkBytes = 32768)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'unsupported_host_platform: This release requires a Windows Host.' }
if ($FunctionName -notmatch '^Invoke_Lswb_[a-f0-9]{32}$') { throw 'invalid_host_function' }
if (-not ('LswbHostV020.Job' -as [type])) {
    $runtimeSource = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__RUNTIME_BASE64__'))
    Add-Type -TypeDefinition $runtimeSource -Language CSharp
}
$resolvedRoot = [IO.Path]::GetFullPath($WorkspaceRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
if (-not (Test-Path -LiteralPath $resolvedRoot -PathType Container)) { throw 'host_root_not_found' }
$sessionState = @{ Root=$resolvedRoot; Jobs=@{}; Uploads=@{}; Readers=@{}; DefaultTimeout=$DefaultTimeout; OutputLimit=$OutputLimit; TransferTtl=$TransferTtl; ChunkBytes=$ChunkBytes; FunctionName=$FunctionName }
$handler = {
    param([string]$Payload, [string]$Nonce, [switch]$ReadInput)
    $ErrorActionPreference = 'Stop'
    function Fail([string]$Code, [string]$Message) { throw ($Code + ': ' + $Message) }
    function Resolve-BridgePath([string]$Relative, [bool]$AllowRoot = $false) {
        if (([string]::IsNullOrEmpty($Relative) -and -not $AllowRoot) -or $Relative -match '^[\\/]|[:\x00-\x1f]' -or $Relative.Contains('\')) { Fail 'invalid_path' 'Use a workspace-relative path with forward slashes.' }
        $parts = @($Relative.Split('/') | Where-Object {$_ -ne ''})
        if (@($parts | Where-Object {$_ -in @('..','.','.git')}).Count) { Fail 'outside_workspace' 'Dot segments and Git administration paths are not allowed.' }
        $full = [IO.Path]::GetFullPath((Join-Path $sessionState.Root $Relative))
        if (-not ($full -eq $sessionState.Root -or $full.StartsWith($sessionState.Root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase))) { Fail 'outside_workspace' 'Path escapes the bound Host root.' }
        $current = $sessionState.Root
        foreach($part in $parts) {
            $current = Join-Path $current $part
            if (Test-Path -LiteralPath $current) {
                if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { Fail 'reparse_point' 'Reparse points below the workspace root are not followed.' }
            }
        }
        return $full
    }
    function Ensure-Parent([string]$Filename, [bool]$Create) {
        $parent = [IO.Path]::GetDirectoryName($Filename)
        if (-not [IO.Directory]::Exists($parent)) { if (-not $Create) { Fail 'parent_missing' 'Parent directory does not exist.' }; $null=[IO.Directory]::CreateDirectory($parent) }
    }
    function Resolve-Executable([string]$Name) {
        $command = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command) { return $command.Source }
        return $null
    }
    function Resolve-Ripgrep {
        $direct=Resolve-Executable 'rg.exe'; if ($direct) {return $direct}
        foreach($code in @(Get-Process -Name Code -ErrorAction SilentlyContinue | ForEach-Object {$_.Path} | Where-Object {$_} | Select-Object -Unique)) {
            $base=Split-Path -Parent $code; $bases=@($base)
            $bases+=@(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | Where-Object {$_.Name -match '^[0-9a-f]{10,40}$'} | ForEach-Object {$_.FullName})
            foreach($candidateBase in $bases) {
                foreach($relative in @('resources/app/node_modules/@vscode/ripgrep/bin/rg.exe','resources/app/node_modules.asar.unpacked/@vscode/ripgrep/bin/rg.exe','resources/app/node_modules/@vscode/ripgrep-universal/bin/rg.exe','resources/app/node_modules.asar.unpacked/@vscode/ripgrep-universal/bin/rg.exe')) {
                    $candidate=Join-Path $candidateBase $relative; if (Test-Path -LiteralPath $candidate -PathType Leaf) {return $candidate}
                }
            }
        }
        Fail 'host_ripgrep_missing' 'Install ripgrep on the Host or use a Host VS Code installation that includes it.'
    }
    function Invoke-Native([string]$Executable, [string[]]$Arguments, [string]$Directory = $sessionState.Root, [int]$Timeout = 30000) {
        $job=[LswbHostV020.Job]::new($Executable,$Arguments,$Directory,$Timeout,$sessionState.OutputLimit)
        try { $snapshot=$job.Snapshot($Timeout+2000,0,0); return $snapshot } finally {$job.Dispose()}
    }
    function Check-Tree([string]$Root) {
        $pending=[Collections.Generic.Stack[string]]::new(); $pending.Push($Root)
        while($pending.Count) {
            $directory=$pending.Pop()
            foreach($entry in [IO.Directory]::EnumerateFileSystemEntries($directory)) {
                $attributes=[IO.File]::GetAttributes($entry)
                if ($attributes -band [IO.FileAttributes]::ReparsePoint) { Fail 'reparse_point' 'Directory copies do not follow reparse points.' }
                if ([IO.Path]::GetFileName($entry) -eq '.git') { Fail 'git_metadata' 'Directory copies do not copy Git administration directories.' }
                if ($attributes -band [IO.FileAttributes]::Directory) {$pending.Push($entry)}
            }
        }
    }
    function Relative-Result([string]$Path) {
        $full=[IO.Path]::GetFullPath((Join-Path $sessionState.Root $Path))
        if (-not $full.StartsWith($sessionState.Root+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { Fail 'outside_workspace' 'Search returned a path outside the bound root.' }
        return $full.Substring($sessionState.Root.Length+1).Replace('\','/')
    }
    function Process-Request($request) {
        switch ($request.action) {
            'hello' {
                $readInput=$false;try{$null=[Console]::KeyAvailable;$readInput=-not[Console]::IsInputRedirected}catch{}
                return @{root=$sessionState.Root;platform='windows';powershell=$PSVersionTable.PSVersion.ToString();protocol=2;functionName=$sessionState.FunctionName;chunkBytes=$sessionState.ChunkBytes;noEchoInput=$readInput}
            }
            'search' {
                $rg=Resolve-Ripgrep; $arguments=[Collections.Generic.List[string]]::new()
                foreach($arg in @('--json','--line-number','--encoding','utf-8','--glob','!**/.git/**')) {$arguments.Add($arg)}
                if (-not $request.regex) {$arguments.Add('--fixed-strings')}
                if (-not $request.caseSensitive) {$arguments.Add('--ignore-case')}
                if ($request.wholeWord) {$arguments.Add('--word-regexp')}
                if ($request.useExcludes -eq $false) {$arguments.Add('--hidden');$arguments.Add('--no-ignore')}
                foreach($glob in @($request.include)) {if($glob){$arguments.Add('--glob');$arguments.Add([string]$glob)}}
                foreach($glob in @($request.exclude)) {if($glob){$arguments.Add('--glob');$arguments.Add('!'+[string]$glob)}}
                $arguments.Add('--');$arguments.Add([string]$request.query);$arguments.Add('.')
                $run=Invoke-Native $rg $arguments.ToArray()
                $matches=[Collections.Generic.List[object]]::new();$parseErrors=0
                foreach($line in $run.stdout.Split("`n")) {
                    if (-not $line.Trim()) {continue}
                    try {$item=$line|ConvertFrom-Json} catch {$parseErrors++;continue}
                    if($item.type -eq 'match') {
                        if(-not $item.data.path.text -or $null -eq $item.data.lines.text){$parseErrors++;continue}
                        $matches.Add(@{path=(Relative-Result $item.data.path.text);line=$item.data.line_number;text=$item.data.lines.text;submatches=@($item.data.submatches|ForEach-Object{@{startByte=$_.start;endByte=$_.end}})})
                    }
                }
                $limit=[int]$request.limit; $limited=$matches.Count -gt $limit
                return @{matches=@($matches.ToArray()|Select-Object -First $limit);exitCode=$run.exitCode;state=$run.state;stderr=$run.stderr;truncated=($run.stdoutTruncated -or $run.stderrTruncated -or $limited);parseErrors=$parseErrors;complete=($run.state -eq 'completed' -and $run.exitCode -in @(0,1) -and -not $run.stdoutTruncated -and -not $run.stderrTruncated -and -not $limited -and $parseErrors -eq 0);scope='saved_host_files'}
            }
            'findFiles' {
                $rg=Resolve-Ripgrep;$arguments=[Collections.Generic.List[string]]::new()
                foreach($arg in @('--files','--glob','!**/.git/**')){$arguments.Add($arg)}
                if($request.useExcludes -eq $false){$arguments.Add('--hidden');$arguments.Add('--no-ignore')}
                foreach($glob in @($request.include)){if($glob){$arguments.Add('--glob');$arguments.Add([string]$glob)}}
                foreach($glob in @($request.exclude)){if($glob){$arguments.Add('--glob');$arguments.Add('!'+[string]$glob)}}
                $arguments.Add('.')
                $run=Invoke-Native $rg $arguments.ToArray();$files=@($run.stdout.Split("`n")|Where-Object{$_.Trim()}|ForEach-Object{Relative-Result $_.TrimEnd("`r")});$limited=$files.Count -gt [int]$request.limit
                return @{files=@($files|Select-Object -First ([int]$request.limit));exitCode=$run.exitCode;state=$run.state;stderr=$run.stderr;truncated=($run.stdoutTruncated -or $limited);complete=($run.state -eq 'completed' -and $run.exitCode -in @(0,1) -and -not $run.stdoutTruncated -and -not $run.stderrTruncated -and -not $limited);scope='saved_host_files'}
            }
            'stat' {
                $filename=Resolve-BridgePath $request.path $true;$item=Get-Item -LiteralPath $filename -Force
                $result=@{directory=$item.PSIsContainer;size=$(if($item.PSIsContainer){$null}else{$item.Length});mtime=$item.LastWriteTimeUtc.ToString('o');ctime=$item.CreationTimeUtc.ToString('o')}
                if($request.withHash -and -not $item.PSIsContainer){$result.sha256=[LswbHostV020.Util]::HashFile($filename)}
                return $result
            }
            'copyFile' {
                $from=Resolve-BridgePath $request.path;$to=Resolve-BridgePath $request.to
                if(-not [IO.File]::Exists($from)){Fail 'not_a_file' 'Source must be a file.'}
                Ensure-Parent $to ($request.parents -ne $false)
                [IO.File]::Copy($from,$to,($request.overwrite -eq $true));return @{copied=$true;bytes=([IO.FileInfo]::new($to)).Length}
            }
            'copyDirectory' {
                $from=Resolve-BridgePath $request.path;$to=Resolve-BridgePath $request.to
                if(-not [IO.Directory]::Exists($from)){Fail 'not_a_directory' 'Source must be a directory.'}
                if($from -eq $to -or $to.StartsWith($from+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){Fail 'invalid_destination' 'Destination must not be the source or its descendant.'}
                if(Test-Path -LiteralPath $to){Fail 'destination_exists' 'Directory copy requires a new destination; no implicit merge or recursive replacement.'}
                Check-Tree $from;Ensure-Parent $to ($request.parents -ne $false)
                Copy-Item -LiteralPath $from -Destination $to -Recurse -Force
                return @{copied=$true;partialFailurePossible=$true}
            }
            'readBytes' {
                $filename=Resolve-BridgePath $request.path
                $stream=[IO.File]::Open($filename,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
                try {
                    if($stream.Length -gt $sessionState.ChunkBytes){Fail 'transfer_required' 'Use a chunked download for this file.'}
                    $bytes=[byte[]]::new([int]$stream.Length);$read=0
                    while($read -lt $bytes.Length){$n=$stream.Read($bytes,$read,$bytes.Length-$read);if($n -eq 0){throw 'Unexpected end of file'};$read+=$n}
                    $sha=[Security.Cryptography.SHA256]::Create();try{$hash=[LswbHostV020.Util]::Hex($sha.ComputeHash($bytes))}finally{$sha.Dispose()}
                    return @{base64=[Convert]::ToBase64String($bytes);bytes=$bytes.Length;sha256=$hash}
                } finally {$stream.Dispose()}
            }
            'beginWrite' {
                $filename=Resolve-BridgePath $request.path
                if([IO.Directory]::Exists($filename)){Fail 'not_a_file' 'Destination is a directory.'}
                if([IO.File]::Exists($filename) -and -not $request.overwrite){Fail 'destination_exists' 'Destination already exists.'}
                if([IO.File]::Exists($filename) -and $request.overwrite -and [string]$request.expectedCurrentSha256 -notmatch '^[a-fA-F0-9]{64}$'){Fail 'overwrite_guard_required' 'Existing byte targets require expectedCurrentSha256 from an explicit raw-byte read or hash.'}
                if([long]$request.size -lt 0){Fail 'invalid_size' 'Size must be nonnegative.'}
                foreach($key in @($sessionState.Uploads.Keys)){if($sessionState.Uploads[$key].stream.Closed){$sessionState.Uploads.Remove($key)}}
                if($sessionState.Uploads.Count -ge 16){Fail 'transfer_limit' 'Close or abort an existing upload first.'}
                $id=[Guid]::NewGuid().ToString('N');$upload=[LswbHostV020.Upload]::new([long]$request.size,$sessionState.TransferTtl)
                $sessionState.Uploads[$id]=@{stream=$upload;path=$filename;overwrite=($request.overwrite -eq $true);expectedCurrent=$request.expectedCurrentSha256;parents=($request.parents -ne $false)}
                return @{transferId=$id;chunkBytes=$sessionState.ChunkBytes;size=[long]$request.size}
            }
            'writeBytes' {
                $filename=Resolve-BridgePath $request.path;$bytes=[Convert]::FromBase64String([string]$request.base64)
                if($bytes.Length -gt $sessionState.ChunkBytes){Fail 'chunk_limit' 'Use a chunked upload for this file.'}
                if([IO.Directory]::Exists($filename)){Fail 'not_a_file' 'Destination is a directory.'}
                if([IO.File]::Exists($filename) -and -not $request.overwrite){Fail 'destination_exists' 'Destination already exists.'}
                if([IO.File]::Exists($filename) -and $request.overwrite -and [string]$request.expectedCurrentSha256 -notmatch '^[a-fA-F0-9]{64}$'){Fail 'overwrite_guard_required' 'Existing byte targets require expectedCurrentSha256.'}
                Ensure-Parent $filename ($request.parents -ne $false)
                $upload=[LswbHostV020.Upload]::new($bytes.Length,$sessionState.TransferTtl)
                try {$null=$upload.Append(0,[string]$request.base64);$hash=$upload.Commit($filename,($request.overwrite -eq $true),[string]$request.expectedCurrentSha256,[string]$request.sha256);return @{written=$true;bytes=$bytes.Length;sha256=$hash}}finally{$upload.Dispose()}
            }
            'writeChunk' {
                $entry=$sessionState.Uploads[$request.transferId];if(-not $entry){Fail 'transfer_not_found' 'Upload is unavailable.'}
                $bytes=[Convert]::FromBase64String([string]$request.base64);if($bytes.Length -gt $sessionState.ChunkBytes){Fail 'chunk_limit' 'Chunk exceeds configured size.'}
                return @{bytesReceived=$entry.stream.Append([int]$request.sequence,[string]$request.base64)}
            }
            'commitWrite' {
                $entry=$sessionState.Uploads[$request.transferId];if(-not $entry){Fail 'transfer_not_found' 'Upload is unavailable.'}
                $null=Resolve-BridgePath $request.path
                Ensure-Parent $entry.path $entry.parents
                $hash=$entry.stream.Commit($entry.path,$entry.overwrite,[string]$entry.expectedCurrent,[string]$request.sha256)
                $sessionState.Uploads.Remove($request.transferId);return @{written=$true;sha256=$hash}
            }
            'openRead' {
                foreach($key in @($sessionState.Readers.Keys)){if($sessionState.Readers[$key].Closed){$sessionState.Readers.Remove($key)}}
                if($sessionState.Readers.Count -ge 16){Fail 'transfer_limit' 'Close an existing download first.'}
                $filename=Resolve-BridgePath $request.path;$id=[Guid]::NewGuid().ToString('N');$reader=[LswbHostV020.Download]::new($filename,$sessionState.TransferTtl);$sessionState.Readers[$id]=$reader
                return @{transferId=$id;size=$reader.Size;chunkBytes=$sessionState.ChunkBytes}
            }
            'readChunk' {
                $entry=$sessionState.Readers[$request.transferId];if(-not $entry){Fail 'transfer_not_found' 'Download is unavailable.'}
                if([int]$request.count -gt $sessionState.ChunkBytes){Fail 'chunk_limit' 'Chunk exceeds configured size.'}
                return $entry.Read([long]$request.offset,[int]$request.count)
            }
            'abortTransfer' {
                if($sessionState.Uploads.ContainsKey($request.transferId)){$sessionState.Uploads[$request.transferId].stream.Dispose();$sessionState.Uploads.Remove($request.transferId)}
                if($sessionState.Readers.ContainsKey($request.transferId)){$sessionState.Readers[$request.transferId].Dispose();$sessionState.Readers.Remove($request.transferId)}
                return @{closed=$true}
            }
            'startJob' {
                if($sessionState.Jobs.Count -ge 16){foreach($key in @($sessionState.Jobs.Keys)){if($sessionState.Jobs[$key].Finished){$sessionState.Jobs[$key].Dispose();$sessionState.Jobs.Remove($key)}}}
                if($sessionState.Jobs.Count -ge 16){Fail 'job_limit' 'At most 16 retained jobs are supported in one Host binding.'}
                if([string]$request.command -eq '' -or $request.command.Length -gt 8000){Fail 'command_limit' 'Host commands must contain 1..8000 characters.'}
                $cwd=Resolve-BridgePath ([string]$request.cwd) $true
                if(-not [IO.Directory]::Exists($cwd)){Fail 'not_a_directory' 'Command working directory is not a directory.'}
                $escaped=$cwd.Replace("'","''")
                $script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new(`$false);`$ErrorActionPreference='Stop';Set-Location -LiteralPath '"+$escaped+"';`$global:LASTEXITCODE=0;try{& {"+[string]$request.command+"`n};exit `$global:LASTEXITCODE}catch{[Console]::Error.WriteLine(`$_.Exception.Message);exit 1}"
                $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script));$exe=(Get-Process -Id $PID).Path;$id=[Guid]::NewGuid().ToString('N')
                $timeout=$sessionState.DefaultTimeout;if($request.timeoutMs){$timeout=[int]$request.timeoutMs};if($timeout -lt 1000 -or $timeout -gt 3600000){Fail 'invalid_timeout' 'Timeout must be 1000..3600000 ms.'}
                $job=[LswbHostV020.Job]::new($exe,[string[]]@('-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',$encoded),$cwd,$timeout,$sessionState.OutputLimit);$sessionState.Jobs[$id]=$job
                $result=$job.Snapshot([int]$request.waitMs,0,0);$result['jobId']=$id;return $result
            }
            'pollJob' {
                $job=$sessionState.Jobs[$request.jobId];if(-not $job){Fail 'job_not_found' 'Job is unavailable in this Host binding.'}
                return $job.Snapshot([int]$request.waitMs,[int]$request.stdoutOffset,[int]$request.stderrOffset)
            }
            'cancelJob' {
                $job=$sessionState.Jobs[$request.jobId];if(-not $job){Fail 'job_not_found' 'Job is unavailable in this Host binding.'};$job.Cancel($false);return $job.Snapshot(2000,0,0)
            }
            'forgetJob' {
                $job=$sessionState.Jobs[$request.jobId];if($job){if(-not $job.Finished){Fail 'job_running' 'Cancel or finish the job before forgetting it.'};$job.Dispose();$sessionState.Jobs.Remove($request.jobId)};return @{forgotten=$true}
            }
            'applyPatch' {
                $git=Resolve-Executable 'git.exe';if(-not $git){Fail 'host_git_missing' 'Git is not available on the Host.'}
                foreach($relative in @($request.paths)){$null=Resolve-BridgePath $relative}
                $temp=Join-Path ([IO.Path]::GetTempPath()) ('lswb-patch-'+[Guid]::NewGuid().ToString('N')+'.patch')
                try {
                    [IO.File]::WriteAllText($temp,[string]$request.patch,[Text.UTF8Encoding]::new($false))
                    $base=[string[]]@('-c',('safe.directory='+$sessionState.Root))
                    $prefixRun=Invoke-Native $git ($base+@('rev-parse','--show-prefix'))
                    $prefix='';if($prefixRun.exitCode -eq 0){$prefix=$prefixRun.stdout.Trim()}
                    $applyArguments=@('apply');if($prefix){$applyArguments+=('--directory='+$prefix)}
                    $check=Invoke-Native $git ($base+$applyArguments+@('--check','--',$temp))
                    if($check.state -ne 'completed' -or $check.exitCode -ne 0){return @{checked=$false;applied=$false;check=$check}}
                    if($request.checkOnly){return @{checked=$true;applied=$false;checkOnly=$true;paths=@($request.paths)}}
                    $run=Invoke-Native $git ($base+$applyArguments+@('--',$temp))
                    return @{checked=$true;applied=($run.state -eq 'completed' -and $run.exitCode -eq 0);result=$run;paths=@($request.paths)}
                } finally {if(Test-Path -LiteralPath $temp){[IO.File]::Delete($temp)}}
            }
            'close' {
                foreach($job in $sessionState.Jobs.Values){$job.Dispose()};foreach($upload in $sessionState.Uploads.Values){$upload.stream.Dispose()};foreach($reader in $sessionState.Readers.Values){$reader.Dispose()}
                $sessionState.Jobs.Clear();$sessionState.Uploads.Clear();$sessionState.Readers.Clear();return @{closed=$true}
            }
            default {Fail 'unsupported_host_action' 'Unknown Host action.'}
        }
    }
    if($Nonce -notmatch '^[a-f0-9]{32}$'){return}
    try {
        if($ReadInput){[Console]::WriteLine("`n"+'LSWB_READY:'+$Nonce);$Payload=[LswbHostV020.Util]::ReadPayload(15000)}
        $request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))|ConvertFrom-Json
        if($request.requestNonce -ne $Nonce){Fail 'nonce_mismatch' 'Host request and output frame do not match.'}
        if(@($request.inspectTextPaths).Count -gt 100){Fail 'inspection_limit' 'Too many open text buffers to verify.'}
        $result=Process-Request $request
        if(@($request.inspectTextPaths).Count -and $null -ne $request.inspectTextPaths -and $result.state -ne 'running'){
            $states=@{}
            foreach($relative in @($request.inspectTextPaths)){
                $states[$relative]=$null
                try{
                    $filename=Resolve-BridgePath $relative
                    if([IO.File]::Exists($filename) -and ([IO.FileInfo]::new($filename)).Length -le 16777216){
                        $text=[IO.File]::ReadAllText($filename,[Text.UTF8Encoding]::new($false,$true)).TrimStart([char]0xfeff).Replace("`r`n","`n").Replace("`r","`n")
                        $sha=[Security.Cryptography.SHA256]::Create();try{$states[$relative]=[LswbHostV020.Util]::Hex($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($text)))}finally{$sha.Dispose()}
                    }
                }catch{}
            }
            $result['textStates']=$states
        }
        $reply=@{ok=$true;result=$result}
    } catch {
        $message=$_.Exception.Message;$code='host_error'
        if($message -match '^([a-z_]+):\s*(.*)$'){$code=$matches[1];$message=$matches[2]}
        $reply=@{ok=$false;error=@{code=$code;message=$message}}
    }
    $json=$reply|ConvertTo-Json -Compress -Depth 30
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    [Console]::WriteLine("`n"+'LSWB_RESULT:'+$Nonce+':')
    for($offset=0;$offset -lt $encoded.Length;$offset+=1024){
        [Console]::WriteLine($encoded.Substring($offset,[Math]::Min(1024,$encoded.Length-$offset)))
        # Yield between bounded bursts so a shared-terminal renderer can acknowledge output.
        if(($offset % 4096) -eq 3072){[Threading.Thread]::Sleep(5)}
    }
    [Console]::WriteLine('LSWB_END:'+$Nonce)
}.GetNewClosure()
Set-Item -Path ('Function:\global:'+$FunctionName) -Value $handler
