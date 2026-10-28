'use strict';

const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const { inflateRawSync } = require('node:zlib');

const archive = resolve(process.argv[2] || 'vscode-extension/sm-scriptlibrary-reviewer-0.1.0.vsix');
const zip = readFileSync(archive);
const entriesByName = readZipEntries(zip);
const entries = [...entriesByName.keys()].sort();

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

const manifest = JSON.parse(readZipEntry(zip, entriesByName.get('extension/package.json')));
assert.equal(manifest.main, './dist/vscode-extension/src/extension.js');
assert.equal(manifest.version, '0.1.0');
assert.ok(manifest.contributes.commands.some((command) => command.command === 'smReviewer.reviewCurrentFile'));
assert.ok(manifest.contributes.commands.some((command) => command.command === 'smReviewer.aiReviewCurrentFile'));
assert.ok(manifest.contributes.commands.some((command) => command.command === 'smReviewer.reviewFolder'));

console.log(`PASS VSIX archive inspection: ${entries.length} entries`);
console.log(`PASS entrypoint: ${manifest.main}`);
console.log('PASS required runtime modules and exclusion policy');

function readZipEntries(buffer) {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'VSIX has no ZIP end-of-central-directory record');
  const count = buffer.readUInt16LE(eocd + 10); let offset = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'Invalid ZIP central-directory entry');
    const method = buffer.readUInt16LE(offset + 10); const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28); const extraLength = buffer.readUInt16LE(offset + 30); const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42); const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.set(name, { method, compressedSize, localOffset }); offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entry) {
  assert.ok(entry, 'Missing VSIX manifest');
  assert.equal(buffer.readUInt32LE(entry.localOffset), 0x04034b50, 'Invalid ZIP local entry');
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26); const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const data = buffer.subarray(entry.localOffset + 30 + nameLength + extraLength, entry.localOffset + 30 + nameLength + extraLength + entry.compressedSize);
  if (entry.method === 0) return data.toString('utf8');
  if (entry.method === 8) return inflateRawSync(data).toString('utf8');
  throw new Error(`Unsupported ZIP compression method: ${entry.method}`);
}
