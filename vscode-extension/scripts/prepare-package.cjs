'use strict';

const { existsSync, rmSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const generatedOnly = [
  'dist/vscode-extension/tests',
  'dist/src/cli',
  'dist/src/reporting',
  'dist/src/source',
];

for (const relativePath of generatedOnly) {
  const target = resolve(root, relativePath);
  if (!target.startsWith(`${root}\\`)) throw new Error(`Unsafe generated target: ${relativePath}`);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`Removed generated package artifact: ${relativePath}`);
  }
}
