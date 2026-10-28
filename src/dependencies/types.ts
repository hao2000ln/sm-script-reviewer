import type { SourceDocument, SourceLocation } from '../core/types';

export type DependencyReferenceStatus = 'RESOLVED' | 'MISSING' | 'UNRESOLVED' | 'DYNAMIC' | 'AMBIGUOUS';
export type DependencyReferenceSyntax = 'property' | 'bracket';
export type DependencyMappingState = 'PROJECT_VERIFIED' | 'UNKNOWN';

export interface DependencyRange { readonly start: SourceLocation; readonly end: SourceLocation; }

export interface ExtractedDependencyReference {
  readonly source: SourceDocument;
  readonly range: DependencyRange;
  readonly syntax: DependencyReferenceSyntax;
  readonly libraryName?: string;
  readonly targetExpression?: string;
  readonly confidence: number;
  readonly evidence: string;
  readonly shadowed: boolean;
}

export interface DependencyLibraryMapping {
  readonly libraryName: string;
  readonly filePath: string;
  readonly provenance?: DependencyMappingState;
}

export interface DependencyAnalysisConfig {
  /** Only permits MISSING when the owner declares exports and mappings complete. */
  readonly corpusComplete?: boolean;
  readonly mappingsComplete?: boolean;
  /** Explicit owner-maintained library name to relative source path mappings. */
  readonly libraryMappings?: readonly DependencyLibraryMapping[];
  /** Exact by default; case-insensitive matching requires explicit opt-in. */
  readonly caseSensitive?: boolean;
}

export interface DependencyNode {
  readonly id: string;
  readonly filePath: string;
  readonly libraryName?: string;
  readonly mappingState: DependencyMappingState;
  readonly duplicateLibraryName: boolean;
}

export interface ResolvedDependencyReference extends ExtractedDependencyReference {
  readonly sourceNodeId: string;
  readonly status: DependencyReferenceStatus;
  readonly targetNodeId?: string;
  readonly candidateNodeIds: readonly string[];
  readonly explanation: string;
}

export interface DependencyEdge {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly libraryName: string;
  readonly references: readonly ResolvedDependencyReference[];
}

export interface DependencyGraph {
  readonly nodes: readonly DependencyNode[];
  readonly edges: readonly DependencyEdge[];
  readonly references: readonly ResolvedDependencyReference[];
  readonly connectedComponents: readonly (readonly string[])[];
  readonly cycles: readonly (readonly string[])[];
}

export interface DependencyImpact {
  readonly changed: readonly string[];
  readonly unknownChanged: readonly string[];
  readonly directDependents: readonly string[];
  readonly indirectDependents: readonly string[];
  readonly dependentsWithinCycles: readonly string[];
  readonly limitations: readonly string[];
}

export interface DependencyCorpusMetadata {
  readonly rootPath: string;
  readonly sourceHash: string;
  readonly fileCount: number;
  readonly skippedFileCount: number;
  readonly corpusComplete: boolean;
  readonly mappingsComplete: boolean;
  readonly caseSensitive: boolean;
}

export interface DependencyAnalysisResult {
  readonly schemaVersion: '1.0.0';
  readonly corpus: DependencyCorpusMetadata;
  readonly graph: DependencyGraph;
  readonly parseDiagnosticFiles: readonly string[];
  readonly failures: readonly { readonly filePath: string; readonly message: string }[];
}
