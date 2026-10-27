import { runAIReview, type AIReviewRunOptions, type AIReviewRunResult } from '../../src/ai/orchestrator';
import type { AIFinding } from '../../src/ai/types';
import type { BatchReviewResult } from '../../src/reviewer/batch';
import { reviewInMemoryDocument, toEditorRange, toEditorSeverity, type EditorRange, type ReviewableDocument } from './review-adapter';

export interface AIReviewDiagnosticData {
  readonly code: string;
  readonly severity: ReturnType<typeof toEditorSeverity>;
  readonly message: string;
  readonly range: EditorRange;
  readonly suggestion: string;
  readonly confidence: number;
  readonly validationStatus: AIFinding['validationStatus'];
  readonly evidenceReferences: readonly string[];
}

export type InMemoryAIReviewResult =
  | { readonly supported: false; readonly reason: string }
  | {
    readonly supported: true;
    readonly ai: AIReviewRunResult;
    readonly diagnostics: readonly AIReviewDiagnosticData[];
  };

/**
 * Adapts one unsaved editor document to the existing batch-oriented AI
 * orchestrator. It does not create a second parser, rule, or AI pipeline.
 */
export async function reviewAIInMemoryDocument(
  document: ReviewableDocument,
  options: AIReviewRunOptions,
): Promise<InMemoryAIReviewResult> {
  const reviewed = reviewInMemoryDocument(document);
  if (!reviewed.supported) return reviewed;

  const batch: BatchReviewResult = {
    files: [{ filePath: reviewed.source.filePath, result: reviewed.result }],
    failures: [],
    skippedFileCount: 0,
  };
  const ai = await runAIReview(batch, options);
  return {
    supported: true,
    ai,
    diagnostics: ai.findings.map(toAIReviewDiagnostic),
  };
}

export function toAIReviewDiagnostic(finding: AIFinding): AIReviewDiagnosticData {
  return {
    code: `AI:${finding.id}`,
    severity: toEditorSeverity(finding.severity),
    message: `AI-assisted (${Math.round(finding.confidence * 100)}% confidence): ${finding.message}`,
    range: toEditorRange(finding.range),
    suggestion: finding.suggestion,
    confidence: finding.confidence,
    validationStatus: finding.validationStatus,
    evidenceReferences: finding.evidenceReferences,
  };
}
