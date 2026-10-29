import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { analyzeDependencyFolder, resolveDependencyReferencePath } from '../src/dependency-adapter';

test('dependency adapter uses unsaved content and explicit mapping without a VS Code host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-dependency-extension-'));
  try {
    const alpha = join(root, 'Alpha.js'); const beta = join(root, 'Beta.js');
    await Promise.all([writeFile(alpha, '', 'utf8'), writeFile(beta, '', 'utf8')]);
    const progress: string[] = [];
    const result = await analyzeDependencyFolder(root, {
      maxFiles: 10,
      openDocuments: new Map([[resolve(alpha).toLowerCase(), 'lib.Beta.run();']]),
      onProgress: (done, total) => progress.push(`${done}/${total}`),
      config: { libraryMappings: [{ libraryName: 'Alpha', filePath: 'Alpha.js' }, { libraryName: 'Beta', filePath: 'Beta.js' }] },
    });
    assert.equal(result.cancelled, false);
    assert.deepEqual(result.analysis.graph.edges.map(({ libraryName }) => libraryName), ['Beta']);
    assert.deepEqual(progress, ['1/2', '2/2']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dependency adapter honors cancellation before source loading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-dependency-extension-cancel-'));
  try {
    await writeFile(join(root, 'Alpha.js'), 'lib.Beta.run();', 'utf8');
    const result = await analyzeDependencyFolder(root, { maxFiles: 10, isCancellationRequested: () => true, config: {} });
    assert.equal(result.cancelled, true);
    assert.equal(result.analysis.corpus.fileCount, 0);
    assert.equal(result.analysis.corpus.executionComplete, false);
    assert.equal(result.analysis.corpus.corpusComplete, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('limited scans report incomplete execution and cannot emit missing references', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-dependency-extension-limit-'));
  try {
    await Promise.all([
      writeFile(join(root, 'Alpha.js'), 'lib.NotExported.run();', 'utf8'),
      writeFile(join(root, 'Beta.js'), '', 'utf8'),
    ]);
    const result = await analyzeDependencyFolder(root, {
      maxFiles: 1,
      config: { corpusComplete: true, mappingsComplete: true, libraryMappings: [{ libraryName: 'Alpha', filePath: 'Alpha.js' }] },
    });
    assert.equal(result.limited, true);
    assert.equal(result.analysis.corpus.executionComplete, false);
    assert.equal(result.analysis.graph.references[0].status, 'UNRESOLVED');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dependency navigation target cannot escape the analyzed corpus', () => {
  const root = resolve('dependency-navigation-root');
  assert.equal(resolveDependencyReferencePath(root, 'nested/Alpha.js'), resolve(root, 'nested/Alpha.js'));
  assert.equal(resolveDependencyReferencePath(root, '../outside.js'), undefined);
  assert.equal(resolveDependencyReferencePath(root, 'C:\\outside.js'), undefined);
});
