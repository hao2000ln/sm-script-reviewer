import type { DependencyEdge, DependencyGraph, DependencyImpact, DependencyNode, ResolvedDependencyReference } from './types';

export function createDependencyGraph(
  nodes: readonly DependencyNode[],
  references: readonly ResolvedDependencyReference[],
): DependencyGraph {
  const edgeGroups = new Map<string, ResolvedDependencyReference[]>();
  for (const reference of references) if (reference.status === 'RESOLVED' && reference.targetNodeId && reference.libraryName) {
    const key = `${reference.sourceNodeId}\u0000${reference.targetNodeId}`;
    const group = edgeGroups.get(key) ?? [];
    group.push(reference);
    edgeGroups.set(key, group);
  }
  const edges: DependencyEdge[] = [...edgeGroups.values()].map((group) => ({
    fromNodeId: group[0].sourceNodeId,
    toNodeId: group[0].targetNodeId!,
    libraryName: group[0].libraryName!,
    references: group.sort((left, right) => left.range.start.offset - right.range.start.offset),
  })).sort((left, right) => `${left.fromNodeId}\u0000${left.toNodeId}`.localeCompare(`${right.fromNodeId}\u0000${right.toNodeId}`));
  const orderedNodes = [...nodes].sort((left, right) => left.id.localeCompare(right.id));
  return {
    nodes: orderedNodes,
    edges,
    references: [...references].sort((left, right) => `${left.sourceNodeId}\u0000${left.range.start.offset}`.localeCompare(`${right.sourceNodeId}\u0000${right.range.start.offset}`)),
    connectedComponents: connectedComponents(orderedNodes, edges),
    cycles: stronglyConnectedCycles(orderedNodes, edges),
  };
}

export function calculateImpact(graph: DependencyGraph, changed: readonly string[]): DependencyImpact {
  const byName = new Map<string, string[]>();
  for (const node of graph.nodes) if (node.libraryName && !node.duplicateLibraryName) byName.set(node.libraryName, [...(byName.get(node.libraryName) ?? []), node.id]);
  const changedIds = new Set<string>(); const unknownChanged: string[] = [];
  for (const name of changed) {
    const matches = byName.get(name) ?? [];
    if (matches.length === 1) changedIds.add(matches[0]); else unknownChanged.push(name);
  }
  const reverse = adjacency(graph.nodes, graph.edges, true);
  const direct = new Set<string>();
  for (const id of changedIds) for (const dependent of reverse.get(id) ?? []) if (!changedIds.has(dependent)) direct.add(dependent);
  const all = traverse(reverse, changedIds);
  for (const id of changedIds) all.delete(id);
  const indirect = [...all].filter((id) => !direct.has(id)).sort();
  const cycleNodes = new Set(graph.cycles.flat());
  const limitations = graph.references.some(({ status }) => status !== 'RESOLVED')
    ? ['Unresolved, dynamic, or ambiguous references may hide additional dependents.'] : [];
  return {
    changed: [...changedIds].sort(), unknownChanged: unknownChanged.sort(), directDependents: [...direct].sort(), indirectDependents: indirect,
    dependentsWithinCycles: [...all].filter((id) => cycleNodes.has(id)).sort(), limitations,
  };
}

function adjacency(nodes: readonly DependencyNode[], edges: readonly DependencyEdge[], reverse = false): Map<string, string[]> {
  const output = new Map<string, string[]>(nodes.map(({ id }) => [id, []]));
  for (const edge of edges) output.get(reverse ? edge.toNodeId : edge.fromNodeId)?.push(reverse ? edge.fromNodeId : edge.toNodeId);
  for (const values of output.values()) values.sort();
  return output;
}

function traverse(adjacencyMap: ReadonlyMap<string, readonly string[]>, starts: ReadonlySet<string>): Set<string> {
  const visited = new Set(starts); const queue = [...starts].sort();
  for (let index = 0; index < queue.length; index += 1) for (const next of adjacencyMap.get(queue[index]) ?? []) if (!visited.has(next)) { visited.add(next); queue.push(next); }
  return visited;
}

function connectedComponents(nodes: readonly DependencyNode[], edges: readonly DependencyEdge[]): readonly (readonly string[])[] {
  const undirected = adjacency(nodes, edges);
  for (const edge of edges) undirected.get(edge.toNodeId)?.push(edge.fromNodeId);
  for (const values of undirected.values()) values.sort();
  const seen = new Set<string>(); const components: string[][] = [];
  for (const node of nodes) if (!seen.has(node.id)) {
    const component = traverse(undirected, new Set([node.id]));
    for (const id of component) seen.add(id);
    components.push([...component].sort());
  }
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

function stronglyConnectedCycles(nodes: readonly DependencyNode[], edges: readonly DependencyEdge[]): readonly (readonly string[])[] {
  const forward = adjacency(nodes, edges); const reverse = adjacency(nodes, edges, true);
  const seen = new Set<string>(); const finish: string[] = [];
  for (const start of nodes.map(({ id }) => id)) if (!seen.has(start)) {
    const stack: { id: string; index: number }[] = [{ id: start, index: 0 }]; seen.add(start);
    while (stack.length) {
      const top = stack[stack.length - 1]; const next = (forward.get(top.id) ?? [])[top.index++];
      if (next === undefined) { finish.push(top.id); stack.pop(); }
      else if (!seen.has(next)) { seen.add(next); stack.push({ id: next, index: 0 }); }
    }
  }
  const assigned = new Set<string>(); const components: string[][] = [];
  for (const start of [...finish].reverse()) if (!assigned.has(start)) {
    // In the second Kosaraju pass, traversal must not cross into a component
    // already assigned by an earlier finishing-time root. Without this guard a
    // one-way edge leaving an SCC can be pulled into a false cycle.
    const component = traverseUnassigned(reverse, start, assigned);
    for (const id of component) assigned.add(id);
    const values = [...component].sort();
    const selfReference = values.length === 1 && (forward.get(values[0]) ?? []).includes(values[0]);
    if (values.length > 1 || selfReference) components.push(values);
  }
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

function traverseUnassigned(
  adjacencyMap: ReadonlyMap<string, readonly string[]>,
  start: string,
  assigned: ReadonlySet<string>,
): Set<string> {
  const visited = new Set<string>([start]); const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    for (const next of adjacencyMap.get(queue[index]) ?? []) {
      if (!assigned.has(next) && !visited.has(next)) { visited.add(next); queue.push(next); }
    }
  }
  return visited;
}
