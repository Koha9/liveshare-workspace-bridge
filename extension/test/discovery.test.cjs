'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {discover,diagnosticReport,inspectRecords}=require('../cli.cjs');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
function disk(entries){return{readdirSync(){return Object.keys(entries)},readFileSync(name){const value=entries[name.replaceAll('\\','/').split('/').at(-1)];if(value instanceof Error)throw value;return value}};}
const record=id=>JSON.stringify({id,pipeName:'liveshare-local-123-'+id,epoch:1,version:'0.2.1'});
const connected=id=>({ok:true,result:{id,epoch:2,roots:[{name:'Fixture',uri:'vsls:/'}]}});
test('missing registry is distinguished from unreadable registry without exposing file contents',async()=>{
 for(const [code,status]of [['ENOENT','no_records'],['EACCES','access_denied'],['EIO','invalid_registry']]){
  const report=await discover({registryPath:'test-registry',fsImpl:{readdirSync(){throw Object.assign(new Error('private details'),{code})}}});
  assert.equal(report.status,status);assert.equal(report.instances.length,0);assert.equal(JSON.stringify(report).includes('private details'),false);
 }
});
test('a sandbox pipe denial is reported as denied with an unsent request, never an empty success',async()=>{
 const report=await discover({fsImpl:disk({[a+'.json']:record(a)}),probe:async()=>{throw Object.assign(new Error('connect failed'),{code:'transport_unavailable',transportCode:'EPERM',requestSent:false})}});
 assert.equal(report.status,'access_denied');assert.deepEqual(report.probes[0],{id:a,status:'denied',code:'transport_unavailable',transportCode:'EPERM',requestSent:false});
});
test('mixed stale/live records remain usable and stale is distinct from denial',async()=>{
 const report=await discover({fsImpl:disk({[a+'.json']:record(a),[b+'.json']:record(b)}),probe:async entry=>{if(entry.id===a)return connected(a);throw Object.assign(new Error(),{code:'transport_unavailable',transportCode:'ENOENT',requestSent:false})}});
 assert.equal(report.status,'partial');assert.equal(report.instances.length,1);assert.equal(report.probes[1].status,'stale');assert.equal(diagnosticReport(report).instances[0].info,undefined);
});
test('malformed and unreadable records are diagnostic issues rather than proof of no instances',async()=>{
 for(const value of ['{"secret":"do not echo"', 'null', JSON.stringify({id:a,pipeName:'arbitrary-pipe'}),Object.assign(new Error(),{code:'EACCES'})]){
  const report=await discover({fsImpl:disk({[a+'.json']:value})});assert.ok(['invalid_registry','access_denied'].includes(report.status));assert.equal(report.issues.length,1);assert.equal(JSON.stringify(report).includes('do not echo'),false);
 }
});
test('connected window without a shared root and wrong server identity are separate outcomes',async()=>{
 const settings={fsImpl:disk({[a+'.json']:record(a)}),probe:async()=>({ok:true,result:{id:a,epoch:1,roots:[]}})};
 assert.equal((await discover(settings)).status,'no_shared_workspace');settings.probe=async()=>connected(b);const wrong=await discover(settings);assert.equal(wrong.status,'unavailable');assert.equal(wrong.probes[0].code,'instance_identity_mismatch');
});
test('registry inspection does not connect to a pipe or write records',()=>{
 const inspected=inspectRecords({fsImpl:disk({[a+'.json']:record(a),'ignore.txt':'ignored'})});assert.equal(inspected.records.length,1);assert.equal(inspected.registry.status,'ready');
});
