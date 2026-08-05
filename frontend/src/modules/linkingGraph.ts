export type LinkableKind = "editor" | "explorer" | "kanban";

export const FRAME_LINKS_KEY = "frame-module-links-v1";
export const FRAME_REGISTRY_KEY = "frame-module-registry-v1";

export interface FrameLinkEdge {
  a: string;
  b: string;
  mode: "context";
}

export interface FrameRegistryItem {
  kind: string;
}

function canonicalEdge(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function edgeKey(a: string, b: string): string {
  const [left, right] = canonicalEdge(a, b);
  return `${left}::${right}`;
}

export function classifyFrameKind(kind: string): LinkableKind | null {
  if (kind === "editor" || kind === "node-doc") return "editor";
  if (kind === "company-explorer") return "explorer";
  if (kind === "kanban") return "kanban";
  return null;
}

export function sanitizeFrameLinks(value: unknown): FrameLinkEdge[] {
  if (!Array.isArray(value)) return [];
  const next: FrameLinkEdge[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as { a?: unknown; b?: unknown; mode?: unknown };
    if (typeof candidate.a !== "string" || typeof candidate.b !== "string") continue;
    if (candidate.a === candidate.b) continue;
    const [a, b] = canonicalEdge(candidate.a, candidate.b);
    const key = edgeKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ a, b, mode: "context" });
  }
  return next;
}

export function sanitizeFrameRegistry(value: unknown): Record<string, FrameRegistryItem> {
  if (!value || typeof value !== "object") return {};
  const next: Record<string, FrameRegistryItem> = {};
  for (const [id, row] of Object.entries(value)) {
    if (!id || !row || typeof row !== "object") continue;
    const candidate = row as { kind?: unknown };
    if (typeof candidate.kind !== "string") continue;
    next[id] = { kind: candidate.kind };
  }
  return next;
}

export function readFrameLinksFromStorage(): FrameLinkEdge[] {
  try {
    const raw = localStorage.getItem(FRAME_LINKS_KEY);
    if (!raw) return [];
    return sanitizeFrameLinks(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function readFrameRegistryFromStorage(): Record<string, FrameRegistryItem> {
  try {
    const raw = localStorage.getItem(FRAME_REGISTRY_KEY);
    if (!raw) return {};
    return sanitizeFrameRegistry(JSON.parse(raw));
  } catch {
    return {};
  }
}

function toAdjacency(edges: FrameLinkEdge[], knownFrameIDs: Set<string>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const id of knownFrameIDs) graph.set(id, new Set());
  for (const edge of edges) {
    if (!knownFrameIDs.has(edge.a) || !knownFrameIDs.has(edge.b)) continue;
    graph.get(edge.a)?.add(edge.b);
    graph.get(edge.b)?.add(edge.a);
  }
  return graph;
}

export function resolveLinkedFrameByKindFromGraph(args: {
  startFrameID: string;
  targetKind: LinkableKind;
  edges: FrameLinkEdge[];
  registry: Record<string, FrameRegistryItem>;
}): string {
  const { startFrameID, targetKind, edges, registry } = args;
  const frameIDs = new Set(Object.keys(registry));
  if (!frameIDs.has(startFrameID)) return "";
  const graph = toAdjacency(edges, frameIDs);
  const visited = new Set<string>([startFrameID]);
  const queue: string[] = [startFrameID];
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    for (const neighbor of graph.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      const kind = classifyFrameKind(registry[neighbor]?.kind ?? "");
      if (kind === targetKind) return neighbor;
      queue.push(neighbor);
    }
  }
  return "";
}

export function resolveDirectLinkedTargets(args: {
  sourceFrameID: string;
  edges: FrameLinkEdge[];
}): string[] {
  const targets = new Set<string>();
  for (const edge of args.edges) {
    if (edge.a === args.sourceFrameID) targets.add(edge.b);
    if (edge.b === args.sourceFrameID) targets.add(edge.a);
  }
  return Array.from(targets);
}

export function resolveConnectedFrameTargets(args: {
  sourceFrameID: string;
  edges: FrameLinkEdge[];
  registry: Record<string, FrameRegistryItem>;
}): string[] {
  const frameIDs = new Set(Object.keys(args.registry));
  if (!frameIDs.has(args.sourceFrameID)) return [];
  const graph = toAdjacency(args.edges, frameIDs);
  const visited = new Set<string>([args.sourceFrameID]);
  const queue: string[] = [args.sourceFrameID];
  const targets: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    for (const neighbor of graph.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      targets.push(neighbor);
      queue.push(neighbor);
    }
  }
  return targets;
}
