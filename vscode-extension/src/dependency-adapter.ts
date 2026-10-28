import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { analyzeDependencies } from '../../src/dependencies/analyze';
import type { DependencyAnalysisConfig, DependencyAnalysisResult } from '../../src/dependencies/types';
import { discoverSourceFiles, loadSource } from '../../src/source/loader';
import type { SourceDocument } from '../../src/core/types';

export interface DependencyFolderOptions {
  readonly config: DependencyAnalysisConfig;
  readonly maxFiles: number;
  readonly openDocuments?: ReadonlyMap<string, string>;
  readonly isCancellationRequested?: () => boolean;
}

export interface DependencyFolderResult { readonly analysis: DependencyAnalysisResult; readonly limited: boolean; readonly cancelled: boolean; }

export async function analyzeDependencyFolder(target: string, options: DependencyFolderOptions): Promise<DependencyFolderResult> {
  const discovery = await discoverSourceFiles(target, { extensions: ['.js', '.txt'], ignoreSymlinks: true });
  const paths = discovery.paths.slice(0, options.maxFiles); const sources: SourceDocument[] = [];
  for (const path of paths) {
    if (options.isCancellationRequested?.()) return { analysis: await analyzeDependencies(target, { ...options.config, sources }), limited: discovery.paths.length > paths.length, cancelled: true };
    const key = resolve(path).toLowerCase(); const text = options.openDocuments?.get(key);
    sources.push(text === undefined ? await loadSource(path) : {
      id: resolve(path), filePath: resolve(path), content: text, hash: createHash('sha256').update(text).digest('hex'),
    });
  }
  return { analysis: await analyzeDependencies(target, { ...options.config, sources }), limited: discovery.paths.length > paths.length, cancelled: false };
}
