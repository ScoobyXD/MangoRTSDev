import { useMemo, useRef } from "react";
import type React from "react";
import { clamp, getNodeTitle, type NodeDirection, type NodePosition, type NodeRecord } from "./shared";
import {
  type NodeMapDragState,
  resolveNodeMapDragStartSelection,
  resolveNodeMapPointerSelection,
} from "./NodeMapControls";
import { isLegalRelationshipSidePair } from "./relationshipProjection";
import { buildNodeTitleCommentSegments, type NodeInlineCommentDraft, type NodeInlineCommentThread } from "./nodeInlineComments";
import { createOneShotBlurSuppression } from "../company-explorer/companyExplorerLocalEntityUpdates";

type NodeMapNodeCardProps = {
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
  inlineCommentThreads: NodeInlineCommentThread[];
  activeInlineCommentThreadID: string;
  inlineCommentDraft: NodeInlineCommentDraft | null;
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
  onSetInlineCommentDraft: React.Dispatch<React.SetStateAction<NodeInlineCommentDraft | null>>;
  onSetError: React.Dispatch<React.SetStateAction<string>>;
  onCreateInlineCommentThread: (draft: NodeInlineCommentDraft) => void;
  onOpenInlineCommentThread: (threadID: string) => void;
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
  inlineCommentThreads,
  activeInlineCommentThreadID,
  inlineCommentDraft,
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
  onSetInlineCommentDraft,
  onSetError,
  onCreateInlineCommentThread,
  onOpenInlineCommentThread,
  onCreateLinkedNode,
  onCommitRelationshipBetweenNodes,
  onUpdateNodeTitle,
  onGetAnchorPoint,
  onStartResize,
}) => {
  const isSelected = selectedNodeIDs.has(node.node_id);
  const isPrimary = node.node_id === selectedNodeID;
  const isEditingTitle = editingNodeTitleNodeID === node.node_id;
  const nodeTitle = getNodeTitle(node);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const titleElementRef = useRef<HTMLDivElement | null>(null);
  const titleBlurSuppressionRef = useRef(createOneShotBlurSuppression());
  const nodeInlineCommentDraft = inlineCommentDraft?.nodeID === node.node_id ? inlineCommentDraft : null;
  const titleSegments = useMemo(() => buildNodeTitleCommentSegments(nodeTitle, inlineCommentThreads), [inlineCommentThreads, nodeTitle]);

  const readNodeTitleSelection = (): NodeInlineCommentDraft | null => {
    const cardElement = cardRef.current;
    const titleElement = titleElementRef.current;
    if (!cardElement || !titleElement) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!titleElement.contains(range.startContainer) || !titleElement.contains(range.endContainer)) return null;
    const rawSelectedText = range.toString();
    const leadingTrim = rawSelectedText.length - rawSelectedText.trimStart().length;
    const trailingTrim = rawSelectedText.length - rawSelectedText.trimEnd().length;
    const selectedText = rawSelectedText.trim();
    if (!selectedText) return null;

    const beforeRange = range.cloneRange();
    beforeRange.selectNodeContents(titleElement);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const startOffset = clamp(beforeRange.toString().length + leadingTrim, 0, nodeTitle.length);
    const endOffset = clamp(startOffset + selectedText.length, startOffset, nodeTitle.length - trailingTrim);
    if (endOffset <= startOffset) return null;

    const selectionRect = range.getBoundingClientRect();
    const cardRect = cardElement.getBoundingClientRect();
    const anchorX = clamp((selectionRect.right - cardRect.left) / zoom + 6, 8, size.w - 8);
    const anchorY = clamp((selectionRect.top - cardRect.top) / zoom - 32, -30, size.h - 20);
    return {
      nodeID: node.node_id,
      quote: nodeTitle.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      anchorX,
      anchorY,
    };
  };

  const captureNodeTitleSelection = () => {
    const draft = readNodeTitleSelection();
    onSetInlineCommentDraft(draft);
  };

  const renderReadOnlyTitle = () => (
    <div
      ref={titleElementRef}
      onPointerUp={() => {
        window.setTimeout(captureNodeTitleSelection, 0);
      }}
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
        userSelect: "none",
        cursor: "inherit",
      }}
    >
      {titleSegments.map((segment) => {
        const isCommented = segment.threadIDs.length > 0;
        const isActiveComment = segment.threadIDs.includes(activeInlineCommentThreadID);
        return (
          <span
            key={`${segment.startOffset}:${segment.endOffset}`}
            title={isCommented ? "Open comment thread" : undefined}
            onClick={isCommented ? (event) => {
              event.stopPropagation();
              const threadID = segment.threadIDs[segment.threadIDs.length - 1];
              onOpenInlineCommentThread(threadID);
            } : undefined}
            style={{
              background: isCommented ? (isActiveComment ? "rgba(100, 116, 139, 0.72)" : "rgba(100, 116, 139, 0.46)") : "transparent",
              borderBottom: isCommented ? `1px solid ${selectionColor}` : "none",
              borderRadius: isCommented ? 3 : 0,
              cursor: isCommented ? "pointer" : "inherit",
            }}
          >
            {segment.text}
          </span>
        );
      })}
    </div>
  );

  return (
    <div
      ref={cardRef}
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
        boxShadow: isSelected ? "0 0 0 3px rgba(100,116,139,0.35), 0 8px 20px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.12)",
        userSelect: "none",
        color: nodeCardText,
        cursor: isEditingTitle && canEdit ? "text" : canEdit ? (dragState?.nodeIDs.includes(node.node_id) ? "grabbing" : "grab") : "default",
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
              if (!titleBlurSuppressionRef.current.shouldHandleBlur()) return;
              void onUpdateNodeTitle(node.node_id, editingNodeTitleDraftRef.current);
              onSetEditingNodeTitleNodeID(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                titleBlurSuppressionRef.current.suppress();
                void onUpdateNodeTitle(node.node_id, editingNodeTitleDraftRef.current);
                onSetEditingNodeTitleNodeID(null);
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                titleBlurSuppressionRef.current.suppress();
                if (editingNodeTitleElementRef.current) editingNodeTitleElementRef.current.textContent = getNodeTitle(node);
                onSetEditingNodeTitleNodeID(null);
                event.currentTarget.blur();
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
            {nodeTitle}
          </div>
        ) : (
          renderReadOnlyTitle()
        )}
      </div>
      {nodeInlineCommentDraft && !isEditingTitle && (
        <button
          type="button"
          title="Comment on selection"
          aria-label="Comment on selection"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onCreateInlineCommentThread(nodeInlineCommentDraft);
          }}
          style={{
            position: "absolute",
            left: nodeInlineCommentDraft.anchorX,
            top: nodeInlineCommentDraft.anchorY,
            width: 28,
            height: 28,
            borderRadius: 6,
            border: `1px solid ${selectionColor}`,
            background: panelSurface,
            color: selectionColor,
            boxShadow: "0 8px 20px rgba(0,0,0,0.24)",
            display: "grid",
            placeItems: "center",
            cursor: "pointer",
            padding: 0,
            zIndex: 42,
          }}
        >
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H11l-4.5 4v-4H8.5A3.5 3.5 0 0 1 5 10.5v-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {isSelected && (
        <div style={{ position: "absolute", top: 6, left: 6, width: 12, height: 12, borderRadius: 999, background: selectionColor, opacity: 0.92 }} />
      )}

      {canEdit && ([
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
      {canEdit && [
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
