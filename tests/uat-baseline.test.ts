import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  compareUatBaselines,
  createManifestTemplate,
  createUatBaseline,
  renderVietnameseComparisonWarning,
  renderVietnameseSummary,
  type UatManifest,
} from '../src/uat/baseline';
import { review } from '../src/reviewer/review';
import type { BatchReviewResult } from '../src/reviewer/batch';
import type { SourceDocument } from '../src/core/types';

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

test('production profile exclusions keep project-specific unknown directories visible while full includes all groups', async () => {
  await withCorpus(async (root) => {
    await source(root, 'ESD_CONFIG/config.js', 'print("config");');
    await source(root, 'ESD_CORE/core.js', 'print("core");');
    await mkdir(join(root, 'ESD_FORM'));
    await source(root, 'ESD_SHARED/shared.txt', 'print("shared");');
    await source(root, 'Samples/sample.js', 'print("sample");');
    await source(root, 'Tests/test.js', 'print("test");');
    await source(root, 'Tools/tool.js', 'print("tool");');
    await source(root, 'CUSTOM_EXTENSION/extra.js', 'print("extra");');
    const production = await createUatBaseline(root, {
      profile: 'production',
      excludedPatterns: ['Samples/**', 'Tests/**', 'Tools/**'],
    });
    assert.deepEqual(production.files.map(({ relativeFilePath }) => relativeFilePath), [
      'CUSTOM_EXTENSION/extra.js', 'ESD_CONFIG/config.js', 'ESD_CORE/core.js', 'ESD_SHARED/shared.txt',
    ]);
    assert.deepEqual(production.provenance.includedUnknownDirectories, ['CUSTOM_EXTENSION']);
    assert.deepEqual(production.provenance.appliedExclusions, ['Samples/**', 'Tests/**', 'Tools/**']);
    assert.equal(production.coverage.unsupportedFileCount, 0);
    assert.ok(production.groups.file.some(({ key }) => key === 'CUSTOM_EXTENSION/extra.js'));
    const full = await createUatBaseline(root, { profile: 'full' });
    assert.equal(full.files.length, 7);
    assert.deepEqual(full.provenance.includedUnknownDirectories, []);
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

test('UAT baseline rejects invalid, corrupted, duplicate, and stale matching manifest labels', async () => {
  await withCorpus(async (root) => {
    await source(root, 'one.js', 'function one() { print("x"); }');
    const baseline = await createUatBaseline(root);
    const finding = baseline.findings.find(({ ruleId }) => ruleId === 'SM-DBG-001')!;
    const entry = { identity: finding.identity, fingerprint: finding.fingerprint, classification: 'TRUE_POSITIVE' as const };
    await assert.rejects(
      () => createUatBaseline(root, { manifest: { schemaVersion: '0.0.0', classifications: [] } as unknown as UatManifest }),
      /Unsupported UAT manifest schema/u,
    );
    await assert.rejects(
      () => createUatBaseline(root, { manifest: { schemaVersion: '1.0.0', classifications: [{ ...entry, classification: 'INVALID' as never }] } }),
      /invalid classification/u,
    );
    await assert.rejects(
      () => createUatBaseline(root, { manifest: { schemaVersion: '1.0.0', classifications: [entry, entry] } }),
      /duplicate or empty identity/u,
    );
    await assert.rejects(
      () => createUatBaseline(root, { manifest: { schemaVersion: '1.0.0', classifications: [{ ...entry, fingerprint: 'stale' }] } }),
      /fingerprint does not match/u,
    );
    await assert.rejects(
      () => createUatBaseline(root, { manifest: { schemaVersion: '1.0.0', classifications: null as never } }),
      /classifications must be an array/u,
    );
  });
});

test('UAT baseline preserves unmatched historical labels but marks rule-error execution coverage incomplete', async () => {
  await withCorpus(async (root) => {
    const document: SourceDocument = {
      id: join(root, 'one.js'), filePath: join(root, 'one.js'),
      content: 'function one() { print("x"); }', hash: 'fixture-hash',
    };
    const result = review(document);
    const batch: BatchReviewResult = {
      files: [{ filePath: document.filePath, result: { ...result, ruleErrors: [{ ruleId: 'TEST-THROW', message: 'intentional test failure' }] } }],
      failures: [], skippedFileCount: 0,
    };
    const report = await createUatBaseline(root, {
      manifest: {
        schemaVersion: '1.0.0', corpusComplete: true,
        classifications: [{ identity: 'historical-identity', fingerprint: 'historical-fingerprint', classification: 'FALSE_POSITIVE' }],
      },
      reviewTarget: async () => batch,
    });
    assert.equal(report.coverage.corpus.status, 'complete');
    assert.equal(report.coverage.execution.status, 'incomplete');
    assert.equal(report.coverage.execution.ruleErrorCount, 1);
    assert.deepEqual(report.coverage.execution.ruleErrors, [{
      relativeFilePath: 'one.js', ruleId: 'TEST-THROW', message: 'intentional test failure',
    }]);
    assert.equal(report.coverage.semantic.status, 'not-established');
    assert.equal(report.coverage.status, 'incomplete');
    assert.equal(report.unmatchedClassifications.length, 1);
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

test('UAT comparison marks matching rule configurations as same', async () => {
  await withCorpus(async (root) => {
    await source(root, 'one.js', 'function missing() { print("normal"); }');
    const config = { rules: { 'SM-CMT-001': { options: { mode: 'all-functions' } } } } as const;
    const previous = await createUatBaseline(root, { config });
    const current = await createUatBaseline(root, { config });
    const comparison = compareUatBaselines(previous, current);
    assert.equal(comparison.configurationComparisonStatus, 'same');
    assert.equal(comparison.configurationChanged, false);
    assert.equal(renderVietnameseComparisonWarning(comparison), undefined);
  });
});

test('UAT comparison warns when comment or print policy changes alter findings', async () => {
  await withCorpus(async (root) => {
    await source(root, 'one.js', `
function topLevel() { print("normal"); }
function outer() { function nested() {} }
`);
    const commentsAll = await createUatBaseline(root, {
      config: { rules: { 'SM-CMT-001': { options: { mode: 'all-functions' } } } },
    });
    const commentsPublic = await createUatBaseline(root, {
      config: { rules: { 'SM-CMT-001': { options: { mode: 'public-functions' } } } },
    });
    const commentComparison = compareUatBaselines(commentsAll, commentsPublic);
    assert.equal(commentComparison.configurationComparisonStatus, 'changed');
    assert.equal(commentComparison.configurationChanged, true);
    assert.ok(commentComparison.removedFindings.length > 0);
    assert.deepEqual(commentComparison.changedSourceFiles, []);

    const printsAll = await createUatBaseline(root, {
      config: { rules: { 'SM-DBG-001': { options: { mode: 'all-print' } } } },
    });
    const printsDebug = await createUatBaseline(root, {
      config: { rules: { 'SM-DBG-001': { options: { mode: 'debug-patterns' } } } },
    });
    const printComparison = compareUatBaselines(printsAll, printsDebug);
    assert.equal(printComparison.configurationComparisonStatus, 'changed');
    assert.ok(printComparison.removedFindings.length > 0);
    assert.match(renderVietnameseComparisonWarning(printComparison)!, /không được kết luận/u);
  });
});

test('UAT comparison treats a legacy baseline without provenance as unknown and preserves manual labels', async () => {
  await withCorpus(async (root) => {
    await source(root, 'one.js', 'print("normal");');
    const previous = await createUatBaseline(root, {
      config: { rules: { 'SM-DBG-001': { options: { mode: 'all-print' } } } },
    });
    const labelled = {
      ...previous,
      findings: previous.findings.map((finding) => ({ ...finding, uatClassification: 'FALSE_POSITIVE' as const })),
    };
    const current = await createUatBaseline(root, {
      config: { rules: { 'SM-DBG-001': { options: { mode: 'off' } } } },
    });
    const changed = compareUatBaselines(labelled, current);
    assert.equal(changed.unmatchedPriorClassifications.length, 1);
    const legacy = { ...labelled, schemaVersion: '1.0.0', provenance: undefined } as unknown as typeof previous;
    const comparison = compareUatBaselines(legacy, current);
    assert.equal(comparison.configurationComparisonStatus, 'unknown');
    assert.equal(comparison.configurationChanged, false);
    assert.match(renderVietnameseComparisonWarning(comparison)!, /không có ruleConfigurationHash/u);
  });
});

test('UAT baseline includes approved SCFile findings without claiming runtime accuracy', async () => {
  await withCorpus(async (root) => {
    await source(root, 'scfile.js', 'var f = new SCFile("contacts", SCFILE_READONLY); f.doUpdate();');
    const report = await createUatBaseline(root, { manifest: { schemaVersion: '1.0.0', corpusComplete: true, classifications: [] } });
    const finding = report.findings.find(({ ruleId }) => ruleId === 'SM-SCF-001');
    assert.ok(finding);
    assert.equal(finding!.classification, 'deterministic');
    assert.equal(report.coverage.corpus.status, 'complete');
    assert.equal(report.coverage.execution.status, 'complete');
    assert.equal(report.coverage.semantic.status, 'not-established');
    assert.equal(report.coverage.status, 'incomplete');
    assert.equal(report.schemaVersion, '1.2.0');
    assert.equal(report.targetPath.includes(root), false);
    assert.equal(report.provenance.sourceHash.length, 64);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(root), false);
    assert.equal(finding!.sourceId, 'scfile.js');
    assert.equal(finding!.filePath, 'scfile.js');
    assert.deepEqual(report.groups.ruleId, [
      { key: 'SM-RC-001', count: 1 }, { key: 'SM-SCF-001', count: 1 },
    ]);
    assert.deepEqual(report.groups.classification, [{ key: 'deterministic', count: 2 }]);
    assert.deepEqual(report.groups.uatClassification, [{ key: 'UNCLASSIFIED', count: 2 }]);
  });
});
