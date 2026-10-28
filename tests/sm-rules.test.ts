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

test('SM-RC-001 preserves its approved method scope while setFields is foundation-only', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts', SCFILE_READONLY);
file.setFields('contact.name');
`, 'SM-RC-001');

  assert.equal(findings.length, 0);
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

test('SM-RC-001 treats captured return-code reads as ambiguous, not executed', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var declaredRc = file.doSelect('true');
function declared() { return declaredRc == RC_SUCCESS; }
var expressionRc = file.doUpdate();
var expression = function () { consume(expressionRc); };
var arrowRc = file.doInsert();
var arrow = () => arrowRc === RC_SUCCESS;
`, 'SM-RC-001');

  assert.equal(findings.length, 0);
});

test('SM-RC-001 treats forward closure captures as ambiguous', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
function declared() { return declaredRc == RC_SUCCESS; }
var expression = function () { consume(expressionRc); };
var arrow = () => arrowRc === RC_SUCCESS;
var declaredRc = file.doSelect('true');
var expressionRc = file.doUpdate();
var arrowRc = file.doInsert();
`, 'SM-RC-001');

  assert.equal(findings.length, 0);
});

test('SM-RC-001 keeps parameter shadowing separate from captured return codes', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
function check(rc, file) {
  if (rc == RC_SUCCESS) file.doUpdate();
}
var expression = function (rc) { return rc == RC_SUCCESS; };
var arrow = (rc) => rc === RC_SUCCESS;
`, 'SM-RC-001');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 3);
});

test('SM-RC-001 does not treat calls on captured SCFile bindings as executed', () => {
  const captured = findingsFor(`
var file = new SCFile('contacts');
function later() { file.doSelect('true'); }
var expression = function () { file.doUpdate(); };
var arrow = () => file.doInsert();
`, 'SM-RC-001');
  const local = findingsFor(`
function later() {
  var local = new SCFile('contacts');
  local.doSelect('true');
}
`, 'SM-RC-001');

  assert.equal(captured.length, 0);
  assert.equal(local.length, 1);
});

test('function-body assignments do not invalidate enclosing SCFile state', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var mutate = function () { file = createUnknown(); };
file.doUpdate();
`, 'SM-RC-001');

  assert.equal(findings.length, 1);
  assert.equal(findings[0].range.start.line, 4);
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

test('SM-LOOP-002 recognizes matching SCFile progress in a for incrementor', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
for (; rc == RC_SUCCESS; rc = file.getNext()) {
  processRecord(file);
}
`, 'SM-LOOP-002');

  assert.equal(findings.length, 0);
});

test('SM-LOOP-002 routes continue paths through a for incrementor', () => {
  const safe = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
for (; rc == RC_SUCCESS; rc = file.getNext()) {
  if (skip) continue;
  processRecord(file);
}
`, 'SM-LOOP-002');
  const missing = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
for (; rc == RC_SUCCESS; count += 1) {
  continue;
}
`, 'SM-LOOP-002');

  assert.equal(safe.length, 0);
  assert.equal(missing.length, 1);
});

test('SM-LOOP-002 distinguishes local and outer labeled continue targets', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var localRc = file.doSelect('true');
local: for (; localRc == RC_SUCCESS; localRc = file.getNext()) {
  continue local;
}
var outerRc = file.doSelect('true');
outer: while (keepRunning) {
  for (; outerRc == RC_SUCCESS; count += 1) {
    continue outer;
  }
}
`, 'SM-LOOP-002');

  assert.equal(findings.length, 0);
});

test('SM-LOOP-002 handles wrong and unknown for incrementor updates conservatively', () => {
  const wrongBinding = findingsFor(`
var first = new SCFile('contacts');
var second = new SCFile('probsummary');
var rc = first.doSelect('true');
for (; rc == RC_SUCCESS; rc = second.getNext()) { process(first); }
`, 'SM-LOOP-002');
  const unknown = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
for (; rc == RC_SUCCESS; rc = computeNextState()) { process(file); }
`, 'SM-LOOP-002');
  const conditional = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
for (; rc == RC_SUCCESS; shouldAdvance ? rc = file.getNext() : count += 1) {
  process(file);
}
`, 'SM-LOOP-002');

  assert.equal(wrongBinding.length, 1);
  assert.equal(unknown.length, 0);
  assert.equal(conditional.length, 0);
});

test('SM-LOOP-002 still suppresses for loops with a possible explicit exit', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
for (; rc == RC_SUCCESS; count += 1) {
  if (done) break;
}
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

test('SM-LOOP-002 suppresses loops with an early break, return, or throw', () => {
  const findings = findingsFor(`
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (rc == RC_SUCCESS) { if (done) break; process(file); }
while (rc == RC_SUCCESS) { if (done) returnValue(); else return; }
while (rc == RC_SUCCESS) { if (failed) throw error; }
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

