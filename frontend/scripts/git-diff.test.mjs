import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = readFileSync(new URL('../src/git-diff-view.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { splitDiff } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('replacement rows align and retain actual line numbers', () => {
 const rows = splitDiff('--- a/test\n+++ b/test\n@@ -8,3 +8,4 @@\n same\n-old\n+new\n+extra\n tail\n');
 assert.equal(rows[2].before.text, 'old'); assert.equal(rows[2].after.text, 'new');
 assert.equal(rows[2].before.number, 9); assert.equal(rows[3].before.number, undefined);
 assert.equal(rows[4].before.number, 10); assert.equal(rows[4].after.number, 11);
});
test('multiple hunks reset line numbers and ignore newline markers', () => {
 const rows = splitDiff('@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n@@ -20 +30 @@\n context\n');
 assert.equal(rows.length, 4); assert.equal(rows[3].before.number, 20); assert.equal(rows[3].after.number, 30);
});
test('new files have empty left rows; deletions have empty right rows', () => {
 assert.equal(splitDiff('+++ test\n+new')[0].after.number, 1);
 assert.equal(splitDiff('@@ -1 +0,0 @@\n-old')[1].after.number, undefined);
});
test('binary and loading messages are not parsed as code', () => {
 assert.deepEqual(splitDiff('Binary files a/file and b/file differ'), []);
 assert.deepEqual(splitDiff('Loading diff…'), []);
});
