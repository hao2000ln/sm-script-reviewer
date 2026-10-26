import ts from 'typescript';
import { statementDefinitelyTerminates } from '../control-flow/completion';
import type { FindingCandidate, Rule } from '../types';

export const unreachableCodeRule: Rule = {
  metadata: {
    id: 'SM-CODE-001',
    title: 'Unreachable code',
    description: 'Reports statements after a definitely terminating statement in the same list.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => {
    const findings: FindingCandidate[] = [];

    const visit = (node: ts.Node): void => {
      if (ts.isSourceFile(node) || ts.isBlock(node)) {
        visitStatementList(node.statements);
        return;
      }
      ts.forEachChild(node, visit);
    };

    const visitStatementList = (statements: readonly ts.Statement[]): void => {
      let terminated = false;
      for (const statement of statements) {
        if (terminated) {
          // Function declarations are hoisted. Do not report the declaration,
          // but still inspect its body for independent unreachable code.
          if (ts.isFunctionDeclaration(statement)) visit(statement);
          else {
            const range = context.rangeOf(statement);
            findings.push({
              message: 'Statement is unreachable after a definite control-flow exit.',
              range,
              evidence: [{
                kind: 'control-flow',
                message: 'An earlier statement in this block always exits control flow.',
                range,
              }],
              suggestion: 'Remove the statement or restructure the preceding control flow.',
            });
          }
          continue;
        }

        visit(statement);
        if (statementDefinitelyTerminates(statement)) terminated = true;
      }
    };

    visit(context.sourceFile);
    return findings;
  },
};

