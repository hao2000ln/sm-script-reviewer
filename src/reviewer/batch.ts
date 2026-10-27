import type { SourceDocument } from '../core/types';
import { discoverSources, loadSource } from '../source/loader';
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
}

export interface BatchReviewOptions {
  readonly load?: (path: string) => Promise<SourceDocument>;
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
  const paths = await discoverSources(target, {
    extensions: REVIEW_EXTENSIONS,
    excludedPatterns: options.excludedPatterns,
    ignoreSymlinks: true,
  });
  const load = options.load ?? loadSource;
  const files: ReviewedFile[] = [];
  const failures: ReviewFailure[] = [];

  for (const filePath of paths) {
    try {
      files.push({ filePath, result: review(await load(filePath), config) });
    } catch (error) {
      failures.push({ filePath, message: errorMessage(error) });
    }
  }

  return { files, failures };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
