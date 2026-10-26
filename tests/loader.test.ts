import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { discoverSources, loadSource } from '../src/source/loader';

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
      writeFile(join(root, 'nested', 'nested.JS'), 'function nested() {}', 'utf8'),
      writeFile(join(root, 'nested', 'ignored.txt'), 'not JavaScript', 'utf8'),
      writeFile(join(root, '.hidden', 'hidden.js'), 'function hidden() {}', 'utf8'),
      writeFile(join(root, 'dist', 'generated.js'), 'function generated() {}', 'utf8'),
      writeFile(join(root, 'node_modules', 'dependency.js'), 'function dependency() {}', 'utf8'),
    ]);

    assert.deepEqual(await discoverSources(root), [
      join(root, 'nested', 'nested.JS'),
      join(root, 'root.js'),
    ].sort());
    assert.deepEqual(await discoverSources(join(root, 'nested', 'ignored.txt')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
