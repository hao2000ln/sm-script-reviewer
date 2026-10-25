import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, extname, join } from 'node:path';
import type { SourceDocument } from '../core/types';
export async function loadSource(path: string): Promise<SourceDocument> {
  const filePath = resolve(path);
  const content = await readFile(filePath, 'utf8');
  return { id: filePath, filePath, content, hash: createHash('sha256').update(content).digest('hex') };
}
export async function discoverSources(path: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const absolute = resolve(path);
  if ((await fs.stat(absolute)).isFile()) return extname(absolute).toLowerCase() === '.js' ? [absolute] : [];
  const output: string[] = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const next = join(absolute, entry.name);
    if (entry.isDirectory()) output.push(...await discoverSources(next));
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.js') output.push(next);
  }
  return output.sort();
}
