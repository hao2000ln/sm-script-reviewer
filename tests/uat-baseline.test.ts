import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  compareUatBaselines,
  createManifestTemplate,
  createUatBaseline,
  renderVietnameseSummary,
  type UatManifest,
} from '../src/uat/baseline';

async function withCorpus(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'sm-reviewer-uat-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

async function source(root: string, path: string, content: string): Promise<void> {
  const destination = join(root, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

test('UAT baseline handles an empty folder with explicit incomplete coverage', async () => {
  await withCorpus(async (root) => {
    const report = await createUatBaseline(root, { generatedAt: '2026-01-01T00:00:00.000Z' });
    assert.equal(report.summary.files, 0);
    assert.equal(report.coverage.status, 'incomplete');
    assert.match(renderVietnameseSummary(report), /File đã phân tích: 0/u);
  });
});

test('UAT baseline orders nested files and accounts for unsupported and invalid source', async () => {
  await withCorpus(async (root) => {
    await source(root, 'nested/valid.txt', '/** docs */\nfunction valid() {}');
    await source(root, 'invalid.js', 'function broken( {');
    await source(root, 'notes.md', '# unsupported');
    const report = await createUatBaseline(root);
    assert.deepEqual(report.files.map(({ relativeFilePath }) => relativeFilePath), ['invalid.js', 'nested/valid.txt']);
    assert.equal(report.coverage.unsupportedFileCount, 1);
    assert.equal(report.coverage.filesWithParseDiagnostics, 1);
    assert.equal(report.coverage.status, 'incomplete');
  });
});

test('UAT baseline persists manual classifications by fingerprint and keeps deterministic identities distinct', async () => {
  await withCorpus(async (root) => {
    await source(root, 'one.js', 'function one() { print("x"); }');
    await source(root, 'two.js', 'function one() { print("x"); }');
    const first = await createUatBaseline(root);
    const prints = first.findings.filter(({ ruleId }) => ruleId === 'SM-DBG-001');
    assert.equal(prints.length, 2);
    assert.notEqual(prints[0].identity, prints[1].identity);
    const manifest: UatManifest = {
      schemaVersion: '1.0.0', corpusComplete: true,
      classifications: [{ identity: prints[0].identity, fingerprint: prints[0].fingerprint, classification: 'TRUE_POSITIVE', note: 'Reviewed manually.' }],
    };
    const second = await createUatBaseline(root, { manifest });
    assert.equal(second.summary.truePositives, 1);
    assert.equal(second.summary.unclassified, second.findings.length - 1);
    assert.equal(second.unmatchedClassifications.length, 0);
    assert.equal(createManifestTemplate(second).classifications.length, second.findings.length);
  });
});

test('UAT comparison accounts for changed and removed source instead of calling labels resolved', async () => {
  await withCorpus(async (root) => {
    await source(root, 'changed.js', 'function target() { print("x"); }');
    await source(root, 'removed.js', 'function removed() {}');
    const previous = await createUatBaseline(root);
    const labelled = previous.findings.find(({ ruleId }) => ruleId === 'SM-DBG-001')!;
    const priorWithLabel = {
      ...previous,
      findings: previous.findings.map((finding) => finding.fingerprint === labelled.fingerprint
        ? { ...finding, uatClassification: 'FALSE_POSITIVE' as const } : finding),
    };
    await source(root, 'changed.js', 'function target() { print("y"); print("z"); }');
    await rm(join(root, 'removed.js'));
    const current = await createUatBaseline(root);
    const comparison = compareUatBaselines(priorWithLabel, current);
    assert.ok(comparison.newFindings.length > 0);
    assert.ok(comparison.removedFindings.length > 0);
    assert.deepEqual(comparison.changedSourceFiles, ['changed.js', 'removed.js']);
    assert.equal(comparison.unmatchedPriorClassifications.length, 1);
  });
});

test('UAT baseline includes approved SCFile findings without claiming runtime accuracy', async () => {
  await withCorpus(async (root) => {
    await source(root, 'scfile.js', 'var f = new SCFile("contacts", SCFILE_READONLY); f.doUpdate();');
    const report = await createUatBaseline(root, { manifest: { schemaVersion: '1.0.0', corpusComplete: true, classifications: [] } });
    const finding = report.findings.find(({ ruleId }) => ruleId === 'SM-SCF-001');
    assert.ok(finding);
    assert.equal(finding!.classification, 'deterministic');
    assert.equal(report.coverage.status, 'complete');
  });
});
