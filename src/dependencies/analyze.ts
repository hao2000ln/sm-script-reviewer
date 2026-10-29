import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
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
      catch (error) { failures.push({ filePath: corpusRelativePath(rootPath, path), message: error instanceof Error ? error.message : String(error) }); }
    }
    sources = values;
  }
  const orderedSources = [...sources].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const index = createDependencyIndex(rootPath, orderedSources, options);
  const references = [];
  const parseDiagnosticFiles: string[] = [];
  for (const source of orderedSources) {
    const artifact = createAnalysisArtifact(source);
    // Use the same normalized relative identity as the index. `endsWith` is
    // unsafe when a corpus contains paths such as lib/Alpha.js and Alpha.js.
    const sourceId = relative(rootPath, source.filePath).replaceAll('\\', '/').replace(/^\.\//u, '');
    if (artifact.analysis.issues.length > 0) parseDiagnosticFiles.push(index.nodes.find(({ filePath }) => filePath === sourceId)?.id ?? sourceId);
    const sourceNode = index.nodes.find(({ filePath }) => filePath === sourceId);
    if (!sourceNode) continue;
    for (const reference of extractDependencies(source)) references.push(index.resolve(sourceNode.id, reference));
  }
  const graph = createDependencyGraph(index.nodes, references);
  const sourceHash = createHash('sha256')
    .update(orderedSources.map(({ filePath, hash }) => `${corpusRelativePath(rootPath, filePath)}\u0000${hash}`).join('\n'))
    .digest('hex');
  return {
    schemaVersion: '1.0.0',
    corpus: {
      rootPath: shareableCorpusRoot(rootPath), sourceHash, fileCount: orderedSources.length, skippedFileCount,
      corpusComplete: index.config.corpusComplete, mappingsComplete: index.config.mappingsComplete,
      caseSensitive: index.config.caseSensitive,
    },
    graph, parseDiagnosticFiles: parseDiagnosticFiles.sort(), failures: failures.sort((left, right) => left.filePath.localeCompare(right.filePath)),
  };
}

function corpusRelativePath(rootPath: string, filePath: string): string {
  const value = relative(rootPath, filePath).replaceAll('\\', '/');
  return value && !value.startsWith('../') && value !== '..' ? value : '<outside-corpus>';
}

function shareableCorpusRoot(rootPath: string): string {
  const value = relative(process.cwd(), rootPath).replaceAll('\\', '/');
  // A report can be shared without disclosing the workstation's absolute
  // directory layout. External roots deliberately remain opaque.
  return value && !value.startsWith('../') && value !== '..' && !isAbsolute(value) ? value : '<external-corpus>';
}
