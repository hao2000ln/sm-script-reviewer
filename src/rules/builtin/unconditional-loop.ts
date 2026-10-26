import ts from 'typescript';
import { hasSyntacticLoopExit, isUnconditionalLoop } from '../control-flow/loop-exits';
import type { FindingCandidate, Rule } from '../types';

export const unconditionalLoopRule: Rule = {
  metadata: {
    id: 'SM-LOOP-001',
    title: 'Unconditional loop without a syntactic exit',
    description: 'Reports unconditional loop syntax with no recognized possible exit.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => {
    const findings: FindingCandidate[] = [];
    const visit = (node: ts.Node): void => {
      if (isUnconditionalLoop(node) && !hasSyntacticLoopExit(node)) {
        const range = context.rangeOf(node);
        findings.push({
          message: 'Unconditional loop has no recognized syntactic break, return, or throw exit.',
          range,
          evidence: [{
            kind: 'control-flow',
            message: 'The condition is unconditional and no possible exit is visible in the supported syntax subset.',
            range,
          }],
          suggestion: 'Review termination behavior and add an explicit exit condition if the loop is not intentionally unbounded.',
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(context.sourceFile);
    return findings;
  },
};

