import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { createAnalysisArtifact } from '../src/parser/analysis-artifact';
import { RuleRegistry } from '../src/rules/registry';
import { RuleRunner, RuleConfigurationError } from '../src/rules/runner';
import type { Rule } from '../src/rules/types';

const source = (content = 'function run() {}'): SourceDocument => ({
  id: 'test',
  filePath: 'test.js',
  content,
  hash: 'test-hash',
});

const rule = (
  id: string,
  overrides: Partial<Rule> = {},
): Rule => ({
  metadata: {
    id,
    title: id,
    description: `${id} description`,
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => [{
    message: `${id} finding`,
    range: context.range(0, 1),
    evidence: [{
      kind: 'source-pattern',
      message: 'matched source',
      range: context.range(0, 1),
    }],
  }],
  ...overrides,
});

test('registry rejects duplicate IDs and returns rules in ID order', () => {
  const registry = new RuleRegistry([rule('SM-ZZZ-001'), rule('SM-AAA-001')]);
  assert.deepEqual(registry.all().map(({ metadata }) => metadata.id), [
    'SM-AAA-001',
    'SM-ZZZ-001',
  ]);
  assert.throws(
    () => new RuleRegistry([rule('SM-DUP-001'), rule('SM-DUP-001')]),
    /Duplicate rule ID: SM-DUP-001/u,
  );
});

test('runner supports disabling rules and overriding severity', () => {
  const runner = new RuleRunner(new RuleRegistry([
    rule('SM-OFF-001'),
    rule('SM-ON-001'),
  ]));
  const result = runner.run(createAnalysisArtifact(source()), {
    rules: {
      'SM-OFF-001': false,
      'SM-ON-001': { severity: 'error' },
    },
  });

  assert.deepEqual(result.findings.map(({ ruleId, severity }) => [ruleId, severity]), [
    ['SM-ON-001', 'error'],
  ]);
  assert.deepEqual(result.skippedRules, [{ ruleId: 'SM-OFF-001', reason: 'disabled' }]);
});

test('runner rejects unknown rules, invalid severity, and invalid options before execution', () => {
  let executions = 0;
  const configurable = rule('SM-CFG-001', {
    validateOptions: (options) => (
      options.allowed === true ? [] : ['options.allowed must be true']
    ),
    run: () => {
      executions += 1;
      return [];
    },
  });
  const runner = new RuleRunner(new RuleRegistry([configurable]));
  const artifact = createAnalysisArtifact(source());

  assert.throws(
    () => runner.run(artifact, { rules: { 'SM-UNKNOWN-001': {} } }),
    RuleConfigurationError,
  );
  assert.throws(
    () => runner.run(artifact, {
      rules: { 'SM-CFG-001': { severity: 'urgent' as 'error' } },
    }),
    /Invalid severity/u,
  );
  assert.throws(
    () => runner.run(artifact, {
      rules: { 'SM-CFG-001': { options: { allowed: false } } },
    }),
    /options.allowed must be true/u,
  );
  assert.equal(executions, 0);
});

test('runner isolates rule exceptions and continues other rules', () => {
  const broken = rule('SM-BROKEN-001', {
    run: () => { throw new Error('private stack detail'); },
  });
  const runner = new RuleRunner(new RuleRegistry([broken, rule('SM-GOOD-001')]));
  const result = runner.run(createAnalysisArtifact(source()));

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].ruleId, 'SM-GOOD-001');
  assert.deepEqual(result.ruleErrors, [{
    ruleId: 'SM-BROKEN-001',
    message: 'private stack detail',
  }]);
});

test('runner discards partial findings when a rule fails during iteration', () => {
  const partiallyBroken = rule('SM-PARTIAL-001', {
    run: (context) => [
      {
          message: 'must not escape failed rule',
          range: context.range(0, 1),
          evidence: [],
      },
      {
        message: 'broken candidate',
        range: context.range(1, 2),
        get evidence(): never {
          throw new Error('normalization failed');
        },
      },
    ],
  });
  const result = new RuleRunner(new RuleRegistry([partiallyBroken]))
    .run(createAnalysisArtifact(source()));

  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.ruleErrors, [{
    ruleId: 'SM-PARTIAL-001',
    message: 'normalization failed',
  }]);
});

test('runner deduplicates findings from one rule but preserves cross-rule findings', () => {
  const duplicate = rule('SM-DUP-A', {
    run: (context) => {
      const candidate = {
        message: 'same finding',
        range: context.range(0, 1),
        evidence: [{
          kind: 'source-pattern' as const,
          message: 'same evidence',
          range: context.range(0, 1),
        }],
      };
      return [candidate, candidate];
    },
  });
  const other = rule('SM-DUP-B', {
    run: (context) => [{
      message: 'same finding',
      range: context.range(0, 1),
      evidence: [{
        kind: 'source-pattern',
        message: 'same evidence',
        range: context.range(0, 1),
      }],
    }],
  });
  const result = new RuleRunner(new RuleRegistry([other, duplicate]))
    .run(createAnalysisArtifact(source()));

  assert.deepEqual(result.findings.map(({ ruleId }) => ruleId), ['SM-DUP-A', 'SM-DUP-B']);
  assert.notEqual(result.findings[0].fingerprint, result.findings[1].fingerprint);
});

test('runner orders findings by range then rule ID and evidence by range', () => {
  const unordered = rule('SM-ORDER-B', {
    run: (context) => [{
      message: 'later',
      range: context.range(10, 11),
      evidence: [
        { kind: 'ast', message: 'later evidence', range: context.range(8, 9) },
        { kind: 'ast', message: 'earlier evidence', range: context.range(3, 4) },
      ],
    }, {
      message: 'earlier',
      range: context.range(2, 3),
      evidence: [],
    }],
  });
  const sameRange = rule('SM-ORDER-A', {
    run: (context) => [{ message: 'same offset', range: context.range(2, 3), evidence: [] }],
  });
  const result = new RuleRunner(new RuleRegistry([unordered, sameRange]))
    .run(createAnalysisArtifact(source('abcdefghijklm;')));

  assert.deepEqual(result.findings.map(({ ruleId, message }) => [ruleId, message]), [
    ['SM-ORDER-A', 'same offset'],
    ['SM-ORDER-B', 'earlier'],
    ['SM-ORDER-B', 'later'],
  ]);
  assert.deepEqual(
    result.findings[2].evidence.map(({ message }) => message),
    ['earlier evidence', 'later evidence'],
  );
});

test('valid-only rules are skipped for parse errors while recoverable rules are marked', () => {
  const recoverable = rule('SM-RECOVER-001', {
    metadata: {
      ...rule('ignored').metadata,
      id: 'SM-RECOVER-001',
      syntaxPolicy: 'recoverable',
    },
  });
  const runner = new RuleRunner(new RuleRegistry([
    rule('SM-VALID-001'),
    recoverable,
  ]));
  const result = runner.run(createAnalysisArtifact(source('function broken( {')));

  assert.deepEqual(result.findings.map(({ ruleId, analysisStatus }) => [ruleId, analysisStatus]), [
    ['SM-RECOVER-001', 'recovered'],
  ]);
  assert.deepEqual(result.skippedRules, [{
    ruleId: 'SM-VALID-001',
    reason: 'syntax-errors',
  }]);
});

