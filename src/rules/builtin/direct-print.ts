import ts from 'typescript';
import type { FindingCandidate, Rule } from '../types';

const MODES = ['all-print', 'debug-patterns', 'off'] as const;
type PrintMode = typeof MODES[number];
const DEBUG_MARKER = /\b(?:DEBUG|TRACE|TEMP\s+DEBUG)\b/iu;

export const directPrintRule: Rule = {
  metadata: {
    id: 'SM-DBG-001',
    title: 'Direct print debug output',
    description: 'Reports direct print() calls that can leave debug output in production code.',
    classification: 'deterministic',
    allowedClassifications: ['deterministic', 'heuristic'],
    defaultEnabled: true,
    defaultSeverity: 'warning',
    syntaxPolicy: 'valid-only',
  },
  validateOptions: (options) => options.mode === undefined || (typeof options.mode === 'string' && MODES.includes(options.mode as PrintMode))
    ? []
    : [`SM-DBG-001 mode must be one of: ${MODES.join(', ')}`],
  run: (context, options) => {
    const mode = (typeof options.mode === 'string' ? options.mode : 'all-print') as PrintMode;
    if (mode === 'off') return [];
    const findings: FindingCandidate[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'print'
      ) {
        if (mode === 'debug-patterns' && !node.arguments.some(hasExplicitDebugMarker)) {
          ts.forEachChild(node, visit);
          return;
        }
        const range = context.rangeOf(node);
        findings.push({
          message: mode === 'all-print'
            ? 'Remove direct print() debug output from production code.'
            : 'Direct print() contains an explicit debug marker.',
          range,
          evidence: [{
            kind: 'ast',
            message: mode === 'all-print'
              ? 'Direct call expression targets the identifier print.'
              : 'Direct print() argument contains a statically known debug marker.',
            range,
          }],
          suggestion: mode === 'all-print'
            ? 'Remove the debug call or replace it with the approved logging mechanism.'
            : 'Remove the debug marker or replace the diagnostic output with an approved logging mechanism.',
          ...(mode === 'debug-patterns'
            ? { classification: 'heuristic' as const, defaultSeverity: 'info' as const, confidence: 0.9 }
            : {}),
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(context.sourceFile);
    return findings;
  },
};

function hasExplicitDebugMarker(expression: ts.Expression): boolean {
  const value = ts.isStringLiteral(expression)
    ? expression.text
    : ts.isNoSubstitutionTemplateLiteral(expression)
      ? expression.text
      : undefined;
  return value !== undefined && DEBUG_MARKER.test(value);
}

