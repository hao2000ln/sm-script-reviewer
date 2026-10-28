import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { review } from '../src/reviewer/review';
import { loadSource } from '../src/source/loader';
import { createReviewReport, reportExitCode, type ReviewReport } from '../src/reporting/report';
import { renderTextReview } from '../src/cli/text-review';
import { renderHtmlReport } from '../src/reporting/html';

const cliPath = resolve(__dirname, '../src/cli/index.js');

test('JSON report is versioned, filtered, deterministic, and preserves fingerprints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-json-'));
  const sourcePath = join(root, 'source.js');
  try {
    await mkdir(join(root, 'excluded'), { recursive: true });
    await Promise.all([
      writeFile(sourcePath, 'function undocumented() { print("debug"); }', 'utf8'),
      writeFile(join(root, 'excluded', 'ignored.js'), 'print("ignored");', 'utf8'),
    ]);

    const result = runReview(root,
      '--format', 'json',
      '--rule', 'SM-DBG-001',
      '--exclude', '**/ignored.js');
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout) as ReviewReport;
    const direct = review(await loadSource(sourcePath));

    assert.equal(report.schemaVersion, '1.0.0');
    assert.equal(report.toolVersion, '0.1.0');
    assert.equal(report.inputPath, resolve(root));
    assert.ok(Number.isFinite(Date.parse(report.generatedAt)));
    assert.equal(report.failureThreshold, 'warning');
    assert.equal(report.summary.files, 1);
    assert.equal(report.summary.findings, 1);
    assert.equal(report.summary.skippedFiles, 1);
    assert.equal('aiCoverage' in report, false);
    assert.equal(report.findings[0].ruleId, 'SM-DBG-001');
    assert.equal(
      report.findings[0].fingerprint,
      direct.findings.find(({ ruleId }) => ruleId === 'SM-DBG-001')?.fingerprint,
    );
    assert.doesNotMatch(result.stdout, /ignored\.js/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('configuration and minimum severity affect reporting without changing rule fingerprints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-config-'));
  const sourcePath = join(root, 'source.js');
  const configPath = join(root, 'review.config.json');
  try {
    await Promise.all([
      writeFile(sourcePath, 'print("debug");', 'utf8'),
      writeFile(configPath, JSON.stringify({
        rules: { 'SM-DBG-001': { severity: 'error' } },
      }), 'utf8'),
    ]);

    const hidden = runReview(sourcePath, '--format', 'json', '--min-severity', 'error');
    assert.equal(hidden.status, 0);
    assert.equal((JSON.parse(hidden.stdout) as ReviewReport).summary.findings, 0);

    const visible = runReview(sourcePath,
      '--format', 'json',
      '--min-severity', 'error',
      '--config', configPath);
    assert.equal(visible.status, 1);
    const report = JSON.parse(visible.stdout) as ReviewReport;
    assert.equal(report.findings[0].severity, 'error');
    assert.equal(report.findings[0].ruleId, 'SM-DBG-001');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('v1-production preset suppresses quality-policy findings and accepts explicit overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-preset-'));
  const sourcePath = join(root, 'source.js');
  const configPath = join(root, 'review.config.json');
  try {
    await Promise.all([
      writeFile(sourcePath, 'function undocumented() { print("debug"); }', 'utf8'),
      writeFile(configPath, JSON.stringify({ rules: { 'SM-DBG-001': { enabled: true } } }), 'utf8'),
    ]);
    const focused = runReview(sourcePath, '--format', 'json', '--preset', 'v1-production');
    assert.equal(focused.status, 0);
    assert.equal((JSON.parse(focused.stdout) as ReviewReport).summary.findings, 0);

    const override = runReview(sourcePath, '--format', 'json', '--preset', 'v1-production', '--config', configPath);
    assert.equal(override.status, 1);
    assert.deepEqual((JSON.parse(override.stdout) as ReviewReport).findings.map(({ ruleId }) => ruleId), ['SM-DBG-001']);
    assert.equal(runReview(sourcePath, '--preset', 'unknown').status, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('HTML report is standalone, escaped, filterable, and supports output files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-html-'));
  const sourcePath = join(root, 'a&b.js');
  const outputPath = join(root, 'report.html');
  try {
    await writeFile(sourcePath, 'print("debug");', 'utf8');
    const result = runReview(sourcePath, '--format', 'html', '--output', outputPath);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    const html = await readFile(outputPath, 'utf8');

    assert.match(html, /^<!doctype html>/u);
    assert.match(html, /id="severity-filter"/u);
    assert.match(html, /id="rule-filter"/u);
    assert.match(html, /a&amp;b\.js/u);
    assert.match(html, /Evidence/u);
    assert.doesNotMatch(html, /(?:src|href)="https?:/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid options, configuration, and targets return exit code 2 with clean stdout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-invalid-'));
  const sourcePath = join(root, 'source.js');
  const configPath = join(root, 'bad.json');
  try {
    await Promise.all([
      writeFile(sourcePath, 'print("debug");', 'utf8'),
      writeFile(configPath, '{ invalid', 'utf8'),
    ]);
    const invalidFormat = runReview(sourcePath, '--format', 'xml');
    const invalidConfig = runReview(sourcePath, '--config', configPath, '--format', 'json');
    const missingTarget = runReview(join(root, 'missing.js'), '--format', 'json');

    for (const result of [invalidFormat, invalidConfig, missingTarget]) {
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.notEqual(result.stderr, '');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('syntax-invalid source returns 2 with machine-readable diagnostics and skipped rules', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-syntax-'));
  const sourcePath = join(root, 'broken.js');
  try {
    await writeFile(sourcePath, 'function broken( {', 'utf8');
    const result = runReview(sourcePath, '--format', 'json');
    assert.equal(result.status, 2);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout) as ReviewReport;
    assert.ok(report.summary.diagnostics > 0);
    assert.ok(report.skippedRules.some(({ reason }) => reason === 'syntax-errors'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('JSON workflow includes SM-RC-001 and SM-LOOP-002 without changing their contracts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-rules-'));
  const sourcePath = join(root, 'sm-source.js');
  try {
    await writeFile(sourcePath, `
var file = new SCFile('contacts');
var rc = file.doSelect('true');
while (rc == RC_SUCCESS) { processRecord(file); }
file.doUpdate();
`, 'utf8');
    const result = runReview(sourcePath,
      '--format', 'json',
      '--rule', 'SM-RC-001',
      '--rule', 'SM-LOOP-002');
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout) as ReviewReport;
    assert.deepEqual(report.findings.map(({ ruleId }) => ruleId), [
      'SM-LOOP-002',
      'SM-RC-001',
    ]);
    assert.ok(report.findings.every(({ fingerprint }) => fingerprint.length === 64));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('operational file failures deterministically produce exit code 2', () => {
  const report = createReviewReport({
    files: [],
    failures: [{ filePath: 'unreadable.js', message: 'access denied' }],
    skippedFileCount: 0,
  });
  assert.equal(reportExitCode(report), 2);
  assert.deepEqual(report.failures, [{ filePath: 'unreadable.js', message: 'access denied' }]);
});

test('text and HTML reports label and escape model-generated findings separately', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-ai-'));
  const sourcePath = join(root, 'source.js');
  try {
    await writeFile(sourcePath, 'print("debug");', 'utf8');
    const result = review(await loadSource(sourcePath));
    const range = {
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 6, offset: 5 },
    };
    const report = createReviewReport({
      files: [{ filePath: sourcePath, result }],
      failures: [],
      skippedFileCount: 0,
    }, {
      ai: {
        enabled: true,
        errors: [],
        coverage: [{
          filePath: sourcePath,
          totalIndexedFunctions: 3,
          selectedForAIReview: 1,
          notReviewedFunctions: 2,
          status: 'partial',
        }],
        findings: [{
          id: 'ai:test',
          filePath: sourcePath,
          sourceId: result.analysis.source.id,
          sourceHash: result.analysis.source.hash,
          range,
          category: 'logic',
          severity: 'warning',
          message: '<model observation>',
          explanation: '<untrusted explanation>',
          suggestion: 'Review manually.',
          evidenceReferences: ['source:target'],
          confidence: 0.5,
          assertionKind: 'model-inference',
          model: { providerId: 'test', modelId: 'test-model' },
          validationStatus: 'validated',
        }],
      },
    });
    const text = renderTextReview(report);
    const html = renderHtmlReport(report);
    assert.match(text, /AI-WARNING \[MODEL-GENERATED\]/u);
    assert.match(text, /AI-WARNING Partial review/u);
    assert.match(html, /AI review \(model-generated\)/u);
    assert.match(html, /not fully AI-reviewed/u);
    assert.match(html, /&lt;model observation&gt;/u);
    assert.doesNotMatch(html, /<model observation>/u);
    assert.equal(report.findings.some(({ ruleId }) => ruleId.startsWith('AI')), false);
    assert.equal(report.aiFindings?.length, 1);
    assert.deepEqual(report.aiCoverage?.[0], {
      filePath: sourcePath,
      totalIndexedFunctions: 3,
      selectedForAIReview: 1,
      notReviewedFunctions: 2,
      status: 'partial',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('explicit unsupported files fail while empty directories remain clean', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-report-input-'));
  const jsonPath = join(root, 'source.json');
  const markdownPath = join(root, 'source.md');
  const empty = join(root, 'empty');
  try {
    await mkdir(empty);
    await Promise.all([
      writeFile(jsonPath, '{}', 'utf8'),
      writeFile(markdownPath, '# text', 'utf8'),
    ]);
    for (const path of [jsonPath, markdownPath]) {
      const result = runReview(path, '--format', 'json');
      assert.equal(result.status, 2);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /Unsupported source file extension/u);
    }

    const result = runReview(empty, '--format', 'json');
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout) as ReviewReport;
    assert.equal(report.summary.files, 0);
    assert.equal(report.summary.skippedFiles, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review --help prints valid usage and exits successfully', () => {
  const result = spawnSync(process.execPath, [cliPath, 'review', '--help'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage: sm-review review <file-or-directory>/u);
  assert.match(result.stdout, /--format text\|json\|html/u);
  assert.match(result.stdout, /--min-severity info\|warning\|error/u);
});

function runReview(target: string, ...args: string[]) {
  return spawnSync(process.execPath, [cliPath, 'review', target, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
}
