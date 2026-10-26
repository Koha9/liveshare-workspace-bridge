'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {patchPaths}=require('../patch.cjs');
function patch(name='file.txt',text='-old\n+new'){return `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${text}\n`;}
test('patch paths retain spaces and distinguish hunk content from file headers',()=>{
 assert.deepEqual(patchPaths(patch('a file.txt')),['a file.txt']);
 assert.deepEqual(patchPaths(patch('file.txt','--- not a header\n+++ not a header')),['file.txt']);
});
test('rejects traversal, Git metadata, binary patches and symlink modes before Host dispatch',()=>{
 for(const name of ['../outside','.git/config','C:/outside'])assert.throws(()=>patchPaths(patch(name)));
 assert.throws(()=>patchPaths('GIT binary patch\n'),{code:'unsupported_patch'});
 assert.throws(()=>patchPaths('new file mode 120000\n'+patch()),{code:'unsupported_patch'});
});
test('decodes Git quoted UTF-8 paths without dropping non-ASCII characters',()=>{
 const text='--- "a/\\303\\251.txt"\n+++ "b/\\303\\251.txt"\n@@ -1 +1 @@\n-a\n+b\n';
 assert.deepEqual(patchPaths(text),['é.txt']);
});
