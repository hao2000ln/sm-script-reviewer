import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { join, resolve } from 'node:path';
import { analyzeDependencies } from '../src/dependencies/analyze';
import { calculateImpact } from '../src/dependencies/graph';
import type { SourceDocument } from '../src/core/types';

function source(root: string, file: string, content: string): SourceDocument {
  return { id: resolve(root, file), filePath: resolve(root, file), content, hash: createHash('sha256').update(content).digest('hex') };
}

async function analyze(files: Record<string, string>, configuration: Parameters<typeof analyzeDependencies>[1] = {}) {
  const root = resolve('dependency-test-corpus');
  return analyzeDependencies(root, {
    ...configuration,
    sources: Object.entries(files).map(([file, content]) => source(root, file, content)),
  });
}

const mappings = [
  { libraryName: 'Alpha', filePath: 'Alpha.js' },
  { libraryName: 'Beta', filePath: 'Beta.js' },
  { libraryName: 'Gamma', filePath: 'Gamma.js' },
] as const;

test('extracts direct and static bracket lib references without treating methods as library names', async () => {
  const result = await analyze({
    'Alpha.js': 'lib.Beta.run(); lib["Gamma"].helper.value;',
    'Beta.js': '', 'Gamma.js': '',
  }, { libraryMappings: mappings });
  assert.deepEqual(result.graph.references.map(({ libraryName, status, syntax }) => [libraryName, status, syntax]), [
    ['Beta', 'RESOLVED', 'property'], ['Gamma', 'RESOLVED', 'bracket'],
  ]);
  assert.deepEqual(result.graph.edges.map(({ libraryName }) => libraryName), ['Beta', 'Gamma']);
});

test('keeps computed targets dynamic and lexical lib shadowing unresolved', async () => {
  const result = await analyze({
    'Alpha.js': 'lib[target].run(); function local(lib) { lib.Beta.run(); }',
    'Beta.js': '',
  }, { libraryMappings: mappings });
  assert.deepEqual(result.graph.references.map(({ status }) => status), ['DYNAMIC', 'UNRESOLVED']);
  assert.equal(result.graph.edges.length, 0);
});

test('requires declared complete corpus and mappings before reporting missing libraries', async () => {
  const files = { 'Alpha.js': 'lib.NotExported.run();' };
  const unresolved = await analyze(files, { libraryMappings: [{ libraryName: 'Alpha', filePath: 'Alpha.js' }] });
  const missing = await analyze(files, {
    corpusComplete: true, mappingsComplete: true,
    libraryMappings: [{ libraryName: 'Alpha', filePath: 'Alpha.js' }],
  });
  assert.equal(unresolved.graph.references[0].status, 'UNRESOLVED');
  assert.equal(missing.graph.references[0].status, 'MISSING');
});

test('marks duplicate mappings ambiguous and preserves deterministic candidates', async () => {
  const result = await analyze({ 'Alpha.js': 'lib.Beta.run();', 'One.js': '', 'Two.js': '' }, {
    libraryMappings: [
      { libraryName: 'Alpha', filePath: 'Alpha.js' },
      { libraryName: 'Beta', filePath: 'One.js' },
      { libraryName: 'Beta', filePath: 'Two.js' },
    ],
  });
  assert.equal(result.graph.references[0].status, 'AMBIGUOUS');
  assert.deepEqual(result.graph.references[0].candidateNodeIds, ['One.js', 'Two.js']);
});

test('builds cycles, reverse impact, multiple changes and self references without recursion', async () => {
  const result = await analyze({
    'Alpha.js': 'lib.Beta.run();',
    'Beta.js': 'lib.Gamma.run();',
    'Gamma.js': 'lib.Alpha.run();',
    'Self.js': 'lib.Self.run();',
  }, { libraryMappings: [...mappings, { libraryName: 'Self', filePath: 'Self.js' }] });
  assert.deepEqual(result.graph.cycles, [['Alpha.js', 'Beta.js', 'Gamma.js'], ['Self.js']]);
  const impact = calculateImpact(result.graph, ['Gamma', 'Self', 'Unknown']);
  assert.deepEqual(impact.changed, ['Gamma.js', 'Self.js']);
  assert.deepEqual(impact.directDependents, ['Beta.js']);
  assert.deepEqual(impact.indirectDependents, ['Alpha.js']);
  assert.deepEqual(impact.dependentsWithinCycles, ['Alpha.js', 'Beta.js']);
  assert.deepEqual(impact.unknownChanged, ['Unknown']);
});

test('retains parse-recovery corpus evidence without executing source', async () => {
  const result = await analyze({ 'Alpha.js': 'lib.Beta.run(); function broken( {', 'Beta.js': '' }, { libraryMappings: mappings });
  assert.deepEqual(result.parseDiagnosticFiles, ['Alpha.js']);
  assert.equal(result.graph.references[0].status, 'RESOLVED');
});
