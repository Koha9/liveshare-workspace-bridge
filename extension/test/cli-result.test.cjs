'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {unsuccessful}=require('../cli.cjs');
test('CLI distinguishes successful dry runs/no-match/cancellation from failed command outcomes',()=>{
 assert.equal(unsuccessful({ok:true,result:{checked:true,checkOnly:true,applied:false}},'applyPatch'),false);
 assert.equal(unsuccessful({ok:true,result:{state:'completed',exitCode:1,complete:true,matches:[]}},'search'),false);
 assert.equal(unsuccessful({ok:true,result:{state:'completed',exitCode:7}},'hostExec'),true);
 assert.equal(unsuccessful({ok:true,result:{state:'cancelled',exitCode:1}},'hostJobCancel'),false);
 assert.equal(unsuccessful({ok:true,result:{state:'cancelled',exitCode:1}},'hostJobPoll'),true);
});
