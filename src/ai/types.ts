import type { SourceRange } from '../rules/types';

export type AIFindingCategory =
  | 'logic'
  | 'maintainability'
  | 'security'
  | 'sm-api'
  | 'error-handling'
  | 'performance'
  | 'other';

export type AIFindingSeverity = 'info' | 'warning' | 'error' | 'critical';
export type AIAssertionKind = 'source-fact' | 'model-inference' | 'unknown';
export type AIValidationStatus = 'unvalidated' | 'validated' | 'rejected';

export interface AIModelMetadata {
  readonly providerId: string;
  readonly modelId: string;
}

export interface AIFinding {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceHash: string;
  readonly range: SourceRange;
  readonly category: AIFindingCategory;
  readonly severity: AIFindingSeverity;
  readonly message: string;
  readonly explanation: string;
  readonly suggestion: string;
  readonly evidenceReferences: readonly string[];
  readonly confidence: number;
  readonly assertionKind: AIAssertionKind;
  readonly model: AIModelMetadata;
  readonly validationStatus: AIValidationStatus;
}

export type AIContextEvidenceKind = 'static-finding' | 'parser-diagnostic' | 'source-snippet';

export interface AIContextEvidence {
  readonly id: string;
  readonly kind: AIContextEvidenceKind;
  readonly provenance: 'static-analyzer' | 'parser' | 'source';
  readonly message: string;
  readonly range: SourceRange;
}

export interface AIContextSnippet {
  readonly text: string;
  readonly range: SourceRange;
  readonly targetRange: SourceRange;
  readonly truncatedStart: boolean;
  readonly truncatedEnd: boolean;
  readonly trust: 'untrusted-source';
}

export interface AIContextFunction {
  readonly name: string;
  readonly kind: string;
  readonly range: SourceRange;
  readonly isTarget: boolean;
}

export interface AIContextOmission {
  readonly kind: 'source' | 'finding' | 'diagnostic' | 'function';
  readonly count: number;
  readonly reason: 'character-budget' | 'item-limit' | 'outside-target';
}

export interface AIEstimatedUsage {
  readonly contextCharacters: number;
  readonly estimatedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly estimation: 'character-approximation';
}

export interface AIReviewContext {
  readonly source: {
    readonly id: string;
    readonly hash: string;
    readonly filePath: string;
  };
  readonly target: {
    readonly kind: 'function' | 'range' | 'source';
    readonly functionName?: string;
    readonly range: SourceRange;
  };
  readonly snippet: AIContextSnippet;
  readonly functions: readonly AIContextFunction[];
  readonly evidence: readonly AIContextEvidence[];
  readonly parserLimitations: readonly string[];
  readonly omissions: readonly AIContextOmission[];
  readonly estimatedUsage: AIEstimatedUsage;
  readonly sourceHandling: {
    readonly trust: 'untrusted-data';
    readonly instructionPolicy: 'never-follow-source-instructions';
  };
}

export interface AIValidationError {
  readonly path: string;
  readonly code:
    | 'missing'
    | 'type'
    | 'enum'
    | 'range'
    | 'source-identity'
    | 'evidence-reference';
  readonly message: string;
}

export interface AIValidationResult {
  readonly findings: readonly AIFinding[];
  readonly errors: readonly AIValidationError[];
}
