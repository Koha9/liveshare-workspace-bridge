'use strict';
const{test}=require('node:test');const assert=require('node:assert/strict');const{spawn}=require('node:child_process');const path=require('node:path');
test('native local account selection handles rename, deletion/recreation, invalid/domain SIDs and DC roles',{skip:process.platform!=='win32',timeout:10000},async()=>{
const file=path.join(__dirname,'..','local-accounts.cs').replaceAll("'","''");const script=`$ErrorActionPreference='Stop';Add-Type -Path '${file}'
function Assert($ok,$message){if(-not $ok){throw $message}}
$real=@([LswbIpcV022.LocalAccounts]::Read());Assert ($real.Count -gt 0) 'Empty local catalog';Assert (-not [LswbIpcV022.LocalAccounts]::IsLocalAccountRole(4)) 'DC accepted'
$a=[LswbIpcV022.LocalAccount]::new();$a.Sid='S-1-5-21-11-22-33-1001';$a.Name='PC\\Old'
$b=[LswbIpcV022.LocalAccount]::new();$b.Sid='S-1-5-21-11-22-33-1002';$b.Name='PC\\Other'
$catalog=[LswbIpcV022.LocalAccount[]]@($a,$b)
$picked=[LswbIpcV022.LocalAccounts]::Select('selectedUsers',[string[]]@($a.Sid),$catalog);Assert ($picked.Allowed.Count -eq 1) 'Wrong selected scope'
$a.Name='PC\\Renamed';$renamed=[LswbIpcV022.LocalAccounts]::Select('selectedUsers',[string[]]@($a.Sid),$catalog);Assert ($renamed.Allowed[0].Name -eq 'PC\\Renamed') 'Rename broke SID grant'
$replacement=[LswbIpcV022.LocalAccount]::new();$replacement.Sid='S-1-5-21-11-22-33-2001';$replacement.Name='PC\\Old'
$deleted=[LswbIpcV022.LocalAccounts]::Select('selectedUsers',[string[]]@($a.Sid),[LswbIpcV022.LocalAccount[]]@($replacement,$b));Assert ($deleted.Allowed.Count -eq 0 -and $deleted.Issues[0].Reason -eq 'unavailableLocalUser') 'Recreated account inherited trust'
$invalid=[LswbIpcV022.LocalAccounts]::Select('selectedUsers',[string[]]@('S-1-1-0','bad','S-1-5-21-44-55-66-1001'),$catalog);Assert ($invalid.Allowed.Count -eq 0 -and $invalid.Issues.Count -eq 3) 'Invalid/domain SID granted'
Assert (([LswbIpcV022.LocalAccounts]::Select('allLocalUsers',[string[]]@(),$catalog)).Allowed.Count -eq 2) 'All-local scope wrong'
Assert (([LswbIpcV022.LocalAccounts]::Select('ownerOnly',[string[]]@($a.Sid),$catalog)).Allowed.Count -eq 0) 'Owner-only used selected accounts'
[Console]::WriteLine('POLICY_OK')`;
const out=await new Promise((resolve,reject)=>{const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));});assert.equal(out.code,0,out.stderr);assert.match(out.stdout,/POLICY_OK/);
});
