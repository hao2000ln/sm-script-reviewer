import type { SourceDocument, AnalysisResult } from '../core/types';
import { createAnalysisArtifact } from './analysis-artifact';

export function analyze(source: SourceDocument): AnalysisResult {
  return createAnalysisArtifact(source).analysis;
}
