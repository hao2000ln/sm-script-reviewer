import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadUatEnvironmentConfiguration, type UatEnvironmentConfiguration } from '../cli/environment';
import {
  compareUatBaselines,
  createManifestTemplate,
  createUatBaseline,
  renderVietnameseSummary,
  type UatBaselineReport,
  LEGACY_UAT_BASELINE_SCHEMA_VERSION,
  UAT_BASELINE_SCHEMA_VERSION,
  type UatCorpusProfile,
  type UatManifest,
} from './baseline';

const USAGE = `Usage: sm-uat <source-folder> [options]

Options:
  --manifest <path>          Optional manually maintained classification manifest
  --output <path>            Write machine-readable baseline JSON (required for comparison)
  --previous <path>          Compare against a previous baseline JSON
  --write-manifest <path>    Explicitly write a NEEDS_VERIFICATION template
  --profile <production|full> Corpus profile (default: production)
  --exclude <glob>           Exclude source paths (repeatable)
  --help                     Show this help`;

export async function runUatCommand(args: readonly string[]): Promise<0 | 2> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { target: suppliedTarget, ...options } = parseUatArguments(args);
  const environment = await loadUatEnvironmentConfiguration();
  const invocation = resolveUatInvocation(suppliedTarget, options, environment);
  const { profile, target, uatDirectory, excludedPatterns } = invocation;
  const manifest = options.manifest ? await readJson<UatManifest>(options.manifest) : undefined;
  const baseline = await createUatBaseline(target, {
    manifest,
    excludedPatterns,
    profile,
    relativeCorpusRoot: relativeCorpusRoot(target),
  });
  const report = options.previous
    ? { ...baseline, comparison: compareUatBaselines(await readBaseline(options.previous), baseline) }
    : baseline;
  // Preserve the original explicit-source behavior: without --output it only
  // writes the console summary. The all-default local workflow gets a safe
  // predictable destination under SM-UAT.
  const output = options.output ?? (suppliedTarget ? undefined : resolve(uatDirectory, `baseline-${profile}.json`));
  if (output) await writeJson(output, report);
  if (options.writeManifest) await writeJson(options.writeManifest, createManifestTemplate(baseline));
  process.stdout.write(`${renderVietnameseSummary(baseline)}\n`);
  if (options.previous) {
    const comparison = (report as typeof report & { comparison: ReturnType<typeof compareUatBaselines> }).comparison;
    process.stdout.write(`- So với baseline trước: mới=${comparison.newFindings.length}, mất=${comparison.removedFindings.length}, còn lại=${comparison.persistentFindings.length}, source thay đổi=${comparison.changedSourceFiles.length}.\n`);
  }
  return 0;
}

interface ParsedOptions {
  readonly target?: string;
  readonly manifest?: string;
  readonly output?: string;
  readonly previous?: string;
  readonly writeManifest?: string;
  readonly profile?: Exclude<UatCorpusProfile, 'custom'>;
  readonly excludedPatterns: readonly string[];
}

export function parseUatArguments(args: readonly string[]): ParsedOptions {
  let target: string | undefined;
  let manifest: string | undefined;
  let output: string | undefined;
  let previous: string | undefined;
  let writeManifest: string | undefined;
  let profile: Exclude<UatCorpusProfile, 'custom'> | undefined;
  const excludedPatterns: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option.startsWith('-')) {
      if (target) throw new Error(`Unexpected source path: ${option}`);
      target = option;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('-')) throw new Error(`Missing value for ${option}`);
    index += 1;
    if (option === '--manifest') manifest = value;
    else if (option === '--output') output = value;
    else if (option === '--previous') previous = value;
    else if (option === '--write-manifest') writeManifest = value;
    else if (option === '--profile') {
      if (value !== 'production' && value !== 'full') throw new Error(`Invalid UAT profile: ${value}`);
      profile = value;
    }
    else if (option === '--exclude') excludedPatterns.push(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (previous && !output) throw new Error('--previous requires --output to preserve the comparison result');
  return { target, manifest, output, previous, writeManifest, profile, excludedPatterns };
}

export function resolveUatInvocation(
  suppliedTarget: string | undefined,
  options: Omit<ParsedOptions, 'target'>,
  environment: UatEnvironmentConfiguration,
): {
  readonly profile: Exclude<UatCorpusProfile, 'custom'>;
  readonly target: string;
  readonly uatDirectory: string;
  readonly excludedPatterns: readonly string[];
} {
  const profile = options.profile ?? 'production';
  const profileExclusions = profile === 'production' ? ['Samples/**', 'Tests/**', 'Tools/**'] : [];
  return {
    profile,
    target: suppliedTarget ?? environment.scriptLibraryDir ?? './SM-Exports/ScriptLibrary',
    uatDirectory: environment.uatDir ?? './SM-UAT',
    excludedPatterns: [...profileExclusions, ...options.excludedPatterns],
  };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readBaseline(path: string): Promise<UatBaselineReport> {
  const baseline = await readJson<UatBaselineReport>(path);
  if (baseline.schemaVersion !== UAT_BASELINE_SCHEMA_VERSION
    && baseline.schemaVersion !== LEGACY_UAT_BASELINE_SCHEMA_VERSION) {
    throw new Error(`Unsupported UAT baseline schema: ${String(baseline.schemaVersion)}`);
  }
  return baseline;
}

function relativeCorpusRoot(path: string): string {
  const resolved = resolve(path);
  const root = resolve(process.cwd());
  return resolved.startsWith(root) ? resolved.slice(root.length).replaceAll('\\', '/').replace(/^\/+/, '') || '.' : 'external-corpus';
}

if (require.main === module) {
  runUatCommand(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; },
  );
}
