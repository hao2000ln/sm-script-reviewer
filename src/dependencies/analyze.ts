import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createAnalysisArtifact } from '../parser/analysis-artifact';
import { discoverSourceFiles, loadSource } from '../source/loader';
import type { SourceDocument } from '../core/types';
import { extractDependencies } from './extract';
import { createDependencyGraph } from './graph';
import { createDependencyIndex } from './index';
import type { DependencyAnalysisConfig, DependencyAnalysisResult } from './types';

export interface DependencyAnalyzeOptions extends DependencyAnalysisConfig {
  readonly excludedPatterns?: readonly string[];
  readonly sources?: readonly SourceDocument[];
}

export async function analyzeDependencies(
  target: string,
  options: DependencyAnalyzeOptions = {},
): Promise<DependencyAnalysisResult> {
  const rootPath = resolve(target);
  const failures: { filePath: string; message: string }[] = [];
  let skippedFileCount = 0;
  let sources = options.sources;
  if (!sources) {
    const discovery = await discoverSourceFiles(rootPath, {
      extensions: ['.js', '.txt'], excludedPatterns: options.excludedPatterns, ignoreSymlinks: true,
    });
    skippedFileCount = discovery.skippedFileCount;
    const values: SourceDocument[] = [];
    for (const path of discovery.paths) {
      try { values.push(await loadSource(path)); }
      catch (error) { failures.push({ filePath: path, message: error instanceof Error ? error.message : String(error) }); }
    }
    sources = values;
  }
  const orderedSources = [...sources].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const index = createDependencyIndex(rootPath, orderedSources, options);
  const references = [];
  const parseDiagnosticFiles: string[] = [];
  for (const source of orderedSources) {
    const artifact = createAnalysisArtifact(source);
    if (artifact.analysis.issues.length > 0) parseDiagnosticFiles.push(index.nodes.find(({ filePath }) => source.filePath.endsWith(filePath))?.id ?? source.filePath);
    const sourceNode = index.nodes.find(({ filePath }) => source.filePath.endsWith(filePath));
    if (!sourceNode) continue;
    for (const reference of extractDependencies(source)) references.push(index.resolve(sourceNode.id, reference));
  }
  const graph = createDependencyGraph(index.nodes, references);
  const sourceHash = createHash('sha256')
    .update(orderedSources.map(({ filePath, hash }) => `${filePath}\u0000${hash}`).join('\n'))
    .digest('hex');
  return {
    schemaVersion: '1.0.0',
    corpus: {
      rootPath, sourceHash, fileCount: orderedSources.length, skippedFileCount,
      corpusComplete: index.config.corpusComplete, mappingsComplete: index.config.mappingsComplete,
      caseSensitive: index.config.caseSensitive,
    },
    graph, parseDiagnosticFiles: parseDiagnosticFiles.sort(), failures: failures.sort((left, right) => left.filePath.localeCompare(right.filePath)),
  };
}
