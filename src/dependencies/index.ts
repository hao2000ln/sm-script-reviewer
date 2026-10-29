import { relative } from 'node:path';
import type { SourceDocument } from '../core/types';
import type {
  DependencyAnalysisConfig,
  DependencyMappingState,
  DependencyNode,
  ExtractedDependencyReference,
  ResolvedDependencyReference,
} from './types';

export interface DependencyIndex {
  readonly nodes: readonly DependencyNode[];
  readonly config: Required<Pick<DependencyAnalysisConfig, 'corpusComplete' | 'mappingsComplete' | 'caseSensitive'>>;
  resolve(sourceNodeId: string, reference: ExtractedDependencyReference): ResolvedDependencyReference;
}

export function createDependencyIndex(
  rootPath: string,
  sources: readonly SourceDocument[],
  config: DependencyAnalysisConfig = {},
): DependencyIndex {
  const normalizedConfig = {
    corpusComplete: config.corpusComplete === true,
    mappingsComplete: config.mappingsComplete === true,
    // Matching is exact unless the project explicitly opts into case folding.
    // ScriptLibrary names are deployment identities, so silently folding case
    // can turn a configuration error into a false resolved edge.
    caseSensitive: config.caseSensitive !== false,
  };
  const nodeByPath = new Map<string, DependencyNode>();
  const mappingsByPath = new Map<string, { readonly libraryName: string; readonly provenance: DependencyMappingState }[]>();
  for (const mapping of config.libraryMappings ?? []) {
    const path = normalizePath(mapping.filePath);
    const existing = mappingsByPath.get(path) ?? [];
    existing.push({ libraryName: mapping.libraryName, provenance: mapping.provenance ?? 'PROJECT_VERIFIED' });
    mappingsByPath.set(path, existing);
  }
  const mappedNames = new Map<string, string[]>();
  for (const [path, mappings] of mappingsByPath) {
    for (const mapping of mappings) {
      const key = nameKey(mapping.libraryName, normalizedConfig.caseSensitive);
      const values = mappedNames.get(key) ?? [];
      values.push(path);
      mappedNames.set(key, values);
    }
  }
  for (const source of sources) {
    const filePath = normalizePath(relative(rootPath, source.filePath));
    const mappings = mappingsByPath.get(filePath) ?? [];
    // More than one name per file is intentionally retained as unknown: a
    // ScriptLibrary runtime identity is not inferred from a file without one
    // unambiguous owner mapping.
    const mapping = mappings.length === 1 ? mappings[0] : undefined;
    const duplicateLibraryName = mapping
      ? (mappedNames.get(nameKey(mapping.libraryName, normalizedConfig.caseSensitive))?.length ?? 0) > 1
      : false;
    nodeByPath.set(filePath, {
      id: filePath,
      filePath,
      ...(mapping ? { libraryName: mapping.libraryName, mappingState: mapping.provenance } : { mappingState: 'UNKNOWN' as const }),
      duplicateLibraryName,
    });
  }
  const nodes = [...nodeByPath.values()].sort(compareNodes);
  const candidatesByName = new Map<string, DependencyNode[]>();
  for (const node of nodes) if (node.libraryName && node.mappingState === 'PROJECT_VERIFIED') {
    const key = nameKey(node.libraryName, normalizedConfig.caseSensitive);
    const values = candidatesByName.get(key) ?? [];
    values.push(node);
    candidatesByName.set(key, values);
  }
  return {
    nodes,
    config: normalizedConfig,
    resolve(sourceNodeId, reference) {
      if (reference.shadowed) return result(sourceNodeId, reference, 'UNRESOLVED', [], 'lib is lexically shadowed; no SM global library reference is assumed.');
      if (!reference.libraryName) return result(sourceNodeId, reference, 'DYNAMIC', [], 'Computed library target is dynamic and is not resolved.');
      const mappingPaths = mappedNames.get(nameKey(reference.libraryName, normalizedConfig.caseSensitive)) ?? [];
      const candidates = [...(candidatesByName.get(nameKey(reference.libraryName, normalizedConfig.caseSensitive)) ?? [])]
        .sort(compareNodes);
      if (candidates.length === 1 && !candidates[0].duplicateLibraryName) {
        return result(sourceNodeId, reference, 'RESOLVED', candidates, 'Explicit project-verified library mapping resolved this reference.');
      }
      if (candidates.length > 1 || candidates.some((candidate) => candidate.duplicateLibraryName)) {
        return result(sourceNodeId, reference, 'AMBIGUOUS', candidates, 'Multiple explicit library mappings match this reference.');
      }
      if (mappingPaths.length > 0) {
        return result(sourceNodeId, reference, 'UNRESOLVED', [], 'A configured mapping is not present as a project-verified source node in this corpus.');
      }
      if (normalizedConfig.corpusComplete && normalizedConfig.mappingsComplete && !hasUnknownMappings(mappingsByPath)) {
        return result(sourceNodeId, reference, 'MISSING', [], 'Complete corpus and complete explicit mapping contain no matching library.');
      }
      return result(sourceNodeId, reference, 'UNRESOLVED', [], 'No explicit library mapping is available; incomplete corpus or mapping prevents a missing-reference claim.');
    },
  };
}

function hasUnknownMappings(mappingsByPath: ReadonlyMap<string, readonly { readonly libraryName: string; readonly provenance: DependencyMappingState }[]>): boolean {
  return [...mappingsByPath.values()].some((mappings) => mappings.some(({ provenance }) => provenance !== 'PROJECT_VERIFIED'));
}

function result(
  sourceNodeId: string,
  reference: ExtractedDependencyReference,
  status: ResolvedDependencyReference['status'],
  candidates: readonly DependencyNode[],
  explanation: string,
): ResolvedDependencyReference {
  return {
    ...reference,
    sourceNodeId,
    status,
    ...(status === 'RESOLVED' ? { targetNodeId: candidates[0].id } : {}),
    candidateNodeIds: candidates.map(({ id }) => id),
    explanation,
  };
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function nameKey(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLocaleLowerCase('en-US');
}

function compareNodes(left: DependencyNode, right: DependencyNode): number {
  return left.filePath.localeCompare(right.filePath);
}
