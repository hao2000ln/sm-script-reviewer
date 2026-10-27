import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { discoverSourceFiles, discoverSources, loadSource } from '../src/source/loader';

test('loads UTF-8 source and computes its SHA-256 hash', async () => {
  const filePath = resolve(__dirname, '../../examples/sample.js');
  const source = await loadSource(filePath);

  assert.equal(source.id, filePath);
  assert.equal(source.filePath, filePath);
  assert.match(source.content, /function getStatusList\(query\)/u);
  assert.equal(
    source.hash,
    createHash('sha256').update(source.content).digest('hex'),
  );
});

test('discovers JavaScript recursively and excludes generated or hidden folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-script-reviewer-'));

  try {
    await Promise.all([
      
      mkdir(join(root, 'nested'), { recursive: true }),
      mkdir(join(root, '.hidden'), { recursive: true }),
      mkdir(join(root, 'dist'), { recursive: true }),
      mkdir(join(root, 'node_modules'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, 'root.js'), 'function root() {}', 'utf8'),
      writeFile(join(root, 'review.txt'), 'function review() {}', 'utf8'),
      writeFile(join(root, 'nested', 'nested.JS'), 'function nested() {}', 'utf8'),
      writeFile(join(root, 'nested', 'ignored.md'), 'not JavaScript', 'utf8'),
      writeFile(join(root, '.hidden', 'hidden.js'), 'function hidden() {}', 'utf8'),
      writeFile(join(root, 'dist', 'generated.js'), 'function generated() {}', 'utf8'),
      writeFile(join(root, 'node_modules', 'dependency.js'), 'function dependency() {}', 'utf8'),
    ]);
    let symlinkCreated = false;
    try {
      await symlink(join(root, 'root.js'), join(root, 'linked.js'), 'file');
      symlinkCreated = true;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EPERM')) throw error;
    }

    assert.deepEqual(await discoverSources(root), [
      join(root, 'nested', 'nested.JS'),
      join(root, 'root.js'),
    ].sort());
    assert.deepEqual(await discoverSources(root, { extensions: ['js', '.txt'] }), [
      join(root, 'nested', 'nested.JS'),
      join(root, 'review.txt'),
      join(root, 'root.js'),
    ].sort());
    assert.equal((await discoverSourceFiles(root)).skippedFileCount, 2);
    assert.equal((await discoverSourceFiles(root, {
      extensions: ['js', '.txt'],
    })).skippedFileCount, 1);
    assert.deepEqual(await discoverSources(join(root, 'nested', 'ignored.md')), []);
    if (symlinkCreated) {
      assert.deepEqual(await discoverSources(join(root, 'linked.js'), {
        ignoreSymlinks: true,
      }), []);
      assert.deepEqual(await discoverSources(join(root, 'linked.js')), [join(root, 'linked.js')]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
