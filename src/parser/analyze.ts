import ts from 'typescript';
import type { SourceDocument, AnalysisResult } from '../core/types';
import { indexComments } from './comments';
import { indexFunctions } from './functions';
import { createLocationMapper } from './location';

export function analyze(source: SourceDocument): AnalysisResult {
  const ast = ts.createSourceFile(source.filePath, source.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const toLocation = createLocationMapper(ast);
  const indexedComments = indexComments(ast, toLocation);
  const functions = indexFunctions(ast, indexedComments, toLocation);
  const comments = indexedComments.map(({ isTrailing: _, ...comment }) => comment);
  const issues = getParseDiagnostics(ast).map((diagnostic) => ({
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
    start: toLocation(diagnostic.start ?? 0),
  }));

  return { source, functions, comments, issues };
}

function getParseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  // createSourceFile exposes parser diagnostics at runtime, but TypeScript does
  // not include the property in the public SourceFile declaration.
  return (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
}
