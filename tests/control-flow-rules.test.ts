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

test('SM-CODE-001 keeps nested function control flow independent', () => {
  const findings = findingsFor(`
// Outer documentation.
function outer() {
  // Inner documentation.
  function inner() {
    return true;
    print('unreachable only inside inner');
  }
  print('reachable in outer');
}
`, 'SM-CODE-001');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 7);
});

test('SM-CODE-001 analyzes case statement lists without claiming switch completion', () => {
  const findings = findingsFor(`
// Documentation.
function example(value, flag) {
  switch (value) {
    case 1:
      break;
      print('unreachable after break');
    case 2:
      if (flag) break;
      print('reachable through false branch');
      break;
    default:
      return false;
      print('unreachable after return');
  }
  print('reachable after switch');
}
`, 'SM-CODE-001');

  assert.deepEqual(findings.map(({ range }) => range.start.line), [7, 14]);
});

test('SM-CODE-001 remains conservative for try/catch/finally completion', () => {
  const findings = findingsFor(`
// Documentation.
function example(flag) {
  try {
    if (flag) return true;
  } catch (error) {
    throw error;
    print('unreachable inside catch');
  } finally {
    cleanup();
  }
  print('possibly reachable after try');
}
`, 'SM-CODE-001');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 8);
});

test('SM-CODE-001 emits one finding per unreachable outer statement', () => {
  const findings = findingsFor(`
// Documentation.
function example() {
  return true;
  var expression = function () { return false; };
  var arrow = () => { throw new Error('not executed'); };
  print('also unreachable');
}
`, 'SM-CODE-001');

  assert.deepEqual(findings.map(({ range }) => range.start.line), [5, 6, 7]);
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

test('SM-LOOP-001 ignores return and throw inside nested functions or callbacks', () => {
  const findings = findingsFor(`
while (true) { function inner() { return; } }
while (true) { (() => { throw new Error('callback'); })(); }
`, 'SM-LOOP-001');

  assert.deepEqual(findings.map(({ range }) => range.start.line), [2, 3]);
});

test('SM-LOOP-001 handles labeled exits by their actual target', () => {
  const findings = findingsFor(`
outer: while (true) { break outer; }
while (true) { inner: { break inner; } }
`, 'SM-LOOP-001');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 3);
});

test('SM-LOOP-001 does not treat continue as a loop exit', () => {
  const findings = findingsFor('while (true) { continue; }', 'SM-LOOP-001');

  assert.equal(findings.length, 1);
});

test('SM-LOOP-001 conservatively accepts a syntactic exit with unknown reachability', () => {
  const findings = findingsFor(
    'while (true) { if (false) break; }',
    'SM-LOOP-001',
  );

  // The lightweight analysis does not evaluate constant branches. Suppressing
  // the finding avoids overstating that the loop is proven infinite.
  assert.equal(findings.length, 0);
});

test('control-flow findings satisfy the public finding contract deterministically', () => {
  const content = `
// Documentation.
function example() {
  return true;
  print('unreachable');
}
while (true) { work(); }
`;
  const first = run(content).findings.filter(({ ruleId }) => (
    ruleId === 'SM-CODE-001' || ruleId === 'SM-LOOP-001'
  ));
  const second = run(content).findings.filter(({ ruleId }) => (
    ruleId === 'SM-CODE-001' || ruleId === 'SM-LOOP-001'
  ));

  assert.equal(first.length, 2);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(({ fingerprint }) => fingerprint)).size, 2);
  for (const finding of first) {
    assert.equal(finding.severity, 'warning');
    assert.equal(finding.classification, 'deterministic');
    assert.equal(finding.confidence, 1);
    assert.ok(finding.range.end.offset > finding.range.start.offset);
    assert.ok(finding.evidence.length > 0);
    assert.ok(finding.fingerprint.length > 0);
  }
});

test('control-flow rules skip syntax-invalid source', () => {
  const result = run('function broken( { while (true) {}');

  assert.equal(result.findings.length, 0);
  assert.ok(result.skippedRules.some(({ ruleId }) => ruleId === 'SM-CODE-001'));
  assert.ok(result.skippedRules.some(({ ruleId }) => ruleId === 'SM-LOOP-001'));
});

