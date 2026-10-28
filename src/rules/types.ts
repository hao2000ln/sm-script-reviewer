import type ts from 'typescript';
import type { AnalysisResult, SourceDocument, SourceLocation } from '../core/types';

export type RuleSeverity = 'info' | 'warning' | 'error' | 'critical';
export type RuleClassification = 'deterministic' | 'heuristic';
export type SyntaxPolicy = 'valid-only' | 'recoverable';
export type AnalysisStatus = 'valid' | 'recovered';

export interface SourceRange {
  start: SourceLocation;
  end: SourceLocation;
}

export interface FindingEvidence {
  kind: 'ast' | 'source-pattern' | 'control-flow';
  message: string;
  range: SourceRange;
}

export interface FindingCandidate {
  message: string;
  range: SourceRange;
  evidence: readonly FindingEvidence[];
  suggestion?: string;
  /** Required for heuristic rules; deterministic findings are always 1. */
  confidence?: number;
  /** Opt-in mode-specific classification; must be allowed by rule metadata. */
  classification?: RuleClassification;
  /** Used only when the user did not explicitly override rule severity. */
  defaultSeverity?: RuleSeverity;
}

export interface Finding extends FindingCandidate {
  fingerprint: string;
  ruleId: string;
  sourceId: string;
  severity: RuleSeverity;
  classification: RuleClassification;
  confidence: number;
  analysisStatus: AnalysisStatus;
}

export interface RuleMetadata {
  id: string;
  title: string;
  description: string;
  classification: RuleClassification;
  /** Explicitly permits a rule mode to emit a different classification. */
  allowedClassifications?: readonly RuleClassification[];
  defaultEnabled: boolean;
  defaultSeverity: RuleSeverity;
  syntaxPolicy: SyntaxPolicy;
}

export interface RuleContext {
  source: SourceDocument;
  sourceFile: ts.SourceFile;
  analysis: AnalysisResult;
  parseDiagnostics: readonly ts.Diagnostic[];
  syntaxValid: boolean;
  range(startOffset: number, endOffset: number): SourceRange;
  rangeOf(node: ts.Node): SourceRange;
}

export interface Rule {
  metadata: RuleMetadata;
  validateOptions?(options: Readonly<Record<string, unknown>>): readonly string[];
  run(
    context: RuleContext,
    options: Readonly<Record<string, unknown>>,
  ): readonly FindingCandidate[];
}

export interface RuleConfig {
  enabled?: boolean;
  severity?: RuleSeverity;
  options?: Readonly<Record<string, unknown>>;
}

export interface RuleSetConfig {
  rules?: Readonly<Record<string, false | RuleConfig>>;
}

export interface RuleExecutionError {
  ruleId: string;
  message: string;
}

export interface SkippedRule {
  ruleId: string;
  reason: 'disabled' | 'syntax-errors';
}

export interface RuleRunResult {
  analysis: AnalysisResult;
  findings: Finding[];
  ruleErrors: RuleExecutionError[];
  skippedRules: SkippedRule[];
}

