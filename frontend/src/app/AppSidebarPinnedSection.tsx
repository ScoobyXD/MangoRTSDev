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
  buildSidebarPinTreeNodes,
  type SidebarPinDropPlacement,
  type SidebarPinTreeNode,
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
  const [raisedPinID, setRaisedPinID] = useState("");
  const [bumpingPinID, setBumpingPinID] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entries = useMemo(() => buildSidebarPinTreeNodes(tree, expandedFolderIDs), [expandedFolderIDs, tree]);

  useEffect(() => {
    if (!renamingFolderID || !renameInputRef.current) return;
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [renamingFolderID]);

  useEffect(() => () => {
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
  }, []);

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

  const handleInternalDrop = async (moving: SidebarPinEntryRef, row: SidebarPinTreeNode, placement: SidebarPinDropPlacement) => {
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

  const openPin = (pin: SidebarPin) => {
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
    setBumpingPinID(pin.pinID);
    bumpTimerRef.current = setTimeout(() => {
      setBumpingPinID((current) => current === pin.pinID ? "" : current);
      bumpTimerRef.current = null;
    }, 180);
    onPinOpen(pin);
  };

  const renderEntries = (nodes: SidebarPinTreeNode[]): React.ReactNode => nodes.map((row) => {
    const rowKey = `${row.entryType}:${row.entryID}`;
    const placement = dropTarget?.key === rowKey ? dropTarget.placement : null;
    const ref: SidebarPinEntryRef = { entryType: row.entryType, entryID: row.entryID };
    const pinRaised = row.entryType === "pin" && (raisedPinID === row.pin.pinID || bumpingPinID === row.pin.pinID);
    const expanded = row.entryType === "folder" && expandedFolderIDs.has(row.folder.folderID);
    return (
      <div
        key={rowKey}
        data-pin-entry={row.entryType}
        data-pin-entry-id={row.entryID}
        data-pin-depth={row.depth}
        data-pin-raised={pinRaised ? "true" : undefined}
        draggable={renamingFolderID !== row.entryID}
        style={pinEntryStyle(row.entryType, placement, pinRaised)}
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
          <fieldset data-pin-folder-frame={row.folder.folderID} style={folderFrameStyle(placement)}>
            <legend style={folderLegendStyle}>
              <button
                type="button"
                aria-label={expanded ? `Collapse ${row.folder.name}` : `Expand ${row.folder.name}`}
                style={disclosureButtonStyle}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedFolderIDs((current) => {
                    const next = new Set(current);
                    if (next.has(row.folder.folderID)) next.delete(row.folder.folderID);
                    else next.add(row.folder.folderID);
                    return next;
                  });
                }}
              >
                <ExplorerDisclosureIcon open={expanded} color="#475569" />
              </button>
              {renamingFolderID === row.folder.folderID ? (
                <input
                  ref={renameInputRef}
                  value={renameDraft}
                  aria-label="Pinned folder name"
                  style={renameInputStyle}
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onBlur={() => void finishRename(row.folder)}
                  onClick={(event) => event.stopPropagation()}
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
                  data-pin-folder-title={row.folder.folderID}
                  title="Click to rename; drag to move"
                  style={folderNameButtonStyle}
                  onClick={(event) => {
                    event.stopPropagation();
                    startRename(row.folder);
                  }}
                >
                  {row.folder.name}
                </button>
              )}
            </legend>
            {expanded && (
              <div data-pin-folder-contents={row.folder.folderID} style={folderContentsStyle}>
                {renderEntries(row.children)}
              </div>
            )}
          </fieldset>
        ) : (
          <div style={pinRowStyle}>
            <button
              type="button"
              style={pinButtonStyle}
              onMouseEnter={() => setRaisedPinID(row.pin.pinID)}
              onMouseLeave={() => setRaisedPinID((current) => current === row.pin.pinID ? "" : current)}
              onFocus={() => setRaisedPinID(row.pin.pinID)}
              onBlur={() => setRaisedPinID((current) => current === row.pin.pinID ? "" : current)}
              onClick={() => openPin(row.pin)}
            >
              <span style={rowIconStyle}><ExplorerRowIcon kind={row.pin.kind} /></span>
              <span style={rowTextStyle}>{row.pin.name}</span>
            </button>
            <button type="button" aria-label={`Unpin ${row.pin.name}`} style={removeButtonStyle} onClick={() => onPinRemove(row.pin)}>X</button>
          </div>
        )}
      </div>
    );
  });
  return (
    <section
      style={pinnedSectionStyle(dropActive || !!dropTarget)}
      aria-label="Pinned"
      data-sidebar-pinned-surface="elevated"
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
        {entries.length === 0 ? (
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
        ) : renderEntries(entries)}
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
  const surfaceShadow = "4px 5px 14px rgba(148, 163, 184, 0.2), -3px -3px 10px rgba(255, 255, 255, 0.82), inset 1px 1px 0 rgba(255, 255, 255, 0.76)";
  return {
    flex: "0 0 auto",
    display: "grid",
    gap: 7,
    minWidth: 0,
    boxSizing: "border-box",
    margin: "0 1px 8px",
    padding: "8px 7px 10px",
    border: "1px solid rgba(148, 163, 184, 0.24)",
    borderRadius: 11,
    background: "linear-gradient(145deg, rgba(255,255,255,.92), rgba(248,250,252,.78))",
    boxShadow: active ? `${surfaceShadow}, 0 0 0 2px rgba(14, 165, 233, 0.14)` : surfaceShadow,
    transition: "box-shadow 140ms ease",
  };
}

const headerStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) 22px",
  alignItems: "center",
  gap: 8,
  padding: "0 1px 0 2px",
  color: "#111111",
  fontSize: 12,
  fontWeight: 650,
};

const headerLineStyle: React.CSSProperties = { minWidth: 0, height: 1, background: "rgba(15, 23, 42, 0.12)" };
const addFolderButtonStyle: React.CSSProperties = { width: 22, height: 22, border: "1px solid rgba(100,116,139,.25)", borderRadius: 5, background: "rgba(255,255,255,.74)", color: "#334155", cursor: "pointer", lineHeight: 1 };
const pinListStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 4 };
const emptyStyle: React.CSSProperties = { minHeight: 34, display: "flex", alignItems: "center", padding: "0 6px", color: "rgba(15,23,42,.48)", fontSize: 11, fontWeight: 600 };

function pinEntryStyle(entryType: SidebarPinTreeNode["entryType"], placement: SidebarPinDropPlacement | null, raised: boolean): React.CSSProperties {
  const placementShadow = placement === "before"
    ? "inset 0 2px 0 rgba(71,85,105,.66)"
    : placement === "after"
      ? "inset 0 -2px 0 rgba(71,85,105,.66)"
      : placement === "inside"
        ? "inset 0 0 0 1px rgba(14,165,233,.36)"
        : undefined;
  return {
    position: "relative",
    minWidth: 0,
    borderRadius: 8,
    background: placement === "inside" ? "rgba(14,165,233,.06)" : raised ? "rgba(255,255,255,.76)" : "transparent",
    boxShadow: placementShadow ?? (raised ? "0 5px 12px rgba(100,116,139,.18), 0 1px 3px rgba(15,23,42,.08)" : "none"),
    transform: entryType === "pin" && raised ? "translateY(-2px)" : "translateY(0)",
    cursor: "grab",
    transition: "background 120ms ease, box-shadow 140ms ease, transform 120ms ease",
  };
}

function folderFrameStyle(placement: SidebarPinDropPlacement | null): React.CSSProperties {
  return {
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    margin: 0,
    padding: "3px 5px 6px 6px",
    border: `1px solid ${placement === "inside" ? "rgba(14,165,233,.42)" : "rgba(100,116,139,.28)"}`,
    borderRadius: 7,
    background: "transparent",
    boxShadow: "none",
  };
}

const folderLegendStyle: React.CSSProperties = {
  maxWidth: "calc(100% - 25px)",
  minWidth: 0,
  marginLeft: 18,
  padding: "0 3px",
  display: "inline-grid",
  gridTemplateColumns: "16px minmax(0, 1fr)",
  alignItems: "center",
  gap: 3,
  color: "#111827",
};
const folderContentsStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 4, padding: "3px 0 0 12px" };
const disclosureButtonStyle: React.CSSProperties = { width: 16, height: 22, display: "grid", placeItems: "center", border: 0, background: "transparent", cursor: "pointer", padding: 0 };
const folderNameButtonStyle: React.CSSProperties = { minWidth: 0, maxWidth: "100%", height: 24, border: 0, background: "transparent", color: "#111827", cursor: "grab", font: "inherit", fontSize: 11.5, fontWeight: 700, textAlign: "left", padding: "0 3px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const pinRowStyle: React.CSSProperties = { minWidth: 0, minHeight: 31, display: "grid", gridTemplateColumns: "minmax(0,1fr) 22px", alignItems: "center", gap: 3 };
const rowIconStyle: React.CSSProperties = { width: 22, height: 22, display: "grid", placeItems: "center", color: "#111" };
const pinButtonStyle: React.CSSProperties = { minWidth: 0, minHeight: 31, display: "grid", gridTemplateColumns: "22px minmax(0,1fr)", alignItems: "center", gap: 5, border: 0, borderRadius: 7, background: "transparent", color: "#111", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 600, padding: "0 6px", textAlign: "left" };
const rowTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const removeButtonStyle: React.CSSProperties = { width: 22, height: 22, display: "grid", placeItems: "center", border: "1px solid rgba(100,116,139,.22)", borderRadius: 5, background: "rgba(255,255,255,.58)", color: "rgba(15,23,42,.52)", cursor: "pointer", fontSize: 10 };
const renameInputStyle: React.CSSProperties = { width: "100%", minWidth: 0, height: 22, boxSizing: "border-box", border: "1px solid #64748b", borderRadius: 4, background: "rgba(255,255,255,.92)", color: "#111827", font: "inherit", fontSize: 11, fontWeight: 700, padding: "0 5px", outline: "none" };
const menuButtonStyle: React.CSSProperties = { width: "100%", minHeight: 31, border: 0, background: "transparent", color: "#111827", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600, textAlign: "left", padding: "0 12px" };
const successStyle: React.CSSProperties = { margin: "0 2px 5px", padding: "5px 7px", border: "1px solid rgba(34,197,94,.36)", borderRadius: 7, background: "linear-gradient(135deg,rgba(220,252,231,.96),rgba(187,247,208,.9))", color: "#166534", fontSize: 10, fontWeight: 800, lineHeight: 1.25 };
