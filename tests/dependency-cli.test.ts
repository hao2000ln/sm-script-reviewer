import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const cliPath = resolve(__dirname, '../src/cli/index.js');

function run(...args: string[]) {
  return spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
}

test('dependency CLI emits stable JSON, escaped HTML, and reverse impact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-dependency-cli-'));
  const configRoot = await mkdtemp(join(tmpdir(), 'sm-dependency-config-'));
  const config = join(configRoot, 'dependencies.json'); const html = join(root, 'dependencies.html');
  try {
    await Promise.all([
      writeFile(join(root, 'Alpha.js'), 'lib.Beta.run(); lib[dynamic].run(); lib["<unsafe>"].run();', 'utf8'),
      writeFile(join(root, 'Beta.js'), 'lib.Alpha.run();', 'utf8'),
      writeFile(join(root, 'Unsafe.js'), '', 'utf8'),
      writeFile(config, JSON.stringify({ corpusComplete: true, mappingsComplete: true, libraryMappings: [
        { libraryName: 'Alpha', filePath: 'Alpha.js' }, { libraryName: 'Beta', filePath: 'Beta.js' }, { libraryName: '<unsafe>', filePath: 'Unsafe.js' },
      ] }), 'utf8'),
    ]);
    const json = run('dependencies', root, '--config', config, '--format', 'json');
    assert.equal(json.status, 0);
    const report = JSON.parse(json.stdout) as { analysis: { graph: { edges: unknown[]; cycles: string[][]; references: { status: string }[] } } };
    assert.equal(JSON.stringify(report).includes(root.replaceAll('\\', '/')), false);
    assert.equal(report.analysis.graph.edges.length, 3);
    assert.deepEqual(report.analysis.graph.cycles, [['Alpha.js', 'Beta.js']]);
    assert.ok(report.analysis.graph.references.some(({ status }) => status === 'DYNAMIC'));

    const impact = run('impact', root, '--config', config, '--changed', 'Beta', '--format', 'json');
    assert.equal(impact.status, 0);
    assert.deepEqual(JSON.parse(impact.stdout).impact.directDependents, ['Alpha.js']);

    const htmlResult = run('dependencies', root, '--config', config, '--format', 'html', '--output', html);
    assert.equal(htmlResult.status, 0);
    const content = await readFile(html, 'utf8');
    assert.match(content, /id="filter"/u);
    assert.doesNotMatch(content, /(?:src|href)="https?:/u);
    assert.match(content, /&lt;unsafe&gt;/u);
    assert.doesNotMatch(content, /<unsafe>/u);
  } finally { await Promise.all([rm(root, { recursive: true, force: true }), rm(configRoot, { recursive: true, force: true })]); }
});

test('dependency CLI validates impact input and reports missing only for complete corpus', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-dependency-cli-missing-'));
  const configRoot = await mkdtemp(join(tmpdir(), 'sm-dependency-config-'));
  const config = join(configRoot, 'dependencies.json');
  try {
    await writeFile(join(root, 'Alpha.js'), 'lib.NotExported.run();', 'utf8');
    await writeFile(config, JSON.stringify({ corpusComplete: true, mappingsComplete: true, libraryMappings: [{ libraryName: 'Alpha', filePath: 'Alpha.js' }] }), 'utf8');
    const missing = run('dependencies', root, '--config', config, '--format', 'json');
    assert.equal(missing.status, 1);
    assert.equal(JSON.parse(missing.stdout).analysis.graph.references[0].status, 'MISSING');
    const invalid = run('impact', root, '--config', config);
    assert.equal(invalid.status, 2);
  } finally { await Promise.all([rm(root, { recursive: true, force: true }), rm(configRoot, { recursive: true, force: true })]); }
});

test('dependency CLI rejects malformed configuration without writing a report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-dependency-cli-invalid-'));
  const config = join(root, 'dependencies.json');
  try {
    await writeFile(join(root, 'Alpha.js'), 'lib.Beta.run();', 'utf8');
    await writeFile(config, JSON.stringify({ corpusComplete: 'yes', libraryMappings: [{}] }), 'utf8');
    const invalid = run('dependencies', root, '--config', config, '--format', 'json');
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /corpusComplete must be boolean/u);
    assert.equal(invalid.stdout, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});
