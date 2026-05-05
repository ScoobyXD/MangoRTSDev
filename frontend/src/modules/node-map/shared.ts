import React from "react";

// Reusable line-divider style for panel sections in node-map side UI.
export const divider = { borderBottom: "1px solid currentColor", padding: "5px 0" };

// Core node row payload returned by backend APIs and workspace snapshot cache.
export type NodeRecord = {
  company_id: string;
  node_id: string;
  title: string;
  created_timestamp: string;
};

// Runtime-safe node label resolver for hot-path module rendering.
export function getNodeTitle(node: Pick<NodeRecord, "title">): string {
  return trimOrEmpty(node.title || "");
}

// Relationship row payload (a/b sides preserve directional parent/child semantics).
export type NodeRelationship = {
  company_id: string;
  node_relationship_id: string;
  node_id_a: string;
  node_id_b: string;
  a_position: "Parent" | "Child" | "Peer";
  b_position: "Parent" | "Child" | "Peer";
  created_timestamp: string;
};

// Node information row payload; editor module stores text-box document data here.
export type NodeInformation = {
  company_id: string;
  information_id: string;
  node_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

// Combined node details payload consumed by Node Map + Editor + Explorer details panes.
export type NodeDetails = {
  node: NodeRecord;
  information: NodeInformation[];
  relationships: NodeRelationship[];
};

export type NodeDirection = "left" | "right" | "top" | "bottom";
export type PanelEdge = "top" | "right" | "bottom" | "left";
export type NodePosition = { x: number; y: number };
export type RelationshipAnchor = { from: NodeDirection; to: NodeDirection };
export type PersistedMapPosition = {
  entity_id?: string;
  node_id?: string;
  logic_gate_id?: string;
  x: number;
  y: number;
  updated_timestamp?: string;
};

// Persisted node-map viewport + selection state (used for cross-module linking).
export type NodeMapState = {
  zoom: number;
  pan: { x: number; y: number };
  selectedNodeID: string;
  // Legacy cache slot. New browser-cache writes keep this empty because shared
  // map geometry is owned by the map-layout API/database, not localStorage.
  nodePositions: Record<string, NodePosition>;
  relationshipColorsEnabled?: boolean;
  relationshipRoleColors?: { parent: string; peer: string; child: string };
};

// Canonical node information type options mapped to backend enum contract.
export const INFO_TYPES = [
  "Text box",
  "Checklist",
  "Status",
  "Due date",
  "Employee name",
  "PDF",
  "PNG",
  "MOV",
  "Hyperlink",
] as const;

// Shared geometry constants for node cards and mini-grid snapping behavior.
export const NODE_W = 148;
export const NODE_H = 96;
export const MINI_GRID = 12;
export const NODE_MAP_MIN_ZOOM = 0.08;
export const NODE_MAP_MAX_ZOOM = 2.7;
export const SESSION_NODE_MAP_STATE = new Map<string, NodeMapState>();
export const PANEL_MIN_WIDTH = 300;
export const PANEL_MIN_HEIGHT = 220;

// Drag handles for the node details panel move/resize feature.
export const panelResizeHandles: { key: string; edges: Partial<Record<PanelEdge, true>>; cursor: string; style: React.CSSProperties }[] = [
  { key: "top-left", edges: { top: true, left: true }, cursor: "nwse-resize", style: { top: -6, left: -6, width: 12, height: 12 } },
  { key: "top-right", edges: { top: true, right: true }, cursor: "nesw-resize", style: { top: -6, right: -6, width: 12, height: 12 } },
  { key: "bottom-left", edges: { bottom: true, left: true }, cursor: "nesw-resize", style: { bottom: -6, left: -6, width: 12, height: 12 } },
  { key: "bottom-right", edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -6, right: -6, width: 12, height: 12 } },
  { key: "top", edges: { top: true }, cursor: "ns-resize", style: { top: -4, left: 14, right: 14, height: 8 } },
  { key: "bottom", edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -4, left: 14, right: 14, height: 8 } },
  { key: "left", edges: { left: true }, cursor: "ew-resize", style: { left: -4, top: 14, bottom: 14, width: 8 } },
  { key: "right", edges: { right: true }, cursor: "ew-resize", style: { right: -4, top: 14, bottom: 14, width: 8 } },
];

// Input sanitizer helpers used by forms and pointer math throughout node-map modules.
export function trimOrEmpty(value: string): string {
  return value.trim();
}

export function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

export function snapToGrid(value: number): number {
  return Math.round(value / MINI_GRID) * MINI_GRID;
}

function positionKey(position: NodePosition): string {
  return `${snapToGrid(position.x)}:${snapToGrid(position.y)}`;
}

export function resolveOpenNodeMapPosition(input: {
  desired: NodePosition;
  occupied: Record<string, NodePosition>;
  worldWidth: number;
  worldHeight: number;
  nodeWidth: number;
  nodeHeight: number;
  ignoreID?: string;
}): NodePosition {
  const clampPosition = (position: NodePosition) => ({
    x: clamp(snapToGrid(position.x), 0, input.worldWidth - input.nodeWidth),
    y: clamp(snapToGrid(position.y), 0, input.worldHeight - input.nodeHeight),
  });
  const occupiedKeys = new Set<string>();
  for (const [id, position] of Object.entries(input.occupied)) {
    if (id === input.ignoreID || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    occupiedKeys.add(positionKey(position));
  }

  const base = clampPosition(input.desired);
  if (!occupiedKeys.has(positionKey(base))) return base;

  const stepX = Math.max(MINI_GRID, snapToGrid(input.nodeWidth + MINI_GRID * 3));
  const stepY = Math.max(MINI_GRID, snapToGrid(input.nodeHeight + MINI_GRID * 3));
  const maxRadius = Math.max(
    1,
    Math.ceil(input.worldWidth / stepX),
    Math.ceil(input.worldHeight / stepY),
  );

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    const candidates = [
      { x: base.x + stepX * radius, y: base.y },
      { x: base.x, y: base.y + stepY * radius },
      { x: base.x - stepX * radius, y: base.y },
      { x: base.x, y: base.y - stepY * radius },
      { x: base.x + stepX * radius, y: base.y + stepY * radius },
      { x: base.x - stepX * radius, y: base.y + stepY * radius },
      { x: base.x + stepX * radius, y: base.y - stepY * radius },
      { x: base.x - stepX * radius, y: base.y - stepY * radius },
    ];
    for (const candidate of candidates) {
      const position = clampPosition(candidate);
      if (!occupiedKeys.has(positionKey(position))) return position;
    }
  }

  return base;
}

function formatGridNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function plusGridSvgDataURL(input: {
  size: number;
  color: string;
  opacity: number;
  arm: number;
  strokeWidth: number;
}): string {
  const center = input.size / 2;
  const arm = Math.min(input.arm, input.size / 2 - 1);
  const x1 = formatGridNumber(center - arm);
  const x2 = formatGridNumber(center + arm);
  const xCenter = formatGridNumber(center);
  const yCenter = formatGridNumber(center);
  const y1 = formatGridNumber(center - arm);
  const y2 = formatGridNumber(center + arm);
  const strokeWidth = formatGridNumber(input.strokeWidth);
  const size = formatGridNumber(input.size);
  const opacity = formatGridNumber(clamp(input.opacity, 0, 1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><path d="M${x1} ${yCenter}H${x2}M${xCenter} ${y1}V${y2}" fill="none" stroke="${input.color}" stroke-opacity="${opacity}" stroke-width="${strokeWidth}" stroke-linecap="square"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function adaptivePlusGridWorldStep(zoom: number): number {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  let step = 48;
  while (step * safeZoom < 22) step *= 2;
  while (step * safeZoom > 64 && step > MINI_GRID) step /= 2;
  return step;
}

export function buildPlusGridBackgroundStyle(input: {
  zoom: number;
  accent: string;
  theme: "light" | "dark";
}): React.CSSProperties {
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  const minorStep = adaptivePlusGridWorldStep(zoom);
  const majorStep = minorStep * 4;
  const strokeWidth = clamp(1 / zoom, 0.45, 1.4);
  const minorArm = clamp(3.5 / zoom, 1.8, 5.5);
  const majorArm = clamp(5.5 / zoom, 2.6, 7.5);
  const minorColor = input.theme === "dark" ? "#bcecf2" : "#425961";
  const majorColor = input.accent || (input.theme === "dark" ? "#72f1ff" : "#007b88");
  const majorLayerOffset = formatGridNumber((minorStep - majorStep) / 2);

  // The browser repeats two tiny SVG tiles instead of creating thousands of
  // grid DOM nodes. Both plus layers stay visually distinct from relationship lines.
  return {
    backgroundColor: input.theme === "dark" ? "rgba(10, 14, 18, 0.68)" : "rgba(247, 251, 252, 0.82)",
    backgroundImage: [
      plusGridSvgDataURL({ size: minorStep, color: minorColor, opacity: input.theme === "dark" ? 0.28 : 0.24, arm: minorArm, strokeWidth }),
      plusGridSvgDataURL({ size: majorStep, color: majorColor, opacity: input.theme === "dark" ? 0.42 : 0.30, arm: majorArm, strokeWidth }),
    ].join(", "),
    backgroundPosition: `0 0, ${majorLayerOffset}px ${majorLayerOffset}px`,
    backgroundRepeat: "repeat, repeat",
    backgroundSize: `${minorStep}px ${minorStep}px, ${majorStep}px ${majorStep}px`,
  };
}

export function reconcileNodeMapPositions<T extends { node_id: string }>(input: {
  previous: Record<string, NodePosition>;
  nodes: T[];
  canvasWidth: number;
  worldWidth: number;
  worldHeight: number;
  nodeWidth: number;
  nodeHeight: number;
  defaultPosition?: NodePosition;
}): Record<string, NodePosition> {
  if (input.nodes.length === 0) return input.previous;

  let next = input.previous;
  let missingIndex = 0;
  const ensureWritable = () => {
    if (next === input.previous) next = { ...input.previous };
  };

  const missingCount = input.nodes.reduce((count, node) => count + (input.previous[node.node_id] ? 0 : 1), 0);
  const useViewportInsertion = !!input.defaultPosition && missingCount <= 1 && Object.keys(input.previous).length > 0;

  for (const [index, node] of input.nodes.entries()) {
    const existing = input.previous[node.node_id];
    if (existing) {
      const clamped = {
        x: clamp(snapToGrid(existing.x), 0, input.worldWidth - input.nodeWidth),
        y: clamp(snapToGrid(existing.y), 0, input.worldHeight - input.nodeHeight),
      };
      if (clamped.x !== existing.x || clamped.y !== existing.y) {
        ensureWritable();
        next[node.node_id] = clamped;
      }
      continue;
    }

    const perRow = Math.max(1, Math.floor(input.canvasWidth / (input.nodeWidth + 40)));
    // Viewport insertion is for one newly created item. When many nodes become
    // visible after load/remount/folder broadening, use the stable grid instead
    // so a stale pan value cannot pack the whole workspace into the top-left.
    const baseX = useViewportInsertion && input.defaultPosition ? input.defaultPosition.x : 100;
    const baseY = useViewportInsertion && input.defaultPosition ? input.defaultPosition.y : 120;
    const placementIndex = useViewportInsertion ? missingIndex : index;
    const x = snapToGrid((placementIndex % perRow) * (input.nodeWidth + 26) + baseX);
    const y = snapToGrid(Math.floor(placementIndex / perRow) * (input.nodeHeight + 26) + baseY);
    missingIndex += 1;
    ensureWritable();
    next[node.node_id] = resolveOpenNodeMapPosition({
      desired: { x, y },
      occupied: next,
      worldWidth: input.worldWidth,
      worldHeight: input.worldHeight,
      nodeWidth: input.nodeWidth,
      nodeHeight: input.nodeHeight,
    });
  }

  return next;
}

export function persistedMapPositionsToNodePositions(input: {
  positions: PersistedMapPosition[] | undefined;
  worldWidth: number;
  worldHeight: number;
  nodeWidth: number;
  nodeHeight: number;
}): Record<string, NodePosition> {
  const out: Record<string, NodePosition> = {};
  for (const position of input.positions ?? []) {
    const id = position.entity_id || position.node_id || position.logic_gate_id || "";
    if (!id || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    out[id] = {
      x: clamp(snapToGrid(position.x), 0, input.worldWidth - input.nodeWidth),
      y: clamp(snapToGrid(position.y), 0, input.worldHeight - input.nodeHeight),
    };
  }
  return out;
}

export function changedPersistedMapPositions(input: {
  previous: Record<string, NodePosition>;
  current: Record<string, NodePosition>;
  entityIDs?: Set<string>;
}): Array<{ entity_id: string; x: number; y: number }> {
  const changed: Array<{ entity_id: string; x: number; y: number }> = [];
  for (const [entityID, position] of Object.entries(input.current)) {
    if (input.entityIDs && !input.entityIDs.has(entityID)) continue;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    const previous = input.previous[entityID];
    if (previous && previous.x === position.x && previous.y === position.y) continue;
    changed.push({ entity_id: entityID, x: position.x, y: position.y });
  }
  return changed;
}

type KeydownTargetLike = {
  isContentEditable?: boolean;
  closest?: (selector: string) => KeydownTargetLike | null;
};

// Editor canvas key-routing guard:
// key presses from editable controls must never be treated as canvas create-textbox intent.
export function shouldIgnoreCanvasKeydownTarget(target: KeydownTargetLike | null | undefined): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest?.("[contenteditable='true'], textarea, input"));
}

// Relationship anchor helper for opposite-side calculations.
export function oppositeSide(direction: NodeDirection): NodeDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

// Editor box model used in module-local render state.
export type NodeDocBox = { local_id: string; x: number; y: number; w: number; h: number; information_id?: string; information: string };
export const NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX = "node-map-explorer-context-v1";
export const NODE_DOC_MIN_W = 180;
export const NODE_DOC_MIN_H = 36;
