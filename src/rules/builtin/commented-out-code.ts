import type { CommentInfo } from '../../core/types';
import type { Rule } from '../types';

export const commentedOutCodeRule: Rule = {
  metadata: {
    id: 'SM-CMT-002',
    title: 'Possible commented-out code',
    description: 'Reports comments that strongly resemble disabled JavaScript statements.',
    classification: 'heuristic',
    defaultEnabled: false,
    defaultSeverity: 'info',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => context.analysis.comments
    .filter((comment) => resemblesCode(normalizeComment(comment)))
    .map((comment) => ({
      message: 'Comment appears to contain disabled code.',
      range: { start: comment.start, end: comment.end },
      evidence: [{
        kind: 'source-pattern',
        message: 'Comment text matches a strong JavaScript statement pattern.',
        range: { start: comment.start, end: comment.end },
      }],
      suggestion: 'Remove obsolete code or preserve its history in version control.',
      confidence: 0.82,
    })),
};

function normalizeComment(comment: CommentInfo): string {
  const withoutDelimiters = comment.kind === 'line'
    ? comment.text.replace(/^\/\//u, '')
    : comment.text.replace(/^\/\*/u, '').replace(/\*\/$/u, '');
  return withoutDelimiters
    .split(/\r\n|\r|\n/u)
    .map((line) => line.replace(/^\s*\*(?=\s|$)\s?/u, '').trim())
    .join(' ')
    .trim();
}

function resemblesCode(text: string): boolean {
  const patterns = [
    /^(?:var|let|const)\s+[A-Za-z_$][\w$]*(?:\s*=\s*.+)?;\s*$/u,
    /^function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/u,
    /^(?:if|for|while|switch)\s*\([^)]*\)\s*\{/u,
    /^return(?:\s+.+)?;\s*$/u,
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])*\s*=\s*.+;\s*$/u,
    /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\([^)]*\)\s*;\s*$/u,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

