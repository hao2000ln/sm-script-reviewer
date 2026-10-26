import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { review } from '../src/reviewer/review';

const run = (content: string) => review({
  id: 'control-flow-test',
  filePath: 'control-flow-test.js',
  content,
  hash: 'control-flow-test',
} as SourceDocument);

const findingsFor = (content: string, ruleId: string) => (
  run(content).findings.filter((finding) => finding.ruleId === ruleId)
);

test('SM-CODE-001 reports executable statements after definite return or throw', () => {
  const findings = findingsFor(`
// Documentation.
function example(flag) {
  if (flag) {
    throw new Error('stop');
    print('unreachable in branch');
  }
  return true;
  var value = 1;
  print(value);
}
`, 'SM-CODE-001');

  assert.deepEqual(findings.map(({ range }) => range.start.line), [6, 9, 10]);
});

test('SM-CODE-001 recognizes if/else only when both branches terminate', () => {
  const bothTerminate = findingsFor(`
// Documentation.
function example(flag) {
  if (flag) return 1;
  else throw new Error('stop');
  print('unreachable');
}
`, 'SM-CODE-001');
  const oneTerminates = findingsFor(`
// Documentation.
function example(flag) {
  if (flag) return 1;
  print('reachable');
}
`, 'SM-CODE-001');

  assert.equal(bothTerminate.length, 1);
  assert.equal(bothTerminate[0].range.start.line, 6);
  assert.equal(oneTerminates.length, 0);
});

test('SM-CODE-001 handles break and continue only inside their statement list', () => {
  const findings = findingsFor(`
while (condition) {
  if (skip) {
    continue;
    print('unreachable after continue');
  }
  break;
  print('unreachable after break');
}
print('reachable after loop');
`, 'SM-CODE-001');

  assert.deepEqual(findings.map(({ range }) => range.start.line), [5, 8]);
});

test('SM-CODE-001 skips hoisted function declarations but retains termination state', () => {
  const findings = findingsFor(`
// Documentation.
function outer() {
  return true;
  function hoisted() {}
  print('unreachable');
}
`, 'SM-CODE-001');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 6);
});

test('SM-LOOP-001 reports unconditional loops without a syntactic exit', () => {
  const findings = findingsFor(`
while (true) { print('forever'); }
for (;;) { continue; }
do { var value = 1; } while (true);
`, 'SM-LOOP-001');

  assert.deepEqual(findings.map(({ range }) => range.start.line), [2, 3, 4]);
});

test('SM-LOOP-001 does not report conditional loops or loops with possible exits', () => {
  const findings = findingsFor(`
while (condition) { print('conditional'); }
while (true) { if (condition) break; }
for (;;) { if (condition) returnValue(); else break; }
do { if (condition) throw new Error('stop'); } while (true);
`, 'SM-LOOP-001');

  assert.equal(findings.length, 0);
});

test('SM-LOOP-001 distinguishes breaks in nested loops and switches', () => {
  const findings = findingsFor(`
outer: while (true) {
  while (condition) { break; }
  switch (value) { case 1: break; }
}
while (true) { break; }
labelled: while (true) { break labelled; }
`, 'SM-LOOP-001');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 2);
});

test('control-flow rules skip syntax-invalid source', () => {
  const result = run('function broken( { while (true) {}');

  assert.equal(result.findings.length, 0);
  assert.ok(result.skippedRules.some(({ ruleId }) => ruleId === 'SM-CODE-001'));
  assert.ok(result.skippedRules.some(({ ruleId }) => ruleId === 'SM-LOOP-001'));
});

