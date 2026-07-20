import type React from "react";
import { getNodeTitle, type NodeDirection, type NodePosition, type NodeRecord } from "./shared";
import {
  type NodeMapDragState,
  resolveNodeMapDragStartSelection,
  resolveNodeMapPointerSelection,
} from "../node-map/NodeMapControls";
import { canStartRelationshipFromSide, isLegalRelationshipSidePair } from "./relationshipProjection";
import { NodeMyTeraPanel, type NodeMyTeraRole } from "../node-map/NodeMyTeraPanel";
import type { MyTeraCardState } from "../node-map/mapAppearancePersistence";

const LOGIC_GATE_SIDE_CONTROLS: Array<{ direction: NodeDirection; style: React.CSSProperties }> = [
  { direction: "left", style: { left: -12, top: "50%", transform: "translate(-50%, -50%)", flexDirection: "column" } },
  { direction: "right", style: { right: -12, top: "50%", transform: "translate(50%, -50%)", flexDirection: "column" } },
  { direction: "top", style: { top: -12, left: "50%", transform: "translate(-50%, -50%)", flexDirection: "row" } },
  { direction: "bottom", style: { bottom: -12, left: "50%", transform: "translate(-50%, 50%)", flexDirection: "row" } },
];
const AND_GATE_VIEWBOX_WIDTH = 148;
const AND_GATE_VIEWBOX_HEIGHT = 96;
const AND_GATE_PATH = "M1 1H100A47 47 0 0 1 100 95H1Z";

type LogicGateMapNodeCardProps = {
  node: NodeRecord;
  canEdit: boolean;
  editableNodeIDs: Set<string>;
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
  panelMutedText: string;
  myTeraState: MyTeraCardState;
  myTeraRoles: NodeMyTeraRole[];
  relationshipCount: number;
  onToggleMyTera: (nodeID: string) => void;
  onUpdateMyTera: (nodeID: string, next: MyTeraCardState) => void;
  onMyTeraContentHeightChange: (nodeID: string, height: number) => void;
  onSetCanvasActive: React.Dispatch<React.SetStateAction<boolean>>;
  onSetContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; worldX: number; worldY: number } | null>>;
  onSetNodeContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; nodeID: string } | null>>;
  onSetRelationshipContextMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; relationshipID: string } | null>>;
  onSetSelectedRelationshipIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSetSelectedNodeID: React.Dispatch<React.SetStateAction<string>>;
  onSetSelectedNodeIDs: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSetDragState: React.Dispatch<React.SetStateAction<NodeMapDragState | null>>;
  onSetRelationshipDraft: React.Dispatch<React.SetStateAction<{ sourceNodeID: string; sourceSide: NodeDirection; cursor: { x: number; y: number } } | null>>;
  onSetEditingNodeTitleNodeID: (nodeID: string | null) => void;
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

export const LogicGateMapNodeCard: React.FC<LogicGateMapNodeCardProps> = ({
  node,
  canEdit,
  editableNodeIDs,
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
  panelMutedText,
  myTeraState,
  myTeraRoles,
  relationshipCount,
  onToggleMyTera,
  onUpdateMyTera,
  onMyTeraContentHeightChange,
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
  const gateFill = isSelected ? nodeCardSelectedBackground : nodeCardBackground;
  const gateStroke = isSelected ? selectionColor : nodeCardBorder;
  const gateShadow = isSelected
    ? "drop-shadow(0 0 4px rgba(100,116,139,0.45)) drop-shadow(0 8px 20px rgba(0,0,0,0.2))"
    : "drop-shadow(0 4px 12px rgba(0,0,0,0.12))";
  const myTeraExpanded = myTeraState.enabled && myTeraState.expanded;
  const myTeraPanelHeight = myTeraExpanded ? Math.max(228, myTeraState.panelHeight ?? 228) : 0;
  const titleStripHeight = myTeraExpanded ? Math.max(72, size.h - myTeraPanelHeight) : size.h;

  return (
    <div
      data-node-card="true"
      data-mytera-enabled={myTeraState.enabled ? "true" : "false"}
      data-mytera-expanded={myTeraExpanded ? "true" : "false"}
      style={{
        position: "absolute",
        left: position.x,
        top: position.y,
        width: size.w,
        height: size.h,
        border: "none",
        background: "transparent",
        outline: "none",
        display: "grid",
        gridTemplateRows: "1fr",
        boxShadow: "none",
        userSelect: "none",
        color: nodeCardText,
        cursor: isEditingTitle && canEdit ? "text" : canEdit ? (dragState?.nodeIDs.includes(node.node_id) ? "grabbing" : "grab") : "default",
        zIndex: isPrimary ? 5 : 4,
        overflow: "visible",
        isolation: "isolate",
        transform: isSelected ? "rotate(-0.45deg)" : "none",
        transformOrigin: "48% 82%",
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
        const nextIDs = nextSelection.dragNodeIDs.filter((id) => editableNodeIDs.has(id));
        onSetSelectedNodeID(nextSelection.selectedNodeID);
        onSetSelectedNodeIDs(nextSelection.selectedNodeIDs);
        if (!canEdit || nextIDs.length === 0) return;

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
      {myTeraExpanded && ([
        { key: "rear", transform: "translate(10px, 8px) rotate(1.1deg)", opacity: 0.1 },
        { key: "middle", transform: "translate(-7px, 5px) rotate(-0.75deg)", opacity: 0.07 },
      ] as const).map((layer) => (
        <svg
          key={layer.key}
          data-mytera-layer={layer.key}
          aria-hidden="true"
          viewBox={`0 0 ${AND_GATE_VIEWBOX_WIDTH} ${AND_GATE_VIEWBOX_HEIGHT}`}
          preserveAspectRatio="none"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            overflow: "visible",
            pointerEvents: "none",
            zIndex: layer.key === "rear" ? -2 : -1,
            transform: layer.transform,
          }}
        >
          <path
            d={AND_GATE_PATH}
            fill={accent}
            fillOpacity={layer.opacity}
            stroke={accent}
            strokeOpacity={0.28}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ))}
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${AND_GATE_VIEWBOX_WIDTH} ${AND_GATE_VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          pointerEvents: "none",
          zIndex: 0,
          filter: gateShadow,
        }}
      >
        <path
          d={AND_GATE_PATH}
          fill={gateFill}
          fillOpacity={myTeraExpanded ? 0.78 : 1}
          stroke={gateStroke}
          strokeWidth={isSelected ? 2.4 : 1.4}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {myTeraExpanded && (
        <div style={{ position: "absolute", inset: `0 12% ${titleStripHeight}px 0`, zIndex: 2 }}>
          <NodeMyTeraPanel
            entityLabel="Logic gate property"
            relationshipCount={relationshipCount}
            roles={myTeraRoles}
            value={myTeraState}
            canEdit={canEdit}
            accent={accent}
            surface={panelSurface}
            textColor={nodeCardText}
            mutedTextColor={panelMutedText}
            onChange={(next) => onUpdateMyTera(node.node_id, next)}
            onContentHeightChange={(height) => onMyTeraContentHeightChange(node.node_id, height)}
          />
        </div>
      )}
      <div
        style={{
          position: myTeraExpanded ? "absolute" : "relative",
          bottom: myTeraExpanded ? 0 : undefined,
          zIndex: 3,
          display: "grid",
          placeItems: "center",
          width: "100%",
          height: "100%",
          textAlign: "center",
          padding: "10px 22px 10px 10px",
          boxSizing: "border-box",
          background: myTeraExpanded ? `color-mix(in srgb, ${gateFill} 72%, transparent)` : "transparent",
          borderTop: myTeraExpanded ? `1px solid color-mix(in srgb, ${accent} 24%, transparent)` : "none",
          borderRadius: myTeraExpanded ? "0 42% 42% 0" : 0,
        }}
      >
        {/* Latency-obsession alignment: keep node-card render minimal.
            We only render the title so no extra metadata fetch/render churn appears on the hot canvas path. */}
        {isEditingTitle && canEdit ? (
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
              fontWeight: 500,
              lineHeight: 1.15,
              letterSpacing: 0,
              fontFamily: "var(--mango-font-family)",
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
              fontWeight: 500,
              lineHeight: 1.15,
              letterSpacing: 0,
              fontFamily: "var(--mango-font-family)",
            }}
          >
            {getNodeTitle(node)}
          </div>
        )}
      </div>
      {((canEdit && isPrimary) || myTeraState.enabled) && (
        <button
          type="button"
          data-mytera-toggle="true"
          aria-label={myTeraExpanded ? "Collapse MyTera" : (myTeraState.enabled ? "Expand MyTera" : "Add MyTera")}
          aria-expanded={myTeraExpanded}
          title={myTeraExpanded ? "Collapse MyTera" : (myTeraState.enabled ? "Expand MyTera" : "Add MyTera")}
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onToggleMyTera(node.node_id);
          }}
          style={{
            position: "absolute",
            right: "16%",
            bottom: Math.max(8, titleStripHeight - 14),
            minWidth: 76,
            height: 28,
            padding: "0 10px",
            borderRadius: 999,
            border: `1px solid color-mix(in srgb, ${accent} 64%, transparent)`,
            background: `color-mix(in srgb, ${panelSurface} 92%, transparent)`,
            color: nodeCardText,
            boxShadow: "0 5px 14px rgba(15,23,42,0.18)",
            fontSize: 10.5,
            fontWeight: 800,
            cursor: "pointer",
            zIndex: 7,
          }}
        >
          {myTeraState.enabled ? `MyTera ${myTeraExpanded ? "▴" : "▾"}` : "+ MyTera"}
        </button>
      )}
      {isSelected && (
        <div style={{ position: "absolute", top: 8, left: 8, width: 12, height: 12, borderRadius: 999, background: selectionColor, opacity: 0.92, zIndex: 2 }} />
      )}

      {canEdit && LOGIC_GATE_SIDE_CONTROLS.map(({ direction, style: sideStyle }) => {
        const isDrafting = !!relationshipDraft;
        const isSource = relationshipDraft?.sourceNodeID === node.node_id && relationshipDraft.sourceSide === direction;
        const isLegalDraftTarget = !!relationshipDraft && relationshipDraft.sourceNodeID !== node.node_id && isLegalRelationshipSidePair(relationshipDraft.sourceSide, direction);
        const canStartFromSide = canStartRelationshipFromSide(direction);
        const showControls = isDrafting ? (isSource || isLegalDraftTarget) : (isPrimary && canStartFromSide);
        if (!showControls) return null;
        return (
          <div
            key={direction}
            style={{
              position: "absolute",
              ...sideStyle,
              display: "flex",
              gap: 4,
            }}
          >
            {!isDrafting && canStartFromSide && (
              <button
                title={`Create ${direction} logic gate`}
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
                  display: "grid",
                  placeItems: "center",
                  fontSize: 14,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                +
              </button>
            )}
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
                if (!canStartFromSide) return;
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
                cursor: relationshipDraft?.sourceNodeID === node.node_id ? "not-allowed" : "pointer",
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
      {canEdit && [
        { key: "tl", edges: { left: true, top: true }, cursor: "nwse-resize", style: { left: -6, top: -6, width: 12, height: 12 } },
        { key: "tr", edges: { right: true, top: true }, cursor: "nesw-resize", style: { right: -6, top: -6, width: 12, height: 12 } },
        { key: "tr-curve", edges: { right: true, top: true }, cursor: "nesw-resize", style: { left: "calc(67.5% - 6px)", top: -6, width: 18, height: 14 } },
        { key: "bl", edges: { left: true, bottom: true }, cursor: "nesw-resize", style: { left: -6, bottom: -6, width: 12, height: 12 } },
        { key: "br", edges: { right: true, bottom: true }, cursor: "nwse-resize", style: { right: -6, bottom: -6, width: 12, height: 12 } },
        { key: "br-curve", edges: { right: true, bottom: true }, cursor: "nwse-resize", style: { left: "calc(67.5% - 6px)", bottom: -6, width: 18, height: 14 } },
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
