import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef } from "react";
import { shouldDeferToNativeTextEditing } from "../../hooks/keyboardShortcutRouting.js";
import { NodeDirection, NodePosition, clamp, snapToGrid } from "./shared.js";

export type NodeMapScreenPoint = { x: number; y: number };
export type NodeMapScreenRect = { minX: number; maxX: number; minY: number; maxY: number };

const EPSILON = 0.000001;
const CLICK_DRAG_THRESHOLD_PX = 4;
export const NODE_MAP_CLIPBOARD_STORAGE_KEY = "mangorts:node-map-clipboard-v1";

const pointInRect = (point: NodeMapScreenPoint, rect: NodeMapScreenRect) => (
  point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY
);

const orientation = (a: NodeMapScreenPoint, b: NodeMapScreenPoint, c: NodeMapScreenPoint) => {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < EPSILON) return 0;
  return value > 0 ? 1 : 2;
};

const onSegment = (a: NodeMapScreenPoint, b: NodeMapScreenPoint, c: NodeMapScreenPoint) => (
  b.x <= Math.max(a.x, c.x) + EPSILON &&
  b.x + EPSILON >= Math.min(a.x, c.x) &&
  b.y <= Math.max(a.y, c.y) + EPSILON &&
  b.y + EPSILON >= Math.min(a.y, c.y)
);

const segmentsIntersect = (a1: NodeMapScreenPoint, a2: NodeMapScreenPoint, b1: NodeMapScreenPoint, b2: NodeMapScreenPoint) => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
};

// Node-map relationship line segment hit-test against the current multi-select box rectangle.
export const segmentIntersectsRect = (from: NodeMapScreenPoint, to: NodeMapScreenPoint, rect: NodeMapScreenRect) => {
  if (pointInRect(from, rect) || pointInRect(to, rect)) return true;

  if (Math.max(from.x, to.x) < rect.minX || Math.min(from.x, to.x) > rect.maxX) return false;
  if (Math.max(from.y, to.y) < rect.minY || Math.min(from.y, to.y) > rect.maxY) return false;

  const topLeft = { x: rect.minX, y: rect.minY };
  const topRight = { x: rect.maxX, y: rect.minY };
  const bottomLeft = { x: rect.minX, y: rect.maxY };
  const bottomRight = { x: rect.maxX, y: rect.maxY };

  return (
    segmentsIntersect(from, to, topLeft, topRight) ||
    segmentsIntersect(from, to, topRight, bottomRight) ||
    segmentsIntersect(from, to, bottomRight, bottomLeft) ||
    segmentsIntersect(from, to, bottomLeft, topLeft)
  );
};

// Full relationship path hit-test against the active multi-select box rectangle.
export const pathIntersectsRect = (points: NodeMapScreenPoint[], rect: NodeMapScreenRect) => {
  if (points.length < 2) return false;
  for (let i = 1; i < points.length; i += 1) {
    if (segmentIntersectsRect(points[i - 1], points[i], rect)) return true;
  }
  return false;
};

export type NodeMapDragState = {
  nodeIDs: string[];
  pointerID: number;
  offsets: Record<string, { x: number; y: number }>;
  startMouseX?: number;
  startMouseY?: number;
  clearSelectionOnClick?: boolean;
};

export type NodeMapPanState = {
  pointerID: number;
  startMouseX: number;
  startMouseY: number;
  startPanX: number;
  startPanY: number;
  clearSelectionOnClick?: boolean;
};

export type NodeMapMultiSelectBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
  additive: boolean;
};

export type NodeMapRelationshipPath = {
  id: string;
  points: Array<{ x: number; y: number }>;
};

export type NodeMapClipboardKind = "node" | "logic_gate";

export type NodeMapClipboardPayload = {
  kind: NodeMapClipboardKind;
  nodes: Array<{ oldID: string; title: string; x: number; y: number; w: number; h: number }>;
  relationships: Array<{
    oldID: string;
    nodeIDA: string;
    nodeIDB: string;
    aPosition: string;
    bPosition: string;
    anchor?: { from: NodeDirection; to: NodeDirection };
  }>;
};

function nodeMapClipboardLabel(kind: NodeMapClipboardKind, node: { node_id: string; name?: string; title?: string; header?: string }): string {
  const label = kind === "node" ? node.name : node.header || node.title;
  return (label || node.node_id).trim() || node.node_id;
}

export function buildNodeMapClipboardPayload<TNode extends { node_id: string; name?: string; title?: string; header?: string }, TRelationship extends { node_relationship_id: string; node_id_a: string; node_id_b: string; a_position: string; b_position: string }>(input: {
  kind: NodeMapClipboardKind;
  nodes: TNode[];
  relationships: TRelationship[];
  nodePositions: Record<string, NodePosition>;
  nodeSizes: Record<string, { w: number; h: number }>;
  relationshipAnchors: Record<string, { from: NodeDirection; to: NodeDirection }>;
  selectedNodeID: string;
  selectedNodeIDs: Set<string>;
}): NodeMapClipboardPayload | null {
  const selectedIDs = input.selectedNodeIDs.size > 0
    ? new Set(input.selectedNodeIDs)
    : (input.selectedNodeID ? new Set([input.selectedNodeID]) : new Set<string>());
  if (selectedIDs.size === 0) return null;

  const copiedNodes = input.nodes
    .filter((node) => selectedIDs.has(node.node_id))
    .map((node) => {
      const position = input.nodePositions[node.node_id] ?? { x: 0, y: 0 };
      const size = input.nodeSizes[node.node_id] ?? { w: 148, h: 96 };
      return {
        oldID: node.node_id,
        title: nodeMapClipboardLabel(input.kind, node),
        x: snapToGrid(position.x),
        y: snapToGrid(position.y),
        w: snapToGrid(size.w),
        h: snapToGrid(size.h),
      };
    });
  if (copiedNodes.length === 0) return null;

  const copiedIDSet = new Set(copiedNodes.map((node) => node.oldID));
  const copiedRelationships = input.relationships
    .filter((relationship) => copiedIDSet.has(relationship.node_id_a) && copiedIDSet.has(relationship.node_id_b))
    .map((relationship) => ({
      oldID: relationship.node_relationship_id,
      nodeIDA: relationship.node_id_a,
      nodeIDB: relationship.node_id_b,
      aPosition: relationship.a_position,
      bPosition: relationship.b_position,
      anchor: input.relationshipAnchors[relationship.node_relationship_id],
    }));

  return { kind: input.kind, nodes: copiedNodes, relationships: copiedRelationships };
}
export function parseNodeMapClipboardPayload(raw: string | null | undefined): NodeMapClipboardPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NodeMapClipboardPayload;
    if (parsed.kind !== "node" && parsed.kind !== "logic_gate") return null;
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0 || !Array.isArray(parsed.relationships)) return null;
    const nodes = parsed.nodes
      .map((node) => ({
        oldID: typeof node.oldID === "string" ? node.oldID.trim() : "",
        title: typeof node.title === "string" ? node.title.trim() : "",
        x: Number(node.x),
        y: Number(node.y),
        w: Number(node.w),
        h: Number(node.h),
      }))
      .filter((node) => node.oldID && node.title && Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.w) && Number.isFinite(node.h));
    if (nodes.length === 0) return null;
    const nodeIDs = new Set(nodes.map((node) => node.oldID));
    const relationships = parsed.relationships
      .map((relationship) => ({
        oldID: typeof relationship.oldID === "string" ? relationship.oldID.trim() : "",
        nodeIDA: typeof relationship.nodeIDA === "string" ? relationship.nodeIDA.trim() : "",
        nodeIDB: typeof relationship.nodeIDB === "string" ? relationship.nodeIDB.trim() : "",
        aPosition: typeof relationship.aPosition === "string" ? relationship.aPosition.trim() : "",
        bPosition: typeof relationship.bPosition === "string" ? relationship.bPosition.trim() : "",
        anchor: relationship.anchor,
      }))
      .filter((relationship) => relationship.oldID && nodeIDs.has(relationship.nodeIDA) && nodeIDs.has(relationship.nodeIDB) && relationship.aPosition && relationship.bPosition);
    return { kind: parsed.kind, nodes, relationships };
  } catch {
    return null;
  }
}

export function beginNodeMapMultiSelectSession(
  viewportElement: HTMLDivElement | null,
  pointerID: number,
  clientX: number,
  clientY: number,
  additive: boolean,
): { pointerID: number; multiSelectBox: NodeMapMultiSelectBox } | null {
  if (!viewportElement) return null;
  const bounds = viewportElement.getBoundingClientRect();
  const localX = clamp(clientX - bounds.left, 0, bounds.width);
  const localY = clamp(clientY - bounds.top, 0, bounds.height);
  return {
    pointerID,
    multiSelectBox: { startX: localX, startY: localY, currentX: localX, currentY: localY, active: true, additive },
  };
}

export function computeNodeMapMultiSelectResult(input: {
  nodes: Array<{ node_id: string }>;
  nodePositions: Record<string, NodePosition>;
  relationshipPaths: NodeMapRelationshipPath[];
  multiSelectBox: NodeMapMultiSelectBox;
  zoom: number;
  pan: { x: number; y: number };
  nodeWidth: number;
  nodeHeight: number;
}): { selectedNodeIDs: Set<string>; selectedRelationshipIDs: Set<string> } {
  const minX = Math.min(input.multiSelectBox.startX, input.multiSelectBox.currentX);
  const maxX = Math.max(input.multiSelectBox.startX, input.multiSelectBox.currentX);
  const minY = Math.min(input.multiSelectBox.startY, input.multiSelectBox.currentY);
  const maxY = Math.max(input.multiSelectBox.startY, input.multiSelectBox.currentY);
  const selectedNodeIDs = new Set<string>();

  for (const node of input.nodes) {
    const position = input.nodePositions[node.node_id];
    if (!position) continue;
    const left = position.x * input.zoom + input.pan.x;
    const top = position.y * input.zoom + input.pan.y;
    const right = left + input.nodeWidth * input.zoom;
    const bottom = top + input.nodeHeight * input.zoom;
    const overlaps = right >= minX && left <= maxX && bottom >= minY && top <= maxY;
    if (overlaps) selectedNodeIDs.add(node.node_id);
  }

  const rect = { minX, maxX, minY, maxY };
  const selectedRelationshipIDs = new Set(
    input.relationshipPaths
      .filter((path) => pathIntersectsRect(path.points.map((point) => ({
        x: point.x * input.zoom + input.pan.x,
        y: point.y * input.zoom + input.pan.y,
      })), rect))
      .map((path) => path.id),
  );

  return { selectedNodeIDs, selectedRelationshipIDs };
}

export function mergeNodeMapMultiSelect(previousSelection: Set<string>, inBoxSelection: Set<string>, additive: boolean): Set<string> {
  if (!additive) return new Set(inBoxSelection);
  const merged = new Set(previousSelection);
  for (const id of inBoxSelection) merged.add(id);
  return merged;
}

export function resolveNodeMapPointerSelection(input: {
  selectedNodeIDs: Set<string>;
  nodeID: string;
  additive: boolean;
}): { selectedNodeIDs: Set<string>; selectedNodeID: string } {
  if (!input.nodeID) return { selectedNodeIDs: new Set(input.selectedNodeIDs), selectedNodeID: "" };
  if (!input.additive) return { selectedNodeIDs: new Set([input.nodeID]), selectedNodeID: input.nodeID };

  const next = new Set(input.selectedNodeIDs);
  if (next.has(input.nodeID)) next.delete(input.nodeID);
  else next.add(input.nodeID);
  return { selectedNodeIDs: next, selectedNodeID: next.has(input.nodeID) ? input.nodeID : (Array.from(next)[0] ?? "") };
}

export function resolveNodeMapDragStartSelection(input: {
  selectedNodeIDs: Set<string>;
  selectedNodeID: string;
  nodeID: string;
}): { selectedNodeIDs: Set<string>; selectedNodeID: string; dragNodeIDs: string[]; clearSelectionOnClick: boolean } {
  const clickedSelectedBatch = input.selectedNodeIDs.size > 1 && input.selectedNodeIDs.has(input.nodeID);
  if (clickedSelectedBatch) {
    const dragNodeIDs = Array.from(input.selectedNodeIDs);
    return {
      selectedNodeIDs: new Set(input.selectedNodeIDs),
      selectedNodeID: input.selectedNodeID || dragNodeIDs[0] || input.nodeID,
      dragNodeIDs,
      clearSelectionOnClick: false,
    };
  }

  const nextSelection = resolveNodeMapPointerSelection({ selectedNodeIDs: input.selectedNodeIDs, nodeID: input.nodeID, additive: false });
  return {
    selectedNodeIDs: nextSelection.selectedNodeIDs,
    selectedNodeID: nextSelection.selectedNodeID,
    dragNodeIDs: Array.from(nextSelection.selectedNodeIDs),
    clearSelectionOnClick: false,
  };
}

export function shouldTreatNodeMapGestureAsClick(input: {
  startMouseX: number;
  startMouseY: number;
  endMouseX: number;
  endMouseY: number;
  thresholdPx?: number;
}): boolean {
  const threshold = input.thresholdPx ?? CLICK_DRAG_THRESHOLD_PX;
  const dx = input.endMouseX - input.startMouseX;
  const dy = input.endMouseY - input.startMouseY;
  return dx * dx + dy * dy <= threshold * threshold;
}

export function resolveNodeMapBlankCanvasSelection(input: {
  selectedNodeID: string;
  selectedNodeIDs: Set<string>;
  selectedRelationshipIDs: Set<string>;
}): { selectedNodeID: string; selectedNodeIDs: Set<string>; selectedRelationshipIDs: Set<string> } {
  const hasBatchSelection = input.selectedNodeIDs.size > 1 || input.selectedRelationshipIDs.size > 0;
  if (hasBatchSelection) {
    return { selectedNodeID: "", selectedNodeIDs: new Set(), selectedRelationshipIDs: new Set() };
  }

  // A plain blank-canvas click is also the pan gesture start. Keep a single
  // entity selected so linked Editors do not lose their detail context while
  // still normalizing the selection set for later drag/delete commands.
  const retainedNodeID = input.selectedNodeID || Array.from(input.selectedNodeIDs)[0] || "";
  return {
    selectedNodeID: retainedNodeID,
    selectedNodeIDs: retainedNodeID ? new Set([retainedNodeID]) : new Set(),
    selectedRelationshipIDs: new Set(),
  };
}

export function shouldIgnoreMapDeleteKeyTarget(target: unknown): boolean {
  return shouldDeferToNativeTextEditing(target);
}

export function resolveNodeMapDeleteSelection(input: {
  selectedNodeID: string;
  selectedNodeIDs: Set<string>;
  selectedRelationshipIDs: Set<string>;
}): { nodeIDs: string[]; relationshipIDs: string[] } {
  const relationshipIDs = Array.from(input.selectedRelationshipIDs);
  const nodeIDs = input.selectedNodeIDs.size > 0 ? Array.from(input.selectedNodeIDs) : (input.selectedNodeID ? [input.selectedNodeID] : []);
  return { nodeIDs, relationshipIDs };
}

export function useNodeMapMultiSelectControls(input: {
  selectionPointerID: number | null;
  multiSelectBox: NodeMapMultiSelectBox;
  multiSelectBoxRef: MutableRefObject<NodeMapMultiSelectBox>;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  nodes: Array<{ node_id: string }>;
  nodePositions: Record<string, NodePosition>;
  relationshipPathsRef: MutableRefObject<NodeMapRelationshipPath[]>;
  zoom: number;
  pan: { x: number; y: number };
  nodeWidth: number;
  nodeHeight: number;
  selectedNodeIDs: Set<string>;
  selectedRelationshipIDs: Set<string>;
  selectedNodeID: string;
  setSelectedNodeIDs: Dispatch<SetStateAction<Set<string>>>;
  setSelectedRelationshipIDs: Dispatch<SetStateAction<Set<string>>>;
  setSelectedNodeID: Dispatch<SetStateAction<string>>;
  setSelectionPointerID: Dispatch<SetStateAction<number | null>>;
  setMultiSelectBox: Dispatch<SetStateAction<NodeMapMultiSelectBox>>;
}) {
  useEffect(() => {
    input.multiSelectBoxRef.current = input.multiSelectBox;
  }, [input.multiSelectBox, input.multiSelectBoxRef]);

  useEffect(() => {
    if (input.selectionPointerID === null || !input.multiSelectBox.active) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== input.selectionPointerID) return;
      if (!input.viewportRef.current) return;
      const bounds = input.viewportRef.current.getBoundingClientRect();
      const currentX = clamp(event.clientX - bounds.left, 0, bounds.width);
      const currentY = clamp(event.clientY - bounds.top, 0, bounds.height);
      input.setMultiSelectBox((previous) => {
        const next = { ...previous, currentX, currentY };
        input.multiSelectBoxRef.current = next;
        return next;
      });
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== input.selectionPointerID) return;
      const activeBox = input.multiSelectBoxRef.current;
      const multiSelectResult = computeNodeMapMultiSelectResult({
        nodes: input.nodes,
        nodePositions: input.nodePositions,
        relationshipPaths: input.relationshipPathsRef.current,
        multiSelectBox: activeBox,
        zoom: input.zoom,
        pan: input.pan,
        nodeWidth: input.nodeWidth,
        nodeHeight: input.nodeHeight,
      });
      const mergedNodeIDs = mergeNodeMapMultiSelect(input.selectedNodeIDs, multiSelectResult.selectedNodeIDs, activeBox.additive);
      const mergedRelationshipIDs = mergeNodeMapMultiSelect(input.selectedRelationshipIDs, multiSelectResult.selectedRelationshipIDs, activeBox.additive);
      input.setSelectedNodeIDs(mergedNodeIDs);
      input.setSelectedRelationshipIDs(mergedRelationshipIDs);
      const [firstSelectedNodeID] = mergedNodeIDs;
      input.setSelectedNodeID(mergedNodeIDs.size === 1 && mergedRelationshipIDs.size === 0 ? firstSelectedNodeID ?? "" : "");
      input.setSelectionPointerID(null);
      const idleBox = { ...activeBox, active: false, additive: false };
      input.multiSelectBoxRef.current = idleBox;
      input.setMultiSelectBox(idleBox);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [input]);
}

export function useNodeMapDragControls(input: {
  dragState: NodeMapDragState | null;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  pan: { x: number; y: number };
  zoom: number;
  worldWidth: number;
  worldHeight: number;
  nodeWidth: number;
  nodeHeight: number;
  setNodePositions: Dispatch<SetStateAction<Record<string, NodePosition>>>;
  setDragState: Dispatch<SetStateAction<NodeMapDragState | null>>;
  setSelectedNodeID?: Dispatch<SetStateAction<string>>;
  setSelectedNodeIDs?: Dispatch<SetStateAction<Set<string>>>;
  setSelectedRelationshipIDs?: Dispatch<SetStateAction<Set<string>>>;
}) {
  useEffect(() => {
    if (!input.dragState) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== input.dragState?.pointerID || !input.viewportRef.current) return;
      const bounds = input.viewportRef.current.getBoundingClientRect();
      const mouseX = event.clientX - bounds.left;
      const mouseY = event.clientY - bounds.top;
      input.setNodePositions((previous) => {
        const next = { ...previous };
        for (const nodeID of input.dragState?.nodeIDs ?? []) {
          const offset = input.dragState?.offsets[nodeID];
          if (!offset) continue;
          const worldX = (mouseX - input.pan.x) / input.zoom - offset.x;
          const worldY = (mouseY - input.pan.y) / input.zoom - offset.y;
          next[nodeID] = {
            x: clamp(snapToGrid(worldX), 0, input.worldWidth - input.nodeWidth),
            y: clamp(snapToGrid(worldY), 0, input.worldHeight - input.nodeHeight),
          };
        }
        return next;
      });
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== input.dragState?.pointerID) return;
      if (input.dragState.clearSelectionOnClick && typeof input.dragState.startMouseX === "number" && typeof input.dragState.startMouseY === "number") {
        const isClick = shouldTreatNodeMapGestureAsClick({
          startMouseX: input.dragState.startMouseX,
          startMouseY: input.dragState.startMouseY,
          endMouseX: event.clientX,
          endMouseY: event.clientY,
        });
        if (isClick) {
          input.setSelectedNodeID?.("");
          input.setSelectedNodeIDs?.(new Set());
          input.setSelectedRelationshipIDs?.(new Set());
        }
      }
      input.setDragState(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [input]);
}

export function useNodeMapPanControls(input: {
  panState: NodeMapPanState | null;
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  setPanState: Dispatch<SetStateAction<NodeMapPanState | null>>;
  setSelectedNodeID?: Dispatch<SetStateAction<string>>;
  setSelectedNodeIDs?: Dispatch<SetStateAction<Set<string>>>;
  setSelectedRelationshipIDs?: Dispatch<SetStateAction<Set<string>>>;
}) {
  useEffect(() => {
    if (!input.panState) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== input.panState?.pointerID) return;
      const dx = event.clientX - (input.panState?.startMouseX ?? 0);
      const dy = event.clientY - (input.panState?.startMouseY ?? 0);
      input.setPan({ x: (input.panState?.startPanX ?? 0) + dx, y: (input.panState?.startPanY ?? 0) + dy });
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== input.panState?.pointerID) return;
      if (input.panState.clearSelectionOnClick) {
        const isClick = shouldTreatNodeMapGestureAsClick({
          startMouseX: input.panState.startMouseX,
          startMouseY: input.panState.startMouseY,
          endMouseX: event.clientX,
          endMouseY: event.clientY,
        });
        if (isClick) {
          input.setSelectedNodeID?.("");
          input.setSelectedNodeIDs?.(new Set());
          input.setSelectedRelationshipIDs?.(new Set());
        }
      }
      input.setPanState(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [input]);
}

export function useNodeMapRelationshipDraftControls(input: {
  relationshipDraft: { sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  pan: { x: number; y: number };
  zoom: number;
  worldWidth: number;
  worldHeight: number;
  setRelationshipDraft: Dispatch<SetStateAction<{ sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null>>;
  setSelectedRelationshipIDs: Dispatch<SetStateAction<Set<string>>>;
}) {
  useEffect(() => {
    if (!input.relationshipDraft) return;
    const onMove = (event: PointerEvent) => {
      if (!input.viewportRef.current) return;
      const bounds = input.viewportRef.current.getBoundingClientRect();
      const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
      const localY = clamp(event.clientY - bounds.top, 0, bounds.height);
      const worldX = clamp((localX - input.pan.x) / input.zoom, 0, input.worldWidth);
      const worldY = clamp((localY - input.pan.y) / input.zoom, 0, input.worldHeight);
      input.setRelationshipDraft((previous) => (previous ? { ...previous, cursor: { x: worldX, y: worldY } } : previous));
    };

    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [input]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      input.setRelationshipDraft(null);
      input.setSelectedRelationshipIDs(new Set());
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [input]);
}

export function useNodeMapDeleteKeyboardControl(input: {
  canvasActive: boolean;
  selectedNodeID: string;
  selectedNodeIDs: Set<string>;
  selectedRelationshipIDs: Set<string>;
  setConfirmDelete: Dispatch<SetStateAction<{ nodeIDs: string[]; relationshipIDs: string[] } | null>>;
}) {
  const latestInputRef = useRef(input);
  latestInputRef.current = input;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const current = latestInputRef.current;
      const { nodeIDs, relationshipIDs } = resolveNodeMapDeleteSelection(current);
      const hasSelection = relationshipIDs.length > 0 || nodeIDs.length > 0;
      if (!hasSelection) return;

      const target = event.target as HTMLElement | null;
      const hasBatchSelection = current.selectedNodeIDs.size > 1 || current.selectedRelationshipIDs.size > 0;
      if (!hasBatchSelection && shouldIgnoreMapDeleteKeyTarget(target)) return;
      event.preventDefault();
      event.stopPropagation();
      current.setConfirmDelete({ nodeIDs, relationshipIDs });
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
