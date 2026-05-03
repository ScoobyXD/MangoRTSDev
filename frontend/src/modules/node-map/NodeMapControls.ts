import { Dispatch, MutableRefObject, SetStateAction, useEffect } from "react";
import { NodeDirection, NodePosition, NodeRecord, PanelEdge, clamp, snapToGrid } from "./shared.js";

export type NodeMapScreenPoint = { x: number; y: number };
export type NodeMapScreenRect = { minX: number; maxX: number; minY: number; maxY: number };

const EPSILON = 0.000001;

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
};

export type NodeMapPanState = {
  pointerID: number;
  startMouseX: number;
  startMouseY: number;
  startPanX: number;
  startPanY: number;
};

export type NodeMapMultiSelectBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
  additive: boolean;
};

export type NodeMapPanelDragState = {
  pointerID: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

export type NodeMapPanelResizeState = {
  pointerID: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  originW: number;
  originH: number;
  edges: Partial<Record<PanelEdge, true>>;
};

export type NodeMapRelationshipPath = {
  id: string;
  points: Array<{ x: number; y: number }>;
};

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
  nodes: NodeRecord[];
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

type DeleteKeyTargetLike = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => DeleteKeyTargetLike | null;
};

export function shouldIgnoreMapDeleteKeyTarget(target: DeleteKeyTargetLike | null | undefined): boolean {
  if (!target) return false;
  const tag = target.tagName ?? "";
  if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return true;
  return Boolean(target.closest?.("[contenteditable='true'], textarea, input"));
}

export function useNodeMapMultiSelectControls(input: {
  selectionPointerID: number | null;
  multiSelectBox: NodeMapMultiSelectBox;
  multiSelectBoxRef: MutableRefObject<NodeMapMultiSelectBox>;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  nodes: NodeRecord[];
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
      const [firstSelectedNodeID] = multiSelectResult.selectedNodeIDs;
      input.setSelectedNodeID(firstSelectedNodeID ?? (activeBox.additive ? input.selectedNodeID : ""));
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
      if (event.pointerId === input.dragState?.pointerID) input.setDragState(null);
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
      if (event.pointerId === input.panState?.pointerID) input.setPanState(null);
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const relationshipIDs = Array.from(input.selectedRelationshipIDs);
      const nodeIDs = input.selectedNodeIDs.size > 0 ? Array.from(input.selectedNodeIDs) : (input.selectedNodeID ? [input.selectedNodeID] : []);
      const hasSelection = relationshipIDs.length > 0 || nodeIDs.length > 0;
      if (!hasSelection) return;

      const target = event.target as HTMLElement | null;
      if (shouldIgnoreMapDeleteKeyTarget(target)) return;
      event.preventDefault();
      event.stopPropagation();
      input.setConfirmDelete({ nodeIDs, relationshipIDs });
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [input]);
}

export function useNodeMapPanelControls(input: {
  panelDrag: NodeMapPanelDragState | null;
  panelResize: NodeMapPanelResizeState | null;
  panelRect: { x: number; y: number; width: number; height: number };
  panelMinWidth: number;
  panelMinHeight: number;
  viewportRef: MutableRefObject<HTMLDivElement | null>;
  setPanelDrag: Dispatch<SetStateAction<NodeMapPanelDragState | null>>;
  setPanelResize: Dispatch<SetStateAction<NodeMapPanelResizeState | null>>;
  setPanelRect: Dispatch<SetStateAction<{ x: number; y: number; width: number; height: number }>>;
}) {
  useEffect(() => {
    if (!input.panelDrag) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== input.panelDrag?.pointerID || !input.viewportRef.current) return;
      const dx = event.clientX - (input.panelDrag?.startX ?? 0);
      const dy = event.clientY - (input.panelDrag?.startY ?? 0);
      const bounds = input.viewportRef.current.getBoundingClientRect();
      const maxX = Math.max(0, bounds.width - input.panelRect.width - 8);
      const maxY = Math.max(0, bounds.height - 56);
      input.setPanelRect((previous) => ({ ...previous, x: clamp((input.panelDrag?.originX ?? 0) + dx, 0, maxX), y: clamp((input.panelDrag?.originY ?? 0) + dy, 8, maxY) }));
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === input.panelDrag?.pointerID) input.setPanelDrag(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [input]);

  useEffect(() => {
    if (!input.panelResize) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== input.panelResize?.pointerID || !input.viewportRef.current) return;
      const bounds = input.viewportRef.current.getBoundingClientRect();
      const dx = event.clientX - (input.panelResize?.startX ?? 0);
      const dy = event.clientY - (input.panelResize?.startY ?? 0);
      const maxX = Math.max(0, bounds.width - 8);
      const maxY = Math.max(8, bounds.height - 8);

      let nextX = input.panelResize?.originX ?? 0;
      let nextY = input.panelResize?.originY ?? 0;
      let nextW = input.panelResize?.originW ?? 0;
      let nextH = input.panelResize?.originH ?? 0;

      if (input.panelResize?.edges.right) nextW = (input.panelResize.originW ?? 0) + dx;
      if (input.panelResize?.edges.bottom) nextH = (input.panelResize.originH ?? 0) + dy;
      if (input.panelResize?.edges.left) {
        nextX = (input.panelResize.originX ?? 0) + dx;
        nextW = (input.panelResize.originW ?? 0) - dx;
      }
      if (input.panelResize?.edges.top) {
        nextY = (input.panelResize.originY ?? 0) + dy;
        nextH = (input.panelResize.originH ?? 0) - dy;
      }

      nextW = clamp(nextW, input.panelMinWidth, maxX);
      nextH = clamp(nextH, input.panelMinHeight, maxY - 8);
      nextX = clamp(nextX, 0, maxX - nextW);
      nextY = clamp(nextY, 8, maxY - nextH);

      if (input.panelResize?.edges.left) nextX = (input.panelResize.originX ?? 0) + ((input.panelResize.originW ?? 0) - nextW);
      if (input.panelResize?.edges.top) nextY = (input.panelResize.originY ?? 0) + ((input.panelResize.originH ?? 0) - nextH);
      nextX = clamp(nextX, 0, maxX - nextW);
      nextY = clamp(nextY, 8, maxY - nextH);

      input.setPanelRect({ x: nextX, y: nextY, width: nextW, height: nextH });
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId === input.panelResize?.pointerID) input.setPanelResize(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [input]);
}
