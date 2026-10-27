import type { ReportFinding, ReviewReport } from './report';

export function renderHtmlReport(report: ReviewReport): string {
  const ruleIds = [...new Set(report.findings.map(({ ruleId }) => ruleId))].sort();
  const findingsByFile = new Map<string, ReportFinding[]>();
  for (const finding of report.findings) {
    const values = findingsByFile.get(finding.filePath) ?? [];
    values.push(finding);
    findingsByFile.set(finding.filePath, values);
  }

  const groups = [...findingsByFile].map(([filePath, findings]) => `
    <section class="file-group">
      <h2>${escapeHtml(filePath)}</h2>
      ${findings.map(renderFinding).join('')}
    </section>`).join('');
  const diagnostics = report.diagnostics.map((diagnostic) => `
    <li><code>${escapeHtml(diagnostic.filePath)}:${diagnostic.start.line}:${diagnostic.start.column}</code>
      ${escapeHtml(diagnostic.message)}</li>`).join('');
  const failures = report.failures.map((failure) => `
    <li><code>${escapeHtml(failure.filePath)}</code> ${escapeHtml(failure.message)}</li>`).join('');
  const aiFindings = (report.aiFindings ?? []).map((finding) => `
    <article class="finding ai-finding" data-severity="${escapeHtml(finding.severity)}" data-rule="ai">
      <header><span class="severity">${escapeHtml(finding.severity)}</span>
        <strong>AI finding — model-generated</strong>
        <code>${escapeHtml(finding.filePath)}:${finding.range.start.line}:${finding.range.start.column}</code></header>
      <p>${escapeHtml(finding.message)}</p>
      <p><strong>Explanation:</strong> ${escapeHtml(finding.explanation)}</p>
      ${finding.suggestion ? `<p><strong>Suggestion:</strong> ${escapeHtml(finding.suggestion)}</p>` : ''}
      <p><small>Model: ${escapeHtml(finding.model.providerId)}/${escapeHtml(finding.model.modelId)}; confidence: ${finding.confidence}</small></p>
    </article>`).join('');
  const aiErrors = (report.aiErrors ?? []).map((error) => `
    <li><code>${escapeHtml(error.filePath)}</code> ${escapeHtml(error.category)}: ${escapeHtml(error.message)}</li>`).join('');
  const aiCoverage = (report.aiCoverage ?? []).map((coverage) => `
    <li><code>${escapeHtml(coverage.filePath)}</code> status=${escapeHtml(coverage.status)},
      selected=${coverage.selectedForAIReview}/${coverage.totalIndexedFunctions},
      not reviewed=${coverage.notReviewedFunctions}
      ${coverage.status === 'partial'
        ? '<strong class="coverage-warning">Warning: this ScriptLibrary was not fully AI-reviewed.</strong>'
        : ''}</li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SM ScriptLibrary Review</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { max-width: 1100px; margin: 0 auto; padding: 24px; line-height: 1.5; }
    .summary, .filters, .finding { border: 1px solid #8886; border-radius: 8px; padding: 12px; margin: 12px 0; }
    .summary { display: flex; gap: 20px; flex-wrap: wrap; }
    .filters label { margin-right: 16px; }
    .finding header { display: flex; gap: 10px; align-items: baseline; }
    .severity { font-weight: 700; text-transform: uppercase; }
    .coverage-warning { display: block; color: #b45309; }
    code { overflow-wrap: anywhere; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>SM ScriptLibrary Review</h1>
  <div class="summary">
    <span>Files: ${report.summary.files}</span><span>Findings: ${report.summary.findings}</span>
    <span>Diagnostics: ${report.summary.diagnostics}</span><span>Failures: ${report.summary.failures}</span>
    <span>Skipped files: ${report.summary.skippedFiles}</span>
    ${report.aiFindings ? `<span>AI findings: ${report.summary.aiFindings}</span><span>AI errors: ${report.summary.aiErrors}</span>` : ''}
    <span>Threshold: ${escapeHtml(report.failureThreshold)}</span>
  </div>
  <div class="filters">
    <label>Severity <select id="severity-filter">
      <option value="all">All</option><option value="warning">Warning+</option>
      <option value="error">Error+</option><option value="critical">Critical</option>
    </select></label>
    <label>Rule <select id="rule-filter"><option value="all">All</option>
      ${ruleIds.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('')}
    </select></label>
  </div>
  <main>${groups || '<p>No findings meeting the failure threshold.</p>'}</main>
  ${report.aiFindings ? `<section><h2>AI review (model-generated)</h2>${aiFindings || '<p>No AI findings.</p>'}</section>` : ''}
  ${report.aiCoverage ? `<section><h2>AI review coverage</h2><ul>${aiCoverage}</ul></section>` : ''}
  ${aiErrors ? `<section><h2>AI errors</h2><ul>${aiErrors}</ul></section>` : ''}
  ${diagnostics ? `<section><h2>Parse diagnostics</h2><ul>${diagnostics}</ul></section>` : ''}
  ${failures ? `<section><h2>File failures</h2><ul>${failures}</ul></section>` : ''}
  <script>
    (() => {
      const ranks = { info: 0, warning: 1, error: 2, critical: 3 };
      const severity = document.getElementById('severity-filter');
      const rule = document.getElementById('rule-filter');
      const apply = () => document.querySelectorAll('.finding').forEach((item) => {
        const severityMatches = severity.value === 'all' || ranks[item.dataset.severity] >= ranks[severity.value];
        const ruleMatches = rule.value === 'all' || item.dataset.rule === rule.value;
        item.classList.toggle('hidden', !(severityMatches && ruleMatches));
      });
      severity.addEventListener('change', apply);
      rule.addEventListener('change', apply);
    })();
  </script>
</body>
</html>`;
}

function renderFinding(finding: ReportFinding): string {
  return `
      <article class="finding" data-severity="${escapeHtml(finding.severity)}" data-rule="${escapeHtml(finding.ruleId)}">
        <header><span class="severity">${escapeHtml(finding.severity)}</span>
          <strong>${escapeHtml(finding.ruleId)}</strong>
          <code>${finding.range.start.line}:${finding.range.start.column}</code></header>
        <p>${escapeHtml(finding.message)}</p>
        ${finding.suggestion ? `<p><strong>Suggestion:</strong> ${escapeHtml(finding.suggestion)}</p>` : ''}
        ${finding.evidence.length > 0 ? `<details><summary>Evidence</summary><ul>${finding.evidence.map((evidence) => (
          `<li><code>${evidence.range.start.line}:${evidence.range.start.column}</code> ${escapeHtml(evidence.message)}</li>`
        )).join('')}</ul></details>` : ''}
      </article>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
