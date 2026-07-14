import React from "react";
import {
  attachStackedDragPreview,
  EXPLORER_ENTITY_DRAG_MIME,
  KANBAN_DEFAULT_COLUMN_ITEM_COLOR,
  serializeExplorerEntityDragPayload,
  type ExplorerEntityDragItem,
} from "../kanban/shared";
import type { SelectionIntent } from "../selectionCoordinator";
import { hasTriageMessageDrag, readTriageMessageDrag } from "../../pages/home/homeUtils";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "./CompanyExplorerIcons";
import {
  EXPLORER_DRAG_MIME,
  getExplorerDragPayloadForSelection,
  getExplorerDropIntent,
  getExplorerRowReorderPlacement,
  readExplorerDragPayload,
  TREE_BASE_LEFT_PX,
  TREE_INDENT_PX,
  TREE_TOGGLE_SLOT_PX,
} from "./companyExplorerDragDrop";
import type {
  ExplorerDragPayload,
  ExplorerRenameDraft,
  ExplorerRowDropPlacement,
  ExplorerTreeNode,
} from "./companyExplorerTypes";
import type { CompanyExplorerTriageMessageDropHandler, CompanyExplorerTriageMessageDropTarget } from "./CompanyExplorerContentModel";
import { COMPANY_EXPLORER_TREE_ROW_HEIGHT } from "./useCompanyExplorerVirtualTree";
import {
  resolveExplorerDropTarget,
  resolveExplorerRootDropTarget,
} from "./treePresentation";

type CompanyExplorerTreeRowProps = {
  row: ExplorerTreeNode;
  treeRows: ExplorerTreeNode[];
  expanded: Set<string>;
  selectedTreeID: string;
  selectedTreeIDs: Set<string>;
  draggingTreeID: string;
  dragOverTreeID: string;
  dragOverPlacement: ExplorerRowDropPlacement | null;
  dragPayload: ExplorerDragPayload | null;
  triageDropTreeID: string;
  renaming: ExplorerRenameDraft | null;
  renameInputRef: React.RefObject<HTMLInputElement>;
  cancelRenameOnBlurRef: React.MutableRefObject<boolean>;
  accent: string;
  surfaceBackground: string;
  surfaceText: string;
  rowIconColor: string;
  dropRowBackground: string;
  selectedRowBackground: string;
  rowRuleColor: string;
  folderToggleColor: string;
  isDarkTheme: boolean;
  isSearchActive: boolean;
  onSelectTreeRow: (row: ExplorerTreeNode, event?: React.MouseEvent, options?: { selectionIntent?: SelectionIntent }) => void;
  onOpenContextMenu: (event: React.MouseEvent, row?: ExplorerTreeNode | null) => void;
  onCommitRename: (draft?: ExplorerRenameDraft) => Promise<void>;
  onSetRenaming: React.Dispatch<React.SetStateAction<ExplorerRenameDraft | null>>;
  onSetExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  onSetDraggingTreeID: React.Dispatch<React.SetStateAction<string>>;
  onSetDragOverTreeID: React.Dispatch<React.SetStateAction<string>>;
  onSetDragOverPlacement: React.Dispatch<React.SetStateAction<ExplorerRowDropPlacement | null>>;
  onSetDragPayload: React.Dispatch<React.SetStateAction<ExplorerDragPayload | null>>;
  onSetTriageDropTreeID: React.Dispatch<React.SetStateAction<string>>;
  onTriageMessagesDrop?: CompanyExplorerTriageMessageDropHandler;
  getKanbanDragItemsForRow: (row: ExplorerTreeNode) => ExplorerEntityDragItem[];
  getExplorerItemRowsForPayload: (payload: ExplorerDragPayload | null) => ExplorerTreeNode[];
  getReorderRowsForTarget: (source: ExplorerTreeNode, target: ExplorerTreeNode) => ExplorerTreeNode[];
  canDropExplorerPayloadOnRow: (payload: ExplorerDragPayload | null, target: ExplorerTreeNode) => boolean;
  dropExplorerPayloadOnRow: (payload: ExplorerDragPayload | null, target: ExplorerTreeNode) => Promise<boolean>;
  canPlaceExplorerFolderAtTarget: (source: ExplorerTreeNode | undefined, target: ExplorerTreeNode) => boolean;
  canPlaceExplorerItemsAtTarget: (payload: ExplorerDragPayload | null, target: ExplorerTreeNode) => boolean;
  reorderExplorerRows: (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => Promise<boolean>;
  placeExplorerFolderAtTarget: (source: ExplorerTreeNode, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => Promise<boolean>;
  placeExplorerItemsAtTarget: (payload: ExplorerDragPayload | null, target: ExplorerTreeNode, placement: ExplorerRowDropPlacement) => Promise<boolean>;
  moveFolder: (folderID: string, parentFolderID: string | undefined, options?: { position?: number; expandTarget?: boolean; parentProvided?: boolean; targetExpanded?: boolean }) => Promise<void>;
  assignExplorerPayloadItemsToFolder: (targetFolderID: string, payload: ExplorerDragPayload) => Promise<void>;
};

const TREE_ROW_PILL_LEFT_PADDING_PX = 3;
const TREE_ROW_PILL_GAP_PX = 6;
const TREE_GUIDE_OFFSET_PX = TREE_TOGGLE_SLOT_PX / 2;
const TREE_GUIDE_ICON_CONNECTOR_GAP_PX = 2;
const TREE_GUIDE_CONNECTOR_END_OFFSET_PX = TREE_ROW_PILL_LEFT_PADDING_PX + TREE_TOGGLE_SLOT_PX + TREE_ROW_PILL_GAP_PX - TREE_GUIDE_ICON_CONNECTOR_GAP_PX;

function getTriageMessageDropTarget(row: ExplorerTreeNode, treeRows: ExplorerTreeNode[]): CompanyExplorerTriageMessageDropTarget | null {
  void treeRows;
  if (row.kind === "logic_gate") {
    const logicGateID = row.logicGateID?.trim() ?? "";
    const parentEntityID = row.entityID?.trim() ?? "";
    return logicGateID ? { kind: "logic_gate", logicGateID, parentEntityID: parentEntityID || undefined, label: row.label } : null;
  }
  return null;
}

function ExplorerPermissionLockIcon({ color }: { color: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={{ width: 12, height: 12, display: "block", flexShrink: 0, color }}
    >
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function hasLaterVisibleSiblingAtDepth(rows: ExplorerTreeNode[], currentRowID: string, depth: number): boolean {
  const currentIndex = rows.findIndex((candidate) => candidate.id === currentRowID);
  if (currentIndex < 0) return true;
  for (let index = currentIndex + 1; index < rows.length; index += 1) {
    const nextDepth = Math.max(0, Math.floor(rows[index].depth));
    if (nextDepth < depth) return false;
    if (nextDepth === depth) return true;
  }
  return false;
}

export const CompanyExplorerTreeRow: React.FC<CompanyExplorerTreeRowProps> = ({
  row,
  treeRows,
  expanded,
  selectedTreeID,
  selectedTreeIDs,
  draggingTreeID,
  dragOverTreeID,
  dragOverPlacement,
  dragPayload,
  triageDropTreeID,
  renaming,
  renameInputRef,
  cancelRenameOnBlurRef,
  accent,
  surfaceBackground,
  surfaceText,
  rowIconColor,
  dropRowBackground,
  selectedRowBackground,
  rowRuleColor: _rowRuleColor,
  folderToggleColor,
  isDarkTheme,
  isSearchActive,
  onSelectTreeRow,
  onOpenContextMenu,
  onCommitRename,
  onSetRenaming,
  onSetExpanded,
  onSetDraggingTreeID,
  onSetDragOverTreeID,
  onSetDragOverPlacement,
  onSetDragPayload,
  onSetTriageDropTreeID,
  onTriageMessagesDrop,
  getKanbanDragItemsForRow,
  getExplorerItemRowsForPayload,
  getReorderRowsForTarget,
  canDropExplorerPayloadOnRow,
  dropExplorerPayloadOnRow,
  canPlaceExplorerFolderAtTarget,
  canPlaceExplorerItemsAtTarget,
  reorderExplorerRows,
  placeExplorerFolderAtTarget,
  placeExplorerItemsAtTarget,
  moveFolder,
  assignExplorerPayloadItemsToFolder,
}) => {
  const isFolder = row.kind === "folder";
  const isExpandable = (isFolder || row.hasChildren) && !isSearchActive;
  const isOpen = expanded.has(row.id);
  const isSelected = selectedTreeID === row.id || selectedTreeIDs.has(row.id);
  const showPermissionMarker = Boolean(row.hasPermissionRules) && (row.kind === "folder" || row.kind === "logic_gate" || row.kind === "project");
  const suppressModifiedClickRef = React.useRef(false);
  const rowDragPayload = isSearchActive ? null : getExplorerDragPayloadForSelection(row, selectedTreeIDs, treeRows);
  const isDragging = draggingTreeID === row.id;
  const triageDropTarget = onTriageMessagesDrop ? getTriageMessageDropTarget(row, treeRows) : null;
  const isExplorerDropTarget = dragOverTreeID === row.id;
  const isTriageDropTarget = triageDropTreeID === row.id;
  const rowFrameGradient = "linear-gradient(135deg, rgba(92, 238, 255, 0.92), rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86))";
  const selectedFrameSurface = isDarkTheme
    ? "linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(30, 41, 59, 0.78) 46%, rgba(58, 44, 92, 0.72))"
    : "linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(228, 251, 255, 0.64) 46%, rgba(247, 240, 255, 0.72))";
  const rowBackground = isTriageDropTarget ? "linear-gradient(90deg, rgba(34, 211, 238, 0.16), rgba(168, 85, 247, 0.12))" : isExplorerDropTarget ? dropRowBackground : undefined;
  const rowBoxShadow = isTriageDropTarget
    ? `inset 0 0 0 1px rgba(14, 165, 233, 0.38), inset 3px 0 0 ${accent}, 0 0 16px rgba(14, 165, 233, 0.16)`
    : isExplorerDropTarget && dragOverPlacement
    ? (dragOverPlacement === "before" ? `inset 0 2px 0 ${accent}` : `inset 0 -2px 0 ${accent}`)
    : "none";
  const hierarchyGuideColor = isDarkTheme ? "rgba(148, 163, 184, 0.26)" : "rgba(100, 116, 139, 0.22)";
  const hierarchyGuideDepth = Math.max(0, Math.floor(row.depth));
  const hierarchyConnectors = React.useMemo(() => Array.from({ length: hierarchyGuideDepth }, (_, level) => {
    const connectorDepth = level + 1;
    const hasLaterSibling = hasLaterVisibleSiblingAtDepth(treeRows, row.id, connectorDepth);
    if (connectorDepth < hierarchyGuideDepth && !hasLaterSibling) return null;
    return {
      isTerminal: connectorDepth === hierarchyGuideDepth && !hasLaterSibling,
      level,
    };
  }).filter((connector): connector is { isTerminal: boolean; level: number } => Boolean(connector)), [hierarchyGuideDepth, row.id, treeRows]);
  const rowPillStyle: React.CSSProperties = {
    position: "relative",
    zIndex: 1,
    minWidth: 0,
    maxWidth: "100%",
    width: renaming?.treeID === row.id ? "100%" : "fit-content",
    minHeight: 24,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 7px 2px 3px",
    border: "1px solid transparent",
    borderRadius: 10,
    background: isSelected ? `${selectedFrameSurface} padding-box, ${rowFrameGradient} border-box` : "transparent",
    boxShadow: isSelected
      ? "0 0 0 1px rgba(120, 224, 255, 0.14), 0 0 13px rgba(183, 124, 255, 0.2), inset 1px 1px 0 rgba(255, 255, 255, 0.82)"
      : "none",
    overflow: "hidden",
    transition: "background 120ms ease, box-shadow 140ms ease, transform 140ms ease",
    transform: isTriageDropTarget ? "translateX(1px)" : "none",
  };
  const toggleRowExpanded = React.useCallback(() => {
    if (!isExpandable) return;
    onSetExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }, [isExpandable, onSetExpanded, row.id]);

  return (
    <div
      className="company-explorer-row"
      data-company-explorer-row-id={row.id}
      draggable={!isSearchActive && !!rowDragPayload && renaming?.treeID !== row.id}
      onMouseDown={(event) => {
        if (event.button !== 0 || renaming?.treeID === row.id) return;
        if (!event.shiftKey && !event.ctrlKey && !event.metaKey) return;
        suppressModifiedClickRef.current = true;
        onSelectTreeRow(row, event, { selectionIntent: "navigate" });
      }}
      onClick={(event) => {
        if (suppressModifiedClickRef.current) {
          suppressModifiedClickRef.current = false;
          return;
        }
        onSelectTreeRow(row, event);
        if (isFolder && event.detail <= 1) toggleRowExpanded();
      }}
      onContextMenu={(event) => onOpenContextMenu(event, row)}
      onDragStart={(event) => {
        if (!rowDragPayload) {
          event.preventDefault();
          return;
        }
        const kanbanDragItems = getKanbanDragItemsForRow(row);
        const explorerDragRows = getExplorerItemRowsForPayload(rowDragPayload);
        if (!selectedTreeIDs.has(row.id)) onSelectTreeRow(row, undefined, { selectionIntent: "navigate" });
        onSetDraggingTreeID(row.id);
        onSetDragPayload(rowDragPayload);
        event.dataTransfer.effectAllowed = row.kind === "folder" ? "move" : "copyMove";
        const serialized = JSON.stringify(rowDragPayload);
        event.dataTransfer.setData(EXPLORER_DRAG_MIME, serialized);
        if (kanbanDragItems.length > 0) {
          const kanbanPayload = serializeExplorerEntityDragPayload(kanbanDragItems.length === 1
            ? { itemType: "node", nodeID: kanbanDragItems[0].nodeID, label: kanbanDragItems[0].label }
            : { itemType: "node_batch", nodes: kanbanDragItems });
          event.dataTransfer.setData(EXPLORER_ENTITY_DRAG_MIME, kanbanPayload);
          attachStackedDragPreview(
            event.dataTransfer,
            kanbanDragItems.map((item) => ({ label: item.label, color: rowIconColor })),
            KANBAN_DEFAULT_COLUMN_ITEM_COLOR,
            "Explorer nodes",
          );
        } else if (explorerDragRows.length > 1) {
          attachStackedDragPreview(
            event.dataTransfer,
            explorerDragRows.map((item) => ({ label: item.label, color: rowIconColor })),
            rowIconColor,
            row.kind === "logic_gate" ? "Explorer logic gates" : "Explorer items",
          );
        }
        event.dataTransfer.setData("text/plain", kanbanDragItems.length > 1 ? `${kanbanDragItems.length} nodes` : row.label);
      }}
      onDragEnd={() => {
        onSetDraggingTreeID("");
        onSetDragOverTreeID("");
        onSetDragOverPlacement(null);
        onSetDragPayload(null);
        onSetTriageDropTreeID("");
      }}
      onDragEnter={(event) => {
        if (!triageDropTarget || !hasTriageMessageDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        onSetTriageDropTreeID(row.id);
      }}
      onDragOver={(event) => {
        if (triageDropTarget && hasTriageMessageDrag(event.dataTransfer)) {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "copy";
          onSetTriageDropTreeID(row.id);
          return;
        }
        const payload = dragPayload ?? readExplorerDragPayload(event.dataTransfer);
        const sourceRow = treeRows.find((item) => item.id === draggingTreeID);
        const placement = row.kind === "folder" ? getExplorerDropIntent(event) : getExplorerRowReorderPlacement(event);
        const isDraggedItemRow = payload?.kind !== "folder" && getExplorerItemRowsForPayload(payload).some((item) => item.id === row.id);
        if (isDraggedItemRow) return;
        if (canDropExplorerPayloadOnRow(payload, row)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onSetDragOverTreeID(row.id);
          onSetDragOverPlacement(null);
          return;
        }
        if (payload?.kind === "folder" && placement !== "inside" && sourceRow && sourceRow.id !== row.id && getReorderRowsForTarget(sourceRow, row).length > 0) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onSetDragOverTreeID(row.id);
          onSetDragOverPlacement(placement);
          return;
        }
        if (payload?.kind === "folder" && placement !== "inside" && sourceRow && canPlaceExplorerFolderAtTarget(sourceRow, row)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onSetDragOverTreeID(row.id);
          onSetDragOverPlacement(placement);
          return;
        }
        if (payload?.kind !== "folder" && placement !== "inside" && canPlaceExplorerItemsAtTarget(payload, row)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          onSetDragOverTreeID(row.id);
          onSetDragOverPlacement(placement);
          return;
        }
        const dropTarget = resolveExplorerDropTarget(row, payload) ?? resolveExplorerRootDropTarget(row, payload);
        if (!dropTarget) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onSetDragOverTreeID(row.id);
        onSetDragOverPlacement(null);
      }}
      onDragLeave={(event) => {
        if (triageDropTarget && hasTriageMessageDrag(event.dataTransfer)) {
          onSetTriageDropTreeID((current) => (current === row.id ? "" : current));
          return;
        }
        onSetDragOverTreeID((current) => (current === row.id ? "" : current));
        onSetDragOverPlacement(null);
      }}
      onDrop={(event) => {
        if (triageDropTarget) {
          const triageMessageDrag = readTriageMessageDrag(event.dataTransfer);
          if (triageMessageDrag.messageIDs.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            onSetTriageDropTreeID("");
            onTriageMessagesDrop?.(triageDropTarget, triageMessageDrag.messageIDs, { x: event.clientX, y: event.clientY }, {
              companyID: triageMessageDrag.companyID,
              sharedInboxID: triageMessageDrag.sharedInboxID,
              accountEmail: triageMessageDrag.accountEmail,
            });
            return;
          }
        }
        const payload = dragPayload ?? readExplorerDragPayload(event.dataTransfer);
        const sourceRow = treeRows.find((item) => item.id === draggingTreeID);
        const placement = dragOverPlacement ?? (row.kind === "folder" ? getExplorerDropIntent(event) : getExplorerRowReorderPlacement(event));
        const dropTarget = resolveExplorerDropTarget(row, payload) ?? resolveExplorerRootDropTarget(row, payload);
        const isDraggedItemRow = payload?.kind !== "folder" && getExplorerItemRowsForPayload(payload).some((item) => item.id === row.id);
        onSetDragOverTreeID("");
        onSetDragOverPlacement(null);
        if (isDraggedItemRow) return;
        if (canDropExplorerPayloadOnRow(payload, row)) {
          event.preventDefault();
          void dropExplorerPayloadOnRow(payload, row);
          return;
        }
        if (payload?.kind === "folder" && placement !== "inside" && sourceRow && sourceRow.id !== row.id && getReorderRowsForTarget(sourceRow, row).length > 0) {
          event.preventDefault();
          void reorderExplorerRows(sourceRow, row, placement);
          return;
        }
        if (payload?.kind === "folder" && placement !== "inside" && sourceRow && canPlaceExplorerFolderAtTarget(sourceRow, row)) {
          event.preventDefault();
          void placeExplorerFolderAtTarget(sourceRow, row, placement);
          return;
        }
        if (payload?.kind !== "folder" && placement !== "inside" && canPlaceExplorerItemsAtTarget(payload, row)) {
          event.preventDefault();
          void placeExplorerItemsAtTarget(payload, row, placement);
          return;
        }
        if (!dropTarget || !payload) return;
        event.preventDefault();
        if (payload.kind === "folder" && payload.folderID) {
          void moveFolder(payload.folderID, dropTarget.folderID, { targetExpanded: expanded.has(dropTarget.treeID) });
          return;
        }
        void assignExplorerPayloadItemsToFolder(dropTarget.folderID, payload);
      }}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        minHeight: COMPANY_EXPLORER_TREE_ROW_HEIGHT,
        padding: "2px 8px",
        paddingLeft: TREE_BASE_LEFT_PX + row.depth * TREE_INDENT_PX,
        fontSize: 12,
        cursor: isFolder && isExpandable ? "pointer" : "default",
        opacity: isDragging ? 0.55 : 1,
        ["--company-explorer-hover-bg" as string]: isDarkTheme ? "rgba(255,255,255,0.07)" : "rgba(71, 85, 105, 0.12)",
        ["--company-explorer-selected-bg" as string]: selectedRowBackground,
        background: rowBackground,
        border: "1px solid transparent",
        borderRadius: 7,
        boxShadow: rowBoxShadow,
        transition: "background 120ms ease, box-shadow 140ms ease",
      }}
    >
      {hierarchyConnectors.length > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
          }}
        >
          {hierarchyConnectors.map(({ isTerminal, level }) => {
            const guideLeft = TREE_BASE_LEFT_PX + level * TREE_INDENT_PX + TREE_GUIDE_OFFSET_PX;
            if (isTerminal) {
              const connectorEndLeft = TREE_BASE_LEFT_PX + hierarchyGuideDepth * TREE_INDENT_PX + TREE_GUIDE_CONNECTOR_END_OFFSET_PX;
              const connectorWidth = Math.max(4, (connectorEndLeft - guideLeft) / 3);
              return (
                <span
                  key={level}
                  style={{
                    position: "absolute",
                    display: "block",
                    left: guideLeft,
                    top: -1,
                    bottom: -1,
                    width: connectorWidth,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      display: "block",
                      left: 0,
                      top: 0,
                      height: "calc(50% + 1px)",
                      width: 1,
                      background: hierarchyGuideColor,
                    }}
                  />
                  <span
                    style={{
                      position: "absolute",
                      display: "block",
                      left: 0,
                      top: "50%",
                      width: connectorWidth,
                      height: 1,
                      background: hierarchyGuideColor,
                    }}
                  />
                </span>
              );
            }
            return (
              <span
                key={level}
                style={{
                  position: "absolute",
                  display: "block",
                  left: guideLeft,
                  top: -1,
                  bottom: -1,
                  width: 1,
                  borderRadius: 999,
                  background: hierarchyGuideColor,
                }}
              />
            );
          })}
        </span>
      )}
      <div className="company-explorer-row-hit" data-selected={isSelected ? "true" : undefined} style={rowPillStyle}>
        {isExpandable ? (
          <button
            draggable={false}
            onMouseDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              toggleRowExpanded();
            }}
            style={{ border: "none", background: "transparent", width: TREE_TOGGLE_SLOT_PX, height: 20, cursor: "pointer", color: folderToggleColor, display: "grid", placeItems: "center", padding: 0, flexShrink: 0 }}
          >
            <ExplorerDisclosureIcon open={isOpen} color={folderToggleColor} />
          </button>
        ) : <span style={{ width: TREE_TOGGLE_SLOT_PX, flexShrink: 0 }} />}
        <ExplorerRowIcon
          kind={row.kind}
          systemKey={row.systemKey}
          mangoDefaultFolder={row.kind === "folder" && (Boolean(row.systemKey) || row.syntheticKind === "GVIC_folder" || row.syntheticKind === "default_scope_folder")}
        />
        {renaming?.treeID === row.id ? (
          <input
            ref={renameInputRef}
            value={renaming.value}
            onChange={(event) => onSetRenaming((current) => (current ? { ...current, value: event.target.value } : current))}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                if (renaming) void onCommitRename({ ...renaming, value: event.currentTarget.value });
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancelRenameOnBlurRef.current = true;
                onSetRenaming(null);
              }
            }}
            onBlur={(event) => {
              if (cancelRenameOnBlurRef.current) {
                cancelRenameOnBlurRef.current = false;
                return;
              }
              if (renaming) void onCommitRename({ ...renaming, value: event.currentTarget.value });
            }}
            style={{
              minWidth: 0,
              width: "100%",
              border: `1px solid ${accent}`,
              background: surfaceBackground,
              color: surfaceText,
              font: "inherit",
              fontSize: 12,
              padding: "1px 4px",
              outline: "none",
            }}
          />
        ) : (
          <span
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{
              minWidth: 0,
              flex: "1 1 auto",
              display: showPermissionMarker ? "grid" : "block",
              gridTemplateColumns: showPermissionMarker ? "minmax(0, 1fr) auto" : undefined,
              alignItems: "center",
              gap: showPermissionMarker ? 5 : undefined,
              overflow: "hidden",
              cursor: "default",
              userSelect: "none",
            }}
          >
            <span style={{ minWidth: 0, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
            {showPermissionMarker && (
              <span title="Permissions set" aria-label="Permissions set">
                <ExplorerPermissionLockIcon color={isDarkTheme ? "rgba(226, 232, 240, 0.74)" : "rgba(71, 85, 105, 0.78)"} />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
};
