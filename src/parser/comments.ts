import ts from 'typescript';
import type { CommentInfo } from '../core/types';
import type { LocationMapper } from './location';

export interface IndexedComment extends CommentInfo {
  /** A trailing comment belongs to code before it, not to a following function. */
  isTrailing: boolean;
}

/**
 * Collect comments only from trivia positions recognized by the parsed AST.
 * A standalone scanner cannot distinguish division from regular expressions or
 * resume template-literal scanning after a `${...}` interpolation.
 */
export function indexComments(
  sourceFile: ts.SourceFile,
  toLocation: LocationMapper,
): IndexedComment[] {
  const sourceText = sourceFile.text;
  const commentsByRange = new Map<string, CommentInfo>();

  const addRanges = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      const key = `${range.pos}:${range.end}`;
      if (commentsByRange.has(key)) continue;

      commentsByRange.set(key, {
        kind: range.kind === ts.SyntaxKind.SingleLineCommentTrivia ? 'line' : 'block',
        text: sourceText.slice(range.pos, range.end),
        start: toLocation(range.pos),
        end: toLocation(range.end),
      });
    }
  };

  const visit = (node: ts.Node): void => {
    addRanges(ts.getLeadingCommentRanges(sourceText, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(sourceText, node.getEnd()));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };

  visit(sourceFile);
  const comments = [...commentsByRange.values()].sort(
    (left, right) => left.start.offset - right.start.offset,
  );
  return classifyTrailingComments(comments, sourceText);
}

export function findLeadingComment(
  comments: readonly IndexedComment[],
  anchorOffset: number,
  sourceText: string,
): string | undefined {
  let currentIndex = -1;
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    if (comments[index].end.offset <= anchorOffset) {
      currentIndex = index;
      break;
    }
  }

  if (currentIndex < 0) return undefined;

  const closest = comments[currentIndex];
  const closestGap = sourceText.slice(closest.end.offset, anchorOffset);
  if (closest.isTrailing || !isContiguousWhitespace(closestGap)) return undefined;

  const group: IndexedComment[] = [closest];
  while (currentIndex > 0) {
    const previous = comments[currentIndex - 1];
    const current = comments[currentIndex];
    const gap = sourceText.slice(previous.end.offset, current.start.offset);

    if (previous.isTrailing || !isContiguousWhitespace(gap)) break;
    group.unshift(previous);
    currentIndex -= 1;
  }

  return group.map(({ text }) => text).join('\n');
}

function isContiguousWhitespace(text: string): boolean {
  if (!/^\s*$/u.test(text)) return false;

  // One line break separates adjacent source lines. Two indicate a blank line.
  return !/(?:\r\n|\r|\n)[\t\f\v ]*(?:\r\n|\r|\n)/u.test(text);
}

function classifyTrailingComments(
  comments: readonly CommentInfo[],
  sourceText: string,
): IndexedComment[] {
  let cursor = 0;
  let lineHasCode = false;

  return comments.map((comment) => {
    lineHasCode = scanLineState(
      sourceText.slice(cursor, comment.start.offset),
      lineHasCode,
      true,
    );
    const indexedComment = { ...comment, isTrailing: lineHasCode };
    lineHasCode = scanLineState(
      sourceText.slice(comment.start.offset, comment.end.offset),
      lineHasCode,
      false,
    );
    cursor = comment.end.offset;
    return indexedComment;
  });
}

function scanLineState(text: string, initialState: boolean, countCode: boolean): boolean {
  let lineHasCode = initialState;
  for (const character of text) {
    if (character === '\r' || character === '\n') {
      lineHasCode = false;
    } else if (countCode && !/\s/u.test(character)) {
      lineHasCode = true;
    }
  }

  return lineHasCode;
}
