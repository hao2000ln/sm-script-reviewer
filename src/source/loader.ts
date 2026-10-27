import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname, join, relative } from 'node:path';
import type { SourceDocument } from '../core/types';
import { matchesGlob } from './glob';

export interface SourceDiscoveryOptions {
  readonly extensions?: readonly string[];
  readonly excludedDirectoryNames?: readonly string[];
  readonly excludedPatterns?: readonly string[];
  readonly ignoreSymlinks?: boolean;
}

export interface SourceDiscoveryResult {
  readonly paths: readonly string[];
  readonly skippedFileCount: number;
}

const DEFAULT_EXTENSIONS = ['.js'] as const;
const DEFAULT_EXCLUDED_DIRECTORIES = ['.git', 'node_modules', 'dist'] as const;

export async function loadSource(path: string): Promise<SourceDocument> {
  const filePath = resolve(path);
  const content = await readFile(filePath, 'utf8');
  return { id: filePath, filePath, content, hash: createHash('sha256').update(content).digest('hex') };
}

export async function discoverSources(
  path: string,
  options: SourceDiscoveryOptions = {},
): Promise<string[]> {
  return [...(await discoverSourceFiles(path, options)).paths];
}

export async function discoverSourceFiles(
  path: string,
  options: SourceDiscoveryOptions = {},
): Promise<SourceDiscoveryResult> {
  const absolute = resolve(path);
  const extensions = new Set(
    (options.extensions ?? DEFAULT_EXTENSIONS).map(normalizeExtension),
  );
  const excludedDirectories = new Set(
    (options.excludedDirectoryNames ?? DEFAULT_EXCLUDED_DIRECTORIES)
      .map((name) => name.toLowerCase()),
  );
  const result = await discover(
    absolute,
    absolute,
    extensions,
    excludedDirectories,
    options.excludedPatterns ?? [],
    options.ignoreSymlinks === true,
  );
  return {
    paths: result.paths.sort(compareNormalizedPaths),
    skippedFileCount: result.skippedFileCount,
  };
}

interface MutableDiscoveryResult {
  paths: string[];
  skippedFileCount: number;
}

async function discover(
  root: string,
  absolute: string,
  extensions: ReadonlySet<string>,
  excludedDirectories: ReadonlySet<string>,
  excludedPatterns: readonly string[],
  ignoreSymlinks: boolean,
): Promise<MutableDiscoveryResult> {
  const relativePath = normalizedPath(relative(root, absolute));
  if (relativePath && excludedPatterns.some((pattern) => matchesGlob(relativePath, pattern))) {
    return { paths: [], skippedFileCount: 0 };
  }
  const entry = await lstat(absolute);
  if (entry.isSymbolicLink() && ignoreSymlinks) return { paths: [], skippedFileCount: 0 };
  const target = entry.isSymbolicLink() ? await stat(absolute) : entry;
  if (target.isFile()) {
    return extensions.has(extname(absolute).toLowerCase())
      ? { paths: [absolute], skippedFileCount: 0 }
      : { paths: [], skippedFileCount: 1 };
  }
  if (!target.isDirectory()) return { paths: [], skippedFileCount: 0 };

  const output: MutableDiscoveryResult = { paths: [], skippedFileCount: 0 };
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.') || excludedDirectories.has(entry.name.toLowerCase())) {
      if (entry.isFile()) output.skippedFileCount += 1;
      continue;
    }
    const next = join(absolute, entry.name);
    const nextRelativePath = normalizedPath(relative(root, next));
    if (excludedPatterns.some((pattern) => matchesGlob(nextRelativePath, pattern))) {
      if (entry.isFile()) output.skippedFileCount += 1;
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await discover(
        root,
        next,
        extensions,
        excludedDirectories,
        excludedPatterns,
        ignoreSymlinks,
      );
      output.paths.push(...nested.paths);
      output.skippedFileCount += nested.skippedFileCount;
    } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      output.paths.push(next);
    } else if (entry.isFile()) {
      output.skippedFileCount += 1;
    }
  }
  return output;
}

function normalizeExtension(extension: string): string {
  const normalized = extension.toLowerCase();
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/');
}

function compareNormalizedPaths(left: string, right: string): number {
  const normalizedLeft = normalizedPath(left);
  const normalizedRight = normalizedPath(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  return 0;
}
