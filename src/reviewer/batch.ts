import type { SourceDocument } from '../core/types';
import { lstat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { discoverSourceFiles, loadSource } from '../source/loader';
import type { RuleRunResult } from '../rules/types';
import type { RuleSetConfig } from '../rules/types';
import { review, validateReviewConfig } from './review';

export interface ReviewedFile {
  readonly filePath: string;
  readonly result: RuleRunResult;
}

export interface ReviewFailure {
  readonly filePath: string;
  readonly message: string;
}

export interface BatchReviewResult {
  readonly files: readonly ReviewedFile[];
  readonly failures: readonly ReviewFailure[];
  readonly skippedFileCount: number;
}

export interface BatchReviewOptions {
  readonly load?: (path: string) => Promise<SourceDocument>;
  /** Test/host seam; the default remains the built-in static reviewer. */
  readonly reviewSource?: (source: SourceDocument, config: RuleSetConfig) => RuleRunResult;
  readonly config?: RuleSetConfig;
  readonly excludedPatterns?: readonly string[];
}

const REVIEW_EXTENSIONS = ['.js', '.txt'] as const;

export async function reviewTarget(
  target: string,
  options: BatchReviewOptions = {},
): Promise<BatchReviewResult> {
  const config = options.config ?? {};
  validateReviewConfig(config);
  const absoluteTarget = resolve(target);
  const targetStat = await lstat(absoluteTarget);
  if (targetStat.isFile() && !REVIEW_EXTENSIONS.includes(
    extname(absoluteTarget).toLowerCase() as typeof REVIEW_EXTENSIONS[number],
  )) {
    throw new Error(`Unsupported source file extension: ${extname(absoluteTarget) || '<none>'}`);
  }
  const discovery = await discoverSourceFiles(absoluteTarget, {
    extensions: REVIEW_EXTENSIONS,
    excludedPatterns: options.excludedPatterns,
    ignoreSymlinks: true,
  });
  const load = options.load ?? loadSource;
  const reviewSource = options.reviewSource ?? review;
  const files: ReviewedFile[] = [];
  const failures: ReviewFailure[] = [];

  for (const filePath of discovery.paths) {
    try {
      files.push({ filePath, result: reviewSource(await load(filePath), config) });
    } catch (error) {
      failures.push({ filePath, message: errorMessage(error) });
    }
  }

  return { files, failures, skippedFileCount: discovery.skippedFileCount };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
