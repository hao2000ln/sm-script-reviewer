import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeDependencies } from '../dependencies/analyze';
import { calculateImpact } from '../dependencies/graph';
import { validateDependencyAnalysisConfig } from '../dependencies/index';
import { renderDependencyHtml, renderDependencyText, type DependencyReport } from '../dependencies/report';
import type { DependencyAnalysisConfig } from '../dependencies/types';
import { TOOL_VERSION } from '../core/version';

type Format = 'text' | 'json' | 'html';
interface Options { readonly format: Format; readonly output?: string; readonly config?: string; readonly changed: readonly string[]; readonly excludedPatterns: readonly string[]; }

export const DEPENDENCY_USAGE = `Usage:
  sm-review dependencies <folder> [--format text|json|html] [--output <path>] [--config <path>] [--exclude <glob>]
  sm-review impact <folder> --changed <library> [--changed <library>] [options]

Dependency config is JSON: { corpusComplete, mappingsComplete, caseSensitive, libraryMappings: [{ libraryName, filePath }] }.
MISSING is emitted only when corpusComplete and mappingsComplete are both true.`;

export async function runDependencyCommand(command: 'dependencies' | 'impact', target: string, args: readonly string[]): Promise<0 | 1 | 2> {
  const options = parseOptions(command, args);
  const config = options.config ? await loadConfig(options.config) : {};
  const analysis = await analyzeDependencies(target, { ...config, excludedPatterns: options.excludedPatterns });
  const impact = command === 'impact' ? calculateImpact(analysis.graph, options.changed) : undefined;
  const report: DependencyReport = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), toolVersion: TOOL_VERSION, analysis, ...(impact ? { impact } : {}) };
  const output = options.format === 'json' ? JSON.stringify(report, null, 2) : options.format === 'html' ? renderDependencyHtml(report) : renderDependencyText(report);
  if (options.output) await writeFile(resolve(options.output), `${output}\n`, 'utf8'); else process.stdout.write(`${output}\n`);
  if (analysis.failures.length > 0) return 2;
  return analysis.graph.references.some(({ status }) => status === 'MISSING') ? 1 : 0;
}

function parseOptions(command: 'dependencies' | 'impact', args: readonly string[]): Options {
  let format: Format = 'text'; let output: string | undefined; let config: string | undefined; const changed: string[] = []; const excludedPatterns: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]; const value = args[index + 1];
    if (!option.startsWith('--')) throw new Error(`Unexpected argument: ${option}`);
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    index += 1;
    if (option === '--format' && (value === 'text' || value === 'json' || value === 'html')) format = value;
    else if (option === '--format') throw new Error(`Invalid format: ${value}`);
    else if (option === '--output') output = value;
    else if (option === '--config') config = value;
    else if (option === '--changed') changed.push(value);
    else if (option === '--exclude') excludedPatterns.push(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (command === 'impact' && changed.length === 0) throw new Error('impact requires at least one --changed <library>');
  return { format, output, config, changed, excludedPatterns };
}

async function loadConfig(path: string): Promise<DependencyAnalysisConfig> {
  let value: unknown;
  try { value = JSON.parse(await readFile(resolve(path), 'utf8')) as unknown; }
  catch (error) { throw new Error(`Cannot read dependency configuration: ${error instanceof Error ? error.message : String(error)}`); }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Dependency configuration must be an object');
  const config = value as DependencyAnalysisConfig;
  validateDependencyAnalysisConfig(config);
  return config;
}
