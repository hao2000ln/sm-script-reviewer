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
  /** Caller signals a deliberately truncated or cancelled injected source list. */
  readonly executionComplete?: boolean;
  readonly limitedFileCount?: number;
  readonly skippedFileCount?: number;
  readonly knownFailures?: readonly { readonly filePath: string; readonly message: string }[];
  readonly sources?: readonly SourceDocument[];
}

export async function analyzeDependencies(
  target: string,
  options: DependencyAnalyzeOptions = {},
): Promise<DependencyAnalysisResult> {
  const rootPath = resolve(target);
  const failures: { filePath: string; message: string }[] = (options.knownFailures ?? []).map(({ filePath }) => ({
    filePath: corpusRelativePath(rootPath, resolve(rootPath, filePath)), message: 'Unable to load source file.',
  }));
  let skippedFileCount = options.skippedFileCount ?? 0;
  const limitedFileCount = options.limitedFileCount ?? 0;
  let sources = options.sources;
  if (!sources) {
    const discovery = await discoverSourceFiles(rootPath, {
      extensions: ['.js', '.txt'], excludedPatterns: options.excludedPatterns, ignoreSymlinks: true,
    });
    skippedFileCount += discovery.skippedFileCount;
    const values: SourceDocument[] = [];
    for (const path of discovery.paths) {
      try { values.push(await loadSource(path)); }
      catch { failures.push({ filePath: corpusRelativePath(rootPath, path), message: 'Unable to load source file.' }); }
    }
    sources = values;
  }
  const usableSources = sources.filter((source) => {
    const valid = corpusRelativePath(rootPath, source.filePath) !== '<outside-corpus>';
    if (!valid) failures.push({ filePath: '<outside-corpus>', message: 'Injected dependency source is outside the analyzed corpus.' });
    return valid;
  });
  const orderedSources = [...usableSources].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const references = [];
  const parseDiagnosticFiles: string[] = [];
  const artifacts = orderedSources.map((source) => ({ source, artifact: createAnalysisArtifact(source) }));
  for (const { source, artifact } of artifacts) if (artifact.analysis.issues.length > 0) parseDiagnosticFiles.push(corpusRelativePath(rootPath, source.filePath));
  const executionComplete = (options.executionComplete ?? options.sources === undefined)
    && limitedFileCount === 0 && skippedFileCount === 0 && failures.length === 0 && parseDiagnosticFiles.length === 0;
  const declaredCorpusComplete = options.corpusComplete === true;
  const index = createDependencyIndex(rootPath, orderedSources, { ...options, corpusComplete: declaredCorpusComplete && executionComplete });
  for (const { source } of artifacts) {
    // Use the same normalized relative identity as the index. `endsWith` is
    // unsafe when a corpus contains paths such as lib/Alpha.js and Alpha.js.
    const sourceId = relative(rootPath, source.filePath).replaceAll('\\', '/').replace(/^\.\//u, '');
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
      limitedFileCount, failureCount: failures.length, parseDiagnosticFileCount: parseDiagnosticFiles.length,
      declaredCorpusComplete, executionComplete, executionIncompleteReasons: incompleteReasons({ skippedFileCount, limitedFileCount, failures, parseDiagnosticFiles, injected: options.sources !== undefined && options.executionComplete !== true }),
      corpusComplete: index.config.corpusComplete, mappingsComplete: index.config.mappingsComplete,
      caseSensitive: index.config.caseSensitive,
    },
    graph, parseDiagnosticFiles: parseDiagnosticFiles.sort(), failures: failures.sort((left, right) => left.filePath.localeCompare(right.filePath)),
  };
}

function incompleteReasons(input: {
  readonly skippedFileCount: number; readonly limitedFileCount: number;
  readonly failures: readonly unknown[]; readonly parseDiagnosticFiles: readonly string[]; readonly injected: boolean;
}): readonly string[] {
  const reasons: string[] = [];
  if (input.injected) reasons.push('Injected sources were not declared execution-complete.');
  if (input.skippedFileCount > 0) reasons.push('Files were skipped or excluded during discovery.');
  if (input.limitedFileCount > 0) reasons.push('The configured file limit truncated the scan.');
  if (input.failures.length > 0) reasons.push('At least one source file could not be loaded.');
  if (input.parseDiagnosticFiles.length > 0) reasons.push('At least one source file has parse diagnostics.');
  return reasons;
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
