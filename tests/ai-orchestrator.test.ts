import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { runAIReview } from '../src/ai/orchestrator';
import type { AIProvider, AIProviderRequest } from '../src/ai/provider';
import { review } from '../src/reviewer/review';
import type { BatchReviewResult } from '../src/reviewer/batch';
import type { SourceDocument } from '../src/core/types';
import { createHash } from 'node:crypto';

test('AI review is disabled by default and requires explicit transmission consent', async () => {
  const batch = createBatch('print("debug");');
  const provider = new ContextResponseProvider();
  const disabled = await runAIReview(batch, {
    enabled: false,
    allowSourceTransmission: false,
    provider,
    modelId: 'test-model',
    timeoutMs: 100,
  });
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.findings, []);
  assert.deepEqual(disabled.errors, []);
  assert.equal(disabled.coverage[0].status, 'not-run');
  assert.equal(provider.calls, 0);

  const denied = await runAIReview(batch, {
    enabled: true,
    allowSourceTransmission: false,
    provider,
    modelId: 'test-model',
    timeoutMs: 100,
  });
  assert.equal(denied.errors[0].category, 'permission-denied');
  assert.equal(provider.calls, 0);
  assert.ok(batch.files[0].result.findings.length > 0);
});

test('orchestrator validates AI findings and keeps them separate from static findings', async () => {
  const batch = createBatch('print("debug");');
  const result = await runAIReview(batch, {
    enabled: true,
    allowSourceTransmission: true,
    provider: new ContextResponseProvider(),
    modelId: 'test-model',
    timeoutMs: 100,
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].validationStatus, 'validated');
  assert.deepEqual(result.findings[0].model, {
    providerId: 'context-test',
    modelId: 'test-model',
  });
  assert.equal(batch.files[0].result.findings[0].ruleId, 'SM-DBG-001');
});

test('malformed AI response becomes a structured error without erasing static results', async () => {
  const batch = createBatch('print("debug");');
  const result = await runAIReview(batch, {
    enabled: true,
    allowSourceTransmission: true,
    provider: new ContextResponseProvider(true),
    modelId: 'test-model',
    timeoutMs: 100,
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.errors[0].category, 'response-invalid');
  assert.ok(batch.files[0].result.findings.length > 0);
  assert.equal(result.coverage[0].status, 'failed');
});

test('single-context MVP reports partial function coverage transparently', async () => {
  const batch = createBatch(`function first() {}
function second() {}
function third() {}`);
  const result = await runAIReview(batch, {
    enabled: true,
    allowSourceTransmission: true,
    provider: new ContextResponseProvider(),
    modelId: 'test-model',
    timeoutMs: 100,
  });
  assert.deepEqual(result.coverage, [{
    filePath: 'test.js',
    totalIndexedFunctions: 3,
    selectedForAIReview: 1,
    notReviewedFunctions: 2,
    status: 'partial',
  }]);
});

class ContextResponseProvider implements AIProvider {
  readonly id = 'context-test';
  calls = 0;

  constructor(private readonly malformed = false) {}

  async review(request: AIProviderRequest) {
    this.calls += 1;
    const { context } = request;
    return {
      providerId: this.id,
      modelId: request.modelId,
      rawResult: this.malformed ? { findings: [{ message: 'incomplete' }] } : {
        findings: [{
          id: 'ai:test:1',
          sourceId: context.source.id,
          sourceHash: context.source.hash,
          range: context.snippet.range,
          category: 'maintainability',
          severity: 'warning',
          message: 'Model observation',
          explanation: 'Generated for an offline test.',
          suggestion: 'Review manually.',
          evidenceReferences: ['source:target'],
          confidence: 0.6,
          assertionKind: 'model-inference',
          model: { providerId: this.id, modelId: request.modelId },
          validationStatus: 'unvalidated',
        }],
      },
    };
  }
}

function createBatch(content: string): BatchReviewResult {
  const source: SourceDocument = {
    id: 'source:test',
    filePath: 'test.js',
    content,
    hash: createHash('sha256').update(content).digest('hex'),
  };
  return {
    files: [{ filePath: source.filePath, result: review(source) }],
    failures: [],
    skippedFileCount: 0,
  };
}
