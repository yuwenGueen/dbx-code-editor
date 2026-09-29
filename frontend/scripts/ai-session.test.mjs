import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
async function load(name){const source=readFileSync(new URL(`../src/${name}.ts`,import.meta.url),'utf8');return import(`data:text/javascript;base64,${Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString('base64')}`);}
const {restoreSessionState}=await load('ai-session');
const {proposalDiff}=await load('ai-review');
const {splitDiff}=await load('git-diff-view');
test('old sessions recover with safe defaults; malformed proposals cannot become executable',()=>{
 assert.deepEqual(restoreSessionState(undefined),{draft:'',mode:'agent',context:[],proposals:[]});
 const state=restoreSessionState({mode:'ask',draft:'unfinished',context:['src/a.ts','../escape'],proposals:[{path:'../escape',content:'x'},{path:'a',content:'x',before:{path:'b'}},{path:'good',content:'new'}]});
 assert.equal(state.mode,'ask');assert.equal(state.draft,'unfinished');assert.deepEqual(state.context,['src/a.ts']);assert.equal(state.proposals.length,1);
});
test('restores model identity, proposal revisions and undo snapshot',()=>{
 const state={draft:'next',mode:'agent',model:{configId:'provider',model:'model'},context:['a'],proposals:[{path:'a',content:'new',before:{path:'a',content:'old',revision:'r1',encoding:'utf-8'},applied:'r2',rejected:false}]};
 assert.deepEqual(restoreSessionState(JSON.parse(JSON.stringify(state))),state);
});
test('proposal comparison preserves line alignment and unchanged middle lines',()=>{
 const rows=splitDiff(proposalDiff('first\nold\nshared\nend\n','first\nnew\nshared\nextra\nend\n'));
 assert.ok(rows.some(r=>r.before.text==='old'&&r.after.text==='new'));
 assert.ok(rows.some(r=>r.before.text==='shared'&&r.after.text==='shared'&&!r.before.kind));
 assert.ok(rows.some(r=>r.after.text==='extra'&&r.after.kind==='added'));
 assert.equal(proposalDiff('same','same'),'内容没有变化。');
});
test('large line counts use a bounded comparison',()=>{
 const rows=splitDiff(proposalDiff('a\n'.repeat(1000),'b\n'.repeat(1000)));
 assert.equal(rows.length,1001);
 assert.equal(rows[1].before.kind,'deleted');assert.equal(rows[1].after.kind,'added');
});
test('a final newline-only edit is visible in review',()=>{
 const diff=proposalDiff('line','line\n');
 const rows=splitDiff(diff);
 assert.equal(rows[1].before.kind,'deleted');assert.equal(rows[1].after.kind,'added');
 assert.match(diff,/文件末尾换行/);
});
