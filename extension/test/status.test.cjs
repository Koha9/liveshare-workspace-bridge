'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');const {EventEmitter}=require('node:events');const {PassThrough}=require('node:stream');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
test('status bar links to English settings and follows master/terminal switches immediately',t=>{
 const localHome=fs.mkdtempSync(path.join(os.tmpdir(),'lswb-status-home-'));
 const settings={},commands=new Map(),context={subscriptions:[]};let folderChange,configurationChange;
 const item={visible:false,show(){this.visible=true},hide(){this.visible=false},dispose(){}};
 class Uri{constructor(){this.scheme='vsls';this.path='/';this.authority=''}toString(){return'vsls:/'}}
 const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{child.emit('exit',0);child.stdout.end();child.stderr.end();child.stdin.end();return true;};
 const sdk={Uri,StatusBarAlignment:{Right:2},window:{terminals:[],createOutputChannel:()=>({append(){},appendLine(){},dispose(){}}),createStatusBarItem:alignment=>{assert.equal(alignment,2);return item}},workspace:{workspaceFolders:[],textDocuments:[],isTrusted:true,getConfiguration:()=>({get:key=>settings[key]}),onDidChangeWorkspaceFolders:callback=>{folderChange=callback;return{dispose(){}}},onDidChangeConfiguration:callback=>{configurationChange=callback;return{dispose(){}}}},commands:{registerCommand:(name,callback)=>{commands.set(name,callback);return{dispose(){}}},executeCommand:async()=>{}}};
 const original=Module._load;delete require.cache[require.resolve('../extension.cjs')];let extension;
 try{Module._load=function(name,parent,isMain){if(name==='vscode')return sdk;if(name==='node:os')return{...os,homedir:()=>localHome};if(name==='node:child_process')return{spawn:()=>child};return original.call(this,name,parent,isMain);};extension=require('../extension.cjs');}finally{Module._load=original;}
 t.after(()=>{for(const disposable of context.subscriptions.slice().reverse())disposable.dispose();assert.equal(path.dirname(localHome),os.tmpdir());assert.ok(path.basename(localHome).startsWith('lswb-status-home-'));fs.rmSync(localHome,{recursive:true,force:true});});
 extension.activate(context);assert.equal(item.visible,false);
 sdk.workspace.workspaceFolders=[{name:'Status fixture',uri:new Uri()}];folderChange();assert.equal(item.visible,true);assert.match(item.text,/Guest only/u);assert.equal(item.command,'liveshareWorkspaceBridge.openSettings');
 settings['terminal.enabled']=true;configurationChange({affectsConfiguration:key=>key.includes('terminal')});assert.match(item.text,/Host allowed/u);
 settings['agent.enabled']=false;configurationChange({affectsConfiguration:key=>key.includes('agent.enabled')});assert.match(item.text,/Agent off/u);assert.match(item.tooltip,/disabled/u);
 assert.equal(commands.has('liveshareWorkspaceBridge.openSettings'),true);
});
