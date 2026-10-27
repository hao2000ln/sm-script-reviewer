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
    const denied = await runCli(file, ['--ai', '--format', 'json'], {}, root);
    assert.equal(denied.status, 2);
    assert.equal(denied.stderr, '');
    const deniedReport = JSON.parse(denied.stdout) as ReviewReport;
    assert.equal(deniedReport.aiErrors?.[0].category, 'permission-denied');
    assert.equal(deniedReport.aiCoverage?.[0].status, 'not-run');
    assert.ok(deniedReport.findings.length > 0);

    const missingKey = await runCli(file, [
      '--ai', '--allow-source-transmission', '--format', 'json',
    ], {}, root);
    assert.equal(missingKey.status, 2);
    assert.equal(missingKey.stderr, '');
    const keyReport = JSON.parse(missingKey.stdout) as ReviewReport;
    assert.equal(keyReport.aiErrors?.[0].category, 'configuration');
    assert.ok(keyReport.findings.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('CLI loads AI configuration from .env without enabling AI or consent implicitly', async () => {
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
    await writeFile(join(root, '.env'), [
      'SM_REVIEWER_AI_API_KEY=local-file-key',
      'SM_REVIEWER_AI_MODEL=env-file-model',
      `SM_REVIEWER_AI_ENDPOINT=http://127.0.0.1:${address.port}/v1/chat/completions`,
      'SM_REVIEWER_AI_TIMEOUT_MS=1000',
    ].join('\n'), 'utf8');
    const offline = await runCli(file, ['--format', 'json'], {}, root);
    assert.equal(offline.status, 1);
    assert.equal((JSON.parse(offline.stdout) as ReviewReport).aiCoverage, undefined);

    const result = await runCli(file, [
      '--ai',
      '--allow-source-transmission',
      '--format', 'json',
    ], {}, root);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /local-file-key/u);
    const report = JSON.parse(result.stdout) as ReviewReport;
    assert.ok(report.findings.some(({ ruleId }) => ruleId === 'SM-DBG-001'));
    assert.equal(report.aiFindings?.[0].message, 'AI test finding');
    assert.deepEqual(report.aiFindings?.[0].model, {
      providerId: 'openai-compatible',
      modelId: 'env-file-model',
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

test('OS environment overrides .env and CLI arguments take highest priority', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-ai-cli-priority-'));
  const file = join(root, 'source.js');
  const models: string[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    const payload = JSON.parse(body);
    models.push(payload.model);
    response.end(JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }] }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server unavailable');
  const endpoint = `http://127.0.0.1:${address.port}/v1/chat/completions`;
  try {
    await writeFile(file, '/** documented */\nfunction source() {}', 'utf8');
    await writeFile(join(root, '.env'), [
      'SM_REVIEWER_AI_API_KEY=file-key',
      'SM_REVIEWER_AI_MODEL=file-model',
      'SM_REVIEWER_AI_ENDPOINT=https://unused.invalid/v1/chat/completions',
      'SM_REVIEWER_AI_TIMEOUT_MS=1',
    ].join('\n'), 'utf8');

    const environmentResult = await runCli(file, [
      '--ai', '--allow-source-transmission', '--format', 'json',
    ], {
      SM_REVIEWER_AI_API_KEY: 'environment-key',
      SM_REVIEWER_AI_MODEL: 'environment-model',
      SM_REVIEWER_AI_ENDPOINT: endpoint,
      SM_REVIEWER_AI_TIMEOUT_MS: '1000',
    }, root);
    assert.equal(environmentResult.status, 0);
    assert.doesNotMatch(`${environmentResult.stdout}${environmentResult.stderr}`, /environment-key/u);

    const cliResult = await runCli(file, [
      '--ai', '--allow-source-transmission',
      '--ai-model', 'cli-model',
      '--ai-endpoint', endpoint,
      '--ai-timeout', '1000',
      '--format', 'json',
    ], {
      SM_REVIEWER_AI_API_KEY: 'environment-key',
      SM_REVIEWER_AI_MODEL: 'environment-model',
      SM_REVIEWER_AI_ENDPOINT: 'https://unused.invalid/v1/chat/completions',
      SM_REVIEWER_AI_TIMEOUT_MS: 'invalid',
    }, root);
    assert.equal(cliResult.status, 0);
    assert.doesNotMatch(`${cliResult.stdout}${cliResult.stderr}`, /environment-key/u);
    assert.deepEqual(models, ['environment-model', 'cli-model']);
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid .env timeout is rejected only when AI is enabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sm-ai-cli-timeout-'));
  const file = join(root, 'source.js');
  try {
    await writeFile(file, 'print("debug");', 'utf8');
    await writeFile(join(root, '.env'), 'SM_REVIEWER_AI_TIMEOUT_MS=invalid\n', 'utf8');
    const offline = await runCli(file, ['--format', 'json'], {}, root);
    assert.equal(offline.status, 1);
    assert.equal(offline.stderr, '');

    const ai = await runCli(file, ['--ai', '--format', 'json'], {}, root);
    assert.equal(ai.status, 2);
    assert.equal(ai.stdout, '');
    assert.match(ai.stderr, /SM_REVIEWER_AI_TIMEOUT_MS must be a positive integer/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function runCli(
  target: string,
  args: readonly string[],
  environment: Record<string, string> = {},
  cwd?: string,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, reject) => {
    const childEnvironment = { ...process.env };
    for (const name of [
      'SM_REVIEWER_AI_API_KEY',
      'SM_REVIEWER_AI_MODEL',
      'SM_REVIEWER_AI_ENDPOINT',
      'SM_REVIEWER_AI_TIMEOUT_MS',
    ]) delete childEnvironment[name];
    Object.assign(childEnvironment, environment);
    const child = spawn(process.execPath, [cliPath, 'review', target, ...args], {
      env: childEnvironment,
      cwd,
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
