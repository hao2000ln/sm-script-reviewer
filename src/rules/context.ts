import type ts from 'typescript';
import type { AnalysisArtifact } from '../parser/analysis-artifact';
import type { RuleContext, SourceRange } from './types';

export function createRuleContext(artifact: AnalysisArtifact): RuleContext {
  const range = (startOffset: number, endOffset: number): SourceRange => ({
    start: artifact.toLocation(startOffset),
    end: artifact.toLocation(endOffset),
  });

  return {
    source: artifact.analysis.source,
    sourceFile: artifact.sourceFile,
    analysis: artifact.analysis,
    parseDiagnostics: artifact.parseDiagnostics,
    syntaxValid: artifact.parseDiagnostics.length === 0,
    range,
    rangeOf: (node: ts.Node): SourceRange => range(
      node.getStart(artifact.sourceFile),
      node.getEnd(),
    ),
  };
}

