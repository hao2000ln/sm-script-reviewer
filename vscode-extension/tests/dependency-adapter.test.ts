import { strict as assert } from 'node:assert';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { analyzeDependencyFolder } from '../src/dependency-adapter';

test('dependency adapter uses unsaved content and explicit mapping without a VS Code host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-dependency-extension-'));
  try {
    const alpha = join(root, 'Alpha.js'); const beta = join(root, 'Beta.js');
    await Promise.all([writeFile(alpha, '', 'utf8'), writeFile(beta, '', 'utf8')]);
    const result = await analyzeDependencyFolder(root, {
      maxFiles: 10,
      openDocuments: new Map([[resolve(alpha).toLowerCase(), 'lib.Beta.run();']]),
      config: { libraryMappings: [{ libraryName: 'Alpha', filePath: 'Alpha.js' }, { libraryName: 'Beta', filePath: 'Beta.js' }] },
    });
    assert.equal(result.cancelled, false);
    assert.deepEqual(result.analysis.graph.edges.map(({ libraryName }) => libraryName), ['Beta']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('dependency adapter honors cancellation before source loading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-dependency-extension-cancel-'));
  try {
    await writeFile(join(root, 'Alpha.js'), 'lib.Beta.run();', 'utf8');
    const result = await analyzeDependencyFolder(root, { maxFiles: 10, isCancellationRequested: () => true, config: {} });
    assert.equal(result.cancelled, true);
    assert.equal(result.analysis.corpus.fileCount, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
