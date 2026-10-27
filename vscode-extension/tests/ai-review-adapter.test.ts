import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { AIProvider, AIProviderRequest } from '../../src/ai/provider';
import { reviewAIInMemoryDocument } from '../src/ai-review-adapter';

const document = (text: string) => ({
  uri: 'untitled:ai.js',
  fileName: 'ai.js',
  languageId: 'javascript',
  text,
  version: 1,
});

test('AI adapter is disabled by default and does not call its provider', async () => {
  const provider = new MockProvider();
  const result = await reviewAIInMemoryDocument(document('print("debug");'), {
    enabled: false,
    allowSourceTransmission: false,
    provider,
    modelId: 'mock',
    timeoutMs: 100,
  });
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.equal(provider.calls, 0);
  assert.equal(result.ai.coverage[0].status, 'not-run');
});

test('AI adapter requires consent and keeps static analysis separate', async () => {
  const provider = new MockProvider();
  const result = await reviewAIInMemoryDocument(document('print("debug");'), {
    enabled: true,
    allowSourceTransmission: false,
    provider,
    modelId: 'mock',
    timeoutMs: 100,
  });
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.equal(provider.calls, 0);
  assert.equal(result.ai.errors[0].category, 'permission-denied');
  assert.equal(result.diagnostics.length, 0);
});

test('AI adapter maps validated model findings without executing unsaved source', async () => {
  (globalThis as { extensionAIExecuted?: boolean }).extensionAIExecuted = false;
  const provider = new MockProvider();
  const result = await reviewAIInMemoryDocument(document(
    'globalThis.extensionAIExecuted = true;\nfunction target() { print("debug"); }',
  ), {
    enabled: true,
    allowSourceTransmission: true,
    provider,
    modelId: 'mock',
    timeoutMs: 100,
  });
  assert.equal((globalThis as { extensionAIExecuted?: boolean }).extensionAIExecuted, false);
  assert.equal(result.supported, true);
  if (!result.supported) return;
  assert.equal(result.ai.errors.length, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].validationStatus, 'validated');
  assert.match(result.diagnostics[0].message, /AI-assisted/u);
});

test('AI adapter exposes partial single-function coverage and rejects invalid responses', async () => {
  const partial = await reviewAIInMemoryDocument(document(
    'function first() {}\nfunction second() {}\nfunction third() {}',
  ), {
    enabled: true,
    allowSourceTransmission: true,
    provider: new MockProvider(),
    modelId: 'mock',
    timeoutMs: 100,
  });
  assert.equal(partial.supported, true);
  if (!partial.supported) return;
  assert.equal(partial.ai.coverage[0].status, 'partial');
  assert.equal(partial.ai.coverage[0].notReviewedFunctions, 2);

  const invalid = await reviewAIInMemoryDocument(document('function target() {}'), {
    enabled: true,
    allowSourceTransmission: true,
    provider: new MockProvider(true),
    modelId: 'mock',
    timeoutMs: 100,
  });
  assert.equal(invalid.supported, true);
  if (!invalid.supported) return;
  assert.equal(invalid.ai.errors[0].category, 'response-invalid');
  assert.equal(invalid.diagnostics.length, 0);
});

class MockProvider implements AIProvider {
  readonly id = 'extension-mock';
  calls = 0;

  constructor(private readonly invalid = false) {}

  async review(request: AIProviderRequest) {
    this.calls += 1;
    if (this.invalid) return { providerId: this.id, modelId: request.modelId, rawResult: { findings: [{}] } };
    return {
      providerId: this.id,
      modelId: request.modelId,
      rawResult: {
        findings: [{
          id: 'ai:extension:1',
          sourceId: request.context.source.id,
          sourceHash: request.context.source.hash,
          range: request.context.snippet.range,
          category: 'maintainability',
          severity: 'warning',
          message: 'Offline model observation',
          explanation: 'Mock response only.',
          suggestion: 'Verify manually.',
          evidenceReferences: ['source:target'],
          confidence: 0.7,
          assertionKind: 'model-inference',
          model: { providerId: this.id, modelId: request.modelId },
          validationStatus: 'unvalidated',
        }],
      },
    };
  }
}
