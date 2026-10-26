import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { createAnalysisArtifact } from '../src/parser/analysis-artifact';
import { createBuiltinRuleRegistry } from '../src/rules/builtin';
import { RuleRunner } from '../src/rules/runner';

const review = (content: string) => {
  const source: SourceDocument = {
    id: 'test',
    filePath: 'test.js',
    content,
    hash: 'test-hash',
  };
  return new RuleRunner(createBuiltinRuleRegistry()).run(createAnalysisArtifact(source));
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

test('built-in rules do not run on syntax-invalid source', () => {
  const result = review('function broken( { print("debug");');

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.skippedRules, [
    { ruleId: 'SM-CMT-001', reason: 'syntax-errors' },
    { ruleId: 'SM-DBG-001', reason: 'syntax-errors' },
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

