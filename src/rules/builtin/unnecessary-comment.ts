import type { CommentInfo } from '../../core/types';
import type { FindingCandidate, Rule } from '../types';

export const unnecessaryCommentRule: Rule = {
  metadata: {
    id: 'SM-CMT-003',
    title: 'Empty or separator-only comment',
    description: 'Reports comments containing no explanatory text.',
    classification: 'heuristic',
    defaultEnabled: false,
    defaultSeverity: 'info',
    syntaxPolicy: 'valid-only',
  },
  run: (context) => context.analysis.comments.flatMap((comment) => {
    const content = normalizeComment(comment);
    const confidence = content.length === 0
      ? 0.98
      : /^[\-=*_#~]{3,}$/u.test(content) ? 0.85 : undefined;
    if (confidence === undefined) return [];

    const range = { start: comment.start, end: comment.end };
    const finding: FindingCandidate = {
      message: content.length === 0
        ? 'Comment is empty.'
        : 'Comment contains only separator characters.',
      range,
      evidence: [{
        kind: 'source-pattern',
        message: 'Comment has no explanatory words.',
        range,
      }],
      suggestion: 'Remove the comment or replace it with useful context.',
      confidence,
    };
    return [finding];
  }),
};

function normalizeComment(comment: CommentInfo): string {
  const withoutDelimiters = comment.kind === 'line'
    ? comment.text.replace(/^\/\//u, '')
    : comment.text.replace(/^\/\*/u, '').replace(/\*\/$/u, '');
  return withoutDelimiters
    .split(/\r\n|\r|\n/u)
    .map((line) => line.replace(/^\s*\*(?=\s|$)\s?/u, '').trim())
    .join('')
    .trim();
}

