import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBuiltinRuleRegistry } from '../rules/builtin';
import type { RuleSetConfig, RuleSeverity } from '../rules/types';
import { reviewTarget } from '../reviewer/batch';
import { renderHtmlReport } from '../reporting/html';
import { renderJsonReport } from '../reporting/json';
import { createReviewReport, reportExitCode } from '../reporting/report';
import { renderTextReview } from './text-review';

type ReviewFormat = 'text' | 'json' | 'html';

interface ReviewCommandOptions {
  readonly format: ReviewFormat;
  readonly output?: string;
  readonly config?: string;
  readonly minSeverity: RuleSeverity;
  readonly ruleIds: readonly string[];
  readonly excludedPatterns: readonly string[];
}

const CLI_SEVERITIES = new Set<RuleSeverity>(['info', 'warning', 'error']);
const FORMATS = new Set<ReviewFormat>(['text', 'json', 'html']);

export class CliInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInputError';
  }
}

export async function runReviewCommand(target: string, args: readonly string[]): Promise<0 | 1 | 2> {
  const options = parseReviewOptions(args);
  validateRuleFilters(options.ruleIds);
  const config = options.config ? await loadConfig(options.config) : {};
  const batch = await reviewTarget(target, {
    config,
    excludedPatterns: options.excludedPatterns,
  });
  const report = createReviewReport(batch, {
    minSeverity: options.minSeverity,
    ruleIds: options.ruleIds.length > 0 ? options.ruleIds : undefined,
  });
  const rendered = renderReport(report, options.format);

  if (options.output) {
    await writeFile(resolve(options.output), `${rendered}\n`, 'utf8');
  } else {
    process.stdout.write(`${rendered}\n`);
  }
  return reportExitCode(report);
}

function parseReviewOptions(args: readonly string[]): ReviewCommandOptions {
  let format: ReviewFormat = 'text';
  let output: string | undefined;
  let config: string | undefined;
  let minSeverity: RuleSeverity = 'warning';
  const ruleIds: string[] = [];
  const excludedPatterns: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = args[index + 1];
    if (!option.startsWith('--')) throw new CliInputError(`Unexpected argument: ${option}`);
    if (!value || value.startsWith('--')) throw new CliInputError(`Missing value for ${option}`);
    index += 1;

    switch (option) {
      case '--format':
        if (!FORMATS.has(value as ReviewFormat)) throw new CliInputError(`Invalid format: ${value}`);
        format = value as ReviewFormat;
        break;
      case '--output':
        output = value;
        break;
      case '--config':
        config = value;
        break;
      case '--min-severity':
        if (!CLI_SEVERITIES.has(value as RuleSeverity)) {
          throw new CliInputError(`Invalid minimum severity: ${value}`);
        }
        minSeverity = value as RuleSeverity;
        break;
      case '--rule':
        ruleIds.push(value);
        break;
      case '--exclude':
        excludedPatterns.push(value);
        break;
      default:
        throw new CliInputError(`Unknown option: ${option}`);
    }
  }

  return { format, output, config, minSeverity, ruleIds, excludedPatterns };
}

function validateRuleFilters(ruleIds: readonly string[]): void {
  const registry = createBuiltinRuleRegistry();
  for (const id of ruleIds) {
    if (!registry.get(id)) throw new CliInputError(`Unknown rule ID: ${id}`);
  }
}

async function loadConfig(path: string): Promise<RuleSetConfig> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
  } catch (error) {
    throw new CliInputError(`Cannot read configuration: ${errorMessage(error)}`);
  }
  if (!isPlainObject(value) || (value.rules !== undefined && !isPlainObject(value.rules))) {
    throw new CliInputError('Configuration must be an object with an optional rules object');
  }
  return value as RuleSetConfig;
}

function renderReport(
  report: Parameters<typeof renderTextReview>[0],
  format: ReviewFormat,
): string {
  if (format === 'json') return renderJsonReport(report);
  if (format === 'html') return renderHtmlReport(report);
  return renderTextReview(report);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
