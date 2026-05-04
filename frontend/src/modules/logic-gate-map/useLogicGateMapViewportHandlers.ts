import type React from "react";
import { clamp, type NodeDirection } from "./shared";
import type { NodeMapPanState } from "../node-map/NodeMapControls";
import type {
  LogicGateMapCanvasContextMenuState,
  LogicGateMapNodeContextMenuState,
  LogicGateMapRelationshipContextMenuState,
} from "./LogicGateMapContextMenus";

export type LogicGateMapViewportHandlers = {
  onContextMenu: React.MouseEventHandler<HTMLDivElement>;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
};

type UseLogicGateMapViewportHandlersOptions = {
  viewportRef: React.RefObject<HTMLDivElement>;
  pan: { x: number; y: number };
  zoom: number;
  worldWidth: number;
  worldHeight: number;
  relationshipDraft: { sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null;
  selectedNodeIDs: Set<string>;
  selectedRelationshipIDs: Set<string>;
  startNodeMapMultiSelect: (pointerID: number, clientX: number, clientY: number, additive: boolean) => void;
  setCanvasActive: React.Dispatch<React.SetStateAction<boolean>>;
  setContextMenu: React.Dispatch<React.SetStateAction<LogicGateMapCanvasContextMenuState | null>>;
  setNodeContextMenu: React.Dispatch<React.SetStateAction<LogicGateMapNodeContextMenuState | null>>;
  setRelationshipContextMenu: React.Dispatch<React.SetStateAction<LogicGateMapRelationshipContextMenuState | null>>;
  setRelationshipDraft: React.Dispatch<React.SetStateAction<{ sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null>>;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  setPan: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  setPanState: React.Dispatch<React.SetStateAction<NodeMapPanState | null>>;
};

export function useLogicGateMapViewportHandlers({
  viewportRef,
  pan,
  zoom,
  worldWidth,
  worldHeight,
  relationshipDraft,
  selectedNodeIDs,
  selectedRelationshipIDs,
  startNodeMapMultiSelect,
  setCanvasActive,
  setContextMenu,
  setNodeContextMenu,
  setRelationshipContextMenu,
  setRelationshipDraft,
  setZoom,
  setPan,
  setPanState,
}: UseLogicGateMapViewportHandlersOptions): LogicGateMapViewportHandlers {
  return {
    onContextMenu(event) {
      event.preventDefault();
      event.stopPropagation();
      setCanvasActive(true);
      setNodeContextMenu(null);
      setRelationshipContextMenu(null);
      if (!viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
      const localY = clamp(event.clientY - bounds.top, 0, bounds.height);
      const worldX = clamp((localX - pan.x) / zoom, 0, worldWidth);
      const worldY = clamp((localY - pan.y) / zoom, 0, worldHeight);
      const menuWidth = 232;
      const menuHeight = 188;
      const clampedX = clamp(localX, 8, Math.max(8, bounds.width - menuWidth - 8));
      const clampedY = clamp(localY, 8, Math.max(8, bounds.height - menuHeight - 8));
      setContextMenu({ x: clampedX, y: clampedY, worldX, worldY });
    },
    onWheel(event) {
      event.preventDefault();
      if (!viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      const cursorX = event.clientX - bounds.left;
      const cursorY = event.clientY - bounds.top;
      const worldX = (cursorX - pan.x) / zoom;
      const worldY = (cursorY - pan.y) / zoom;
      const delta = event.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = clamp(zoom * delta, 0.45, 2.7);
      setZoom(nextZoom);
      setPan({ x: cursorX - worldX * nextZoom, y: cursorY - worldY * nextZoom });
    },
    onPointerDown(event) {
      if (!viewportRef.current) return;
      setCanvasActive(true);
      setContextMenu(null);
      setNodeContextMenu(null);
      setRelationshipContextMenu(null);

      if (event.ctrlKey || event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        startNodeMapMultiSelect(event.pointerId, event.clientX, event.clientY, true);
        return;
      }

      if (relationshipDraft) setRelationshipDraft(null);
      const clearSelectionOnClick = selectedNodeIDs.size > 1 || selectedRelationshipIDs.size > 0;
      setPanState({
        pointerID: event.pointerId,
        startMouseX: event.clientX,
        startMouseY: event.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        clearSelectionOnClick,
      });
    },
  };
}
