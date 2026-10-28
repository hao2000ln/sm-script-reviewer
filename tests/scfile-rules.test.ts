import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { review } from '../src/reviewer/review';

function run(content: string) {
  return review({ id: 'scfile-rule-test', filePath: 'scfile-rule-test.js', content, hash: content } as SourceDocument);
}

function findings(content: string, ruleId: string) {
  return run(content).findings.filter((finding) => finding.ruleId === ruleId);
}

test('SM-SCF-001 reports verified READONLY write operations with constructor evidence', () => {
  const result = run(`
var f = new SCFile('contacts', SCFILE_READONLY);
f.doUpdate();
f.doInsert();
f.doDelete();
`);
  const found = result.findings.filter(({ ruleId }) => ruleId === 'SM-SCF-001');
  assert.equal(found.length, 3);
  assert.deepEqual(found.map(({ range }) => range.start.line), [3, 4, 5]);
  assert.ok(found.every(({ severity, classification, confidence, evidence }) => severity === 'error'
    && classification === 'deterministic' && confidence === 1 && evidence.length === 2));
});

test('SM-SCF-001 accepts normal and unknown modes, reassignment, shadowing, and deferred captures', () => {
  const found = findings(`
var normal = new SCFile('contacts'); normal.doUpdate();
var unknown = new SCFile('contacts', mode); unknown.doUpdate();
var f = new SCFile('contacts', SCFILE_READONLY); var alias = f; alias = createUnknown(); alias.doUpdate();
function later() { f.doUpdate(); }
function scoped() { var f = new SCFile('contacts'); f.doUpdate(); }
`, 'SM-SCF-001');
  assert.equal(found.length, 0);
});

test('SM-SCF-001 recognizes one-hop aliases and conditional direct writes without duplicate findings', () => {
  const source = `
var f = new SCFile('contacts', SCFILE_READONLY);
var alias = f;
if (shouldWrite) alias.doUpdate();
`;
  const first = findings(source, 'SM-SCF-001');
  const second = findings(source, 'SM-SCF-001');
  assert.equal(first.length, 1);
  assert.equal(first[0].range.start.line, 4);
  assert.deepEqual(first, second);
});

test('SM-SCF-002 warns only for known non-READONLY setFields calls', () => {
  const found = findings(`
var normal = new SCFile('contacts'); normal.setFields(['phone']);
var readonly = new SCFile('contacts', SCFILE_READONLY); readonly.setFields(['phone']);
var unknown = new SCFile('contacts', mode); unknown.setFields(['phone']);
`, 'SM-SCF-002');
  assert.equal(found.length, 1);
  assert.equal(found[0].severity, 'warning');
  assert.equal(found[0].range.start.line, 2);
  assert.equal(found[0].evidence.length, 2);
});

test('SM-SCF-003 reports only proven setFields type and count violations', () => {
  const found = findings(`
var f = new SCFile('contacts', SCFILE_READONLY);
f.setFields(123);
f.setFields(true);
f.setFields({ name: 'phone' });
f.setFields(['phone', 123]);
f.setFields('phone', 'name');
f.setFields();
f.setFields('phone name');
f.setFields(['phone', 'name']);
f.setFields(new Array('phone', 'name'));
f.setFields(dynamicFields);
`, 'SM-SCF-003');
  assert.equal(found.length, 5);
  assert.deepEqual(found.map(({ range }) => range.start.line), [3, 4, 5, 6, 7]);
  assert.ok(found.every(({ severity, confidence }) => severity === 'error' && confidence === 1));
});

test('SM-SCF-002 does not duplicate an invalid-argument finding on the same call', () => {
  const source = "var f = new SCFile('contacts'); f.setFields(123);";
  assert.equal(findings(source, 'SM-SCF-002').length, 0);
  assert.equal(findings(source, 'SM-SCF-003').length, 1);
});

test('SM-SCF-004 reports only proven constructor count and literal-type violations', () => {
  const found = findings(`
new SCFile('contacts', SCFILE_READONLY);
new SCFile();
new SCFile({ record: true });
new SCFile('contacts', mode);
new SCFile(123);
new SCFile(true);
new SCFile('contacts', true);
new SCFile('contacts', 'readonly');
new SCFile('contacts', SCFILE_READONLY, 'extra');
`, 'SM-SCF-004');
  assert.equal(found.length, 5);
  assert.deepEqual(found.map(({ range }) => range.start.line), [6, 7, 8, 9, 10]);
  assert.ok(found.every(({ severity }) => severity === 'error'));
});

test('write return codes remain exactly one SM-RC-001 finding with no SM-RC-003 duplicate', () => {
  const result = run("var f = new SCFile('contacts'); f.doUpdate();");
  assert.equal(result.findings.filter(({ ruleId }) => ruleId === 'SM-RC-001').length, 1);
  assert.equal(result.findings.filter(({ ruleId }) => ruleId === 'SM-RC-003').length, 0);
  assert.equal(run("var f = new SCFile('contacts'); var rc = f.doUpdate(); if (rc == RC_SUCCESS) {};").findings
    .filter(({ ruleId }) => ruleId === 'SM-RC-001').length, 0);
});

test('does not claim doRemove as a verified native write operation', () => {
  const result = run("var f = new SCFile('contacts', SCFILE_READONLY); f.doRemove();");
  assert.equal(result.findings.filter(({ ruleId }) => ruleId.startsWith('SM-SCF-')).length, 0);
});
