import type React from "react";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";

export type LogicGateMapCanvasContextMenuState = { x: number; y: number; worldX: number; worldY: number };
export type LogicGateMapNodeContextMenuState = { x: number; y: number; nodeID: string };
export type LogicGateMapRelationshipContextMenuState = { x: number; y: number; relationshipID: string };
export type LogicGateMapDeleteConfirmationState = { nodeIDs: string[]; relationshipIDs: string[]; position?: ConfirmActionMenuPosition | null };
export type LogicGateMapRelationshipRole = "input" | "output";

type LogicGateMapContextMenusProps = {
  contextMenu: LogicGateMapCanvasContextMenuState | null;
  nodeContextMenu: LogicGateMapNodeContextMenuState | null;
  relationshipContextMenu: LogicGateMapRelationshipContextMenuState | null;
  confirmDelete: LogicGateMapDeleteConfirmationState | null;
  accent: string;
  panelSurface: string;
  panelSubtleSurface: string;
  panelText: string;
  panelMutedText: string;
  relationshipColorsEnabled: boolean;
  relationshipRoleColors: Record<LogicGateMapRelationshipRole, string>;
  selectedNodeIDs: Set<string>;
  selectedRelationshipIDs: Set<string>;
  nodeContextMenuCanEdit: boolean;
  relationshipContextMenuCanEdit: boolean;
  contextMenuButtonStyle: React.CSSProperties;
  contextMenuDangerButtonStyle: React.CSSProperties;
  selectionBoxActive: boolean;
  statusMessage: string;
  error: string;
  onCreateNodeAtContext: (worldX: number, worldY: number) => void;
  onToggleRelationshipColors: () => void;
  onRelationshipRoleColorChange: (role: LogicGateMapRelationshipRole, color: string) => void;
  onFindNodeSelection: (nodeID: string) => void;
  onOpenNodeInNewTab: (nodeID: string) => void;
  onPinNode: (nodeID: string) => void;
  onRenameNode: (nodeID: string) => void;
  onOpenPermissions: (nodeID: string) => void;
  onRequestDeleteNodes: (nodeIDs: string[], position?: ConfirmActionMenuPosition) => void;
  onDeleteRelationships: (relationshipIDs: string[], position?: ConfirmActionMenuPosition) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

export const LogicGateMapContextMenus: React.FC<LogicGateMapContextMenusProps> = ({
  contextMenu,
  nodeContextMenu,
  relationshipContextMenu,
  confirmDelete,
  accent,
  panelSurface,
  panelSubtleSurface,
  panelText,
  relationshipColorsEnabled,
  relationshipRoleColors,
  selectedNodeIDs,
  selectedRelationshipIDs,
  nodeContextMenuCanEdit,
  relationshipContextMenuCanEdit,
  contextMenuButtonStyle,
  contextMenuDangerButtonStyle,
  selectionBoxActive,
  statusMessage,
  error,
  onCreateNodeAtContext,
  onToggleRelationshipColors,
  onRelationshipRoleColorChange,
  onFindNodeSelection,
  onOpenNodeInNewTab,
  onPinNode,
  onRenameNode,
  onOpenPermissions,
  onRequestDeleteNodes,
  onDeleteRelationships,
  onConfirmDelete,
  onCancelDelete,
}) => (
  <>
    {contextMenu && (
      <div
        style={{
          position: "absolute",
          left: contextMenu.x,
          top: contextMenu.y,
          background: panelSurface,
          border: `1px solid ${accent}`,
          borderRadius: 8,
          padding: 8,
          width: 232,
          boxSizing: "border-box",
          display: "grid",
          gap: 0,
          zIndex: 40,
          boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          style={{
            width: "100%",
            border: "1px solid rgba(0,0,0,0.16)",
            background: panelSubtleSurface,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            padding: "7px 8px",
            textAlign: "left",
            color: panelText,
            borderRadius: 0,
          }}
          onClick={() => onCreateNodeAtContext(contextMenu.worldX, contextMenu.worldY)}
        >
          Create new logic gate
        </button>
        <button
          style={{
            width: "100%",
            border: "1px solid rgba(0,0,0,0.16)",
            background: panelSubtleSurface,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            padding: "7px 8px",
            textAlign: "left",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            color: panelText,
            borderRadius: 0,
          }}
          onClick={onToggleRelationshipColors}
        >
          <span>Enable relationship colors</span>
          <span
            aria-hidden="true"
            style={{
              width: 28,
              height: 18,
              borderRadius: 999,
              background: relationshipColorsEnabled ? "#64748b" : "#b7c0c7",
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: relationshipColorsEnabled ? "flex-end" : "flex-start",
              padding: 2,
              boxSizing: "border-box",
              flexShrink: 0,
              transition: "background 120ms ease",
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: panelSurface,
                boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
              }}
            />
          </span>
        </button>
        <div
          style={{
            display: "grid",
            marginLeft: 16,
            gap: 0,
            opacity: relationshipColorsEnabled ? 1 : 0.68,
          }}
        >
          {([
            ["Input", "input"],
            ["Output", "output"],
          ] as const).map(([label, key], index) => (
            <label
              key={key}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                alignItems: "center",
                columnGap: 8,
                fontSize: 11,
                fontWeight: 700,
                padding: "6px 8px",
                border: "1px solid rgba(0,0,0,0.16)",
                borderTop: index === 0 ? "1px solid rgba(0,0,0,0.16)" : "0",
                borderRadius: 0,
                background: panelSubtleSurface,
              }}
            >
              <span>{label}</span>
              <input
                type="color"
                value={relationshipRoleColors[key]}
                onChange={(event) => onRelationshipRoleColorChange(key, event.target.value)}
              />
            </label>
          ))}
        </div>
      </div>
    )}

    {nodeContextMenu && (
      <div
        style={{
          position: "absolute",
          left: nodeContextMenu.x,
          top: nodeContextMenu.y,
          transform: "translate(8px, 8px)",
          background: panelSurface,
          border: `1px solid ${accent}`,
          borderRadius: 8,
          padding: 4,
          zIndex: 41,
          boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
          display: "grid",
          gap: 2,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button style={contextMenuButtonStyle} onClick={() => onOpenNodeInNewTab(nodeContextMenu.nodeID)}>
          Open in new browser tab
        </button>
        <button style={contextMenuButtonStyle} onClick={() => onFindNodeSelection(nodeContextMenu.nodeID)}>
          Find on Explorer
        </button>
        <button style={contextMenuButtonStyle} onClick={() => onPinNode(nodeContextMenu.nodeID)}>
          Pin Logic Gate
        </button>
        {nodeContextMenuCanEdit && (
          <button style={contextMenuButtonStyle} onClick={() => onRenameNode(nodeContextMenu.nodeID)}>
            Rename logic gate
          </button>
        )}
        <button style={contextMenuButtonStyle} onClick={() => onOpenPermissions(nodeContextMenu.nodeID)}>
          Permissions
        </button>
        {nodeContextMenuCanEdit && (
          <button
            style={contextMenuDangerButtonStyle}
            onClick={(event) => {
              const ids = selectedNodeIDs.size > 0 ? Array.from(selectedNodeIDs) : [nodeContextMenu.nodeID];
              onRequestDeleteNodes(ids, confirmMenuPositionFromElement(event.currentTarget));
            }}
          >
            Delete logic gate
          </button>
        )}
      </div>
    )}

    {relationshipContextMenu && relationshipContextMenuCanEdit && (
      <div
        style={{
          position: "absolute",
          left: relationshipContextMenu.x,
          top: relationshipContextMenu.y,
          transform: "translate(8px, 8px)",
          background: panelSurface,
          border: `1px solid ${accent}`,
          borderRadius: 8,
          padding: 4,
          zIndex: 41,
          boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
          display: "grid",
          gap: 2,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          style={contextMenuDangerButtonStyle}
          onClick={(event) => {
            const relationshipIDs = selectedRelationshipIDs.has(relationshipContextMenu.relationshipID)
              ? Array.from(selectedRelationshipIDs)
              : [relationshipContextMenu.relationshipID];
            onDeleteRelationships(relationshipIDs, confirmMenuPositionFromElement(event.currentTarget));
          }}
        >
          Delete relationship{selectedRelationshipIDs.size > 1 ? "s" : ""}
        </button>
      </div>
    )}

    {selectedNodeIDs.size > 1 && !selectionBoxActive && (
      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: 10,
          zIndex: 30,
          background: "rgba(0,0,0,0.75)",
          color: "#fff",
          padding: "4px 8px",
          borderRadius: 6,
          fontSize: 10,
        }}
      >
        Group selected: {selectedNodeIDs.size}
      </div>
    )}

    {(statusMessage || error) && (
      <div
        style={{
          position: "absolute",
          bottom: selectedNodeIDs.size > 1 && !selectionBoxActive ? 40 : 10,
          left: 10,
          zIndex: 31,
          maxWidth: 420,
          borderRadius: 8,
          padding: "6px 8px",
          fontSize: 11,
          fontFamily: "var(--mango-font-family)",
          background: error ? "rgba(51, 65, 85, 0.9)" : "rgba(0, 0, 0, 0.78)",
          color: "#ffffff",
          boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
        }}
      >
        {error ? `Error: ${error}` : statusMessage}
      </div>
    )}

    {confirmDelete && (
      <ConfirmActionMenu
        title={(
          <>
            Are you sure you want to delete {confirmDelete.nodeIDs.length} logic gate{confirmDelete.nodeIDs.length === 1 ? "" : "s"}
            {confirmDelete.relationshipIDs.length > 0 ? ` and ${confirmDelete.relationshipIDs.length} relationship line${confirmDelete.relationshipIDs.length === 1 ? "" : "s"}` : ""}?
          </>
        )}
        detail="This removes the selected logic gate data immediately. Use Undo (Ctrl/Cmd + Z) if this was accidental."
        position={confirmDelete.position}
        isDarkTheme={panelText !== "#111111"}
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    )}
  </>
);
