import type React from "react";
import { clamp, type NodeDirection } from "./shared";
import type {
  NodeMapCanvasContextMenuState,
  NodeMapNodeContextMenuState,
  NodeMapRelationshipContextMenuState,
} from "./NodeMapContextMenus";

export type NodeMapRelationshipHitLinePath = {
  id: string;
  points: { x: number; y: number }[];
};

type NodeMapRelationshipDraft = {
  sourceNodeID: string;
  sourceSide: NodeDirection;
  cursor: { x: number; y: number };
};

type NodeMapRelationshipHitLinesProps = {
  worldWidth: number;
  worldHeight: number;
  paths: NodeMapRelationshipHitLinePath[];
  viewportRef: React.RefObject<HTMLDivElement>;
  suppressNextRelationshipLineClickRef: React.MutableRefObject<boolean>;
  onStartMultiSelect: (pointerID: number, clientX: number, clientY: number, additive: boolean) => void;
  onDeleteRelationships: (relationshipIDs: string[]) => void;
  onSetCanvasActive: React.Dispatch<React.SetStateAction<boolean>>;
  onSetContextMenu: React.Dispatch<React.SetStateAction<NodeMapCanvasContextMenuState | null>>;
  onSetNodeContextMenu: React.Dispatch<React.SetStateAction<NodeMapNodeContextMenuState | null>>;
  onSetRelationshipContextMenu: React.Dispatch<React.SetStateAction<NodeMapRelationshipContextMenuState | null>>;
  onSetRelationshipDraft: React.Dispatch<React.SetStateAction<NodeMapRelationshipDraft | null>>;
  onSetError: React.Dispatch<React.SetStateAction<string>>;
  onSetSelectedNodeID: React.Dispatch<React.SetStateAction<string>>;
  onSetSelectedNodeIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSetSelectedRelationshipIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
};

export const NodeMapRelationshipHitLines: React.FC<NodeMapRelationshipHitLinesProps> = ({
  worldWidth,
  worldHeight,
  paths,
  viewportRef,
  suppressNextRelationshipLineClickRef,
  onStartMultiSelect,
  onDeleteRelationships,
  onSetCanvasActive,
  onSetContextMenu,
  onSetNodeContextMenu,
  onSetRelationshipContextMenu,
  onSetRelationshipDraft,
  onSetError,
  onSetSelectedNodeID,
  onSetSelectedNodeIDs,
  onSetSelectedRelationshipIDs,
}) => {
  return (
    <svg
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "auto", zIndex: 2 }}
      viewBox={`0 0 ${worldWidth} ${worldHeight}`}
    >
      {paths.map((path) => (
        <polyline
          key={path.id}
          points={path.points.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          style={{ cursor: "pointer" }}
          onPointerDown={(event) => {
            event.stopPropagation();
            onSetCanvasActive(true);
            onSetRelationshipContextMenu(null);
            if (event.ctrlKey || event.shiftKey) {
              event.preventDefault();
              suppressNextRelationshipLineClickRef.current = true;
              onStartMultiSelect(event.pointerId, event.clientX, event.clientY, true);
            }
          }}
          onClick={(event) => {
            if (suppressNextRelationshipLineClickRef.current) {
              suppressNextRelationshipLineClickRef.current = false;
              return;
            }
            event.stopPropagation();
            onSetRelationshipDraft(null);
            onSetRelationshipContextMenu(null);
            onSetError("");
            if (event.shiftKey || event.ctrlKey) {
              onSetSelectedRelationshipIDs((previous) => {
                const next = new Set(previous);
                if (next.has(path.id)) next.delete(path.id);
                else next.add(path.id);
                return next;
              });
              return;
            }
            onSetSelectedNodeIDs(new Set());
            onSetSelectedNodeID("");
            onSetSelectedRelationshipIDs(new Set([path.id]));
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            onSetRelationshipDraft(null);
            onSetRelationshipContextMenu(null);
            onDeleteRelationships([path.id]);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!viewportRef.current) return;
            const bounds = viewportRef.current.getBoundingClientRect();
            const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
            const localY = clamp(event.clientY - bounds.top, 0, bounds.height);
            const menuWidth = 188;
            const menuHeight = 56;
            const clampedX = clamp(localX, 8, Math.max(8, bounds.width - menuWidth - 8));
            const clampedY = clamp(localY, 8, Math.max(8, bounds.height - menuHeight - 8));
            onSetCanvasActive(true);
            onSetRelationshipDraft(null);
            onSetContextMenu(null);
            onSetNodeContextMenu(null);
            onSetSelectedNodeIDs(new Set());
            onSetSelectedNodeID("");
            onSetSelectedRelationshipIDs((previous) => {
              if (previous.has(path.id)) return previous;
              return new Set([path.id]);
            });
            onSetRelationshipContextMenu({ x: clampedX, y: clampedY, relationshipID: path.id });
          }}
        />
      ))}
    </svg>
  );
};
