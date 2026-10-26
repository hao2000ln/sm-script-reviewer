import ts from 'typescript';
import type { AnalysisResult, SourceDocument } from '../core/types';
import { indexComments } from './comments';
import { indexFunctions } from './functions';
import { createLocationMapper, type LocationMapper } from './location';

/** Internal parser output for AST-based consumers. It is not JSON-serializable. */
export interface AnalysisArtifact {
  analysis: AnalysisResult;
  sourceFile: ts.SourceFile;
  parseDiagnostics: readonly ts.Diagnostic[];
  toLocation: LocationMapper;
}

export function createAnalysisArtifact(source: SourceDocument): AnalysisArtifact {
  const sourceFile = ts.createSourceFile(
    source.filePath,
    source.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const toLocation = createLocationMapper(sourceFile);
  const indexedComments = indexComments(sourceFile, toLocation);
  const parseDiagnostics = getParseDiagnostics(sourceFile);
  const analysis: AnalysisResult = {
    source,
    functions: indexFunctions(sourceFile, indexedComments, toLocation),
    comments: indexedComments.map(({ isTrailing: _, ...comment }) => comment),
    issues: parseDiagnostics.map((diagnostic) => ({
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      start: toLocation(diagnostic.start ?? 0),
    })),
  };

  return { analysis, sourceFile, parseDiagnostics, toLocation };
}

function getParseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  // createSourceFile exposes parser diagnostics at runtime, but TypeScript does
  // not include the property in the public SourceFile declaration.
  return (sourceFile as ts.SourceFile & {
    readonly parseDiagnostics: readonly ts.Diagnostic[];
  }).parseDiagnostics ?? [];
}

