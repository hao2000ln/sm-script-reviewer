import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  isSupportedDocument,
  reviewInMemoryDocument,
  toEditorPosition,
  toEditorRange,
  toEditorSeverity,
} from '../src/review-adapter';
import { ReviewLifecycle, shouldReviewOnSave } from '../src/review-lifecycle';
import { resolveReviewPreset } from '../../src/reviewer/presets';
import { review } from '../../src/reviewer/review';

test('maps static severity to VS Code diagnostic severity', () => {
  assert.equal(toEditorSeverity('critical'), 'error');
  assert.equal(toEditorSeverity('error'), 'error');
  assert.equal(toEditorSeverity('warning'), 'warning');
  assert.equal(toEditorSeverity('info'), 'information');
});

test('converts 1-based UTF-16 locations to 0-based end-exclusive editor ranges', () => {
  assert.deepEqual(toEditorPosition({ line: 2, column: 3, offset: 4 }), {
    line: 1,
    character: 2,
  });
  assert.deepEqual(toEditorRange({
    start: { line: 1, column: 3, offset: 2 },
    end: { line: 1, column: 5, offset: 4 },
  }), {
    start: { line: 0, character: 2 },
    end: { line: 0, character: 4 },
  });
  assert.deepEqual(toEditorPosition({ line: 1, column: 3, offset: 2 }), {
    line: 0,
    character: 2,
  });
});

test('preserves zero-length ranges safely', () => {
  const range = toEditorRange({
    start: { line: 3, column: 1, offset: 12 },
    end: { line: 3, column: 1, offset: 12 },
  });
  assert.deepEqual(range.start, range.end);
});

test('reviews unsaved in-memory JavaScript without executing it', () => {
  (globalThis as { executed?: boolean }).executed = false;
  const reviewed = reviewInMemoryDocument({
    uri: 'untitled:ScriptLibrary.js',
    fileName: 'ScriptLibrary.js',
    languageId: 'javascript',
    text: 'globalThis.executed = true;\nprint("debug");',
    version: 7,
  });
  assert.equal(reviewed.supported, true);
  if (!reviewed.supported) return;
  assert.equal((globalThis as { executed?: boolean }).executed, false);
  const debug = reviewed.diagnostics.find(({ code }) => code === 'SM-DBG-001');
  assert.ok(debug);
  assert.ok(debug.suggestion);
  assert.ok(debug.evidence.length > 0);
});

test('rejects unsupported documents and supports ScriptLibrary text files', () => {
  assert.equal(isSupportedDocument({ fileName: 'notes.md', languageId: 'markdown' }), false);
  assert.equal(isSupportedDocument({ fileName: 'ScriptLibrary.txt', languageId: 'plaintext' }), true);
  const unsupported = reviewInMemoryDocument({
    uri: 'file:///notes.md', fileName: 'notes.md', languageId: 'markdown', text: '# notes', version: 1,
  });
  assert.equal(unsupported.supported, false);
});

test('save settings and lifecycle prevent stale diagnostics from being applied', () => {
  assert.equal(shouldReviewOnSave(true, true), true);
  assert.equal(shouldReviewOnSave(false, true), false);
  assert.equal(shouldReviewOnSave(true, false), false);
  const lifecycle = new ReviewLifecycle();
  const first = lifecycle.begin('file:///script.js', 1);
  const second = lifecycle.begin('file:///script.js', 2);
  assert.equal(lifecycle.isCurrent(first, 1), false);
  assert.equal(lifecycle.isCurrent(second, 1), false);
  assert.equal(lifecycle.isCurrent(second, 2), true);
  lifecycle.clear('file:///script.js');
  assert.equal(lifecycle.isCurrent(second, 2), false);
});

test('lifecycle invalidation cannot reuse a cleared URI generation', () => {
  const lifecycle = new ReviewLifecycle();
  const uri = 'file:///script.js';
  const beforeClear = lifecycle.begin(uri, 1);

  lifecycle.clear(uri);
  const afterClear = lifecycle.begin(uri, 1);
  assert.notEqual(afterClear.generation, beforeClear.generation);
  assert.equal(lifecycle.isCurrent(beforeClear, 1), false);
  assert.equal(lifecycle.isCurrent(afterClear, 1), true);
});

test('global lifecycle invalidation rejects tokens before clearAll', () => {
  const lifecycle = new ReviewLifecycle();
  const uri = 'file:///script.js';
  const beforeClearAll = lifecycle.begin(uri, 1);

  lifecycle.clearAll();
  const afterClearAll = lifecycle.begin(uri, 1);
  assert.equal(afterClearAll.generation, beforeClearAll.generation);
  assert.notEqual(afterClearAll.epoch, beforeClearAll.epoch);
  assert.equal(lifecycle.isCurrent(beforeClearAll, 1), false);
  assert.equal(lifecycle.isCurrent(afterClearAll, 1), true);
});

test('an edit invalidates completed AI diagnostics without affecting another document token', () => {
  const aiLifecycle = new ReviewLifecycle();
  const edited = aiLifecycle.begin('file:///edited.js', 1);
  const unrelated = aiLifecycle.begin('file:///unrelated.js', 1);

  aiLifecycle.clear('file:///edited.js');
  assert.equal(aiLifecycle.isCurrent(edited, 1), false);
  assert.equal(aiLifecycle.isCurrent(unrelated, 1), true);
});

test('an edit invalidates a pending AI review before its response can publish', () => {
  const aiLifecycle = new ReviewLifecycle();
  const pending = aiLifecycle.begin('file:///edited.js', 1);

  // onDidChangeTextDocument calls clear before the asynchronous provider settles.
  aiLifecycle.clear('file:///edited.js');
  assert.equal(aiLifecycle.isCurrent(pending, 2), false);
  assert.equal(aiLifecycle.isCurrent(pending, 1), false);
});

test('reuses SM static rules in the extension adapter', () => {
  const reviewed = reviewInMemoryDocument({
    uri: 'file:///sm.js',
    fileName: 'sm.js',
    languageId: 'javascript',
    text: `/** Review SCFile loop. */
function loop() {
  var file = new SCFile("contacts");
  var rc = file.doSelect('true');
  while (rc == RC_SUCCESS) { print(file.name); }
}`,
    version: 1,
  });
  assert.equal(reviewed.supported, true);
  if (!reviewed.supported) return;
  assert.ok(reviewed.diagnostics.some(({ code }) => code === 'SM-LOOP-002'));
  assert.ok(reviewed.diagnostics.some(({ code }) => code === 'SM-DBG-001'));
});

test('supports the shared V1 production preset without a separate extension rule pipeline', () => {
  const reviewed = reviewInMemoryDocument({
    uri: 'file:///v1.js', fileName: 'v1.js', languageId: 'javascript',
    text: 'function undocumented() { print("debug"); }', version: 1,
  }, resolveReviewPreset('v1-production'));
  assert.equal(reviewed.supported, true);
  if (!reviewed.supported) return;
  assert.equal(reviewed.diagnostics.length, 0);
});

test('matches core V1 preset findings used by the CLI', () => {
  const config = resolveReviewPreset('v1-production');
  const reviewed = reviewInMemoryDocument({
    uri: 'file:///v1-sm.js', fileName: 'v1-sm.js', languageId: 'javascript',
    text: 'var file = new SCFile("contacts"); file.doDelete();', version: 1,
  }, config);
  assert.equal(reviewed.supported, true);
  if (!reviewed.supported) return;
  const core = review(reviewed.source, config);
  assert.deepEqual(
    reviewed.diagnostics.map(({ code }) => code),
    core.findings.map(({ ruleId }) => ruleId),
  );
  assert.deepEqual(core.findings.map(({ ruleId }) => ruleId), ['SM-RC-001']);
});

test('reports parse diagnostics separately with a zero-length range', () => {
  const reviewed = reviewInMemoryDocument({
    uri: 'file:///broken.js', fileName: 'broken.js', languageId: 'javascript',
    text: 'function broken( {', version: 1,
  });
  assert.equal(reviewed.supported, true);
  if (!reviewed.supported) return;
  const diagnostic = reviewed.diagnostics.find(({ code }) => code === 'SM-PARSE');
  assert.ok(diagnostic);
  assert.equal(diagnostic.severity, 'error');
  assert.deepEqual(diagnostic.range.start, diagnostic.range.end);
});
