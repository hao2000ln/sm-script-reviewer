import ts from 'typescript';
import { hasSyntacticLoopExit, isUnconditionalLoop } from '../control-flow/loop-exits';
import type { FindingCandidate, Rule } from '../types';

export const unconditionalLoopRule: Rule = {
  metadata: {
    id: 'SM-LOOP-001',
    title: 'Unconditional loop without a syntactic exit',
    description: 'Reports while(true), do/while(true), and for(;;) loops with no visible exit.',
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
          message: 'Unconditional loop has no syntactic break, return, or throw exit.',
          range,
          evidence: [{
            kind: 'control-flow',
            message: 'The loop condition is unconditional and its body has no visible exit.',
            range,
          }],
          suggestion: 'Add an explicit, reachable exit condition or use a bounded loop.',
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(context.sourceFile);
    return findings;
  },
};

