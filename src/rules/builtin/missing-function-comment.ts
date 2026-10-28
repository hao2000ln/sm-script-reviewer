import ts from 'typescript';
import type { Rule } from '../types';

const MODES = ['all-functions', 'public-functions', 'off'] as const;
type CommentMode = typeof MODES[number];

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
  validateOptions: (options) => validMode(options, MODES, 'SM-CMT-001'),
  run: (context, options) => {
    const mode = modeOf(options, 'all-functions') as CommentMode;
    if (mode === 'off') return [];
    const publicOffsets = mode === 'public-functions'
      ? new Set(context.sourceFile.statements
        .filter(ts.isFunctionDeclaration)
        .filter((node) => node.name !== undefined)
        .map((node) => node.getStart(context.sourceFile)))
      : undefined;
    // all-functions deliberately retains the established named-function index,
    // including named arrows, methods, and assignment expressions.
    return context.analysis.functions.filter((fn) => fn.name !== '<anonymous>' && fn.leadingComment === undefined
      && (publicOffsets === undefined || publicOffsets.has(fn.start.offset)))
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
    });
  },
};

function modeOf(options: Readonly<Record<string, unknown>>, fallback: CommentMode): string {
  return typeof options.mode === 'string' ? options.mode : fallback;
}

function validMode(
  options: Readonly<Record<string, unknown>>,
  modes: readonly string[],
  ruleId: string,
): readonly string[] {
  return options.mode === undefined || modes.includes(options.mode as string)
    ? []
    : [`${ruleId} mode must be one of: ${modes.join(', ')}`];
}

