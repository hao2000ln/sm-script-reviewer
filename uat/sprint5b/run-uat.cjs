'use strict';

const assert = require('node:assert/strict');
const { createServer } = require('node:http');
// Use the extension's bundled core so AIProviderError class identity matches
// the orchestrator used by the extension adapter.
const { OpenAICompatibleProvider } = require('../../vscode-extension/dist/src/ai/openai-compatible-provider');
const { reviewAIInMemoryDocument } = require('../../vscode-extension/dist/vscode-extension/src/ai-review-adapter');

const document = (text) => ({
  uri: 'untitled:sprint5b.js', fileName: 'sprint5b.js', languageId: 'javascript', text, version: 1,
});

async function main() {
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    if (request.url === '/rate-limit') return send(response, 429, { error: 'mock rate limit' });
    if (request.url === '/invalid') return send(response, 200, envelope({ findings: [{}] }));
    const payload = JSON.parse(body);
    const context = JSON.parse(payload.messages[1].content).context;
    return send(response, 200, envelope({ findings: [finding(context, payload.model)] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const endpoint = (path) => `http://127.0.0.1:${address.port}/${path}`;
  const provider = (path = 'success') => new OpenAICompatibleProvider({ endpoint: endpoint(path), apiKey: 'local-mock-key' });
  const options = (overrides = {}) => ({
    enabled: true, allowSourceTransmission: true, provider: provider(), modelId: 'sprint5b-mock', timeoutMs: 1000, ...overrides,
  });
  const cases = [];
  const check = async (name, action) => {
    try { await action(); cases.push(true); console.log(`PASS ${name}`); }
    catch (error) { cases.push(false); console.error(`FAIL ${name}: ${error.message}`); }
  };
  try {
    await check('AI disabled by default', async () => {
      const result = await reviewAIInMemoryDocument(document('function target() {}'), options({ enabled: false, allowSourceTransmission: false }));
      assert.equal(result.ai.coverage[0].status, 'not-run');
    });
    await check('mock success uses unsaved content and emits AI diagnostic', async () => {
      const result = await reviewAIInMemoryDocument(document('function target() { print("unsaved"); }'), options());
      assert.equal(result.ai.errors.length, 0);
      assert.equal(result.diagnostics.length, 1);
      assert.match(result.diagnostics[0].message, /AI-assisted/u);
    });
    await check('HTTP 429 retains static baseline outside AI diagnostics', async () => {
      const result = await reviewAIInMemoryDocument(document('function target() { print("debug"); }'), options({ provider: provider('rate-limit') }));
      assert.equal(result.ai.errors[0].category, 'rate-limited');
      assert.equal(result.diagnostics.length, 0);
    });
    await check('invalid response is rejected', async () => {
      const result = await reviewAIInMemoryDocument(document('function target() {}'), options({ provider: provider('invalid') }));
      assert.equal(result.ai.errors[0].category, 'response-invalid');
    });
    await check('single context reports partial coverage', async () => {
      const result = await reviewAIInMemoryDocument(document('function one() {}\nfunction two() {}'), options());
      assert.equal(result.ai.coverage[0].status, 'partial');
      assert.equal(result.ai.coverage[0].notReviewedFunctions, 1);
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  const passed = cases.filter(Boolean).length;
  console.log(`Result: ${passed}/${cases.length} passed (127.0.0.1 mock only)`);
  if (passed !== cases.length) process.exitCode = 1;
}

function finding(context, modelId) {
  return {
    id: 'ai:sprint5b:1', sourceId: context.source.id, sourceHash: context.source.hash,
    range: context.snippet.range, category: 'maintainability', severity: 'warning',
    message: 'Mock AI observation', explanation: 'Local UAT response.', suggestion: 'Verify manually.',
    evidenceReferences: ['source:target'], confidence: 0.7, assertionKind: 'model-inference',
    model: { providerId: 'sprint5b-mock', modelId }, validationStatus: 'unvalidated',
  };
}

function envelope(value) { return { choices: [{ message: { content: JSON.stringify(value) } }] }; }
function send(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
