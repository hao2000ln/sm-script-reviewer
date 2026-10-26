import type { Rule } from '../types';

export const missingFunctionCommentRule: Rule = {
  metadata: {
    id: 'SM-CMT-001',
    title: 'Function requires a leading comment',
    description: 'Reports named functions that do not have an adjacent leading comment.',
    classification: 'deterministic',
    defaultEnabled: true,
    defaultSeverity: 'warning',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => context.analysis.functions
    .filter((fn) => fn.name !== '<anonymous>' && fn.leadingComment === undefined)
    .map((fn) => {
      const range = context.range(fn.start.offset, fn.end.offset);
      return {
        message: `Function "${fn.name}" has no leading comment.`,
        range,
        evidence: [{
          kind: 'ast',
          message: `Named ${fn.kind} has no associated leading comment.`,
          range,
        }],
        suggestion: 'Add an adjacent leading comment that explains the function purpose.',
      };
    }),
};

