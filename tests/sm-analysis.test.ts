import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { createAnalysisArtifact } from '../src/parser/analysis-artifact';
import { createRuleContext } from '../src/rules/context';
import { getScFileMethod, listScFileMethods } from '../src/sm/api-catalog';
import { extractSmEvents } from '../src/sm/extract-events';

const analyzeSm = (content: string) => {
  const source: SourceDocument = {
    id: 'sm-analysis-test',
    filePath: 'sm-analysis-test.js',
    content,
    hash: 'sm-analysis-test',
  };
  return extractSmEvents(createRuleContext(createAnalysisArtifact(source)));
};

test('SCFile API catalog contains only approved evidence-backed methods', () => {
  assert.deepEqual(
    listScFileMethods().map(({ method }) => method),
    ['doDelete', 'doInsert', 'doSelect', 'doUpdate', 'getLastRC', 'getNext'],
  );
  for (const method of listScFileMethods()) {
    assert.equal(method.objectType, 'SCFile');
    assert.equal(method.evidenceStatus, 'official');
    assert.ok(method.documentationUrl.startsWith('https://'));
    assert.ok(method.limitations.length > 0);
  }
  assert.equal(getScFileMethod('doClose'), undefined);
});

test('extracts SCFile construction, direct calls, aliases, and return-code comparisons', () => {
  const result = analyzeSm(`
var file = new SCFile('contacts');
var alias = file;
var rc = alias.doSelect('contact.name="test"');
if (RC_SUCCESS == rc) {
  rc = file.getNext();
}
`);

  assert.equal(result.constructions.length, 1);
  assert.equal(result.constructions[0].bindingName, 'file');
  assert.equal(result.constructions[0].evidence.status, 'official');
  assert.ok(result.constructions[0].containingScopeId.length > 0);
  assert.deepEqual(result.calls.map(({ method, receiverName, resultUse }) => [
    method,
    receiverName,
    resultUse,
  ]), [
    ['doSelect', 'alias', 'assigned'],
    ['getNext', 'file', 'assigned'],
  ]);
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.comparisons[0].returnCodeName, 'rc');
  assert.equal(result.comparisons[0].evidence.status, 'official');
});

test('keeps lexical scopes separate and respects SCFile shadowing', () => {
  const result = analyzeSm(`
var outer = new SCFile('contacts');
function nested(SCFile) {
  var fake = new SCFile('contacts');
  fake.doSelect('true');
}
function separate() {
  var outer = {};
  outer.doSelect('true');
}
outer.doSelect('true');
`);

  assert.equal(result.constructions.length, 1);
  assert.deepEqual(result.calls.map(({ receiverName }) => receiverName), ['outer']);
});

test('respects hoisted function and catch-parameter shadowing of SCFile', () => {
  const functionShadow = analyzeSm(`
function SCFile() {}
var fake = new SCFile('contacts');
fake.doSelect('true');
`);
  const catchShadow = analyzeSm(`
try { work(); } catch (SCFile) {
  var fake = new SCFile('contacts');
  fake.doSelect('true');
}
`);

  assert.equal(functionShadow.constructions.length, 0);
  assert.equal(functionShadow.calls.length, 0);
  assert.equal(catchShadow.constructions.length, 0);
  assert.equal(catchShadow.calls.length, 0);
});

test('invalidates bindings on reassignment and rejects deep aliases', () => {
  const result = analyzeSm(`
var file = new SCFile('contacts');
var alias = file;
var deepAlias = alias;
alias = {};
alias.doSelect('true');
deepAlias.doSelect('true');
file = getUnknownFile();
file.getNext();
`);

  assert.equal(result.constructions.length, 1);
  assert.equal(result.calls.length, 0);
});

test('distinguishes multiple SCFile instances and ignores dynamic method access', () => {
  const result = analyzeSm(`
var first = new SCFile('contacts');
var second = new SCFile('probsummary');
first.doUpdate();
first.doInsert();
second.doDelete();
second.getLastRC();
first['doSelect']('true');
`);

  assert.equal(result.constructions.length, 2);
  assert.equal(new Set(result.constructions.map(({ bindingId }) => bindingId)).size, 2);
  assert.deepEqual(result.calls.map(({ method }) => method), [
    'doUpdate',
    'doInsert',
    'doDelete',
    'getLastRC',
  ]);
});

test('analyzes deferred function-local state without executing captured state', () => {
  const result = analyzeSm(`
var outer = new SCFile('contacts');
var rc = outer.doSelect('true');
var callback = function () {
  outer = createUnknown();
  if (rc == RC_SUCCESS) outer.doUpdate();
  var local = new SCFile('probsummary');
  local.doSelect('true');
};
outer.doUpdate();
`);

  assert.deepEqual(result.constructions.map(({ bindingName }) => bindingName), ['outer', 'local']);
  assert.deepEqual(result.calls.map(({ receiverName, method }) => [receiverName, method]), [
    ['outer', 'doSelect'],
    ['local', 'doSelect'],
    ['outer', 'doUpdate'],
  ]);
  assert.equal(result.returnCodes[0].status, 'ambiguous');
});

