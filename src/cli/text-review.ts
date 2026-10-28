import type { ReviewReport } from '../reporting/report';

export function renderTextReview(report: ReviewReport): string {
  const lines: string[] = [`Preset: ${report.reviewPreset}`];
  for (const file of report.files) {
    lines.push(file.filePath);
    const findings = report.findings.filter(({ filePath }) => filePath === file.filePath);
    const diagnostics = report.diagnostics.filter(({ filePath }) => filePath === file.filePath);
    const ruleErrors = report.ruleErrors.filter(({ filePath }) => filePath === file.filePath);
    const aiFindings = report.aiFindings?.filter(({ filePath }) => filePath === file.filePath) ?? [];
    const aiErrors = report.aiErrors?.filter(({ filePath }) => filePath === file.filePath) ?? [];
    const aiCoverage = report.aiCoverage?.find(({ filePath }) => filePath === file.filePath);

    for (const finding of findings) {
      lines.push(
        `  ${finding.severity.toUpperCase()} ${finding.ruleId} `
        + `${finding.range.start.line}:${finding.range.start.column} ${finding.message}`,
      );
      if (finding.suggestion) lines.push(`    Suggestion: ${finding.suggestion}`);
    }
    for (const issue of diagnostics) {
      lines.push(`  PARSE ${issue.start.line}:${issue.start.column} ${issue.message}`);
    }
    for (const error of ruleErrors) {
      lines.push(`  RULE-ERROR ${error.ruleId} ${error.message}`);
    }
    for (const finding of aiFindings) {
      lines.push(
        `  AI-${finding.severity.toUpperCase()} [MODEL-GENERATED] `
        + `${finding.range.start.line}:${finding.range.start.column} ${finding.message}`,
      );
      lines.push(`    Explanation: ${finding.explanation}`);
      if (finding.suggestion) lines.push(`    Suggestion: ${finding.suggestion}`);
      lines.push(`    Model: ${finding.model.providerId}/${finding.model.modelId}`);
    }
    for (const error of aiErrors) {
      lines.push(`  AI-ERROR ${error.category} ${error.message}`);
    }
    if (aiCoverage) {
      lines.push(
        `  AI-COVERAGE ${aiCoverage.status} selected=${aiCoverage.selectedForAIReview}`
        + ` total=${aiCoverage.totalIndexedFunctions}`
        + ` notReviewed=${aiCoverage.notReviewedFunctions}`,
      );
      if (aiCoverage.status === 'partial') {
        lines.push('  AI-WARNING Partial review: this ScriptLibrary was not fully AI-reviewed.');
      }
    }
    if (findings.length === 0 && diagnostics.length === 0 && ruleErrors.length === 0
      && aiFindings.length === 0 && aiErrors.length === 0 && !aiCoverage) {
      lines.push('  No findings.');
    }
  }

  for (const failure of report.failures) {
    lines.push(`${failure.filePath}`);
    lines.push(`  FILE-ERROR ${failure.message}`);
  }
  for (const error of report.aiErrors?.filter(({ filePath }) => filePath === '<review>') ?? []) {
    lines.push(`AI-ERROR ${error.category} ${error.message}`);
  }

  lines.push(
    `Summary: files=${report.summary.files} findings=${report.summary.findings} `
    + `diagnostics=${report.summary.diagnostics} skippedRules=${report.summary.skippedRules} `
    + `skippedFiles=${report.summary.skippedFiles} failures=${report.summary.failures}`
    + (report.aiFindings
      ? ` aiFindings=${report.summary.aiFindings} aiErrors=${report.summary.aiErrors}`
      : ''),
  );
  return lines.join('\n');
}
