import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runAIReview } from '../ai/orchestrator';
import { OpenAICompatibleProvider } from '../ai/openai-compatible-provider';
import { createBuiltinRuleRegistry } from '../rules/builtin';
import type { RuleSetConfig, RuleSeverity } from '../rules/types';
import { reviewTarget } from '../reviewer/batch';
import { isReviewPreset, resolveReviewPreset, type ReviewPreset } from '../reviewer/presets';
import { renderHtmlReport } from '../reporting/html';
import { renderJsonReport } from '../reporting/json';
import { createReviewReport, reportExitCode } from '../reporting/report';
import { renderTextReview } from './text-review';
import {
  loadAIEnvironmentConfiguration,
  type AIEnvironmentConfiguration,
} from './environment';

type ReviewFormat = 'text' | 'json' | 'html';

interface ReviewCommandOptions {
  readonly format: ReviewFormat;
  readonly output?: string;
  readonly config?: string;
  readonly preset: ReviewPreset;
  readonly minSeverity: RuleSeverity;
  readonly ruleIds: readonly string[];
  readonly excludedPatterns: readonly string[];
  readonly ai: boolean;
  readonly allowSourceTransmission: boolean;
  readonly aiModel: string;
  readonly aiEndpoint: string;
  readonly aiTimeoutMs: number;
  readonly aiApiKey: string;
}

const CLI_SEVERITIES = new Set<RuleSeverity>(['info', 'warning', 'error']);
const FORMATS = new Set<ReviewFormat>(['text', 'json', 'html']);
const DEFAULT_AI_MODEL = 'gpt-4o-mini';
const DEFAULT_AI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_AI_TIMEOUT_MS = 30_000;

export const REVIEW_USAGE = `Usage: sm-review review <file-or-directory> [options]

Options:
  --format text|json|html           Report format (default: text)
  --output <path>                   Write the report to a file
  --config <path>                   Load JSON rule configuration
  --preset default|v1-production    Shared rule preset (default: default)
  --min-severity info|warning|error Display and failure threshold (default: warning)
  --rule <rule-id>                  Include a rule in the report (repeatable)
  --exclude <glob>                  Exclude matching files (repeatable)
  --ai                              Enable model-generated review
  --allow-source-transmission       Consent to send source to the configured provider
  --ai-model <model>                AI model ID (default: gpt-4o-mini)
  --ai-endpoint <url>               OpenAI-compatible chat completions endpoint
  --ai-timeout <milliseconds>       Positive request timeout (default: 30000)
  --help                            Show this help

Exit codes: 0 clean, 1 findings at threshold, 2 invalid/incomplete review.`;

export class CliInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInputError';
  }
}

export async function runReviewCommand(target: string, args: readonly string[]): Promise<0 | 1 | 2> {
  const environment = args.includes('--ai')
    ? await loadAIEnvironmentConfiguration()
    : {};
  const options = parseReviewOptions(args, environment);
  validateRuleFilters(options.ruleIds);
  const configuredRules = options.config ? await loadConfig(options.config) : {};
  const config = resolveReviewPreset(options.preset, configuredRules);
  const batch = await reviewTarget(target, {
    config,
    excludedPatterns: options.excludedPatterns,
  });
  const ai = await createAIResult(batch, options);
  const report = createReviewReport(batch, {
    minSeverity: options.minSeverity,
    ruleIds: options.ruleIds.length > 0 ? options.ruleIds : undefined,
    inputPath: resolve(target),
    ...(ai ? { ai } : {}),
  });
  const rendered = renderReport(report, options.format);

  if (options.output) {
    await writeFile(resolve(options.output), `${rendered}\n`, 'utf8');
  } else {
    process.stdout.write(`${rendered}\n`);
  }
  return reportExitCode(report);
}

function parseReviewOptions(
  args: readonly string[],
  environment: AIEnvironmentConfiguration,
): ReviewCommandOptions {
  let format: ReviewFormat = 'text';
  let output: string | undefined;
  let config: string | undefined;
  let preset: ReviewPreset = 'default';
  let minSeverity: RuleSeverity = 'warning';
  const ruleIds: string[] = [];
  const excludedPatterns: string[] = [];
  let ai = false;
  let allowSourceTransmission = false;
  let cliAIModel: string | undefined;
  let cliAIEndpoint: string | undefined;
  let cliAITimeoutMs: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--ai') {
      ai = true;
      continue;
    }
    if (option === '--allow-source-transmission') {
      allowSourceTransmission = true;
      continue;
    }
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
      case '--preset':
        if (!isReviewPreset(value)) throw new CliInputError(`Unknown review preset: ${value}`);
        preset = value;
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
      case '--ai-model':
        if (!value.trim()) throw new CliInputError('AI model must not be empty');
        cliAIModel = value;
        break;
      case '--ai-endpoint':
        cliAIEndpoint = value;
        break;
      case '--ai-timeout': {
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed) || parsed <= 0) {
          throw new CliInputError('AI timeout must be a positive integer');
        }
        cliAITimeoutMs = parsed;
        break;
      }
      default:
        throw new CliInputError(`Unknown option: ${option}`);
    }
  }

  const aiModel = cliAIModel ?? environment.model ?? DEFAULT_AI_MODEL;
  const aiEndpoint = cliAIEndpoint ?? environment.endpoint ?? DEFAULT_AI_ENDPOINT;
  const aiTimeoutMs = cliAITimeoutMs ?? resolveEnvironmentTimeout(environment.timeoutMs, ai);
  if (ai && !aiModel.trim()) throw new CliInputError('AI model must not be empty');
  if (ai && !aiEndpoint.trim()) throw new CliInputError('AI endpoint must not be empty');

  return {
    format,
    output,
    config,
    preset,
    minSeverity,
    ruleIds,
    excludedPatterns,
    ai,
    allowSourceTransmission,
    aiModel,
    aiEndpoint,
    aiTimeoutMs,
    aiApiKey: environment.apiKey ?? '',
  };
}

async function createAIResult(
  batch: Awaited<ReturnType<typeof reviewTarget>>,
  options: ReviewCommandOptions,
) {
  if (!options.ai) return undefined;
  if (!options.allowSourceTransmission) {
    return runAIReview(batch, {
      enabled: true,
      allowSourceTransmission: false,
      modelId: options.aiModel,
      timeoutMs: options.aiTimeoutMs,
    });
  }

  let provider;
  let providerConfigurationError: string | undefined;
  try {
    provider = new OpenAICompatibleProvider({
      endpoint: options.aiEndpoint,
      apiKey: options.aiApiKey,
    });
  } catch (error) {
    providerConfigurationError = errorMessage(error);
  }
  return runAIReview(batch, {
    enabled: true,
    allowSourceTransmission: true,
    provider,
    providerConfigurationError,
    modelId: options.aiModel,
    timeoutMs: options.aiTimeoutMs,
  });
}

function resolveEnvironmentTimeout(value: string | undefined, aiEnabled: boolean): number {
  if (value === undefined || !aiEnabled) return DEFAULT_AI_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new CliInputError('SM_REVIEWER_AI_TIMEOUT_MS must be a positive integer');
  }
  return parsed;
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
