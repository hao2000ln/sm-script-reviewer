import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseUatArguments } from '../src/uat/cli';

test('UAT CLI accepts options before the source folder and preserves repeatable excludes', () => {
  assert.deepEqual(parseUatArguments([
    '--exclude', 'generated/**', '--manifest', 'labels.json', 'exports', '--exclude', 'temp/**',
  ]), {
    target: 'exports', manifest: 'labels.json', output: undefined, previous: undefined,
    writeManifest: undefined, excludedPatterns: ['generated/**', 'temp/**'],
  });
});

test('UAT CLI rejects missing option values, duplicate source paths, and comparison without output', () => {
  assert.throws(() => parseUatArguments(['--manifest']), /Missing value/u);
  assert.throws(() => parseUatArguments(['first', 'second']), /Unexpected source path/u);
  assert.throws(() => parseUatArguments(['exports', '--previous', 'old.json']), /requires --output/u);
});
