import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { createAnalysisArtifact } from '../src/parser/analysis-artifact';
import { createBuiltinRuleRegistry } from '../src/rules/builtin';
import { RuleRunner } from '../src/rules/runner';

const review = (content: string, config: Parameters<RuleRunner['run']>[1] = {}) => {
  const source: SourceDocument = {
    id: 'test',
    filePath: 'test.js',
    content,
    hash: 'test-hash',
  };
  return new RuleRunner(createBuiltinRuleRegistry()).run(createAnalysisArtifact(source), config);
};

test('SM-CMT-001 reports named functions without a leading comment', () => {
  const result = review(`
// Documented declaration.
function documented() {}
function missing() {}
const arrowMissing = () => {};
const object = {
  /** Documented method. */
  documentedMethod() {},
  missingProperty: function () {},
};
`);

  assert.deepEqual(
    result.findings
      .filter(({ ruleId }) => ruleId === 'SM-CMT-001')
      .map(({ message }) => message),
    [
      'Function "missing" has no leading comment.',
      'Function "arrowMissing" has no leading comment.',
      'Function "missingProperty" has no leading comment.',
    ],
  );
});

test('SM-CMT-001 skips anonymous functions and honors nested function comments', () => {
  const result = review(`
(function () {})();
function outer() {
  // Nested documentation.
  function nested() {}
}
`);

  const findings = result.findings.filter(({ ruleId }) => ruleId === 'SM-CMT-001');
  assert.deepEqual(findings.map(({ message }) => message), [
    'Function "outer" has no leading comment.',
  ]);
});

test('SM-CMT-001 public-functions reports only undocumented source-root declarations', () => {
  const result = review(`
function publicMissing() {}
function outer() { function nestedMissing() {} }
var expressionMissing = function namedExpression() {};
var arrowMissing = () => {};
(function callbackMissing() {})();
`, { rules: { 'SM-CMT-001': { options: { mode: 'public-functions' } } } });
  assert.deepEqual(result.findings.filter(({ ruleId }) => ruleId === 'SM-CMT-001').map(({ message }) => message), [
    'Function "publicMissing" has no leading comment.',
    'Function "outer" has no leading comment.',
  ]);
});

test('SM-CMT-001 off emits no findings and rejects invalid modes', () => {
  assert.equal(review('function missing() {}', {
    rules: { 'SM-CMT-001': { options: { mode: 'off' } } },
  }).findings.filter(({ ruleId }) => ruleId === 'SM-CMT-001').length, 0);
  assert.throws(() => review('function missing() {}', {
    rules: { 'SM-CMT-001': { options: { mode: 'everywhere' } } },
  }), /SM-CMT-001 mode must be one of/u);
});

test('SM-DBG-001 reports only direct print calls', () => {
  const result = review(`
print("debug");
obj.print("not a direct call");
const print = function () {};
print.call(null, "not a direct call");
`);

  const findings = result.findings.filter(({ ruleId }) => ruleId === 'SM-DBG-001');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, 'Remove direct print() debug output from production code.');
  assert.equal(findings[0].range.start.line, 2);
  assert.equal(findings[0].range.start.column, 1);
  assert.equal(findings[0].range.end.offset, 15);
  assert.equal(findings[0].severity, 'warning');
  assert.equal(findings[0].classification, 'deterministic');
  assert.equal(findings[0].confidence, 1);
});

test('SM-DBG-001 debug-patterns reports only statically known explicit markers as heuristic info', () => {
  const result = review(`
print("DEBUG: start");
print(` + '`TRACE request`' + `);
print("TEMP DEBUG cleanup");
print("debugging output");
print("notrace");
print(dynamicMessage);
`, { rules: { 'SM-DBG-001': { options: { mode: 'debug-patterns' } } } });
  const findings = result.findings.filter(({ ruleId }) => ruleId === 'SM-DBG-001');
  assert.equal(findings.length, 3);
  assert.ok(findings.every(({ severity, classification, confidence }) => (
    severity === 'info' && classification === 'heuristic' && confidence === 0.9
  )));
});

test('SM-DBG-001 off emits no findings, honors severity override, and rejects invalid modes', () => {
  assert.equal(review('print("DEBUG");', {
    rules: { 'SM-DBG-001': { options: { mode: 'off' } } },
  }).findings.filter(({ ruleId }) => ruleId === 'SM-DBG-001').length, 0);
  assert.equal(review('print("DEBUG");', {
    rules: { 'SM-DBG-001': { severity: 'warning', options: { mode: 'debug-patterns' } } },
  }).findings.find(({ ruleId }) => ruleId === 'SM-DBG-001')?.severity, 'warning');
  assert.throws(() => review('print("x");', {
    rules: { 'SM-DBG-001': { options: { mode: 'only-debug' } } },
  }), /SM-DBG-001 mode must be one of/u);
});

test('built-in rules do not run on syntax-invalid source', () => {
  const result = review('function broken( { print("debug");');

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.skippedRules, [
    { ruleId: 'SM-CMT-001', reason: 'syntax-errors' },
    { ruleId: 'SM-CMT-002', reason: 'disabled' },
    { ruleId: 'SM-CMT-003', reason: 'disabled' },
    { ruleId: 'SM-CODE-001', reason: 'syntax-errors' },
    { ruleId: 'SM-DBG-001', reason: 'syntax-errors' },
    { ruleId: 'SM-LOOP-001', reason: 'syntax-errors' },
    { ruleId: 'SM-LOOP-002', reason: 'syntax-errors' },
    { ruleId: 'SM-RC-001', reason: 'syntax-errors' },
    { ruleId: 'SM-SCF-001', reason: 'syntax-errors' },
    { ruleId: 'SM-SCF-002', reason: 'syntax-errors' },
    { ruleId: 'SM-SCF-003', reason: 'syntax-errors' },
    { ruleId: 'SM-SCF-004', reason: 'syntax-errors' },
  ]);
});

test('built-in severity can be overridden and rule can be disabled', () => {
  const artifact = createAnalysisArtifact({
    id: 'test',
    filePath: 'test.js',
    content: 'function missing() {}\nprint("debug");',
    hash: 'test-hash',
  });
  const result = new RuleRunner(createBuiltinRuleRegistry()).run(artifact, {
    rules: {
      'SM-CMT-001': false,
      'SM-DBG-001': { severity: 'error' },
    },
  });

  assert.deepEqual(result.findings.map(({ ruleId, severity }) => [ruleId, severity]), [
    ['SM-DBG-001', 'error'],
  ]);
});

