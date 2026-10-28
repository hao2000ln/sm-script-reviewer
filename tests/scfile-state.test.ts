import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { createAnalysisArtifact } from '../src/parser/analysis-artifact';
import { createRuleContext } from '../src/rules/context';
import { getScFileStateAnalysis } from '../src/sm/scfile-state';
import { SCFILE_CONTRACT_FIXTURES } from './fixtures/scfile-contract';

function analyze(content: string) {
  const source: SourceDocument = { id: 'scfile-state-test', filePath: 'scfile-state-test.js', content, hash: 'fixture' };
  return getScFileStateAnalysis(createRuleContext(createAnalysisArtifact(source)));
}

function selectedFields(result: ReturnType<typeof analyze>, index = 0): readonly string[] {
  const selection = result.objects[index]?.selectedFields;
  assert.ok(selection, `expected SCFile object at index ${index}`);
  assert.equal(selection.kind, 'selected-fields');
  return selection.fields;
}

test('tracks a READONLY SCFile identity through a local alias and records write evidence', () => {
  const result = analyze("var f = new SCFile('contacts', SCFILE_READONLY);\nvar alias = f;\nalias.doUpdate();");
  const state = result.objects[0];
  assert.equal(state.mode, 'READONLY');
  assert.equal(state.modeCertainty, 'verified');
  assert.equal(state.tableName, 'contacts');
  assert.deepEqual(state.aliases.map(({ bindingName }) => bindingName), ['alias']);
  assert.deepEqual(state.methodCalls.map(({ method }) => method), ['doUpdate']);
  assert.ok(state.evidenceIds.includes(state.methodCalls[0].id));
});

test('indexes setFields literals, reset behaviour, return-code assignment, and normal mode', () => {
  const readonly = analyze("var f = new SCFile('contacts', SCFILE_READONLY);\nvar rc = f.setFields(new Array('contact.name', 'user.id'));\nf.setFields();\nf.doSelect('true');");
  assert.equal(readonly.objects[0].selectedFields.kind, 'all-fields');
  assert.deepEqual(readonly.objects[0].methodCalls.map(({ method }) => method), ['setFields', 'setFields', 'doSelect']);
  const normal = analyze('var f = new SCFile("contacts"); f.setFields(1);');
  assert.equal(normal.objects[0].mode, 'READWRITE');
  assert.equal(normal.objects[0].selectedFields.kind, 'unknown');
});

test('records reassignment but stops tracking calls after the identity becomes unknown', () => {
  const result = analyze("var f = new SCFile('contacts', SCFILE_READONLY);\nvar alias = f;\nalias = getUnknown();\nalias.doUpdate();");
  const state = result.objects[0];
  assert.equal(state.mutations.length, 1);
  assert.equal(state.mutations[0].bindingName, 'alias');
  assert.equal(state.methodCalls.length, 0);
});

test('does not treat a deferred closure over an outer SCFile as executed state', () => {
  const result = analyze("var f = new SCFile('contacts', SCFILE_READONLY);\nfunction later() { f.doUpdate(); }");
  assert.equal(result.objects[0].methodCalls.length, 0);
  assert.ok(result.unsupported.some((message) => message.includes('interprocedural')));
});

test('does not apply deferred function declaration setFields calls to outer execution state', () => {
  const result = analyze(`
var f = new SCFile('contacts', SCFILE_READONLY);
f.setFields(['contact.name']);
function configureLater() {
  f.setFields(['phone']);
}
`);
  assert.deepEqual(selectedFields(result), ['contact.name']);
});

test('keeps local SCFile state isolated for functions that reuse the same variable name', () => {
  const result = analyze(`
function contacts() {
  var file = new SCFile('contacts', SCFILE_READONLY);
  file.setFields(['contact.name']);
}
function phones() {
  var file = new SCFile('phones', SCFILE_READONLY);
  file.setFields(['phone']);
}
`);
  assert.equal(result.objects.length, 2);
  assert.equal(result.objects[0].tableName, 'contacts');
  assert.deepEqual(selectedFields(result, 0), ['contact.name']);
  assert.equal(result.objects[1].tableName, 'phones');
  assert.deepEqual(selectedFields(result, 1), ['phone']);
});

test('does not apply a declaration before a constructor as an invocation of its captured state', () => {
  const result = analyze(`
function configureLater() {
  f.setFields(['phone']);
}
var f = new SCFile('contacts', SCFILE_READONLY);
f.setFields(['contact.name']);
`);
  assert.deepEqual(selectedFields(result), ['contact.name']);
});

test('tracks multiple independent SCFile objects in one function without cross-object state', () => {
  const result = analyze(`
function load() {
  var contacts = new SCFile('contacts', SCFILE_READONLY);
  var phones = new SCFile('phones', SCFILE_READONLY);
  contacts.setFields(['contact.name']);
  phones.setFields(['phone']);
}
`);
  assert.equal(result.objects.length, 2);
  assert.deepEqual(selectedFields(result, 0), ['contact.name']);
  assert.deepEqual(selectedFields(result, 1), ['phone']);
});

test('merges mutually exclusive setFields selections conservatively', () => {
  const different = analyze(`
var f = new SCFile('contacts', SCFILE_READONLY);
if (condition) { f.setFields(['contact.name']); } else { f.setFields(['phone']); }
`);
  const onePath = analyze(`
var f = new SCFile('contacts', SCFILE_READONLY);
if (condition) { f.setFields(['contact.name']); }
`);
  const same = analyze(`
var f = new SCFile('contacts', SCFILE_READONLY);
if (condition) { f.setFields(['contact.name']); } else { f.setFields(['contact.name']); }
`);
  assert.equal(different.objects[0].selectedFields.kind, 'unknown');
  assert.equal(onePath.objects[0].selectedFields.kind, 'unknown');
  assert.deepEqual(same.objects[0].selectedFields, {
    kind: 'selected-fields', fields: ['contact.name'],
    range: same.objects[0].selectedFields.range, evidenceId: same.objects[0].selectedFields.evidenceId,
  });
});

test('SCFile acceptance fixtures declare all requested categories without emitting diagnostics', () => {
  assert.equal(SCFILE_CONTRACT_FIXTURES.length, 16);
  assert.ok(SCFILE_CONTRACT_FIXTURES.some(({ name, classification }) => name === 'readonly-remove' && classification === 'unknown'));
  assert.ok(SCFILE_CONTRACT_FIXTURES.some(({ name, classification }) => name === 'field-outside-selection' && classification === 'contract-dependent'));
  for (const fixture of SCFILE_CONTRACT_FIXTURES) assert.doesNotThrow(() => analyze(fixture.source), fixture.name);
});
