import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { review } from '../src/reviewer/review';

const run = (content: string) => review({
  id: 'sm-rule-test',
  filePath: 'sm-rule-test.js',
  content,
  hash: 'sm-rule-test',
} as SourceDocument);

const findingsFor = (content: string, ruleId: string) => (
  run(content).findings.filter((finding) => finding.ruleId === ruleId)
);

test('SM-RC-001 reports ignored and assigned-but-unused return codes', () => {
  const findings = findingsFor(`
var first = new SCFile('contacts');
first.doSelect('true');
var second = new SCFile('probsummary');
var rc = second.doUpdate();
`, 'SM-RC-001');

  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map(({ range }) => range.start.line), [3, 5]);
});

test('SM-RC-001 accepts comparisons, direct conditions, returns, and passed results', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
if (rc === RC_SUCCESS) { process(file); }
if (file.doUpdate() == RC_SUCCESS) { process(file); }
handleReturnCode(file.doInsert());
  function remove() { return file.doDelete(); }
`, 'SM-RC-001');

  assert.equal(findings.length, 0);
});

test('SM-RC-001 recognizes loop back-edge consumption of getNext return codes', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (rc == RC_SUCCESS) {
  rc = file.getNext();
}
`, 'SM-RC-001');

  assert.equal(findings.length, 0);
});

test('SM-RC-001 treats ambiguous variable use conservatively', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
var transformed = rc + 1;
`, 'SM-RC-001');

  assert.equal(findings.length, 0);
});

test('SM-RC-001 ignores unknown receivers, dynamic methods, and invalidated bindings', () => {
  const findings = findingsFor(`
unknown.doSelect('true');
var file = new SCFile('contacts');
file['doSelect']('true');
file = createWrapper();
file.doUpdate();
`, 'SM-RC-001');

  assert.equal(findings.length, 0);
});

test('SM-LOOP-002 accepts canonical query loops and equality variants', () => {
  const findings = findingsFor(`
var first = new SCFile('contacts');
var rc1 = first.doSelect('true');
while (rc1 == RC_SUCCESS) { rc1 = first.getNext(); }

var second = new SCFile('probsummary');
var rc2 = second.doSelect('true');
while (RC_SUCCESS === rc2) { rc2 = second.getNext(); }

var third = new SCFile('operator');
var rc3 = third.doSelect('true');
while (!(rc3 != RC_SUCCESS)) { rc3 = third.getNext(); }
`, 'SM-LOOP-002');

  assert.equal(findings.length, 0);
});

test('SM-LOOP-002 reports a tracked success loop without cursor progress', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (rc === RC_SUCCESS) {
  processRecord(file);
}
`, 'SM-LOOP-002');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 4);
  assert.equal(findings[0].classification, 'deterministic');
  assert.equal(findings[0].confidence, 1);
});

test('SM-LOOP-002 reports conditional advancement but accepts a later unconditional update', () => {
  const conditional = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (rc == RC_SUCCESS) {
  if (shouldAdvance) rc = file.getNext();
}
`, 'SM-LOOP-002');
  const eventual = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (rc == RC_SUCCESS) {
  if (shouldAdvance) rc = file.getNext();
  rc = file.getNext();
}
`, 'SM-LOOP-002');

  assert.equal(conditional.length, 1);
  assert.equal(eventual.length, 0);
});

test('SM-LOOP-002 suppresses loops with an early break or return', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (rc == RC_SUCCESS) { if (done) break; process(file); }
while (rc == RC_SUCCESS) { if (done) returnValue(); else return; }
`, 'SM-LOOP-002');

  assert.equal(findings.length, 0);
});

test('SM-LOOP-002 ties progress to the correct SCFile instance and supports aliases', () => {
  const findings = findingsFor(`
var first = new SCFile('contacts');
var second = new SCFile('probsummary');
var alias = first;
var rc1 = alias.doSelect('true');
while (rc1 == RC_SUCCESS) { rc1 = alias.getNext(); }
var rc2 = first.doSelect('true');
while (rc2 == RC_SUCCESS) { rc2 = second.getNext(); }
`, 'SM-LOOP-002');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 8);
});

test('SM-LOOP-002 suppresses unknown reassignment and unsupported nested control flow', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (rc == RC_SUCCESS) { rc = computeNextState(); }
var other = file.doSelect('true');
while (other == RC_SUCCESS) {
  while (condition) { other = file.getNext(); }
}
`, 'SM-LOOP-002');

  assert.equal(findings.length, 0);
});

test('SM-LOOP-002 does not treat a negated success condition as a query-success loop', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (!(rc == RC_SUCCESS)) { process(file); }
`, 'SM-LOOP-002');

  assert.equal(findings.length, 0);
});

test('SM rules skip syntax-invalid source and produce stable evidence-backed findings', () => {
  const invalid = run('var file = new SCFile( ; while (true) {}');
  assert.ok(invalid.skippedRules.some(({ ruleId }) => ruleId === 'SM-RC-001'));
  assert.ok(invalid.skippedRules.some(({ ruleId }) => ruleId === 'SM-LOOP-002'));

  const content = `
var file = new SCFile('contacts');
file.doSelect('true');
var rc = file.getNext();
while (rc == RC_SUCCESS) { process(file); }
`;
  const first = run(content).findings.filter(({ ruleId }) => ruleId.startsWith('SM-RC-')
    || ruleId === 'SM-LOOP-002');
  const second = run(content).findings.filter(({ ruleId }) => ruleId.startsWith('SM-RC-')
    || ruleId === 'SM-LOOP-002');

  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(({ fingerprint }) => fingerprint)).size, first.length);
  assert.ok(first.every(({ evidence }) => evidence.length > 0));
});

