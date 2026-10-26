'use strict';
// Explicitly opt-in: starts Codex's existing legacy sandbox with temporary profiles.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),readline=require('node:readline');
const {spawn}=require('node:child_process');const{request}=require('../cli.cjs');
const{listLocalUsers}=require('../ipc-access.cjs');
async function main(){
 if(process.env.LIVESHARE_RUN_SANDBOX!=='1')throw new Error('Set LIVESHARE_RUN_SANDBOX=1 and LIVESHARE_CODEX_EXE explicitly. Sandbox setup can update ACLs in the owned local fixture.');
 const codex=process.env.LIVESHARE_CODEX_EXE;if(!codex||!path.isAbsolute(codex)||!fs.existsSync(codex))throw new Error('LIVESHARE_CODEX_EXE must name an existing absolute Codex executable.');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lswb-sandbox-')),checks=[];
 const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const users=await listLocalUsers(ps),sids=users.filter(x=>['codexsandboxoffline','codexsandboxonline'].includes(x.Name.split('\\').at(-1).toLowerCase())).map(x=>x.Sid);
 assert.equal(sids.length,2,'Both existing test identities are required; do not create accounts.');
 try{for(const allow of [false,true]){
  const pipeName='liveshare-local-'+process.pid+'-'+crypto.randomUUID();let errors='';
  const args=['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(__dirname,'..','pipe-host.ps1'),'-PipeName',pipeName,'-ParentProcessId',String(process.pid),'-AccessMode',allow?'selectedUsers':'ownerOnly','-SelectedSidsBase64',Buffer.from(JSON.stringify(allow?sids:[])).toString('base64')];
  const helper=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),args,{windowsHide:true,stdio:['pipe','pipe','pipe']});helper.stderr.on('data',x=>errors+=x);
  const ready=await new Promise((resolve,reject)=>{helper.once('error',reject);helper.once('exit',code=>reject(new Error('Helper exited '+code+': '+errors)));readline.createInterface({input:helper.stdout}).on('line',line=>{const frame=JSON.parse(line);if(frame.kind==='ready')resolve(frame);else if(frame.kind==='request')helper.stdin.write(JSON.stringify({ok:true,result:frame.body})+'\n');});});
  try{
   assert.equal(ready.ipc.mode,allow?'selectedUsers':'ownerOnly');
   assert.equal((await request({pipeName},{op:'ownerEcho'})).ok,true);
   for(const online of [false,true]){
    const script=`const cp=require('node:child_process');const c=require(${JSON.stringify(path.join(__dirname,'..','cli.cjs'))});(async()=>{const identity=cp.execFileSync('whoami.exe',[],{encoding:'utf8',windowsHide:true}).trim();try{const response=await c.request({pipeName:${JSON.stringify(pipeName)}},{op:'sandboxEcho',text:'中文😀'},2000);console.log(JSON.stringify({identity,response}));}catch(e){console.log(JSON.stringify({identity,code:e.code,transportCode:e.transportCode,requestSent:e.requestSent}));}})();`;
    const expression="eval(Buffer.from('"+Buffer.from(script).toString('base64')+"','base64').toString('utf8'))";
    const command=['-c','windows.sandbox="elevated"','-c','features.prefer_mxc=false','-c','permissions.lswb-ipc-test.extends=":workspace"','-c','permissions.lswb-ipc-test.network.enabled='+online,'sandbox','-C',directory,'--include-managed-config','--permission-profile','lswb-ipc-test','--',process.execPath,'-e',expression];
    const output=await new Promise((resolve,reject)=>{const child=spawn(codex,command,{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill();reject(new Error('Sandbox diagnostic timeout; inspect before retrying.'));},30000);child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error('Sandbox diagnostic exited '+code+': '+stderr));else resolve(stdout);});});
    const result=JSON.parse(output.trim());assert.ok(result.identity.toLowerCase().endsWith(online?'\\codexsandboxonline':'\\codexsandboxoffline'),result.identity);
    if(allow){assert.equal(result.response?.ok,true,JSON.stringify({result,helperErrors:errors}));assert.equal(result.response.result.text,'中文😀');}
    else{assert.equal(result.transportCode,'EPERM',JSON.stringify(result));assert.equal(result.requestSent,false);}
    checks.push({mode:ready.ipc.mode,identity:online?'CodexSandboxOnline':'CodexSandboxOffline',result:allow?'round_trip_passed':'denied_before_send'});console.log(JSON.stringify(checks.at(-1)));
   }
   assert.equal(errors,'');
  }finally{helper.kill();}
 }
 const receipt={version:'0.2.2',passed:true,checks,hostCommandsSent:false,allLocalUsersDeployed:false};const target=path.join(__dirname,'..','..','.local','evidence','sandbox-ipc-'+crypto.randomUUID()+'.json');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(receipt,null,2));console.log('Receipt: '+target);
 }finally{assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('lswb-sandbox-'));fs.rmSync(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
