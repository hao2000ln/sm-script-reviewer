import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { SourceDocument } from '../src/core/types';
import { review } from '../src/reviewer/review';

const runHeuristics = (content: string) => review({
  id: 'comment-test',
  filePath: 'comment-test.js',
  content,
  hash: 'comment-test',
} as SourceDocument, {
  rules: {
    'SM-CMT-002': { enabled: true },
    'SM-CMT-003': { enabled: true },
  },
});

test('comment heuristic rules are disabled by default', () => {
  const result = review({
    id: 'comment-test',
    filePath: 'comment-test.js',
    content: '// var oldValue = 1;\n// -----',
    hash: 'comment-test',
  });

  assert.equal(result.findings.length, 0);
  assert.ok(result.skippedRules.some(({ ruleId, reason }) => (
    ruleId === 'SM-CMT-002' && reason === 'disabled'
  )));
  assert.ok(result.skippedRules.some(({ ruleId, reason }) => (
    ruleId === 'SM-CMT-003' && reason === 'disabled'
  )));
});

test('SM-CMT-002 reports strong commented-out code patterns with confidence', () => {
  const result = runHeuristics(`
// var oldValue = 1;
/* if (ready) { run(); } */
// Explain why the value is retained.
// See http://example.test/path
`);
  const findings = result.findings.filter(({ ruleId }) => ruleId === 'SM-CMT-002');

  assert.equal(findings.length, 2);
  assert.ok(findings.every(({ classification }) => classification === 'heuristic'));
  assert.ok(findings.every(({ confidence }) => confidence > 0 && confidence < 1));
});

test('SM-CMT-002 avoids prose and comment-like text in strings or templates', () => {
  const result = runHeuristics([
    '// function behavior is documented here.',
    '// return codes must be checked.',
    'var url = "http://example.test/var x = 1;";',
    'var template = `// if (ready) run();`;',
  ].join('\n'));

  assert.equal(
    result.findings.filter(({ ruleId }) => ruleId === 'SM-CMT-002').length,
    0,
  );
});

test('SM-CMT-003 reports only empty and separator comments', () => {
  const result = runHeuristics(`
//
// --------
/* *** */
// Useful explanation.
`);
  const findings = result.findings.filter(({ ruleId }) => ruleId === 'SM-CMT-003');

  assert.equal(findings.length, 3);
  assert.ok(findings.every(({ classification }) => classification === 'heuristic'));
  assert.ok(findings.some(({ confidence }) => confidence === 0.98));
  assert.ok(findings.some(({ confidence }) => confidence === 0.85));
});

