'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { OpenAICompatibleProvider } = require('../../dist/src/ai/openai-compatible-provider');
const { runAIReview } = require('../../dist/src/ai/orchestrator');
const { AIProviderError } = require('../../dist/src/ai/provider');
const { reviewTarget } = require('../../dist/src/reviewer/batch');

const fixture = (name) => join(__dirname, name);
const aiOptions = (provider, overrides = {}) => ({
  enabled: true,
  allowSourceTransmission: true,
  provider,
  modelId: 'uat-mock-model',
  timeoutMs: 1_000,
  ...overrides,
});

async function main() {
  let requestCount = 0;
  const server = createServer(async (request, response) => {
    requestCount += 1;
    const body = await readBody(request);
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    if (path === '/rate-limit') {
      sendJson(response, 429, { error: 'mock rate limit' });
      return;
    }
    if (path === '/invalid') {
      sendJson(response, 200, envelope({ findings: [{ message: 'incomplete' }] }));
      return;
    }
    const payload = JSON.parse(body);
    const userMessage = JSON.parse(payload.messages[1].content);
    const context = userMessage.context;
    sendJson(response, 200, envelope({
      findings: [{
        id: 'ai:uat:1',
        sourceId: context.source.id,
        sourceHash: context.source.hash,
        range: context.snippet.range,
        category: 'maintainability',
        severity: 'warning',
        message: 'Offline mock AI finding',
        explanation: 'Generated only by the local Sprint 4 UAT server.',
        suggestion: 'Verify the observation manually.',
        evidenceReferences: ['source:target'],
        confidence: 0.7,
        assertionKind: 'model-inference',
        model: { providerId: 'mock', modelId: payload.model },
        validationStatus: 'unvalidated',
      }],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock server address unavailable');
  const endpoint = (path) => `http://127.0.0.1:${address.port}/${path}`;
  const provider = (path = 'success') => new OpenAICompatibleProvider({
    endpoint: endpoint(path),
    apiKey: 'local-uat-key',
    maxResponseBytes: 100_000,
  });

  const cases = [];
  const verify = async (name, action) => {
    try {
      await action();
      cases.push({ name, passed: true });
      console.log(`PASS ${name}`);
    } catch (error) {
      cases.push({ name, passed: false });
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  try {
    const clean = await reviewTarget(fixture('clean.js'));
    const missingProgress = await reviewTarget(fixture('scfile-loop-missing-get-next.js'));
    const validProgress = await reviewTarget(fixture('scfile-loop-valid-get-next.js'));
    const multipleFunctions = await reviewTarget(fixture('multi-function.js'));
    const oversized = await reviewTarget(fixture('oversized-function.js'));

    await verify('static fixture expectations', async () => {
      assert.deepEqual(clean.files[0].result.findings, []);
      assert.ok(missingProgress.files[0].result.findings.some(({ ruleId }) => ruleId === 'SM-LOOP-002'));
      assert.ok(!validProgress.files[0].result.findings.some(({ ruleId }) => ruleId === 'SM-LOOP-002'));
    });

    await verify('AI disabled by default', async () => {
      const before = requestCount;
      const result = await runAIReview(clean, aiOptions(provider(), { enabled: false }));
      assert.equal(result.enabled, false);
      assert.equal(result.coverage[0].status, 'not-run');
      assert.equal(requestCount, before);
    });

    await verify('missing consent rejection', async () => {
      const before = requestCount;
      const result = await runAIReview(clean, aiOptions(provider(), {
        allowSourceTransmission: false,
      }));
      assert.equal(result.errors[0].category, 'permission-denied');
      assert.equal(result.coverage[0].status, 'not-run');
      assert.equal(requestCount, before);
    });

    await verify('missing API key handling', async () => {
      assert.throws(
        () => new OpenAICompatibleProvider({ endpoint: endpoint('success'), apiKey: '' }),
        (error) => error instanceof AIProviderError && error.category === 'request-invalid',
      );
      const result = await runAIReview(clean, aiOptions(undefined, {
        providerConfigurationError: 'AI API key is required',
      }));
      assert.equal(result.errors[0].category, 'configuration');
      assert.equal(result.coverage[0].status, 'not-run');
    });

    await verify('mock AI success', async () => {
      const result = await runAIReview(clean, aiOptions(provider()));
      assert.equal(result.errors.length, 0);
      assert.equal(result.findings.length, 1);
      assert.equal(result.findings[0].validationStatus, 'validated');
      assert.equal(result.coverage[0].status, 'complete');
    });

    await verify('HTTP 429 handling with static fallback', async () => {
      const staticFingerprints = missingProgress.files[0].result.findings.map(({ fingerprint }) => fingerprint);
      const result = await runAIReview(missingProgress, aiOptions(provider('rate-limit')));
      assert.equal(result.errors[0].category, 'rate-limited');
      assert.equal(result.coverage[0].status, 'failed');
      assert.deepEqual(
        missingProgress.files[0].result.findings.map(({ fingerprint }) => fingerprint),
        staticFingerprints,
      );
      assert.ok(missingProgress.files[0].result.findings.some(({ ruleId }) => ruleId === 'SM-LOOP-002'));
    });

    await verify('invalid AI response handling', async () => {
      const result = await runAIReview(clean, aiOptions(provider('invalid')));
      assert.equal(result.findings.length, 0);
      assert.equal(result.errors[0].category, 'response-invalid');
      assert.equal(result.coverage[0].status, 'failed');
    });

    await verify('multi-function partial AI coverage', async () => {
      const result = await runAIReview(multipleFunctions, aiOptions(provider()));
      assert.deepEqual(result.coverage[0], {
        filePath: multipleFunctions.files[0].filePath,
        totalIndexedFunctions: 3,
        selectedForAIReview: 1,
        notReviewedFunctions: 2,
        status: 'partial',
      });
    });

    await verify('oversized target partial AI coverage', async () => {
      const result = await runAIReview(oversized, aiOptions(provider()));
      assert.deepEqual(result.coverage[0], {
        filePath: oversized.files[0].filePath,
        totalIndexedFunctions: 1,
        selectedForAIReview: 1,
        notReviewedFunctions: 1,
        status: 'partial',
      });
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  const passed = cases.filter(({ passed: value }) => value).length;
  console.log(`\nResult: ${passed}/${cases.length} passed (localhost mock only)`);
  if (passed !== cases.length) process.exitCode = 1;
}

function envelope(content) {
  return { choices: [{ message: { content: JSON.stringify(content) } }] };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    connection: 'close',
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
