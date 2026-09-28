export type RoutePreview = {
  systems: number[];
  edges: [number, number][];
};

export function selectRoutePreview(edges: readonly (readonly [number, number])[], originSystemId: number, destinationSystemId: number): RoutePreview {
  const neighbours = new Map<number, number[]>();

  for (const [left, right] of edges) {
    addNeighbour(neighbours, left, right);
    addNeighbour(neighbours, right, left);
  }

  const systems = [destinationSystemId];
  const previewEdges: [number, number][] = [[originSystemId, destinationSystemId]];
  const visited = new Set([originSystemId, destinationSystemId]);
  const queue = [{ systemId: destinationSystemId, jumps: 1 }];

  for (const { systemId, jumps } of queue) {
    if (jumps === 3) continue;

    for (const neighbourId of neighbours.get(systemId) ?? []) {
      if (visited.has(neighbourId)) continue;
      visited.add(neighbourId);
      systems.push(neighbourId);
      previewEdges.push([systemId, neighbourId]);
      queue.push({ systemId: neighbourId, jumps: jumps + 1 });
    }
  }

  return { systems, edges: previewEdges };
}

function addNeighbour(neighbours: Map<number, number[]>, systemId: number, neighbourId: number): void {
  const existing = neighbours.get(systemId) ?? [];
  if (!existing.includes(neighbourId)) existing.push(neighbourId);
  existing.sort((left, right) => left - right);
  neighbours.set(systemId, existing);
}
