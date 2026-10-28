import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  compareUatBaselines,
  createManifestTemplate,
  createUatBaseline,
  renderVietnameseSummary,
  type UatBaselineReport,
  type UatManifest,
} from './baseline';

const USAGE = `Usage: sm-uat <source-folder> [options]

Options:
  --manifest <path>          Optional manually maintained classification manifest
  --output <path>            Write machine-readable baseline JSON (required for comparison)
  --previous <path>          Compare against a previous baseline JSON
  --write-manifest <path>    Explicitly write a NEEDS_VERIFICATION template
  --exclude <glob>           Exclude source paths (repeatable)
  --help                     Show this help`;

export async function runUatCommand(args: readonly string[]): Promise<0 | 2> {
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { target, ...options } = parseUatArguments(args);
  if (!target) {
    process.stdout.write(`${USAGE}\n`);
    return 2;
  }
  const manifest = options.manifest ? await readJson<UatManifest>(options.manifest) : undefined;
  const baseline = await createUatBaseline(target, {
    manifest,
    excludedPatterns: options.excludedPatterns,
  });
  const report = options.previous
    ? { ...baseline, comparison: compareUatBaselines(await readJson<UatBaselineReport>(options.previous), baseline) }
    : baseline;
  if (options.output) await writeJson(options.output, report);
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
  readonly excludedPatterns: readonly string[];
}

export function parseUatArguments(args: readonly string[]): ParsedOptions {
  let target: string | undefined;
  let manifest: string | undefined;
  let output: string | undefined;
  let previous: string | undefined;
  let writeManifest: string | undefined;
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
    else if (option === '--exclude') excludedPatterns.push(value);
    else throw new Error(`Unknown option: ${option}`);
  }
  if (previous && !output) throw new Error('--previous requires --output to preserve the comparison result');
  return { target, manifest, output, previous, writeManifest, excludedPatterns };
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as T;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

if (require.main === module) {
  runUatCommand(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; },
  );
}
