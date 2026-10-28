import { strict as assert } from 'node:assert'; import { test } from 'node:test'; import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'; import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path';
import { reviewFolder } from '../src/folder-review-adapter';
test('reviews nested js and txt files, honors excludes and limits', async () => {
 const root=await mkdtemp(join(tmpdir(),'sm-folder-')); await mkdir(join(root,'nested')); await mkdir(join(root,'skip'));
 await writeFile(join(root,'a.js'),'print("a");'); await writeFile(join(root,'nested','b.txt'),'print("b");'); await writeFile(join(root,'skip','c.js'),'print("c");');
 const result=await reviewFolder(root,{maxFiles:2,excludedPatterns:['skip/**']}); assert.equal(result.files.length,2); assert.ok(result.files.every(f=>f.filePath.endsWith('.js')||f.filePath.endsWith('.txt')));
 const limited=await reviewFolder(root,{maxFiles:1,excludedPatterns:[]}); assert.equal(limited.limited,true);
});
test('uses unsaved open content and cancels before later files', async () => {
 const root=await mkdtemp(join(tmpdir(),'sm-folder-')); const file=join(root,'a.js'); await writeFile(file,'function clean() {}');
 const unsaved=new Map([[resolve(file).toLowerCase(),'print("unsaved");']]); const result=await reviewFolder(root,{maxFiles:10,excludedPatterns:[],openDocuments:unsaved}); assert.equal(result.files[0].usedUnsavedContent,true); assert.ok(result.files[0].result.findings.length>0);
 const cancelled=await reviewFolder(root,{maxFiles:10,excludedPatterns:[],isCancellationRequested:()=>true}); assert.equal(cancelled.cancelled,true);
});
