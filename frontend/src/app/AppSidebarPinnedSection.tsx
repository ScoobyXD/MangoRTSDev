import React, { useEffect, useMemo, useRef, useState } from "react";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../icons/index.js";
import { getExplorerDropIntent } from "../modules/company-explorer/companyExplorerDragDrop.js";
import { ConfirmActionMenu, type ConfirmActionMenuPosition } from "./ConfirmActionMenu.js";
import FrameRightClickMenu from "./framerightclickmenu.js";
import {
  APP_SIDEBAR_PIN_DRAG_MIME,
  hasSidebarPinDrag,
  hasSidebarPinSectionDrop,
} from "./sidebarPinDrops.js";
import {
  buildSidebarPinTreeRows,
  type SidebarPinDropPlacement,
  type SidebarPinTreeRow,
} from "./sidebarPinTree.js";
import {
  type SidebarPin,
  type SidebarPinEntryRef,
  type SidebarPinFolder,
  type SidebarPinTree,
} from "./sidebarPins.js";

type AppSidebarPinnedSectionProps = {
  tree: SidebarPinTree;
  dropActive: boolean;
  dropSuccess: string;
  pinnedResourceDropBusy: boolean;
  onPinOpen: (pin: SidebarPin) => void;
  onPinOpenInNewTab: (pin: SidebarPin) => void;
  onPinRemove: (pin: SidebarPin) => void;
  onCreateFolder: (parentFolderID: string) => Promise<string | null>;
  onRenameFolder: (folder: SidebarPinFolder, name: string) => Promise<void>;
  onDeleteFolder: (folder: SidebarPinFolder) => Promise<void>;
  onMoveEntry: (moving: SidebarPinEntryRef, target: SidebarPinEntryRef | null, placement: SidebarPinDropPlacement) => void;
  onGroupPins: (dragged: SidebarPin, target: SidebarPin) => Promise<string | null>;
  onExternalDrop: (event: React.DragEvent<HTMLElement>, parentFolderID: string, target: SidebarPinEntryRef | null, placement: "before" | "after" | "inside") => void;
  pinAcceptsResourceDrag: (pin: SidebarPin, dataTransfer: DataTransfer) => boolean;
  onPinnedResourceDrop: (pin: SidebarPin, event: React.DragEvent<HTMLElement>) => boolean;
  onPinDragEnter: () => void;
  onPinDragLeave: () => void;
};

type PinContextMenu =
  | { kind: "pin"; x: number; y: number; pin: SidebarPin }
  | { kind: "folder"; x: number; y: number; folder: SidebarPinFolder };

export function AppSidebarPinnedSection(props: AppSidebarPinnedSectionProps): React.ReactElement {
  const {
    tree,
    dropActive,
    dropSuccess,
    pinnedResourceDropBusy,
    onPinOpen,
    onPinOpenInNewTab,
    onPinRemove,
    onCreateFolder,
    onRenameFolder,
    onDeleteFolder,
    onMoveEntry,
    onGroupPins,
    onExternalDrop,
    pinAcceptsResourceDrag,
    onPinnedResourceDrop,
    onPinDragEnter,
    onPinDragLeave,
  } = props;
  const [expandedFolderIDs, setExpandedFolderIDs] = useState<Set<string>>(new Set());
  const [renamingFolderID, setRenamingFolderID] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [contextMenu, setContextMenu] = useState<PinContextMenu | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ folder: SidebarPinFolder; position: ConfirmActionMenuPosition } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ key: string; placement: SidebarPinDropPlacement } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const rows = useMemo(() => buildSidebarPinTreeRows(tree, expandedFolderIDs), [expandedFolderIDs, tree]);

  useEffect(() => {
    if (renamingFolderID) renameInputRef.current?.focus();
  }, [renamingFolderID]);

  useEffect(() => {
    const existing = new Set(tree.folders.map((folder) => folder.folderID));
    setExpandedFolderIDs((current) => new Set(Array.from(current).filter((folderID) => existing.has(folderID))));
    if (renamingFolderID && !existing.has(renamingFolderID)) setRenamingFolderID("");
  }, [renamingFolderID, tree.folders]);

  const readDraggedEntry = (dataTransfer: DataTransfer): SidebarPinEntryRef | null => {
    if (!hasSidebarPinDrag(dataTransfer)) return null;
    try {
      const parsed = JSON.parse(dataTransfer.getData(APP_SIDEBAR_PIN_DRAG_MIME)) as Partial<SidebarPinEntryRef>;
      const entryID = typeof parsed.entryID === "string" ? parsed.entryID.trim() : "";
      if (!entryID || (parsed.entryType !== "folder" && parsed.entryType !== "pin")) return null;
      return { entryType: parsed.entryType, entryID };
    } catch {
      return null;
    }
  };

  const startRename = (folder: SidebarPinFolder) => {
    setContextMenu(null);
    setExpandedFolderIDs((current) => new Set(current).add(folder.folderID));
    setRenamingFolderID(folder.folderID);
    setRenameDraft(folder.name);
  };

  const finishRename = async (folder: SidebarPinFolder) => {
    const name = renameDraft.trim();
    setRenamingFolderID("");
    if (!name || name === folder.name) return;
    await onRenameFolder(folder, name);
  };

  const createFolder = async (parentFolderID: string) => {
    setContextMenu(null);
    const folderID = await onCreateFolder(parentFolderID);
    if (!folderID) return;
    if (parentFolderID) setExpandedFolderIDs((current) => new Set(current).add(parentFolderID));
    setExpandedFolderIDs((current) => new Set(current).add(folderID));
    setRenamingFolderID(folderID);
    setRenameDraft("New Folder");
  };

  const handleInternalDrop = async (moving: SidebarPinEntryRef, row: SidebarPinTreeRow, placement: SidebarPinDropPlacement) => {
    const target: SidebarPinEntryRef = { entryType: row.entryType, entryID: row.entryID };
    if (placement === "inside" && row.entryType === "pin" && moving.entryType === "pin") {
      const dragged = tree.pins.find((pin) => pin.pinID === moving.entryID);
      if (!dragged || dragged.pinID === row.pin.pinID) return;
      const folderID = await onGroupPins(dragged, row.pin);
      if (!folderID) return;
      setExpandedFolderIDs((current) => new Set(current).add(folderID));
      setRenamingFolderID(folderID);
      setRenameDraft("New Folder");
      return;
    }
    onMoveEntry(moving, target, placement);
    if (placement === "inside" && row.entryType === "folder") {
      setExpandedFolderIDs((current) => new Set(current).add(row.folder.folderID));
    }
  };

  return (
    <section
      style={pinnedSectionStyle(dropActive || !!dropTarget)}
      aria-label="Pinned"
      onDragEnter={(event) => {
        if (hasSidebarPinDrag(event.dataTransfer) || hasSidebarPinSectionDrop(event.dataTransfer) || tree.pins.some((pin) => pinAcceptsResourceDrag(pin, event.dataTransfer))) {
          onPinDragEnter();
        }
      }}
      onDragOver={(event) => {
        if (hasSidebarPinDrag(event.dataTransfer) || hasSidebarPinSectionDrop(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = hasSidebarPinDrag(event.dataTransfer) ? "move" : "copy";
          setDropTarget({ key: "__end__", placement: "after" });
        }
      }}
      onDragLeave={(event) => {
        const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (related && event.currentTarget.contains(related)) return;
        setDropTarget(null);
        onPinDragLeave();
      }}
      onDrop={(event) => {
        const moving = readDraggedEntry(event.dataTransfer);
        if (moving) {
          event.preventDefault();
          onMoveEntry(moving, null, "after");
        } else if (hasSidebarPinSectionDrop(event.dataTransfer)) {
          event.preventDefault();
          onExternalDrop(event, "", null, "after");
        }
        setDropTarget(null);
      }}
    >
      <div style={headerStyle}>
        <span>Pinned</span>
        <span style={headerLineStyle} />
        <button type="button" aria-label="Create pinned folder" title="Create folder" style={addFolderButtonStyle} onClick={() => void createFolder("")}>+</button>
      </div>
      {dropSuccess && <div role="status" style={successStyle}>{dropSuccess}</div>}
      <div style={pinListStyle}>
        {rows.length === 0 ? (
          <div
            style={emptyStyle}
            onDragOver={(event) => {
              if (!hasSidebarPinSectionDrop(event.dataTransfer)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => onExternalDrop(event, "", null, "inside")}
          >
            No pins
          </div>
        ) : rows.map((row) => {
          const rowKey = `${row.entryType}:${row.entryID}`;
          const placement = dropTarget?.key === rowKey ? dropTarget.placement : null;
          const ref: SidebarPinEntryRef = { entryType: row.entryType, entryID: row.entryID };
          return (
            <div
              key={rowKey}
              draggable={renamingFolderID !== row.entryID}
              style={treeRowStyle(row.depth, placement)}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(APP_SIDEBAR_PIN_DRAG_MIME, JSON.stringify(ref));
                event.dataTransfer.setData("text/plain", row.entryType === "folder" ? row.folder.name : row.pin.name);
                setDropTarget(null);
              }}
              onDragEnd={() => setDropTarget(null)}
              onDragLeave={(event) => {
                const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
                if (related && event.currentTarget.contains(related)) return;
                setDropTarget((current) => current?.key === rowKey ? null : current);
              }}
              onDragOver={(event) => {
                if (hasSidebarPinDrag(event.dataTransfer)) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget({ key: rowKey, placement: getExplorerDropIntent(event) });
                  return;
                }
                if (row.entryType === "pin" && pinAcceptsResourceDrag(row.pin, event.dataTransfer)) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "copy";
                  setDropTarget({ key: rowKey, placement: "inside" });
                  return;
                }
                if (hasSidebarPinSectionDrop(event.dataTransfer)) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "copy";
                  setDropTarget({ key: rowKey, placement: getExplorerDropIntent(event) });
                }
              }}
              onDrop={(event) => {
                const moving = readDraggedEntry(event.dataTransfer);
                const intent = getExplorerDropIntent(event);
                if (moving) {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleInternalDrop(moving, row, intent);
                  setDropTarget(null);
                  return;
                }
                if (row.entryType === "pin" && onPinnedResourceDrop(row.pin, event)) {
                  setDropTarget(null);
                  return;
                }
                if (hasSidebarPinSectionDrop(event.dataTransfer)) {
                  event.preventDefault();
                  event.stopPropagation();
                  const parentFolderID = intent === "inside" && row.entryType === "folder" ? row.folder.folderID : row.parentFolderID;
                  onExternalDrop(event, parentFolderID, ref, intent);
                  if (intent === "inside" && row.entryType === "folder") {
                    setExpandedFolderIDs((current) => new Set(current).add(row.folder.folderID));
                  }
                }
                setDropTarget(null);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu(row.entryType === "folder"
                  ? { kind: "folder", x: event.clientX, y: event.clientY, folder: row.folder }
                  : { kind: "pin", x: event.clientX, y: event.clientY, pin: row.pin });
              }}
            >
              {row.entryType === "folder" ? (
                <>
                  <button
                    type="button"
                    aria-label={expandedFolderIDs.has(row.folder.folderID) ? `Collapse ${row.folder.name}` : `Expand ${row.folder.name}`}
                    style={disclosureButtonStyle}
                    onClick={() => setExpandedFolderIDs((current) => {
                      const next = new Set(current);
                      if (next.has(row.folder.folderID)) next.delete(row.folder.folderID);
                      else next.add(row.folder.folderID);
                      return next;
                    })}
                  >
                    <ExplorerDisclosureIcon open={expandedFolderIDs.has(row.folder.folderID)} color="#475569" />
                  </button>
                  <span style={rowIconStyle}><ExplorerRowIcon kind="folder" /></span>
                  {renamingFolderID === row.folder.folderID ? (
                    <input
                      ref={renameInputRef}
                      value={renameDraft}
                      aria-label="Pinned folder name"
                      style={renameInputStyle}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={() => void finishRename(row.folder)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void finishRename(row.folder);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          setRenamingFolderID("");
                        }
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                    />
                  ) : (
                    <button
                      type="button"
                      style={folderNameButtonStyle}
                      onClick={() => setExpandedFolderIDs((current) => new Set(current).add(row.folder.folderID))}
                    >
                      {row.folder.name}
                    </button>
                  )}
                </>
              ) : (
                <>
                  <span style={pinSpacerStyle} />
                  <button type="button" style={pinButtonStyle} onClick={() => onPinOpen(row.pin)}>
                    <span style={rowIconStyle}><ExplorerRowIcon kind={row.pin.kind} /></span>
                    <span style={rowTextStyle}>{row.pin.name}</span>
                  </button>
                  <button type="button" aria-label={`Unpin ${row.pin.name}`} style={removeButtonStyle} onClick={() => onPinRemove(row.pin)}>X</button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {contextMenu?.kind === "pin" && (
        <FrameRightClickMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button type="button" style={menuButtonStyle} onClick={() => { onPinOpenInNewTab(contextMenu.pin); setContextMenu(null); }}>Open in new browser tab</button>
          <button type="button" style={menuButtonStyle} onClick={() => { onPinRemove(contextMenu.pin); setContextMenu(null); }}>Unpin</button>
        </FrameRightClickMenu>
      )}
      {contextMenu?.kind === "folder" && (
        <FrameRightClickMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <button type="button" style={menuButtonStyle} onClick={() => void createFolder(contextMenu.folder.folderID)}>Create folder inside</button>
          <button type="button" style={menuButtonStyle} onClick={() => startRename(contextMenu.folder)}>Rename</button>
          <button
            type="button"
            style={{ ...menuButtonStyle, color: "#dc2626" }}
            onClick={() => {
              setDeleteConfirmation({ folder: contextMenu.folder, position: { x: contextMenu.x, y: contextMenu.y } });
              setContextMenu(null);
            }}
          >
            Delete folder
          </button>
        </FrameRightClickMenu>
      )}
      {deleteConfirmation && (
        <ConfirmActionMenu
          title="Delete pinned folder"
          detail={`Delete ${deleteConfirmation.folder.name} and all pins and folders inside it? The underlying resources will not be deleted.`}
          position={deleteConfirmation.position}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          confirmDisabled={pinnedResourceDropBusy}
          onConfirm={() => {
            const folder = deleteConfirmation.folder;
            setDeleteConfirmation(null);
            void onDeleteFolder(folder);
          }}
          onCancel={() => setDeleteConfirmation(null)}
        />
      )}
    </section>
  );
}

function pinnedSectionStyle(active: boolean): React.CSSProperties {
  return {
    flex: "0 0 auto",
    display: "grid",
    gap: 7,
    minWidth: 0,
    padding: "0 0 10px",
    outline: active ? "2px solid rgba(148, 163, 184, 0.24)" : "2px solid transparent",
    outlineOffset: 2,
    borderRadius: 6,
  };
}

const headerStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) 22px",
  alignItems: "center",
  gap: 8,
  padding: "0 3px 0 6px",
  color: "#111111",
  fontSize: 12,
  fontWeight: 650,
};

const headerLineStyle: React.CSSProperties = { minWidth: 0, height: 1, background: "rgba(15, 23, 42, 0.12)" };
const addFolderButtonStyle: React.CSSProperties = { width: 22, height: 22, border: "1px solid rgba(100,116,139,.28)", borderRadius: 5, background: "#fff", cursor: "pointer", lineHeight: 1 };
const pinListStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 3, padding: "0 2px" };
const emptyStyle: React.CSSProperties = { minHeight: 34, display: "flex", alignItems: "center", padding: "0 6px", color: "rgba(15,23,42,.48)", fontSize: 11, fontWeight: 600 };

function treeRowStyle(depth: number, placement: SidebarPinDropPlacement | null): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: "16px 22px minmax(0, 1fr) 24px",
    alignItems: "center",
    gap: 3,
    paddingLeft: depth * 13,
    cursor: "grab",
    borderRadius: 7,
    background: placement === "inside" ? "rgba(14,165,233,.08)" : "transparent",
    boxShadow: placement === "before"
      ? "inset 0 2px 0 rgba(100,116,139,.58)"
      : placement === "after"
        ? "inset 0 -2px 0 rgba(100,116,139,.58)"
        : placement === "inside"
          ? "inset 0 0 0 2px rgba(14,165,233,.26)"
          : undefined,
  };
}

const disclosureButtonStyle: React.CSSProperties = { width: 16, height: 24, display: "grid", placeItems: "center", border: 0, background: "transparent", cursor: "pointer", padding: 0 };
const rowIconStyle: React.CSSProperties = { width: 22, height: 22, display: "grid", placeItems: "center", color: "#111" };
const folderNameButtonStyle: React.CSSProperties = { gridColumn: "3 / 5", minWidth: 0, height: 29, border: 0, background: "transparent", color: "#111", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 650, textAlign: "left", padding: "0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const pinSpacerStyle: React.CSSProperties = { width: 16 };
const pinButtonStyle: React.CSSProperties = { gridColumn: "2 / 4", minWidth: 0, minHeight: 31, display: "grid", gridTemplateColumns: "22px minmax(0,1fr)", alignItems: "center", gap: 5, border: "1px solid transparent", borderRadius: 6, background: "linear-gradient(#fff,#fff) padding-box, linear-gradient(135deg,rgba(92,238,255,.92),rgba(183,124,255,.88),rgba(255,255,255,.86)) border-box", color: "#111", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 600, padding: "0 6px", textAlign: "left" };
const rowTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const removeButtonStyle: React.CSSProperties = { width: 24, height: 24, display: "grid", placeItems: "center", border: "1px solid rgba(100,116,139,.28)", borderRadius: 5, background: "#fff", color: "rgba(15,23,42,.58)", cursor: "pointer", fontSize: 10 };
const renameInputStyle: React.CSSProperties = { gridColumn: "3 / 5", width: "calc(100% - 4px)", minWidth: 0, height: 24, border: "1px solid #334155", borderRadius: 4, background: "#fff", color: "#111827", font: "inherit", fontSize: 11, fontWeight: 700, padding: "0 6px", outline: "none" };
const menuButtonStyle: React.CSSProperties = { width: "100%", minHeight: 31, border: 0, background: "transparent", color: "#111827", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600, textAlign: "left", padding: "0 12px" };
const successStyle: React.CSSProperties = { margin: "0 2px 5px", padding: "5px 7px", border: "1px solid rgba(34,197,94,.36)", borderRadius: 7, background: "linear-gradient(135deg,rgba(220,252,231,.96),rgba(187,247,208,.9))", color: "#166534", fontSize: 10, fontWeight: 800, lineHeight: 1.25 };
