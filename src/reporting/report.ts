import type { ParseIssue } from '../core/types';
import { TOOL_VERSION } from '../core/version';
import type { AIReviewError, AIReviewRunResult, ReportAIFinding } from '../ai/orchestrator';
import type { BatchReviewResult, ReviewFailure } from '../reviewer/batch';
import type {
  Finding,
  RuleExecutionError,
  RuleSeverity,
  SkippedRule,
} from '../rules/types';

export const REVIEW_REPORT_SCHEMA_VERSION = '1.0.0';

export interface ReviewReportOptions {
  readonly minSeverity?: RuleSeverity;
  readonly ruleIds?: readonly string[];
  readonly generatedAt?: string;
  readonly inputPath?: string;
  readonly ai?: AIReviewRunResult;
}

export interface ReportFinding extends Finding {
  readonly filePath: string;
}

export interface ReportDiagnostic extends ParseIssue {
  readonly filePath: string;
}

export interface ReportSkippedRule extends SkippedRule {
  readonly filePath: string;
}

export interface ReportRuleError extends RuleExecutionError {
  readonly filePath: string;
}

export interface ReportFile {
  readonly filePath: string;
  readonly sourceHash: string;
  readonly findingCount: number;
  readonly diagnosticCount: number;
  readonly skippedRuleCount: number;
  readonly ruleErrorCount: number;
}

export interface ReviewReport {
  readonly schemaVersion: typeof REVIEW_REPORT_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly toolVersion: string;
  readonly inputPath: string;
  readonly failureThreshold: RuleSeverity;
  readonly summary: {
    readonly files: number;
    readonly findings: number;
    readonly diagnostics: number;
    readonly skippedRules: number;
    readonly ruleErrors: number;
    readonly failures: number;
    readonly skippedFiles: number;
    readonly aiFindings?: number;
    readonly aiErrors?: number;
  };
  readonly files: readonly ReportFile[];
  readonly findings: readonly ReportFinding[];
  readonly diagnostics: readonly ReportDiagnostic[];
  readonly skippedRules: readonly ReportSkippedRule[];
  readonly ruleErrors: readonly ReportRuleError[];
  readonly failures: readonly ReviewFailure[];
  readonly aiFindings?: readonly ReportAIFinding[];
  readonly aiErrors?: readonly AIReviewError[];
}

const SEVERITY_RANK: Readonly<Record<RuleSeverity, number>> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

export function createReviewReport(
  batch: BatchReviewResult,
  options: ReviewReportOptions = {},
): ReviewReport {
  const failureThreshold = options.minSeverity ?? 'warning';
  const selectedRules = options.ruleIds ? new Set(options.ruleIds) : undefined;
  const findings: ReportFinding[] = [];
  const diagnostics: ReportDiagnostic[] = [];
  const skippedRules: ReportSkippedRule[] = [];
  const ruleErrors: ReportRuleError[] = [];
  const files: ReportFile[] = [];
  const aiFindings = options.ai?.findings.filter((finding) => (
    SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failureThreshold]
  ));

  for (const file of batch.files) {
    const visibleFindings = file.result.findings.filter((finding) => (
      SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failureThreshold]
      && (!selectedRules || selectedRules.has(finding.ruleId))
    ));
    findings.push(...visibleFindings.map((finding) => ({ ...finding, filePath: file.filePath })));
    diagnostics.push(...file.result.analysis.issues.map((issue) => ({
      ...issue,
      filePath: file.filePath,
    })));
    skippedRules.push(...file.result.skippedRules.map((skipped) => ({
      ...skipped,
      filePath: file.filePath,
    })));
    ruleErrors.push(...file.result.ruleErrors.map((error) => ({
      ...error,
      filePath: file.filePath,
    })));
    files.push({
      filePath: file.filePath,
      sourceHash: file.result.analysis.source.hash,
      findingCount: visibleFindings.length,
      diagnosticCount: file.result.analysis.issues.length,
      skippedRuleCount: file.result.skippedRules.length,
      ruleErrorCount: file.result.ruleErrors.length,
    });
  }

  return {
    schemaVersion: REVIEW_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    toolVersion: TOOL_VERSION,
    inputPath: options.inputPath ?? '',
    failureThreshold,
    summary: {
      files: files.length,
      findings: findings.length,
      diagnostics: diagnostics.length,
      skippedRules: skippedRules.length,
      ruleErrors: ruleErrors.length,
      failures: batch.failures.length,
      skippedFiles: batch.skippedFileCount,
      ...(options.ai ? {
        aiFindings: aiFindings?.length ?? 0,
        aiErrors: options.ai.errors.length,
      } : {}),
    },
    files,
    findings,
    diagnostics,
    skippedRules,
    ruleErrors,
    failures: [...batch.failures],
    ...(options.ai ? {
      aiFindings: aiFindings ?? [],
      aiErrors: [...options.ai.errors],
    } : {}),
  };
}

export function reportExitCode(report: ReviewReport): 0 | 1 | 2 {
  if (report.failures.length > 0 || report.ruleErrors.length > 0 || (report.aiErrors?.length ?? 0) > 0) return 2;
  if (
    report.diagnostics.length > 0
    && report.skippedRules.some(({ reason }) => reason === 'syntax-errors')
  ) {
    return 2;
  }
  return report.findings.length > 0 || (report.aiFindings?.length ?? 0) > 0 ? 1 : 0;
}
