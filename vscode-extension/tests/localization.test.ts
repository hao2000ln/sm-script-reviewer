import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { localizeDiagnostic, resolveLanguage } from '../src/localization';
import type { ReviewDiagnosticData } from '../src/review-adapter';

const diagnostic = (ruleId: string, message: string): ReviewDiagnosticData => ({
  code: ruleId, severity: 'warning', message, suggestion: 'English suggestion.', evidence: [],
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  finding: { ruleId, message, suggestion: 'English suggestion.' } as never,
});

test('localizes dynamic comment, debug, and loop findings into Vietnamese', () => {
  assert.match(localizeDiagnostic(diagnostic('SM-CMT-001', 'Function "loadContacts" has no leading comment.'), 'vi').message, /loadContacts/u);
  assert.match(localizeDiagnostic(diagnostic('SM-DBG-001', 'Remove direct print() debug output from production code.'), 'vi').message, /debug/u);
  assert.match(localizeDiagnostic(diagnostic('SM-LOOP-002', 'loop'), 'vi').message, /getNext/u);
  assert.match(localizeDiagnostic(diagnostic('SM-SCF-001', 'write'), 'vi').message, /SCFILE_READONLY/u);
  assert.match(localizeDiagnostic(diagnostic('SM-SCF-002', 'mode'), 'vi').message, /setFields/u);
  assert.match(localizeDiagnostic(diagnostic('SM-SCF-003', 'args'), 'vi').message, /setFields/u);
  assert.match(localizeDiagnostic(diagnostic('SM-SCF-004', 'constructor'), 'vi').message, /constructor/u);
});
test('keeps English and unknown translations unchanged', () => {
  const unknown = diagnostic('SM-X-001', 'Original message');
  assert.equal(localizeDiagnostic(unknown, 'en').message, 'Original message');
  assert.equal(localizeDiagnostic(unknown, 'vi').message, 'Original message');
});
test('auto language follows Vietnamese VS Code UI only', () => {
  assert.equal(resolveLanguage('auto', 'vi'), 'vi');
  assert.equal(resolveLanguage('auto', 'en-us'), 'en');
  assert.equal(resolveLanguage('vi', 'en-us'), 'vi');
});
