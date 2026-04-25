import type { FrameDataModel } from "../types.js";

type LinkableKind = "map" | "editor" | "explorer";

export interface LinkPlan {
  mapFrameID: string;
  editorFrameIDs: string[];
  explorerFrameIDs: string[];
}

function classifyFrameKind(kind: string): LinkableKind | null {
  if (kind === "nodes" || kind === "nodes-map") return "map";
  if (kind === "editor" || kind === "node-doc") return "editor";
  if (kind === "company-explorer") return "explorer";
  return null;
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

// Resolves link writes using explicit Node Map selection first, then existing links as fallback.
export function computeLinkPlan(
  pool: FrameDataModel[],
  editorLinks: Record<string, string>,
  explorerLinks: Record<string, string>,
): LinkPlan | null {
  if (pool.length < 2) return null;

  const maps = pool.filter((frame) => classifyFrameKind(frame.kind) === "map");
  const editors = pool.filter((frame) => classifyFrameKind(frame.kind) === "editor");
  const explorers = pool.filter((frame) => classifyFrameKind(frame.kind) === "explorer");
  if (editors.length + explorers.length === 0) return null;

  let mapFrameID = maps.length === 1 ? maps[0].id : "";
  if (!mapFrameID) {
    const fallbackCandidates = new Set<string>();
    for (const frame of editors) {
      if (editorLinks[frame.id]) fallbackCandidates.add(editorLinks[frame.id]);
    }
    for (const frame of explorers) {
      if (explorerLinks[frame.id]) fallbackCandidates.add(explorerLinks[frame.id]);
    }
    if (fallbackCandidates.size === 1) mapFrameID = Array.from(fallbackCandidates)[0] ?? "";
  }
  if (!mapFrameID) return null;

  return {
    mapFrameID,
    editorFrameIDs: editors.map((frame) => frame.id),
    explorerFrameIDs: explorers.map((frame) => frame.id),
  };
}

export function buildLinkModulesLabel(pool: FrameDataModel[], linkPlan: LinkPlan | null) {
  if (pool.length <= 1) return "No other module selected";
  if (!linkPlan) return "Select one Node Map + one/more Editor or Company Explorer";
  return pool.map((frame) => frame.title).join(" + ");
}

// Removes links touching the selected/context frame pool.
export function delinkForPool(
  pool: FrameDataModel[],
  editorLinks: Record<string, string>,
  explorerLinks: Record<string, string>,
) {
  if (pool.length === 0) return { nextEditorLinks: editorLinks, nextExplorerLinks: explorerLinks, changed: false };
  const ids = new Set(pool.map((frame) => frame.id));

  let changed = false;
  const nextEditorLinks: Record<string, string> = {};
  for (const [editorID, mapID] of Object.entries(editorLinks)) {
    if (ids.has(editorID) || ids.has(mapID)) {
      changed = true;
      continue;
    }
    nextEditorLinks[editorID] = mapID;
  }

  const nextExplorerLinks: Record<string, string> = {};
  for (const [explorerID, mapID] of Object.entries(explorerLinks)) {
    if (ids.has(explorerID) || ids.has(mapID)) {
      changed = true;
      continue;
    }
    nextExplorerLinks[explorerID] = mapID;
  }

  return { nextEditorLinks, nextExplorerLinks, changed };
}
