'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const archive = resolve(process.argv[2] || 'vscode-extension/sm-scriptlibrary-reviewer-0.1.0.vsix');
const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' })
  .split(/\r?\n/u)
  .filter(Boolean)
  .sort();

const required = [
  'extension/package.json',
  'extension/dist/vscode-extension/src/extension.js',
  'extension/dist/src/reviewer/review.js',
  'extension/dist/src/ai/orchestrator.js',
  'extension/node_modules/typescript/lib/typescript.js',
];
for (const path of required) assert.ok(entries.includes(path), `Missing required VSIX entry: ${path}`);

const forbidden = entries.filter((path) => (
  /(^|\/)(tests?|uat)(\/|$)/u.test(path)
  || /(^|\/)\.env(?:\.|$)/u.test(path)
  || /(^|\/)src\/.*\.ts$/u.test(path)
  || /(^|\/)\.vscode(\/|$)/u.test(path)
  || /\.vsix$/u.test(path)
));
assert.deepEqual(forbidden, [], `Unexpected files in VSIX:\n${forbidden.join('\n')}`);

const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'extension/package.json'], { encoding: 'utf8' }));
assert.equal(manifest.main, './dist/vscode-extension/src/extension.js');
assert.equal(manifest.version, '0.1.0');
assert.ok(manifest.contributes.commands.some((command) => command.command === 'smReviewer.reviewCurrentFile'));
assert.ok(manifest.contributes.commands.some((command) => command.command === 'smReviewer.aiReviewCurrentFile'));

console.log(`PASS VSIX archive inspection: ${entries.length} entries`);
console.log(`PASS entrypoint: ${manifest.main}`);
console.log('PASS required runtime modules and exclusion policy');
