import ts from 'typescript';
import type { FindingCandidate, Rule } from '../types';

export const directPrintRule: Rule = {
  metadata: {
    id: 'SM-DBG-001',
    title: 'Direct print debug output',
    description: 'Reports direct print() calls that can leave debug output in production code.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => {
    const findings: FindingCandidate[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === 'print'
      ) {
        const range = context.rangeOf(node);
        findings.push({
          message: 'Remove direct print() debug output from production code.',
          range,
          evidence: [{
            kind: 'ast',
            message: 'Direct call expression targets the identifier print.',
            range,
          }],
          suggestion: 'Remove the debug call or replace it with the approved logging mechanism.',
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(context.sourceFile);
    return findings;
  },
};

