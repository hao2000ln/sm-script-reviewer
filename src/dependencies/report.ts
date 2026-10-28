import type { DependencyAnalysisResult, DependencyImpact } from './types';

export interface DependencyReport {
  readonly schemaVersion: '1.0.0';
  readonly generatedAt: string;
  readonly toolVersion: string;
  readonly analysis: DependencyAnalysisResult;
  readonly impact?: DependencyImpact;
}

export function renderDependencyText(report: DependencyReport): string {
  const { analysis } = report;
  const statusCounts = analysis.graph.references.reduce<Record<string, number>>((counts, reference) => {
    counts[reference.status] = (counts[reference.status] ?? 0) + 1; return counts;
  }, {});
  const lines = [
    `Dependencies: files=${analysis.corpus.fileCount} nodes=${analysis.graph.nodes.length} edges=${analysis.graph.edges.length}`,
    `Corpus: complete=${analysis.corpus.corpusComplete} mappingsComplete=${analysis.corpus.mappingsComplete} hash=${analysis.corpus.sourceHash}`,
    `References: ${Object.entries(statusCounts).sort(([left], [right]) => left.localeCompare(right)).map(([status, count]) => `${status}=${count}`).join(' ') || 'none'}`,
    `Cycles: ${analysis.graph.cycles.length}; components: ${analysis.graph.connectedComponents.length}; parseDiagnosticFiles: ${analysis.parseDiagnosticFiles.length}; failures: ${analysis.failures.length}`,
  ];
  for (const edge of analysis.graph.edges) lines.push(`  ${edge.fromNodeId} -> ${edge.toNodeId} (${edge.libraryName})`);
  for (const reference of analysis.graph.references.filter(({ status }) => status !== 'RESOLVED')) {
    lines.push(`  ${reference.status} ${reference.sourceNodeId}:${reference.range.start.line}:${reference.range.start.column} ${reference.libraryName ?? reference.targetExpression ?? '<unknown>'}`);
  }
  if (report.impact) {
    lines.push(`Impact: changed=${report.impact.changed.join(',') || 'none'} direct=${report.impact.directDependents.join(',') || 'none'} indirect=${report.impact.indirectDependents.join(',') || 'none'}`);
    if (report.impact.unknownChanged.length) lines.push(`  Unknown changed: ${report.impact.unknownChanged.join(',')}`);
    for (const limitation of report.impact.limitations) lines.push(`  Limitation: ${limitation}`);
  }
  return lines.join('\n');
}

export function renderDependencyHtml(report: DependencyReport): string {
  const { analysis } = report;
  const rows = analysis.graph.references.map((reference) => `<tr data-status="${escape(reference.status)}"><td>${escape(reference.sourceNodeId)}</td><td>${reference.range.start.line}:${reference.range.start.column}</td><td>${escape(reference.libraryName ?? reference.targetExpression ?? '')}</td><td>${escape(reference.status)}</td><td>${escape(reference.explanation)}</td></tr>`).join('');
  const edges = analysis.graph.edges.map((edge) => `<li>${escape(edge.fromNodeId)} → ${escape(edge.toNodeId)} <small>(${escape(edge.libraryName)})</small></li>`).join('');
  const cycles = analysis.graph.cycles.map((cycle) => `<li class="cycle">${cycle.map(escape).join(' → ')}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SM ScriptLibrary Dependencies</title><style>body{font-family:system-ui,sans-serif;max-width:1200px;margin:auto;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #9996;padding:6px;text-align:left}.cycle{color:#b45309}input{padding:6px;width:20rem}.hidden{display:none}code{overflow-wrap:anywhere}</style></head><body><h1>SM ScriptLibrary Dependencies</h1><p>Files: ${analysis.corpus.fileCount}; nodes: ${analysis.graph.nodes.length}; resolved edges: ${analysis.graph.edges.length}; corpus complete: ${analysis.corpus.corpusComplete}; mappings complete: ${analysis.corpus.mappingsComplete}</p><p>Corpus hash: <code>${escape(analysis.corpus.sourceHash)}</code></p><h2>Resolved dependencies</h2><ul>${edges || '<li>None</li>'}</ul><h2>Cycles</h2><ul>${cycles || '<li>None</li>'}</ul><h2>References</h2><label>Filter <input id="filter" aria-label="Filter references"></label><table><thead><tr><th>Source</th><th>Location</th><th>Target</th><th>Status</th><th>Explanation</th></tr></thead><tbody>${rows}</tbody></table>${report.impact ? `<h2>Impact</h2><p>Changed: ${report.impact.changed.map(escape).join(', ') || 'none'}</p><p>Direct dependents: ${report.impact.directDependents.map(escape).join(', ') || 'none'}</p><p>Indirect dependents: ${report.impact.indirectDependents.map(escape).join(', ') || 'none'}</p>` : ''}<script>document.getElementById('filter').addEventListener('input',e=>{const q=e.target.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(r=>r.classList.toggle('hidden',!r.textContent.toLowerCase().includes(q)))});</script></body></html>`;
}

function escape(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
