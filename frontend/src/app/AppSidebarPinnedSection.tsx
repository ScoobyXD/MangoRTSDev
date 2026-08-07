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
import {
  SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS,
  aggregateSidebarPinFolderStatusCounts,
  visibleSidebarLogicGateStatusCounts,
  type SidebarLogicGateStatusCountDefinition,
  type SidebarLogicGateStatusCounts,
} from "./sidebarLogicGateStatusCounts.js";

type AppSidebarPinnedSectionProps = {
  tree: SidebarPinTree;
  logicGateStatusCountsByID: Readonly<Record<string, SidebarLogicGateStatusCounts | undefined>>;
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

type PinGroupHover = {
  draggedPinID: string;
  targetPinID: string;
};

const PIN_GROUP_HOVER_DELAY_MS = 1000;

export function AppSidebarPinnedSection(props: AppSidebarPinnedSectionProps): React.ReactElement {
  const {
    tree,
    logicGateStatusCountsByID,
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
  const [activeRemovePinID, setActiveRemovePinID] = useState("");
  const [focusedFolderID, setFocusedFolderID] = useState("");
  const [pinGroupPreview, setPinGroupPreview] = useState<PinGroupHover | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const bumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeDraggedEntryRef = useRef<SidebarPinEntryRef | null>(null);
  const pinGroupHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinGroupHoverCandidateRef = useRef<PinGroupHover | null>(null);
  const armedPinGroupRef = useRef<PinGroupHover | null>(null);
  const entries = useMemo(() => buildSidebarPinTreeNodes(tree, expandedFolderIDs), [expandedFolderIDs, tree]);
  const folderStatusCountsByID = useMemo(
    () => aggregateSidebarPinFolderStatusCounts(tree, logicGateStatusCountsByID),
    [logicGateStatusCountsByID, tree],
  );

  useEffect(() => {
    if (!renamingFolderID || !renameInputRef.current) return;
    renameInputRef.current.focus();
    renameInputRef.current.select();
  }, [renamingFolderID]);

  useEffect(() => () => {
    if (bumpTimerRef.current) clearTimeout(bumpTimerRef.current);
    if (pinGroupHoverTimerRef.current) clearTimeout(pinGroupHoverTimerRef.current);
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

  const toggleFolder = (folderID: string) => {
    setExpandedFolderIDs((current) => {
      const next = new Set(current);
      if (next.has(folderID)) next.delete(folderID);
      else next.add(folderID);
      return next;
    });
  };

  const clearPinGroupHover = () => {
    if (pinGroupHoverTimerRef.current) clearTimeout(pinGroupHoverTimerRef.current);
    pinGroupHoverTimerRef.current = null;
    pinGroupHoverCandidateRef.current = null;
    armedPinGroupRef.current = null;
    setPinGroupPreview(null);
  };

  const updatePinGroupHover = (moving: SidebarPinEntryRef, row: SidebarPinTreeNode, placement: SidebarPinDropPlacement) => {
    if (placement !== "inside" || moving.entryType !== "pin" || row.entryType !== "pin" || moving.entryID === row.pin.pinID) {
      clearPinGroupHover();
      return;
    }
    const candidate: PinGroupHover = { draggedPinID: moving.entryID, targetPinID: row.pin.pinID };
    const current = pinGroupHoverCandidateRef.current;
    if (current?.draggedPinID === candidate.draggedPinID && current.targetPinID === candidate.targetPinID) return;
    clearPinGroupHover();
    pinGroupHoverCandidateRef.current = candidate;
    pinGroupHoverTimerRef.current = setTimeout(() => {
      const latest = pinGroupHoverCandidateRef.current;
      if (latest?.draggedPinID !== candidate.draggedPinID || latest.targetPinID !== candidate.targetPinID) return;
      pinGroupHoverTimerRef.current = null;
      armedPinGroupRef.current = candidate;
      setPinGroupPreview(candidate);
    }, PIN_GROUP_HOVER_DELAY_MS);
  };

  const handleInternalDrop = async (moving: SidebarPinEntryRef, row: SidebarPinTreeNode, placement: SidebarPinDropPlacement) => {
    const target: SidebarPinEntryRef = { entryType: row.entryType, entryID: row.entryID };
    const armedGroup = armedPinGroupRef.current;
    const groupingIsArmed = placement === "inside"
      && row.entryType === "pin"
      && moving.entryType === "pin"
      && armedGroup?.draggedPinID === moving.entryID
      && armedGroup.targetPinID === row.pin.pinID;
    clearPinGroupHover();
    if (placement === "inside" && row.entryType === "pin" && moving.entryType === "pin") {
      const dragged = tree.pins.find((pin) => pin.pinID === moving.entryID);
      if (!groupingIsArmed || !dragged || dragged.pinID === row.pin.pinID) return;
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

  const renderStatusCounts = (counts: SidebarLogicGateStatusCounts | undefined, reserveEmptySlots = false): React.ReactNode => {
    const visibleCounts = visibleSidebarLogicGateStatusCounts(counts);
    if (visibleCounts.length === 0 && !reserveEmptySlots) return null;
    const visibleByKey = new Map(visibleCounts.map((item) => [item.key, item]));
    return (
      <span data-pin-status-counts style={statusCountsStyle}>
        {SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS.map((definition) => {
          const item = visibleByKey.get(definition.key);
          return (
            <span key={definition.key} data-pin-status-slot={definition.key} style={statusCountSlotStyle}>
              {item && (
                <span
                  data-pin-status={item.key}
                  data-pin-status-count={item.count}
                  aria-label={`${item.label}: ${item.count}`}
                  title={`${item.label}: ${item.count}`}
                  style={statusCountStyle(item)}
                >
                  {item.count}
                </span>
              )}
            </span>
          );
        })}
      </span>
    );
  };

  const renderPinGroupPreviewRow = (pin: SidebarPin): React.ReactNode => (
    <div key={pin.pinID} data-pin-group-preview-entry={pin.pinID} style={pinGroupPreviewRowStyle}>
      <span style={pinGroupPreviewPinStyle}>
        <span style={rowIconStyle}><ExplorerRowIcon kind={pin.kind} /></span>
        <span style={rowTextStyle}>{pin.name}</span>
      </span>
      {renderStatusCounts(pin.kind === "logic_gate" ? logicGateStatusCountsByID[pin.id] : undefined, true)}
      <span aria-hidden="true" style={pinGroupPreviewRemoveSlotStyle} />
    </div>
  );

  const renderEntries = (nodes: SidebarPinTreeNode[]): React.ReactNode => nodes.map((row) => {
    const rowKey = `${row.entryType}:${row.entryID}`;
    const placement = dropTarget?.key === rowKey ? dropTarget.placement : null;
    const ref: SidebarPinEntryRef = { entryType: row.entryType, entryID: row.entryID };
    const pinRaised = row.entryType === "pin" && (raisedPinID === row.pin.pinID || bumpingPinID === row.pin.pinID);
    const expanded = row.entryType === "folder" && expandedFolderIDs.has(row.folder.folderID);
    const folderCounts = row.entryType === "folder" ? folderStatusCountsByID[row.folder.folderID] : undefined;
    const folderHasCounts = visibleSidebarLogicGateStatusCounts(folderCounts).length > 0;
    const isPinGroupPreviewSource = row.entryType === "pin" && pinGroupPreview?.draggedPinID === row.pin.pinID;
    const isPinGroupPreviewTarget = row.entryType === "pin" && pinGroupPreview?.targetPinID === row.pin.pinID;
    const previewDraggedPin = isPinGroupPreviewTarget
      ? tree.pins.find((pin) => pin.pinID === pinGroupPreview?.draggedPinID)
      : undefined;
    return (
      <div
        key={rowKey}
        data-pin-entry={row.entryType}
        data-pin-entry-id={row.entryID}
        data-pin-depth={row.depth}
        data-pin-raised={pinRaised ? "true" : undefined}
        draggable={renamingFolderID !== row.entryID}
        style={isPinGroupPreviewSource ? { display: "none" } : pinEntryStyle(row.entryType, isPinGroupPreviewTarget ? null : placement, pinRaised)}
        onDragStart={(event) => {
          event.stopPropagation();
          activeDraggedEntryRef.current = ref;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(APP_SIDEBAR_PIN_DRAG_MIME, JSON.stringify(ref));
          event.dataTransfer.setData("text/plain", row.entryType === "folder" ? row.folder.name : row.pin.name);
          clearPinGroupHover();
          setDropTarget(null);
        }}
        onDragEnd={(event) => {
          event.stopPropagation();
          activeDraggedEntryRef.current = null;
          clearPinGroupHover();
          setDropTarget(null);
        }}
        onDragLeave={(event) => {
          const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
          if (related && event.currentTarget.contains(related)) return;
          if (pinGroupHoverCandidateRef.current?.targetPinID === row.entryID) clearPinGroupHover();
          setDropTarget((current) => current?.key === rowKey ? null : current);
        }}
        onDragOver={(event) => {
          const moving = activeDraggedEntryRef.current ?? readDraggedEntry(event.dataTransfer);
          if (moving) {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            const intent = getPinDropIntent(event, row.entryType);
            updatePinGroupHover(moving, row, intent);
            setDropTarget({ key: rowKey, placement: intent });
            return;
          }
          clearPinGroupHover();
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
            setDropTarget({ key: rowKey, placement: getPinDropIntent(event, row.entryType) });
          }
        }}
        onDrop={(event) => {
          const moving = readDraggedEntry(event.dataTransfer) ?? activeDraggedEntryRef.current;
          const intent = getPinDropIntent(event, row.entryType);
          if (moving) {
            event.preventDefault();
            event.stopPropagation();
            void handleInternalDrop(moving, row, intent);
            activeDraggedEntryRef.current = null;
            setDropTarget(null);
            return;
          }
          if (row.entryType === "pin" && onPinnedResourceDrop(row.pin, event)) {
            clearPinGroupHover();
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
        {isPinGroupPreviewTarget && previewDraggedPin && row.entryType === "pin" ? (
          <fieldset data-pin-group-preview={row.pin.pinID} aria-label="New Folder preview" style={folderFrameStyle("inside")}>
            <legend style={folderLegendStyle(false)}>
              <span aria-hidden="true" style={previewDisclosureStyle}><ExplorerDisclosureIcon open color="#475569" /></span>
              <span style={pinGroupPreviewTitleStyle}>
                <ExplorerRowIcon kind="folder" />
                <span style={folderNameTextStyle}>New Folder</span>
              </span>
            </legend>
            <div style={folderContentsStyle}>
              {renderPinGroupPreviewRow(row.pin)}
              {renderPinGroupPreviewRow(previewDraggedPin)}
            </div>
          </fieldset>
        ) : row.entryType === "folder" ? (
          <fieldset data-pin-folder-frame={row.folder.folderID} style={folderFrameStyle(placement)}>
            <legend data-pin-drop-anchor={rowKey} style={folderLegendStyle(folderHasCounts)}>
              <button
                type="button"
                aria-label={expanded ? `Collapse ${row.folder.name}` : `Expand ${row.folder.name}`}
                style={disclosureButtonStyle}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFolder(row.folder.folderID);
                }}
              >
                <ExplorerDisclosureIcon open={expanded} color="#475569" />
              </button>
              {renamingFolderID === row.folder.folderID ? (
                <span style={folderRenameStyle}>
                  <ExplorerRowIcon kind="folder" />
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
                </span>
              ) : (
                <button
                  type="button"
                  data-pin-folder-title={row.folder.folderID}
                  data-pin-folder-title-focused={focusedFolderID === row.folder.folderID ? "true" : undefined}
                  title="Click to expand or collapse; right-click for folder actions; drag to move"
                  style={folderNameButtonStyle(focusedFolderID === row.folder.folderID)}
                  onFocus={() => setFocusedFolderID(row.folder.folderID)}
                  onBlur={() => setFocusedFolderID((current) => current === row.folder.folderID ? "" : current)}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFolder(row.folder.folderID);
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <ExplorerRowIcon kind="folder" />
                  <span style={folderNameTextStyle}>{row.folder.name}</span>
                </button>
              )}
              {folderHasCounts && <span data-pin-folder-status-column style={folderStatusColumnStyle}>{renderStatusCounts(folderCounts)}</span>}
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
            {renderStatusCounts(row.pin.kind === "logic_gate" ? logicGateStatusCountsByID[row.pin.id] : undefined, true)}
            <button
              type="button"
              aria-label={`Unpin ${row.pin.name}`}
              data-pin-remove-column="true"
              data-pin-remove-active={activeRemovePinID === row.pin.pinID ? "true" : undefined}
              style={removeButtonStyle(activeRemovePinID === row.pin.pinID)}
              onMouseEnter={() => setActiveRemovePinID(row.pin.pinID)}
              onMouseLeave={() => setActiveRemovePinID((current) => current === row.pin.pinID ? "" : current)}
              onFocus={() => setActiveRemovePinID(row.pin.pinID)}
              onBlur={() => setActiveRemovePinID((current) => current === row.pin.pinID ? "" : current)}
              onClick={() => onPinRemove(row.pin)}
            >
              X
            </button>
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
        if (activeDraggedEntryRef.current || hasSidebarPinDrag(event.dataTransfer) || hasSidebarPinSectionDrop(event.dataTransfer) || tree.pins.some((pin) => pinAcceptsResourceDrag(pin, event.dataTransfer))) {
          onPinDragEnter();
        }
      }}
      onDragOver={(event) => {
        if (activeDraggedEntryRef.current || hasSidebarPinDrag(event.dataTransfer) || hasSidebarPinSectionDrop(event.dataTransfer)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = activeDraggedEntryRef.current || hasSidebarPinDrag(event.dataTransfer) ? "move" : "copy";
          clearPinGroupHover();
          setDropTarget({ key: "__end__", placement: "after" });
        }
      }}
      onDragLeave={(event) => {
        const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (related && event.currentTarget.contains(related)) return;
        clearPinGroupHover();
        setDropTarget(null);
        onPinDragLeave();
      }}
      onDrop={(event) => {
        const moving = readDraggedEntry(event.dataTransfer) ?? activeDraggedEntryRef.current;
        if (moving) {
          event.preventDefault();
          clearPinGroupHover();
          onMoveEntry(moving, null, "after");
          activeDraggedEntryRef.current = null;
        } else if (hasSidebarPinSectionDrop(event.dataTransfer)) {
          event.preventDefault();
          clearPinGroupHover();
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
        <FrameRightClickMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel="Pinned folder actions"
          onClose={() => setContextMenu(null)}
          width={PIN_FOLDER_MENU_WIDTH}
          minWidth={PIN_FOLDER_MENU_WIDTH}
          maxWidth={PIN_FOLDER_MENU_WIDTH}
        >
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
    gap: 6,
    minWidth: 0,
    boxSizing: "border-box",
    margin: "0 1px 8px",
    padding: "8px 7px 9px",
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
const pinListStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 3 };
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
  const outline = placement === "inside" ? "rgba(14,165,233,.42)" : "rgba(100,116,139,.28)";
  return {
    position: "relative",
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
    margin: 0,
    padding: "2px 4px 4px 5px",
    border: 0,
    borderTop: `1px solid ${outline}`,
    borderBottom: `1px solid ${outline}`,
    borderRadius: 0,
    background: "transparent",
    backgroundImage: `linear-gradient(${outline}, ${outline}), linear-gradient(${outline}, ${outline}), linear-gradient(${outline}, ${outline}), linear-gradient(${outline}, ${outline})`,
    backgroundPosition: "left top, right top, left bottom, right bottom",
    backgroundRepeat: "no-repeat",
    backgroundSize: "1px 5px, 1px 5px, 1px 5px, 1px 5px",
    boxShadow: "none",
  };
}

function folderLegendStyle(hasCounts: boolean): React.CSSProperties {
  return {
    width: hasCounts ? "calc(100% - 35px)" : undefined,
    maxWidth: hasCounts ? "calc(100% - 35px)" : "calc(100% - 17px)",
    minWidth: 0,
    marginLeft: 11,
    padding: "0 2px",
    display: "inline-grid",
    gridTemplateColumns: hasCounts ? "14px minmax(0, 1fr) 74px" : "14px minmax(0, 1fr)",
    alignItems: "center",
    gap: 2,
    color: "#111827",
    boxSizing: "border-box",
  };
}
const folderContentsStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 3, marginRight: -4, padding: "2px 0 0 10px" };
const disclosureButtonStyle: React.CSSProperties = { width: 14, height: 20, display: "grid", placeItems: "center", border: 0, background: "transparent", cursor: "pointer", padding: 0 };
const previewDisclosureStyle: React.CSSProperties = { width: 14, height: 20, display: "grid", placeItems: "center" };
function folderNameButtonStyle(focused: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    maxWidth: "100%",
    height: 22,
    display: "grid",
    gridTemplateColumns: "15px minmax(0, 1fr)",
    alignItems: "center",
    gap: 4,
    border: 0,
    borderRadius: 5,
    outline: "none",
    background: focused ? "rgba(241,245,249,.82)" : "transparent",
    boxShadow: focused ? "inset 0 0 0 1px rgba(100,116,139,.24)" : "none",
    color: "#111827",
    cursor: "pointer",
    font: "inherit",
    fontSize: 11.5,
    fontWeight: 700,
    textAlign: "left",
    padding: "0 1px",
    overflow: "hidden",
  };
}
const folderNameTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const folderRenameStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "15px minmax(0, 1fr)", alignItems: "center", gap: 4 };
const pinGroupPreviewTitleStyle: React.CSSProperties = { minWidth: 0, height: 22, display: "grid", gridTemplateColumns: "15px minmax(0, 1fr)", alignItems: "center", gap: 4, color: "#111827", fontSize: 11.5, fontWeight: 700 };
const pinGroupPreviewRowStyle: React.CSSProperties = { minWidth: 0, minHeight: 29, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 22px", alignItems: "center", gap: 2 };
const pinGroupPreviewPinStyle: React.CSSProperties = { minWidth: 0, minHeight: 29, display: "grid", gridTemplateColumns: "20px minmax(0,1fr)", alignItems: "center", gap: 4, color: "#111", fontSize: 11.5, fontWeight: 600, padding: "0 5px" };
const pinGroupPreviewRemoveSlotStyle: React.CSSProperties = { width: 22, height: 22 };
const pinRowStyle: React.CSSProperties = { minWidth: 0, minHeight: 29, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto 22px", alignItems: "center", gap: 2 };
const rowIconStyle: React.CSSProperties = { width: 20, height: 20, display: "grid", placeItems: "center", color: "#111" };
const pinButtonStyle: React.CSSProperties = { minWidth: 0, minHeight: 29, display: "grid", gridTemplateColumns: "20px minmax(0,1fr)", alignItems: "center", gap: 4, border: 0, borderRadius: 7, background: "transparent", color: "#111", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 600, padding: "0 5px", textAlign: "left" };
const rowTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const statusCountsStyle: React.CSSProperties = { width: 74, display: "grid", gridTemplateColumns: "repeat(4, 17px)", alignItems: "center", justifyContent: "end", gap: 2, minWidth: 74, whiteSpace: "nowrap" };
const statusCountSlotStyle: React.CSSProperties = { width: 17, height: 17, display: "grid", placeItems: "center" };
const folderStatusColumnStyle: React.CSSProperties = { width: 74, height: 17, display: "block" };
function statusCountStyle(definition: SidebarLogicGateStatusCountDefinition): React.CSSProperties {
  return {
    minWidth: 17,
    height: 17,
    boxSizing: "border-box",
    display: "inline-grid",
    placeItems: "center",
    padding: "0 3px",
    border: `1px solid ${definition.borderColor}`,
    borderRadius: 4,
    backgroundColor: definition.color,
    backgroundImage: definition.gradient,
    color: definition.textColor,
    boxShadow: `0 3px 8px ${definition.glowColor}, inset 0 1px 0 rgba(255,255,255,.68)`,
    fontSize: 9.5,
    fontWeight: 850,
    lineHeight: 1,
  };
}
function removeButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${active ? "#ff2020" : "rgba(100,116,139,.22)"}`,
    borderRadius: 5,
    background: "rgba(255,255,255,.58)",
    color: active ? "#ff2020" : "rgba(15,23,42,.52)",
    cursor: "pointer",
    fontSize: 10,
    transition: "border-color 100ms ease, color 100ms ease",
  };
}
const renameInputStyle: React.CSSProperties = { width: "100%", minWidth: 0, height: 22, boxSizing: "border-box", border: "1px solid #64748b", borderRadius: 4, background: "rgba(255,255,255,.92)", color: "#111827", font: "inherit", fontSize: 11, fontWeight: 700, padding: "0 5px", outline: "none" };
const menuButtonStyle: React.CSSProperties = { width: "100%", minHeight: 31, border: 0, background: "transparent", color: "#111827", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600, textAlign: "left", padding: "0 12px" };
const successStyle: React.CSSProperties = { margin: "0 2px 5px", padding: "5px 7px", border: "1px solid rgba(34,197,94,.36)", borderRadius: 7, background: "linear-gradient(135deg,rgba(220,252,231,.96),rgba(187,247,208,.9))", color: "#166534", fontSize: 10, fontWeight: 800, lineHeight: 1.25 };

const PIN_FOLDER_MENU_WIDTH = 158;

function getPinDropIntent(event: React.DragEvent<HTMLElement>, entryType: SidebarPinTreeNode["entryType"]): SidebarPinDropPlacement {
  const anchor = entryType === "folder"
    ? event.currentTarget.querySelector<HTMLElement>("[data-pin-drop-anchor]") ?? event.currentTarget
    : event.currentTarget;
  return getExplorerDropIntent(event, anchor);
}
