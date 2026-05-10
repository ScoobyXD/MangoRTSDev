import type React from "react";

export type NodeMapCanvasContextMenuState = { x: number; y: number; worldX: number; worldY: number };
export type NodeMapNodeContextMenuState = { x: number; y: number; nodeID: string };
export type NodeMapRelationshipContextMenuState = { x: number; y: number; relationshipID: string };
export type NodeMapDeleteConfirmationState = { nodeIDs: string[]; relationshipIDs: string[] };
export type NodeMapRelationshipRole = "parent" | "peer" | "child";

type NodeMapContextMenusProps = {
  contextMenu: NodeMapCanvasContextMenuState | null;
  nodeContextMenu: NodeMapNodeContextMenuState | null;
  relationshipContextMenu: NodeMapRelationshipContextMenuState | null;
  confirmDelete: NodeMapDeleteConfirmationState | null;
  accent: string;
  panelSurface: string;
  panelSubtleSurface: string;
  panelText: string;
  panelMutedText: string;
  dialogButtonBackground: string;
  dialogPrimaryButtonText: string;
  dialogCancelButtonText: string;
  relationshipColorsEnabled: boolean;
  relationshipRoleColors: Record<NodeMapRelationshipRole, string>;
  selectedNodeIDs: Set<string>;
  selectedRelationshipIDs: Set<string>;
  contextMenuButtonStyle: React.CSSProperties;
  contextMenuDangerButtonStyle: React.CSSProperties;
  selectionBoxActive: boolean;
  statusMessage: string;
  error: string;
  onCreateNodeAtContext: (worldX: number, worldY: number) => void;
  onToggleRelationshipColors: () => void;
  onRelationshipRoleColorChange: (role: NodeMapRelationshipRole, color: string) => void;
  onFindNodeSelection: (nodeID: string) => void;
  onRenameNode: (nodeID: string) => void;
  onRequestDeleteNodes: (nodeIDs: string[]) => void;
  onDeleteRelationships: (relationshipIDs: string[]) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
};

export const NodeMapContextMenus: React.FC<NodeMapContextMenusProps> = ({
  contextMenu,
  nodeContextMenu,
  relationshipContextMenu,
  confirmDelete,
  accent,
  panelSurface,
  panelSubtleSurface,
  panelText,
  panelMutedText,
  dialogButtonBackground,
  dialogPrimaryButtonText,
  dialogCancelButtonText,
  relationshipColorsEnabled,
  relationshipRoleColors,
  selectedNodeIDs,
  selectedRelationshipIDs,
  contextMenuButtonStyle,
  contextMenuDangerButtonStyle,
  selectionBoxActive,
  statusMessage,
  error,
  onCreateNodeAtContext,
  onToggleRelationshipColors,
  onRelationshipRoleColorChange,
  onFindNodeSelection,
  onRenameNode,
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
          Create new node
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
              background: relationshipColorsEnabled ? "#34c759" : "#b7c0c7",
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
            ["Parent", "parent"],
            ["Peer", "peer"],
            ["Child", "child"],
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
        <button style={contextMenuButtonStyle} onClick={() => onFindNodeSelection(nodeContextMenu.nodeID)}>
          Find on Company Explorer
        </button>
        <button style={contextMenuButtonStyle} onClick={() => onRenameNode(nodeContextMenu.nodeID)}>
          Rename node
        </button>
        <button
          style={contextMenuDangerButtonStyle}
          onClick={() => {
            const ids = selectedNodeIDs.size > 0 ? Array.from(selectedNodeIDs) : [nodeContextMenu.nodeID];
            onRequestDeleteNodes(ids);
          }}
        >
          Delete node
        </button>
      </div>
    )}

    {relationshipContextMenu && (
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
          onClick={() => {
            const relationshipIDs = selectedRelationshipIDs.has(relationshipContextMenu.relationshipID)
              ? Array.from(selectedRelationshipIDs)
              : [relationshipContextMenu.relationshipID];
            onDeleteRelationships(relationshipIDs);
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
          background: error ? "rgba(178, 0, 32, 0.9)" : "rgba(0, 0, 0, 0.78)",
          color: "#ffffff",
          boxShadow: "0 6px 18px rgba(0,0,0,0.22)",
        }}
      >
        {error ? `Error: ${error}` : statusMessage}
      </div>
    )}

    {confirmDelete && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
        <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(255,136,32,0.45)", background: panelSurface, color: panelText, padding: 12, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700 }}>
            Are you sure you want to delete {confirmDelete.nodeIDs.length} node{confirmDelete.nodeIDs.length === 1 ? "" : "s"}
            {confirmDelete.relationshipIDs.length > 0 ? ` and ${confirmDelete.relationshipIDs.length} relationship line${confirmDelete.relationshipIDs.length === 1 ? "" : "s"}` : ""}?
          </div>
          <div style={{ fontSize: 11, lineHeight: 1.35, color: panelMutedText }}>
            This removes the selected node data immediately. Use Undo (Ctrl/Cmd + Z) if this was accidental.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button onClick={onConfirmDelete} style={{ border: "1px solid rgba(255,136,32,0.45)", background: dialogButtonBackground, color: dialogPrimaryButtonText, cursor: "pointer", fontWeight: 700 }}>Yes</button>
            <button onClick={onCancelDelete} style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: dialogCancelButtonText, background: dialogButtonBackground, cursor: "pointer", fontWeight: 700 }}>No</button>
          </div>
        </div>
      </div>
    )}
  </>
);
