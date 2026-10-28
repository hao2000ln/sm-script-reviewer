import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadUatEnvironmentConfiguration } from '../src/cli/environment';
import { parseUatArguments, resolveUatInvocation, runUatCommand } from '../src/uat/cli';

test('UAT CLI accepts options before the source folder and preserves repeatable excludes', () => {
  assert.deepEqual(parseUatArguments([
    '--exclude', 'generated/**', '--manifest', 'labels.json', 'exports', '--exclude', 'temp/**',
  ]), {
    target: 'exports', manifest: 'labels.json', output: undefined, previous: undefined,
    writeManifest: undefined, profile: undefined, excludedPatterns: ['generated/**', 'temp/**'],
  });
});

test('UAT CLI rejects missing option values, duplicate source paths, and comparison without output', () => {
  assert.throws(() => parseUatArguments(['--manifest']), /Missing value/u);
  assert.throws(() => parseUatArguments(['first', 'second']), /Unexpected source path/u);
  assert.throws(() => parseUatArguments(['exports', '--previous', 'old.json']), /requires --output/u);
  assert.throws(() => parseUatArguments(['exports', '--profile', 'unknown']), /Invalid UAT profile/u);
});

test('explicit UAT source path overrides environment defaults and production exclusions compose', () => {
  const options = parseUatArguments(['explicit-export', '--profile', 'production', '--exclude', 'legacy/**']);
  assert.deepEqual(resolveUatInvocation(options.target, options, {
    scriptLibraryDir: 'environment-export', uatDir: 'environment-uat',
  }), {
    target: 'explicit-export', uatDirectory: 'environment-uat', profile: 'production',
    excludedPatterns: ['Samples/**', 'Tests/**', 'Tools/**', 'legacy/**'],
  });
  const full = parseUatArguments(['--profile', 'full']);
  assert.deepEqual(resolveUatInvocation(full.target, full, {}), {
    target: './SM-Exports/ScriptLibrary', uatDirectory: './SM-UAT', profile: 'full', excludedPatterns: [],
  });
});

test('UAT environment values are optional and a missing output directory is created locally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-reviewer-uat-cli-'));
  try {
    await writeFile(join(root, '.env'), 'SM_SCRIPTLIBRARY_DIR=./exports\nSM_UAT_DIR=./uat-output\n', 'utf8');
    assert.deepEqual(await loadUatEnvironmentConfiguration(root), {
      scriptLibraryDir: './exports', uatDir: './uat-output',
    });
    const source = join(root, 'source.js');
    const output = join(root, 'new-output', 'baseline.json');
    await writeFile(source, 'print("debug");', 'utf8');
    assert.equal(await runUatCommand([source, '--profile', 'full', '--output', output]), 0);
    const report = JSON.parse(await readFile(output, 'utf8')) as { provenance: { profile: string } };
    assert.equal(report.provenance.profile, 'full');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
