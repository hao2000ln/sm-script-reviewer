import type { ReviewReport } from '../reporting/report';

export function renderTextReview(report: ReviewReport): string {
  const lines: string[] = [];
  for (const file of report.files) {
    lines.push(file.filePath);
    const findings = report.findings.filter(({ filePath }) => filePath === file.filePath);
    const diagnostics = report.diagnostics.filter(({ filePath }) => filePath === file.filePath);
    const ruleErrors = report.ruleErrors.filter(({ filePath }) => filePath === file.filePath);

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
    if (findings.length === 0 && diagnostics.length === 0 && ruleErrors.length === 0) {
      lines.push('  No findings.');
    }
  }

  for (const failure of report.failures) {
    lines.push(`${failure.filePath}`);
    lines.push(`  FILE-ERROR ${failure.message}`);
  }

  lines.push(
    `Summary: files=${report.summary.files} findings=${report.summary.findings} `
    + `diagnostics=${report.summary.diagnostics} skippedRules=${report.summary.skippedRules} `
    + `failures=${report.summary.failures}`,
  );
  return lines.join('\n');
}
