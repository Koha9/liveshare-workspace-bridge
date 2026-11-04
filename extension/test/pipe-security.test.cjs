'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const path=require('node:path');
test('local pipe excludes broad principals, holds its sole server instance and rejects other sessions',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const source=path.join(__dirname,'..','pipe-security.cs').replaceAll("'","''");
 const script=`$ErrorActionPreference='Stop';Add-Type -Path @('${source.replace('pipe-security.cs','local-accounts.cs')}','${source}');$name='liveshare-local-123-'+[Guid]::NewGuid().ToString();$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$pipe=[LswbIpcV022.LocalPipe]::new($name,'selectedUsers',[string[]]@(([LswbIpcV022.LocalAccounts]::Read())[0].Sid));try{$rules=@($pipe.Stream.GetAccessControl().GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])|ForEach-Object{@{sid=$_.IdentityReference.Value;type=$_.AccessControlType.ToString();rights=$_.PipeAccessRights.ToString()}});$collision=$false;try{$other=[LswbIpcV022.LocalPipe]::new($name,'selectedUsers',[string[]]@(([LswbIpcV022.LocalAccounts]::Read())[0].Sid));$other.Dispose()}catch{$collision=$true};$result=@{owner=$owner;accounts=@($pipe.AllowedUsers|ForEach-Object{$_.Sid});rules=$rules;collisionRejected=$collision;sameSession=[LswbIpcV022.LocalPipe]::IsSessionAllowed($pipe.SessionId,[uint32]$pipe.SessionId);otherSession=[LswbIpcV022.LocalPipe]::IsSessionAllowed($pipe.SessionId,[uint32]($pipe.SessionId+1))};[Console]::WriteLine(($result|ConvertTo-Json -Compress -Depth 5))}finally{$pipe.Dispose()}`;
 const result=await new Promise((resolve,reject)=>{const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.once('error',reject);child.once('close',code=>resolve({code,stdout,stderr}));});
 assert.equal(result.code,0,result.stderr);const r=JSON.parse(result.stdout);assert.equal(r.collisionRejected,true);assert.equal(r.sameSession,true);assert.equal(r.otherSession,false);
 for(const sid of ['S-1-1-0','S-1-5-11','S-1-5-32-545'])assert.equal(r.rules.some(x=>x.sid===sid&&x.type==='Allow'),false,sid);
 assert.ok(r.rules.some(x=>x.sid==='S-1-5-2'&&x.type==='Deny'));assert.ok(r.rules.some(x=>x.sid===r.owner&&x.type==='Allow'&&x.rights==='FullControl'));
 assert.ok(r.accounts.every(x=>/^S-1-5-21-/u.test(x)));
});
function runPowerShell(args){
 const exe=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 return new Promise((resolve,reject)=>{
  const child=spawn(exe,['-NoLogo','-NoProfile','-NonInteractive',...args],{windowsHide:true});
  let stdout='';
  let stderr='';
  child.stdout.on('data',x=>stdout+=x);
  child.stderr.on('data',x=>stderr+=x);
  child.once('error',reject);
  child.once('close',code=>resolve({code,stdout,stderr}));
 });
}
test('native pipe and helper reject the removed allLocalUsers mode',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const source=path.join(__dirname,'..','pipe-security.cs').replaceAll("'","''");
 const accounts=source.replace('pipe-security.cs','local-accounts.cs');
 const lines=[
  "$ErrorActionPreference='Stop'",
  `Add-Type -Path @('${accounts}','${source}')`,
  "$name='liveshare-local-123-'+[Guid]::NewGuid().ToString()",
  "$rejected=$false",
  "try{$pipe=[LswbIpcV022.LocalPipe]::new($name,'allLocalUsers',[string[]]@());$pipe.Dispose()}catch{$rejected=$true}",
  "[Console]::WriteLine($(if($rejected){'REMOVED_REJECTED'}else{'REMOVED_ACCEPTED'}))",
 ];
 const encoded=Buffer.from(lines.join('\n'),'utf16le').toString('base64');
 const native=await runPowerShell(['-EncodedCommand',encoded]);
 assert.equal(native.code,0,native.stderr);
 assert.match(native.stdout,/REMOVED_REJECTED/);
 const helper=path.join(__dirname,'..','pipe-host.ps1');
 const pipeName='liveshare-local-123-'+require('node:crypto').randomUUID();
 const hosted=await runPowerShell(['-File',helper,'-PipeName',pipeName,'-AccessMode','allLocalUsers']);
 assert.notEqual(hosted.code,0);
 assert.match(hosted.stderr,/AccessMode/);
 assert.doesNotMatch(hosted.stdout,/"kind":"ready"/);
});
