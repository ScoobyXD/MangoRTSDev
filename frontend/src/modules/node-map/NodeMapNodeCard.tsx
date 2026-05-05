import type React from "react";
import { getNodeTitle, type NodeDirection, type NodePosition, type NodeRecord } from "./shared";
import {
  type NodeMapDragState,
  resolveNodeMapDragStartSelection,
  resolveNodeMapPointerSelection,
} from "./NodeMapControls";
import { isLegalRelationshipSidePair } from "./relationshipProjection";

type NodeMapNodeCardProps = {
  node: NodeRecord;
  position: NodePosition;
  size: { w: number; h: number };
  selectedNodeID: string;
  selectedNodeIDs: Set<string>;
  editingNodeTitleNodeID: string | null;
  editingNodeTitleElementRef: React.RefObject<HTMLDivElement>;
  editingNodeTitleDraftRef: React.MutableRefObject<string>;
  dragState: NodeMapDragState | null;
  relationshipDraft: { sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null;
  nodePositions: Record<string, NodePosition>;
  zoom: number;
  accent: string;
  panelSurface: string;
  nodeCardBackground: string;
  nodeCardSelectedBackground: string;
  nodeCardBorder: string;
  nodeCardText: string;
  selectionColor: string;
  onSetCanvasActive: React.Dispatch<React.SetStateAction<boolean>>;
  onSetContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; worldX: number; worldY: number } | null>>;
  onSetNodeContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; nodeID: string } | null>>;
  onSetRelationshipContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; relationshipID: string } | null>>;
  onSetSelectedRelationshipIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSetSelectedNodeID: React.Dispatch<React.SetStateAction<string>>;
  onSetSelectedNodeIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSetDragState: React.Dispatch<React.SetStateAction<NodeMapDragState | null>>;
  onSetRelationshipDraft: React.Dispatch<React.SetStateAction<{ sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null>>;
  onSetEditingNodeTitleNodeID: React.Dispatch<React.SetStateAction<string | null>>;
  onSetError: React.Dispatch<React.SetStateAction<string>>;
  onCreateLinkedNode: (sourceNodeID: string, direction: NodeDirection) => Promise<void>;
  onCommitRelationshipBetweenNodes: (sourceNodeID: string, sourceSide: NodeDirection, targetNodeID: string, targetSide: NodeDirection) => Promise<void>;
  onUpdateNodeTitle: (nodeID: string, nextTitle: string) => Promise<void>;
  onGetAnchorPoint: (nodeID: string, side: NodeDirection) => { x: number; y: number } | null;
  onStartResize: (
    nodeID: string,
    pointerID: number,
    startMouseX: number,
    startMouseY: number,
    startX: number,
    startY: number,
    startW: number,
    startH: number,
    edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean },
  ) => void;
};

export const NodeMapNodeCard: React.FC<NodeMapNodeCardProps> = ({
  node,
  position,
  size,
  selectedNodeID,
  selectedNodeIDs,
  editingNodeTitleNodeID,
  editingNodeTitleElementRef,
  editingNodeTitleDraftRef,
  dragState,
  relationshipDraft,
  nodePositions,
  zoom,
  accent,
  panelSurface,
  nodeCardBackground,
  nodeCardSelectedBackground,
  nodeCardBorder,
  nodeCardText,
  selectionColor,
  onSetCanvasActive,
  onSetContextMenu,
  onSetNodeContextMenu,
  onSetRelationshipContextMenu,
  onSetSelectedRelationshipIDs,
  onSetSelectedNodeID,
  onSetSelectedNodeIDs,
  onSetDragState,
  onSetRelationshipDraft,
  onSetEditingNodeTitleNodeID,
  onSetError,
  onCreateLinkedNode,
  onCommitRelationshipBetweenNodes,
  onUpdateNodeTitle,
  onGetAnchorPoint,
  onStartResize,
}) => {
  const isSelected = selectedNodeIDs.has(node.node_id);
  const isPrimary = node.node_id === selectedNodeID;
  const isEditingTitle = editingNodeTitleNodeID === node.node_id;

  return (
    <div
      data-node-card="true"
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        borderRadius: 8,
        border: `1px solid ${isSelected ? selectionColor : nodeCardBorder}`,
        background: isSelected ? nodeCardSelectedBackground : nodeCardBackground,
        outline: isSelected ? `2px solid ${selectionColor}` : "none",
        outlineOffset: isSelected ? 1 : 0,
        display: "grid",
        gridTemplateRows: "1fr",
        boxShadow: isSelected ? "0 0 0 3px rgba(0,233,255,0.35), 0 8px 20px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.12)",
        userSelect: "none",
        color: nodeCardText,
        cursor: isEditingTitle ? "text" : (dragState?.nodeIDs.includes(node.node_id) ? "grabbing" : "grab"),
        zIndex: isPrimary ? 5 : 4,
        overflow: "visible",
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        // legacy details popup removed
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSetCanvasActive(true);
        onSetSelectedRelationshipIDs(new Set());
        onSetRelationshipContextMenu(null);
        const bounds = (event.currentTarget.closest("[data-node-map-viewport='true']") as HTMLDivElement | null)?.getBoundingClientRect();
        if (!bounds) return;
        const nextIDs = selectedNodeIDs.has(node.node_id) ? Array.from(selectedNodeIDs) : [node.node_id];
        if (!(selectedNodeIDs.size > 1 && selectedNodeIDs.has(node.node_id))) {
          onSetSelectedNodeID(node.node_id);
        }
        onSetSelectedNodeIDs(new Set(nextIDs));
        onSetContextMenu(null);
        onSetNodeContextMenu({
          x: Math.max(0, Math.min(event.clientX - bounds.left, bounds.width)),
          y: Math.max(0, Math.min(event.clientY - bounds.top, bounds.height)),
          nodeID: node.node_id,
        });
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        if (event.ctrlKey || event.shiftKey) {
          event.preventDefault();
          const nextSelection = resolveNodeMapPointerSelection({ selectedNodeIDs, nodeID: node.node_id, additive: true });
          onSetSelectedNodeIDs(nextSelection.selectedNodeIDs);
          onSetSelectedNodeID(nextSelection.selectedNodeID);
          return;
        }
        onSetContextMenu(null);
        onSetNodeContextMenu(null);
        onSetRelationshipContextMenu(null);
        onSetSelectedRelationshipIDs(new Set());
        const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect();

        const nextSelection = resolveNodeMapDragStartSelection({ selectedNodeIDs, selectedNodeID, nodeID: node.node_id });
        const nextIDs = nextSelection.dragNodeIDs;
        onSetSelectedNodeID(nextSelection.selectedNodeID);
        onSetSelectedNodeIDs(nextSelection.selectedNodeIDs);

        const offsets: Record<string, { x: number; y: number }> = {};
        for (const id of nextIDs) {
          const pos = nodePositions[id] ?? { x: 0, y: 0 };
          const pointerWorldX = (event.clientX - bounds.left) / zoom + position.x;
          const pointerWorldY = (event.clientY - bounds.top) / zoom + position.y;
          offsets[id] = { x: pointerWorldX - pos.x, y: pointerWorldY - pos.y };
        }
        onSetDragState({
          nodeIDs: nextIDs,
          pointerID: event.pointerId,
          offsets,
          startMouseX: event.clientX,
          startMouseY: event.clientY,
          clearSelectionOnClick: nextSelection.clearSelectionOnClick,
        });
      }}
    >
      <div
        style={{
          display: "grid",
          placeItems: "center",
          width: "100%",
          height: "100%",
          textAlign: "center",
          padding: "10px",
        }}
      >
        {/* Latency-obsession alignment: keep node-card render minimal.
            We only render the title so no extra metadata fetch/render churn appears on the hot canvas path. */}
        {isEditingTitle ? (
          <div
            ref={editingNodeTitleElementRef}
            contentEditable
            suppressContentEditableWarning
            onPointerDown={(event) => event.stopPropagation()}
            onInput={(event) => {
              editingNodeTitleDraftRef.current = event.currentTarget.textContent ?? "";
            }}
            onBlur={() => {
              void onUpdateNodeTitle(node.node_id, editingNodeTitleDraftRef.current);
              onSetEditingNodeTitleNodeID(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onUpdateNodeTitle(node.node_id, editingNodeTitleDraftRef.current);
                onSetEditingNodeTitleNodeID(null);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                if (editingNodeTitleElementRef.current) editingNodeTitleElementRef.current.textContent = getNodeTitle(node);
                onSetEditingNodeTitleNodeID(null);
              }
            }}
            /*
              Gold-standard inline edit behavior: keep exact read-mode typography and box
              metrics so only the caret appears when entering title edit mode.
            */
            style={{
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              overflow: "hidden",
              width: "100%",
              maxWidth: "100%",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              cursor: "text",
              textAlign: "center",
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: "0.03em",
              fontFamily: "'IBM Plex Mono', monospace",
              outline: "none",
            }}
          >
            {getNodeTitle(node)}
          </div>
        ) : (
          <div
            style={{
              whiteSpace: "normal",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              overflow: "hidden",
              maxWidth: "100%",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              fontSize: 18,
              fontWeight: 800,
              lineHeight: 1.15,
              letterSpacing: "0.03em",
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            {getNodeTitle(node)}
          </div>
        )}
      </div>
      {isSelected && (
        <div style={{ position: "absolute", top: 6, left: 6, width: 12, height: 12, borderRadius: 999, background: selectionColor, opacity: 0.92 }} />
      )}

      {([
        ["left", { left: -12, top: "50%", transform: "translate(-50%, -50%)", flexDirection: "column" }],
        ["right", { right: -12, top: "50%", transform: "translate(50%, -50%)", flexDirection: "column" }],
        ["top", { top: -12, left: "50%", transform: "translate(-50%, -50%)", flexDirection: "row" }],
        ["bottom", { bottom: -12, left: "50%", transform: "translate(-50%, 50%)", flexDirection: "row" }],
      ] as const).map(([direction, sideStyle]) => {
        const isDrafting = !!relationshipDraft;
        const isSource = relationshipDraft?.sourceNodeID === node.node_id && relationshipDraft.sourceSide === direction;
        return (
          <div
            key={direction}
            style={{
              position: "absolute",
              ...sideStyle,
              display: isPrimary || isDrafting ? "flex" : "none",
              gap: 4,
            }}
          >
            <button
              title={`Create ${direction} node`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSetError("");
                onSetRelationshipDraft(null);
                void onCreateLinkedNode(node.node_id, direction);
              }}
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                border: `1px solid ${accent}`,
                background: panelSurface,
                color: accent,
                display: isDrafting ? "none" : "grid",
                placeItems: "center",
                fontSize: 14,
                lineHeight: 1,
                cursor: "pointer",
                padding: 0,
              }}
            >
              +
            </button>
            <button
              title={isDrafting ? `Attach relationship on ${direction}` : `Create relationship from ${direction}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSetError("");
                if (relationshipDraft) {
                  if (relationshipDraft.sourceNodeID === node.node_id) return;
                  if (!isLegalRelationshipSidePair(relationshipDraft.sourceSide, direction)) {
                    onSetError("illegal_relationship_pair");
                    return;
                  }
                  void onCommitRelationshipBetweenNodes(relationshipDraft.sourceNodeID, relationshipDraft.sourceSide, node.node_id, direction);
                  onSetRelationshipDraft(null);
                  return;
                }
                const start = onGetAnchorPoint(node.node_id, direction);
                if (!start) return;
                onSetSelectedRelationshipIDs(new Set());
                onSetRelationshipDraft({ sourceNodeID: node.node_id, sourceSide: direction, cursor: start });
              }}
              style={{
                width: 20,
                height: 20,
                borderRadius: 4,
                border: `1px solid ${accent}`,
                background: isSource ? accent : panelSurface,
                color: isSource ? "#ffffff" : accent,
                display: "grid",
                placeItems: "center",
                cursor: relationshipDraft?.sourceNodeID === node.node_id || (relationshipDraft && !isLegalRelationshipSidePair(relationshipDraft.sourceSide, direction)) ? "not-allowed" : "pointer",
                opacity: relationshipDraft && !isLegalRelationshipSidePair(relationshipDraft.sourceSide, direction) ? 0.35 : 1,
                padding: 0,
              }}
            >
              {isDrafting ? (
                <svg aria-hidden="true" width="12" height="13" viewBox="0 0 17 19" style={{ display: "block" }}>
                  <polygon points="8.5,1.5 15.5,5.5 15.5,13.5 8.5,17.5 1.5,13.5 1.5,5.5" fill="none" stroke={isSource ? "#ffffff" : accent} strokeWidth="1.8" />
                </svg>
              ) : (direction === "top" ? "\u2191" : direction === "right" ? "\u2192" : direction === "bottom" ? "\u2193" : "\u2190")}
            </button>
          </div>
        );
      })}
      {[
        { key: "tl", edges: { left: true, top: true }, cursor: "nwse-resize", style: { left: -6, top: -6, width: 12, height: 12 } },
        { key: "tr", edges: { right: true, top: true }, cursor: "nesw-resize", style: { right: -6, top: -6, width: 12, height: 12 } },
        { key: "bl", edges: { left: true, bottom: true }, cursor: "nesw-resize", style: { left: -6, bottom: -6, width: 12, height: 12 } },
        { key: "br", edges: { right: true, bottom: true }, cursor: "nwse-resize", style: { right: -6, bottom: -6, width: 12, height: 12 } },
        { key: "l", edges: { left: true }, cursor: "ew-resize", style: { left: -4, top: 12, bottom: 12, width: 8 } },
        { key: "r", edges: { right: true }, cursor: "ew-resize", style: { right: -4, top: 12, bottom: 12, width: 8 } },
        { key: "t", edges: { top: true }, cursor: "ns-resize", style: { top: -4, left: 12, right: 12, height: 8 } },
        { key: "b", edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -4, left: 12, right: 12, height: 8 } },
      ].map((handle) => (
        <div
          key={handle.key}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSetDragState(null);
            onStartResize(
              node.node_id,
              event.pointerId,
              event.clientX,
              event.clientY,
              position.x,
              position.y,
              size.w,
              size.h,
              handle.edges,
            );
          }}
          style={{ position: "absolute", ...handle.style, cursor: handle.cursor, zIndex: 9 }}
        />
      ))}
    </div>
  );
};
