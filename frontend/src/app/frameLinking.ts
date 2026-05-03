import type { FrameDataModel } from "../types.js";

type LinkableKind = "map" | "editor" | "explorer" | "logic-map" | "kanban";

export const FRAME_LINKS_KEY = "frame-module-links-v1";

export interface FrameLinkEdge {
  a: string;
  b: string;
  mode: "context";
}

export interface LinkPlan {
  edges: FrameLinkEdge[];
}

export function classifyFrameKind(kind: string): LinkableKind | null {
  if (kind === "map") return "map";
  if (kind === "nodes" || kind === "nodes-map") return "map";
  if (kind === "editor" || kind === "node-doc") return "editor";
  if (kind === "company-explorer") return "explorer";
  if (kind === "logic-map") return "logic-map";
  if (kind === "kanban") return "kanban";
  return null;
}

function canonicalEdge(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function edgeKey(a: string, b: string): string {
  const [left, right] = canonicalEdge(a, b);
  return `${left}::${right}`;
}

function toAdjacency(edges: FrameLinkEdge[], frameIDs: Set<string>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const id of frameIDs) graph.set(id, new Set());
  for (const edge of edges) {
    if (!frameIDs.has(edge.a) || !frameIDs.has(edge.b)) continue;
    graph.get(edge.a)?.add(edge.b);
    graph.get(edge.b)?.add(edge.a);
  }
  return graph;
}

// Builds the smallest possible frame pool from the active selection/context click.
export function buildLinkPool(args: {
  frames: FrameDataModel[];
  selectedFrameIds: Set<string>;
  selectedFrameId: string | null;
  contextFrameId: string | null;
}): FrameDataModel[] {
  const selected = args.frames.filter((frame) => args.selectedFrameIds.has(frame.id));
  if (selected.length > 0) return selected;
  if (args.selectedFrameId) {
    const fromSelected = args.frames.find((frame) => frame.id === args.selectedFrameId);
    if (fromSelected) return [fromSelected];
  }
  if (args.contextFrameId) {
    const fromContext = args.frames.find((frame) => frame.id === args.contextFrameId);
    if (fromContext) return [fromContext];
  }
  return [];
}

// Resolves link writes into pairwise context edges. This allows new module kinds to join linking
// without hardcoding one canonical "hub" module.
export function computeLinkPlan(pool: FrameDataModel[]): LinkPlan | null {
  if (pool.length < 2) return null;
  const eligible = pool.filter((frame) => classifyFrameKind(frame.kind) !== null);
  if (eligible.length < 2) return null;
  const edges: FrameLinkEdge[] = [];
  for (let i = 0; i < eligible.length - 1; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      edges.push({ a: eligible[i].id, b: eligible[j].id, mode: "context" });
    }
  }
  return { edges };
}

export function buildLinkModulesLabel(pool: FrameDataModel[], linkPlan: LinkPlan | null) {
  if (pool.length <= 1) return "No other module selected";
  if (!linkPlan) return "Select two or more linkable modules";
  return pool.map((frame) => frame.title).join(" + ");
}

export function mergeLinkPlan(current: FrameLinkEdge[], plan: LinkPlan | null): FrameLinkEdge[] {
  if (!plan || plan.edges.length === 0) return current;
  const next = [...current];
  const seen = new Set(current.map((edge) => edgeKey(edge.a, edge.b)));
  for (const edge of plan.edges) {
    const key = edgeKey(edge.a, edge.b);
    if (seen.has(key) || edge.a === edge.b) continue;
    const [a, b] = canonicalEdge(edge.a, edge.b);
    next.push({ a, b, mode: edge.mode });
    seen.add(key);
  }
  return next;
}

// Removes links touching the selected/context frame pool.
export function delinkForPool(pool: FrameDataModel[], edges: FrameLinkEdge[]) {
  if (pool.length === 0) return { nextEdges: edges, changed: false };
  const ids = new Set(pool.map((frame) => frame.id));
  const nextEdges = edges.filter((edge) => !ids.has(edge.a) && !ids.has(edge.b));
  return { nextEdges, changed: nextEdges.length !== edges.length };
}

export function resolveLinkedFrameByKind(args: {
  startFrameID: string;
  targetKind: LinkableKind;
  frames: FrameDataModel[];
  edges: FrameLinkEdge[];
}): string {
  const { startFrameID, targetKind, frames, edges } = args;
  const frameByID = new Map(frames.map((frame) => [frame.id, frame]));
  const frameIDs = new Set(frameByID.keys());
  if (!frameByID.has(startFrameID)) return "";
  const graph = toAdjacency(edges, frameIDs);
  const visited = new Set<string>([startFrameID]);
  const queue: string[] = [startFrameID];
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    for (const neighbor of graph.get(current) ?? []) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      const candidate = frameByID.get(neighbor);
      if (candidate && classifyFrameKind(candidate.kind) === targetKind) return neighbor;
      queue.push(neighbor);
    }
  }
  return "";
}

export function deriveLegacyMapLinks(frames: FrameDataModel[], edges: FrameLinkEdge[]) {
  const editorLinks: Record<string, string> = {};
  const explorerLinks: Record<string, string> = {};
  for (const frame of frames) {
    const kind = classifyFrameKind(frame.kind);
    if (kind === "editor") {
      const mapID = resolveLinkedFrameByKind({
        startFrameID: frame.id,
        targetKind: "map",
        frames,
        edges,
      });
      if (mapID) editorLinks[frame.id] = mapID;
    }
    if (kind === "explorer") {
      const mapID = resolveLinkedFrameByKind({
        startFrameID: frame.id,
        targetKind: "map",
        frames,
        edges,
      });
      if (mapID) explorerLinks[frame.id] = mapID;
    }
  }
  return { editorLinks, explorerLinks };
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
    next.push({
      a,
      b,
      mode: candidate.mode === "context" ? "context" : "context",
    });
  }
  return next;
}
