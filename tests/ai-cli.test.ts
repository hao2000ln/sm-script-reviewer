import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { ReviewReport } from '../src/reporting/report';

const cliPath = resolve(__dirname, '../src/cli/index.js');

test('CLI reports missing consent and missing API key without losing static findings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-ai-cli-config-'));
  const file = join(root, 'source.js');
  try {
    await writeFile(file, 'print("debug");', 'utf8');
    const denied = await runCli(file, ['--ai', '--format', 'json']);
    assert.equal(denied.status, 2);
    assert.equal(denied.stderr, '');
    const deniedReport = JSON.parse(denied.stdout) as ReviewReport;
    assert.equal(deniedReport.aiErrors?.[0].category, 'permission-denied');
    assert.equal(deniedReport.aiCoverage?.[0].status, 'not-run');
    assert.ok(deniedReport.findings.length > 0);

    const missingKey = await runCli(file, [
      '--ai', '--allow-source-transmission', '--format', 'json',
    ]);
    assert.equal(missingKey.status, 2);
    assert.equal(missingKey.stderr, '');
    const keyReport = JSON.parse(missingKey.stdout) as ReviewReport;
    assert.equal(keyReport.aiErrors?.[0].category, 'configuration');
    assert.ok(keyReport.findings.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI performs an opted-in AI review against a local OpenAI-compatible server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-ai-cli-live-'));
  const file = join(root, 'source.js');
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const payload = JSON.parse(body);
    const user = JSON.parse(payload.messages[1].content);
    const context = user.context;
    const raw = {
      findings: [{
        id: 'ai:cli:1',
        sourceId: context.source.id,
        sourceHash: context.source.hash,
        range: context.snippet.range,
        category: 'logic',
        severity: 'warning',
        message: 'AI test finding',
        explanation: 'Model-generated test explanation.',
        suggestion: 'Review this manually.',
        evidenceReferences: ['source:target'],
        confidence: 0.7,
        assertionKind: 'model-inference',
        model: { providerId: 'ignored', modelId: 'ignored' },
        validationStatus: 'unvalidated',
      }],
    };
    const envelope = JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) } }] });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(envelope);
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server unavailable');
  try {
    await writeFile(file, `function first() { print("debug"); }
function second() {}
function third() {}`, 'utf8');
    const result = await runCli(file, [
      '--ai',
      '--allow-source-transmission',
      '--ai-endpoint', `http://127.0.0.1:${address.port}/v1/chat/completions`,
      '--ai-model', 'local-test-model',
      '--format', 'json',
    ], { SM_REVIEWER_AI_API_KEY: 'local-test-key' });
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout) as ReviewReport;
    assert.ok(report.findings.some(({ ruleId }) => ruleId === 'SM-DBG-001'));
    assert.equal(report.aiFindings?.[0].message, 'AI test finding');
    assert.deepEqual(report.aiFindings?.[0].model, {
      providerId: 'openai-compatible',
      modelId: 'local-test-model',
    });
    assert.deepEqual(report.aiCoverage?.[0], {
      filePath: file,
      totalIndexedFunctions: 3,
      selectedForAIReview: 1,
      notReviewedFunctions: 2,
      status: 'partial',
    });
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    await rm(root, { recursive: true, force: true });
  }
});

function runCli(
  target: string,
  args: readonly string[],
  environment: Record<string, string> = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [cliPath, 'review', target, ...args], {
      env: { ...process.env, SM_REVIEWER_AI_API_KEY: '', ...environment },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolveRun({ status, stdout, stderr }));
  });
}
