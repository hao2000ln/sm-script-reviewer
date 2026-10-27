import ts from 'typescript';
import { getSmAnalysis } from '../../sm/analysis';
import { assessSmQueryLoopProgress, getSmQueryLoopTarget } from '../../sm/flow';
import type { FindingCandidate, Rule } from '../types';

export const smQueryLoopProgressRule: Rule = {
  metadata: {
    id: 'SM-LOOP-002',
    title: 'SCFile query loop without tracked cursor progress',
    description: 'Reports supported SCFile success-loop syntax with a continuing path that does not assign getNext() to the tracked return code.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'error',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => {
    const analysis = getSmAnalysis(context);
    const findings: FindingCandidate[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForStatement(node)) {
        const target = getSmQueryLoopTarget(node, analysis);
        if (target && assessSmQueryLoopProgress(node, target, analysis) === 'missing') {
          const range = context.rangeOf(node);
          findings.push({
            message: `SCFile success loop has a continuing path that does not update "${target.returnCodeName}" from getNext().`,
            range,
            evidence: [{
              kind: 'control-flow',
              message: 'The supported intraprocedural flow subset found no matching getNext() return-code update on at least one continuing path.',
              range,
            }],
            suggestion: 'Update the tracked return code from getNext() on every continuing path, or add an explicit exit.',
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(context.sourceFile);
    return findings;
  },
};

