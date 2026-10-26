'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {createPermissions}=require('../permissions.cjs');const {createHostChannel}=require('../host-channel.cjs');
function fixture(){
 const settings={'terminal.enabled':true},listeners=new Set(),sent=[],writes=[];let hold=false, readNonce, payloadBuffer='';
 const frame=(nonce,result)=>{const encoded=Buffer.from(JSON.stringify({ok:true,result})).toString('base64').replace(/(.{80})/gu,'$1\r\n');const start='LSWB_RESULT:'+nonce+':',end='LSWB_END:'+nonce;const value='\x1b]0;before\x1b\\\r\n'+start.slice(0,25)+'\r\n'+start.slice(25)+encoded+'\r\n'+end.slice(0,25)+'\r\n'+end.slice(25)+'\r\n\x1b]0;after\x1b\\';for(const callback of listeners)callback(value);};
 const pty={handleInput(){},onDidWrite(callback){listeners.add(callback);return{dispose(){listeners.delete(callback)}};}};
 const terminal={name:'powershell [Shared]',creationOptions:{pty},sendText(command,execute){sent.push(command);const match=/-Nonce '([a-f0-9]{32})'/u.exec(command);if(match){const nonce=match[1];if(command.includes('ScriptBlock'))setTimeout(()=>frame(nonce,{protocol:2,noEchoInput:true,chunkBytes:32768}),1);else if(command.includes('-ReadInput')){readNonce=nonce;payloadBuffer='';setTimeout(()=>{for(const callback of listeners)callback('\r\nLSWB_READY:'+nonce+'\r\n')},1);}else if(!hold)setTimeout(()=>frame(nonce,{complete:true,scope:'saved_host_files'}),1);}else if(readNonce&&!hold){payloadBuffer+=command;if(execute){const request=JSON.parse(Buffer.from(payloadBuffer,'base64'));assert.equal(request.requestNonce,readNonce);setTimeout(()=>frame(readNonce,{complete:true,bytes:request.base64?.length}),1);}}}};
 const root={toString:()=> 'vsls:/'};let epoch=1;
 const vscode={window:{terminals:[terminal]},workspace:{getConfiguration:()=>({get:key=>settings[key]}),fs:{async writeFile(uri,bytes){writes.push(bytes.length)},async delete(){}}},Uri:{joinPath:()=>({toString:()=> 'vsls:/bootstrap'})}};
 const permissions=createPermissions(vscode),host=createHostChannel(vscode,{epoch:()=>epoch},permissions);
 return{settings,vscode,permissions,host,root,terminal,sent,writes,listeners,setHold:()=>hold=true,bump:()=>epoch++};
}
test('never selects an ordinary Guest terminal or writes a handshake when Host terminal access is disabled/missing',async t=>{
 const f=fixture();t.after(()=>f.host.dispose());f.settings['terminal.enabled']=false;
 await assert.rejects(f.host.bind(f.root),{code:'terminal_access_disabled'});assert.equal(f.writes.length,0);
 f.settings['terminal.enabled']=true;f.vscode.window.terminals=[{name:'pwsh',shellIntegration:{},creationOptions:{shellPath:'pwsh.exe'}}];
 await assert.rejects(f.host.bind(f.root),{code:'host_terminal_required'});assert.equal(f.writes.length,0);assert.equal(f.sent.length,0);
});
test('binds a shared terminal, sends large payload only after ready, and releases output listeners',async t=>{
 const f=fixture();t.after(()=>f.host.dispose());const bound=await f.host.bind(f.root);assert.equal(bound.bound,true);
 const reply=await f.host.request(f.root,'readBytes',{action:'readBytes',path:'file.bin',padding:'x'.repeat(3000)});
 assert.equal(reply.complete,true);assert.ok(f.sent[1].includes('-ReadInput'));assert.ok(f.sent.length>=3);assert.ok(f.sent.slice(2).every(x=>x.length<=4096));assert.equal(f.listeners.size,0);
});
test('known read-only shared terminals are rejected without a handshake or command',async t=>{
 const f=fixture();t.after(()=>f.host.dispose());f.terminal.creationOptions.pty.isReadonly=true;
 await assert.rejects(f.host.bind(f.root),{code:'host_terminal_required'});assert.equal(f.sent.length,0);assert.equal(f.writes.length,0);
});
test('revoking a permission detaches output capture and never replays a sent action',async t=>{
 const f=fixture();t.after(()=>f.host.dispose());await f.host.bind(f.root);f.setHold();
 const task=f.host.request(f.root,'search',{action:'search',query:'x'});
 await new Promise(resolve=>setTimeout(resolve,10));f.settings['permissions.search']=false;f.host.changed(false);
 await assert.rejects(task,{code:'host_access_revoked'});assert.equal(f.sent.length,2);assert.equal(f.listeners.size,0);
 f.settings['permissions.search']=true;await assert.rejects(f.host.request(f.root,'search',{action:'search',query:'x'}),{code:'host_channel_uncertain'});assert.equal(f.sent.length,2);
});
