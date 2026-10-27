import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildAIReviewContext } from '../src/ai/context-builder';
import { validateAIResponse } from '../src/ai/validation';
import { analyze } from '../src/parser/analyze';
import type { SourceDocument } from '../src/core/types';
import type { AIReviewContext } from '../src/ai/types';

test('validates a well-formed AI finding without converting it to a static finding', () => {
  const context = createContext();
  const raw = { findings: [finding(context)] };
  const result = validateAIResponse(raw, context);

  assert.equal(result.errors.length, 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].assertionKind, 'model-inference');
  assert.equal(result.findings[0].validationStatus, 'validated');
  assert.equal('ruleId' in result.findings[0], false);
});

test('returns structured errors for malformed results and invalid confidence', () => {
  const context = createContext();
  const malformed = validateAIResponse({ finding: [] }, context);
  assert.equal(malformed.findings.length, 0);
  assert.equal(malformed.errors[0].path, 'findings');

  const invalid = finding(context) as Record<string, unknown>;
  invalid.confidence = 2;
  const result = validateAIResponse({ findings: [invalid] }, context);
  assert.equal(result.findings.length, 0);
  assert.ok(result.errors.some(({ path, code }) => (
    path === 'findings[0].confidence' && code === 'range'
  )));
});

test('rejects invented source positions, identities, and evidence references', () => {
  const context = createContext();
  const invalid = finding(context) as Record<string, unknown>;
  invalid.sourceHash = 'invented';
  invalid.evidenceReferences = ['invented:evidence'];
  invalid.range = {
    start: { ...context.snippet.range.start, line: 999 },
    end: context.snippet.range.end,
  };

  const result = validateAIResponse({ findings: [invalid] }, context);
  assert.equal(result.findings.length, 0);
  assert.ok(result.errors.some(({ code }) => code === 'source-identity'));
  assert.ok(result.errors.some(({ code }) => code === 'evidence-reference'));
  assert.ok(result.errors.some(({ code }) => code === 'range'));
});

function createContext(): AIReviewContext {
  const content = 'function target() { return 1; }';
  const source: SourceDocument = {
    id: 'source:validation',
    filePath: 'validation.js',
    content,
    hash: createHash('sha256').update(content).digest('hex'),
  };
  const result = buildAIReviewContext({
    source,
    analysis: analyze(source),
    findings: [],
  });
  if (!result.ok) throw new Error('Test context failed');
  return result.context;
}

function finding(context: AIReviewContext) {
  return {
    id: 'ai:1',
    sourceId: context.source.id,
    sourceHash: context.source.hash,
    range: context.target.range,
    category: 'logic',
    severity: 'warning',
    message: 'Possible logic issue.',
    explanation: 'This is a model inference requiring human review.',
    suggestion: 'Review the condition.',
    evidenceReferences: ['source:target'],
    confidence: 0.7,
    assertionKind: 'model-inference',
    model: { providerId: 'fake', modelId: 'fake-model' },
    validationStatus: 'unvalidated',
  };
}
