import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import { analyzeDependencies } from '../../src/dependencies/analyze';
import type { DependencyAnalysisConfig, DependencyAnalysisResult } from '../../src/dependencies/types';
import { discoverSourceFiles, loadSource } from '../../src/source/loader';
import type { SourceDocument } from '../../src/core/types';

export interface DependencyFolderOptions {
  readonly config: DependencyAnalysisConfig;
  readonly maxFiles: number;
  readonly openDocuments?: ReadonlyMap<string, string>;
  readonly isCancellationRequested?: () => boolean;
  readonly onProgress?: (completed: number, total: number) => void;
}

export interface DependencyFolderResult { readonly analysis: DependencyAnalysisResult; readonly limited: boolean; readonly cancelled: boolean; }

export async function analyzeDependencyFolder(target: string, options: DependencyFolderOptions): Promise<DependencyFolderResult> {
  const discovery = await discoverSourceFiles(target, { extensions: ['.js', '.txt'], ignoreSymlinks: true });
  const paths = discovery.paths.slice(0, options.maxFiles); const sources: SourceDocument[] = [];
  const failures: { filePath: string; message: string }[] = [];
  const limitedFileCount = discovery.paths.length - paths.length;
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    if (options.isCancellationRequested?.()) return { analysis: await analyzeDependencies(target, { ...options.config, sources, executionComplete: false, skippedFileCount: discovery.skippedFileCount, limitedFileCount, knownFailures: failures }), limited: limitedFileCount > 0, cancelled: true };
    const key = resolve(path).toLowerCase(); const text = options.openDocuments?.get(key);
    try {
      sources.push(text === undefined ? await loadSource(path) : {
        id: resolve(path), filePath: resolve(path), content: text, hash: createHash('sha256').update(text).digest('hex'),
      });
    } catch { failures.push({ filePath: relative(target, path).replaceAll('\\', '/'), message: 'Unable to load source file.' }); }
    options.onProgress?.(index + 1, paths.length);
  }
  return { analysis: await analyzeDependencies(target, { ...options.config, sources, executionComplete: failures.length === 0 && limitedFileCount === 0 && discovery.skippedFileCount === 0, skippedFileCount: discovery.skippedFileCount, limitedFileCount, knownFailures: failures }), limited: limitedFileCount > 0, cancelled: false };
}

/** Returns an absolute target only when a graph-owned relative id stays inside root. */
export function resolveDependencyReferencePath(root: string, sourceNodeId: string): string | undefined {
  if (/^[A-Za-z]:[\\/]/u.test(sourceNodeId) || sourceNodeId.startsWith('/') || sourceNodeId.startsWith('\\')) return undefined;
  const target = resolve(root, sourceNodeId);
  const relation = relative(root, target);
  return relation && relation !== '..' && !relation.startsWith(`..${String.fromCharCode(92)}`) && !relation.startsWith('../') ? target : undefined;
}
