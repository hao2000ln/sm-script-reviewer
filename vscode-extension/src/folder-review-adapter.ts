import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { SourceDocument } from '../../src/core/types';
import { discoverSourceFiles, loadSource } from '../../src/source/loader';
import { review } from '../../src/reviewer/review';
import type { RuleRunResult, RuleSetConfig } from '../../src/rules/types';

export interface FolderReviewOptions {
  readonly maxFiles: number;
  readonly excludedPatterns: readonly string[];
  readonly isCancellationRequested?: () => boolean;
  readonly openDocuments?: ReadonlyMap<string, string>;
  readonly onProgress?: (completed: number, total: number) => void;
  readonly config?: RuleSetConfig;
}
export interface FolderReviewFile { readonly filePath: string; readonly result: RuleRunResult; readonly usedUnsavedContent: boolean; }
export interface FolderReviewResult {
  readonly files: readonly FolderReviewFile[]; readonly failures: readonly { filePath: string; message: string }[];
  readonly skippedFileCount: number; readonly limited: boolean; readonly cancelled: boolean;
}

export async function reviewFolder(target: string, options: FolderReviewOptions): Promise<FolderReviewResult> {
  const discovery = await discoverSourceFiles(target, { extensions: ['.js', '.txt'], excludedPatterns: options.excludedPatterns, ignoreSymlinks: true });
  const paths = discovery.paths.slice(0, options.maxFiles);
  const files: FolderReviewFile[] = []; const failures: { filePath: string; message: string }[] = [];
  for (const [index, filePath] of paths.entries()) {
    if (options.isCancellationRequested?.()) return { files, failures, skippedFileCount: discovery.skippedFileCount, limited: discovery.paths.length > paths.length, cancelled: true };
    try {
      const key = resolve(filePath).toLowerCase(); const unsaved = options.openDocuments?.get(key);
      const source: SourceDocument = unsaved === undefined ? await loadSource(filePath) : {
        id: resolve(filePath), filePath: resolve(filePath), content: unsaved, hash: createHash('sha256').update(unsaved).digest('hex'),
      };
      files.push({ filePath, result: review(source, options.config), usedUnsavedContent: unsaved !== undefined });
    } catch (error) { failures.push({ filePath, message: error instanceof Error ? error.message : String(error) }); }
    options.onProgress?.(index + 1, paths.length);
    await Promise.resolve();
  }
  return { files, failures, skippedFileCount: discovery.skippedFileCount, limited: discovery.paths.length > paths.length, cancelled: false };
}
