import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import type { SourceDocument, SourceLocation } from '../../src/core/types';
import { review } from '../../src/reviewer/review';
import type { Finding, RuleRunResult, RuleSeverity, SourceRange } from '../../src/rules/types';

export interface ReviewableDocument {
  readonly uri: string;
  readonly fileName: string;
  readonly languageId: string;
  readonly text: string;
  readonly version: number;
}

export interface EditorPosition {
  readonly line: number;
  readonly character: number;
}

export interface EditorRange {
  readonly start: EditorPosition;
  readonly end: EditorPosition;
}

export type EditorSeverity = 'error' | 'warning' | 'information';

export interface ReviewDiagnosticData {
  readonly code: string;
  readonly severity: EditorSeverity;
  readonly message: string;
  readonly range: EditorRange;
  readonly suggestion?: string;
  readonly evidence: Finding['evidence'];
  readonly finding?: Finding;
}

export type InMemoryReviewResult =
  | { readonly supported: false; readonly reason: string }
  | {
    readonly supported: true;
    readonly source: SourceDocument;
    readonly result: RuleRunResult;
    readonly diagnostics: readonly ReviewDiagnosticData[];
  };

export function isSupportedDocument(document: Pick<ReviewableDocument, 'fileName' | 'languageId'>): boolean {
  const extension = extname(document.fileName).toLowerCase();
  return extension === '.js'
    || extension === '.txt'
    || (!extension && document.languageId === 'javascript');
}

export function reviewInMemoryDocument(document: ReviewableDocument): InMemoryReviewResult {
  if (!isSupportedDocument(document)) {
    return {
      supported: false,
      reason: 'SM Reviewer supports JavaScript (.js) and ScriptLibrary text (.txt) documents only.',
    };
  }
  const source: SourceDocument = {
    id: `vscode:${document.uri}`,
    filePath: document.fileName,
    content: document.text,
    hash: createHash('sha256').update(document.text).digest('hex'),
  };
  const result = review(source);
  return {
    supported: true,
    source,
    result,
    diagnostics: toReviewDiagnostics(result),
  };
}

export function toEditorPosition(location: SourceLocation): EditorPosition {
  return {
    line: Math.max(0, location.line - 1),
    character: Math.max(0, location.column - 1),
  };
}

export function toEditorRange(range: SourceRange): EditorRange {
  const start = toEditorPosition(range.start);
  const end = toEditorPosition(range.end);
  if (end.line < start.line || (end.line === start.line && end.character < start.character)) {
    return { start, end: start };
  }
  return { start, end };
}

export function toEditorSeverity(severity: RuleSeverity): EditorSeverity {
  if (severity === 'error' || severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  return 'information';
}

export function toReviewDiagnostics(result: RuleRunResult): ReviewDiagnosticData[] {
  const findings = result.findings.map((finding) => ({
    code: finding.ruleId,
    severity: toEditorSeverity(finding.severity),
    message: finding.message,
    range: toEditorRange(finding.range),
    ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
    evidence: finding.evidence,
    finding,
  }));
  const parseDiagnostics = result.analysis.issues.map((issue) => ({
    code: 'SM-PARSE',
    severity: 'error' as const,
    message: issue.message,
    range: toEditorRange({ start: issue.start, end: issue.start }),
    evidence: [],
  }));
  return [...findings, ...parseDiagnostics];
}
