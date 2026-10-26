'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {renderBootstrap,psString}=require('../host-channel.cjs');
test('Windows Host helper preserves bytes, verifies chunked transfers, executes bounded jobs and rejects escapes', {skip:process.platform!=='win32',timeout:45000},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lswb runtime '));
  t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(directory).startsWith('lswb runtime '));fs.rmSync(directory,{recursive:true,force:true});});
  const bootstrap=path.join(directory,'bootstrap.ps1');fs.writeFileSync(bootstrap,renderBootstrap());
  const script=path.join(directory,'test.ps1');
  const body=`$ErrorActionPreference='Stop'
& ([ScriptBlock]::Create([IO.File]::ReadAllText(${psString(bootstrap)}))) -FunctionName 'Invoke_Lswb_00000000000000000000000000000000' -WorkspaceRoot ${psString(directory)} -OutputLimit 1024 -ChunkBytes 32768 -TransferTtl 10000
function Invoke-Test($request){
 $n=[Guid]::NewGuid().ToString('N');$request.requestNonce=$n;$p=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($request|ConvertTo-Json -Compress -Depth 20)))
 $old=[Console]::Out;$writer=[IO.StringWriter]::new()
 try{[Console]::SetOut($writer);& 'Invoke_Lswb_00000000000000000000000000000000' -Payload $p -Nonce $n}finally{[Console]::SetOut($old)}
 if($writer.ToString() -notmatch ('LSWB_RESULT:'+$n+':([\\s\\S]*?)LSWB_END:'+$n)){throw 'Missing test frame'}
 return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(($matches[1] -replace '\\s','')))|ConvertFrom-Json)
}
function Assert($condition,$message){if(-not $condition){throw $message}}
$count=0
$escape=Invoke-Test @{action='stat';path='../outside'};Assert (-not $escape.ok -and $escape.error.code -eq 'outside_workspace') 'Traversal accepted';$count++
$raw=[byte[]](0..255);$b64=[Convert]::ToBase64String($raw);$hash=([Security.Cryptography.SHA256]::Create().ComputeHash($raw)|ForEach-Object{$_.ToString('x2')}) -join ''
$write=Invoke-Test @{action='writeBytes';path='bytes.bin';base64=$b64;sha256=$hash};Assert ($write.ok -and $write.result.written) 'Byte write failed'
$read=Invoke-Test @{action='readBytes';path='bytes.bin'};Assert ($read.ok -and $read.result.base64 -ceq $b64 -and $read.result.sha256 -eq $hash) 'Byte fidelity failed';$count++
$old=[IO.File]::ReadAllBytes((Join-Path ${psString(directory)} 'bytes.bin'))
$refused=Invoke-Test @{action='writeBytes';path='bytes.bin';base64=$b64;sha256=$hash};Assert (-not $refused.ok) 'Overwrite accepted without flag';$count++
$wrong=Invoke-Test @{action='writeBytes';path='bytes.bin';base64=$b64;sha256=$hash;overwrite=$true;expectedCurrentSha256=('0'*64)};Assert (-not $wrong.ok -and [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path ${psString(directory)} 'bytes.bin'))) -ceq $b64) 'Wrong overwrite guard changed the file';$count++
$begin=Invoke-Test @{action='beginWrite';path='nested/large.bin';size=768;parents=$true};Assert $begin.ok 'Upload begin failed';$id=$begin.result.transferId
for($i=0;$i -lt 3;$i++){$chunk=Invoke-Test @{action='writeChunk';transferId=$id;sequence=$i;base64=$b64};Assert $chunk.ok 'Chunk failed';if($i -eq 0){$again=Invoke-Test @{action='writeChunk';transferId=$id;sequence=0;base64=$b64};Assert ($again.result.bytesReceived -eq 256) 'Duplicate chunk appended twice'}}
$all=[byte[]](@($raw)+@($raw)+@($raw));$allHash=([Security.Cryptography.SHA256]::Create().ComputeHash($all)|ForEach-Object{$_.ToString('x2')}) -join ''
$commit=Invoke-Test @{action='commitWrite';transferId=$id;path='nested/large.bin';sha256=$allHash};Assert ($commit.ok -and $commit.result.written) 'Commit failed';$count++
$open=Invoke-Test @{action='openRead';path='nested/large.bin'};Assert $open.ok 'Download begin failed';$offset=0;$download=''
while($offset -lt 768){$piece=Invoke-Test @{action='readChunk';transferId=$open.result.transferId;offset=$offset;count=200};Assert $piece.ok 'Download chunk failed';$download+=[Convert]::ToBase64String([Convert]::FromBase64String($piece.result.base64));$offset=$piece.result.nextOffset}
Assert ($piece.result.complete -and $piece.result.sha256 -eq $allHash) 'Download hash failed';$count++
$copy=Invoke-Test @{action='copyDirectory';path='nested';to='copied';parents=$true};Assert ($copy.ok -and (Get-FileHash -LiteralPath (Join-Path ${psString(directory)} 'copied/large.bin')).Hash -eq $allHash) 'Directory copy failed';$count++
$job=Invoke-Test @{action='startJob';command='[Console]::Write(("x"*5000));[Console]::Error.Write(("e"*4000));exit 7';waitMs=3000;timeoutMs=5000;cwd=''}
Assert ($job.ok -and $job.result.state -eq 'completed' -and $job.result.exitCode -eq 7 -and $job.result.stdout.Length -eq 1024 -and $job.result.stdoutTruncated -and $job.result.stderrTruncated) 'Job output/exit handling failed';$count++
$native=Invoke-Test @{action='startJob';command='cmd.exe /d /c exit 7';waitMs=3000;timeoutMs=5000;cwd=''};Assert ($native.ok -and $native.result.exitCode -eq 7) 'Native exit code lost';$count++
$failed=Invoke-Test @{action='startJob';command='throw "controlled"';waitMs=3000;timeoutMs=5000;cwd=''};Assert ($failed.ok -and $failed.result.exitCode -eq 1 -and $failed.result.stderr -match 'controlled') 'PowerShell failure lost';$count++
$inputCheck=Invoke-Test @{action='startJob';command='if($null -eq [Console]::ReadLine()){Write-Output "STDIN_EOF"}else{throw "unexpected input"}';waitMs=3000;timeoutMs=5000;cwd=''};Assert ($inputCheck.ok -and $inputCheck.result.stdout -match 'STDIN_EOF') 'Host child inherited terminal input';$count++
$slow=Invoke-Test @{action='startJob';command='Start-Sleep -Seconds 30';waitMs=0;timeoutMs=1000;cwd=''};Start-Sleep -Milliseconds 1300;$poll=Invoke-Test @{action='pollJob';jobId=$slow.result.jobId;waitMs=3000;stdoutOffset=0;stderrOffset=0};Assert ($poll.ok -and $poll.result.state -eq 'timed_out') 'Timeout failed';$count++
$cancel=Invoke-Test @{action='startJob';command='Start-Sleep -Seconds 30';waitMs=0;timeoutMs=10000;cwd=''};$stopped=Invoke-Test @{action='cancelJob';jobId=$cancel.result.jobId};Assert ($stopped.ok -and $stopped.result.state -eq 'cancelled') 'Cancellation failed';$count++
$close=Invoke-Test @{action='close'};Assert $close.ok 'Close failed'
[Console]::WriteLine((@{checks=$count;passed=$true}|ConvertTo-Json -Compress))
`;
  fs.writeFileSync(script,body);
  const executable=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result=await new Promise((resolve,reject)=>{
    const env={...process.env,PSModulePath:path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/Modules')+';'+(process.env.PSModulePath||'')};
    const child=spawn(executable,['-NoLogo','-NoProfile','-NonInteractive','-File',script],{windowsHide:true,env});let stdout='',stderr='';
    child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));
  });
  assert.equal(result.code,0,result.stdout+'\n'+result.stderr);
  assert.equal(JSON.parse(result.stdout.trim()).checks,13);
});
