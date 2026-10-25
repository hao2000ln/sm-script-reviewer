import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { analyze } from '../src/parser/analyze';
import type { SourceDocument } from '../src/core/types';
const inspect = (content:string) => analyze({id:'test',filePath:'test.js',content,hash:'test'} as SourceDocument);
test('finds documented function and anonymous variable function',()=>{
  const result=inspect('/** Read records. */\nfunction getRecords() {}\nvar save = function() {};');
  assert.equal(result.functions.length,2);
  assert.equal(result.functions[0].name,'getRecords');
  assert.ok(result.functions[0].leadingComment);
  assert.equal(result.functions[1].name,'save');
});
test('does not count comment-like strings',()=>{
  const result=inspect('var url = "http://example";\nfunction go() {}');
  assert.equal(result.comments.length,0);
});
test('returns parse diagnostics',()=>{
  assert.ok(inspect('function broken( {').issues.length>0);
});
