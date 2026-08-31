import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import { buildHuddleLogicGateRoute } from "../../app/deepLinkRoutes";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../icons/index.js";
import { createRequestJSON } from "../api/requestJSON";
import { emitExplorerContextUpdated, EVENT_HUDDLE_EXPLORER_FIND_REQUESTED } from "../dashboardEvents.js";
import { HuddleNodePopup, type HuddleOpenResource } from "./HuddleResourceSurface";
import { HuddleBoardIcon, HuddleResourceIcon } from "./HuddleResourceIcon";

type Folder = { company_id: string; folder_id: string; parent_folder_id?: string | null; name: string };
type Item = { company_id: string; item_id: string; parent_folder_id?: string | null; resource_type: "huddle_logic_gate"; resource_id: string; name: string };
type Tree = { folders?: Folder[]; items?: Item[] };
type HuddleLogicGate = { company_id: string; huddle_logic_gate_id: string; header: string };
type DragEntry = { kind: "folder" | "item"; id: string };
type ContextMenuState =
  | { kind: "folder"; folder: Folder; x: number; y: number }
  | { kind: "item"; item: Item; x: number; y: number };
type ConfirmationState =
  | { kind: "folder"; folder: Folder; position: ConfirmActionMenuPosition }
  | { kind: "item"; item: Item; position: ConfirmActionMenuPosition };

const HUDDLE_EXPLORER_DRAG_MIME = "application/x-mangorts-huddle-explorer-entry";

function readDraggedEntry(dataTransfer: DataTransfer): DragEntry | null {
  try {
    const parsed = JSON.parse(dataTransfer.getData(HUDDLE_EXPLORER_DRAG_MIME)) as Partial<DragEntry>;
    if ((parsed.kind === "folder" || parsed.kind === "item") && typeof parsed.id === "string" && parsed.id.trim()) {
      return { kind: parsed.kind, id: parsed.id.trim() };
    }
  } catch {}
  return null;
}

function folderIsDescendant(folders: Folder[], candidateFolderID: string, ancestorFolderID: string): boolean {
  let cursor = candidateFolderID.trim();
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    if (cursor === ancestorFolderID) return true;
    visited.add(cursor);
    cursor = folders.find((folder) => folder.folder_id === cursor)?.parent_folder_id?.trim() ?? "";
  }
  return false;
}

export const HuddleExplorerSection: React.FC<{ apiBase: string; companyID: string; currentUserID: string }> = ({ apiBase, companyID, currentUserID }) => {
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const sectionRef = useRef<HTMLElement | null>(null);
  const draggingEntryRef = useRef<DragEntry | null>(null);
  const [tree, setTree] = useState<Tree>({ folders: [], items: [] });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedRowID, setSelectedRowID] = useState("");
  const [pendingRevealRowID, setPendingRevealRowID] = useState<string | null>(null);
  const [raisedRowID, setRaisedRowID] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [dropFolderID, setDropFolderID] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [error, setError] = useState("");
  const [openNode, setOpenNode] = useState<HuddleOpenResource | null>(null);

  const load = useCallback(async () => {
    if (!companyID) return;
    try {
      setTree(await requestJSON<Tree>(`/v1/huddle-explorer?company_id=${encodeURIComponent(companyID)}`));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Huddle Boards");
    }
  }, [companyID, requestJSON]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<HuddleOpenResource>).detail;
      if (!detail?.resourceID) return;
      if (detail.resourceType === "huddle_logic_gate") {
        setOpenNode(null);
        return;
      }
      if (detail.resourceType !== "huddle_node") return;
      setOpenNode(detail);
      void load();
    };
    window.addEventListener("mangorts:huddle-open", listener);
    return () => window.removeEventListener("mangorts:huddle-open", listener);
  }, [load]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string; selectRoot?: boolean; folderPathIDs?: string[] }>).detail;
      if (!detail || detail.companyID?.trim() !== companyID.trim()) return;
      setOpenNode(null);
      const folderPathIDs = Array.from(new Set((detail.folderPathIDs ?? []).map((id) => id.trim()).filter(Boolean)));
      if (detail.selectRoot || folderPathIDs.length === 0) {
        setSelectedRowID("");
        setPendingRevealRowID("root");
        return;
      }
      const folderID = folderPathIDs[folderPathIDs.length - 1];
      setExpanded((current) => new Set([...current, ...folderPathIDs]));
      setSelectedRowID(`folder:${folderID}`);
      setPendingRevealRowID(`folder:${folderID}`);
    };
    window.addEventListener(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, listener);
    return () => window.removeEventListener(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, listener);
  }, [companyID]);

  const folders = tree.folders ?? [];
  const items = tree.items ?? [];
  useEffect(() => {
    if (pendingRevealRowID === null) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (pendingRevealRowID === "root") {
        sectionRef.current?.focus({ preventScroll: true });
        sectionRef.current?.scrollIntoView({ block: "nearest" });
        setPendingRevealRowID(null);
        return;
      }
      if (!pendingRevealRowID.startsWith("folder:")) return;
      const folderID = pendingRevealRowID.slice("folder:".length);
      const target = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-huddle-folder-id]") ?? [])
        .find((element) => element.dataset.huddleFolderId === folderID);
      if (!target) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
      setPendingRevealRowID(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, pendingRevealRowID, tree]);

  const runMutation = async (action: () => Promise<void>, fallback: string) => {
    try {
      setError("");
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
    }
  };
  const createFolder = async (parentFolderID = "") => {
    const name = window.prompt("Folder name", "New Folder")?.trim();
    if (!name) return;
    await runMutation(async () => {
      await requestJSON("/v1/huddle-explorer/folders", { method: "POST", json: { company_id: companyID, parent_folder_id: parentFolderID, name } });
      emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
      if (parentFolderID) setExpanded((current) => new Set([...current, parentFolderID]));
      await load();
    }, "Could not create folder");
  };
  const createHuddle = async () => {
    const header = window.prompt("Huddle Board name", "New Huddle Board")?.trim();
    if (!header) return;
    await runMutation(async () => {
      const payload = await requestJSON<{ huddle_logic_gate: HuddleLogicGate }>("/v1/huddle-logic-gates", {
        method: "POST",
        json: { company_id: companyID, header },
      });
      const created = payload.huddle_logic_gate;
      emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
      await load();
      window.dispatchEvent(new CustomEvent<HuddleOpenResource>("mangorts:huddle-open", {
        detail: { resourceType: "huddle_logic_gate", resourceID: created.huddle_logic_gate_id, name: created.header },
      }));
    }, "Could not create Huddle Board");
  };
  const renameFolder = async (folder: Folder) => {
    const name = window.prompt("Folder name", folder.name)?.trim();
    if (!name || name === folder.name) return;
    await runMutation(async () => {
      await requestJSON(`/v1/huddle-explorer/folders/${encodeURIComponent(folder.folder_id)}`, { method: "PUT", json: { company_id: companyID, name } });
      emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
      await load();
    }, "Could not rename folder");
  };
  const renameItem = async (item: Item) => {
    const header = window.prompt("Huddle Board name", item.name)?.trim();
    if (!header || header === item.name) return;
    await runMutation(async () => {
      await requestJSON(`/v1/huddle-logic-gates/${encodeURIComponent(item.resource_id)}`, { method: "PUT", json: { company_id: companyID, header } });
      emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
      await load();
    }, "Could not rename Huddle Board");
  };
  const deleteFolder = async (folder: Folder) => {
    await runMutation(async () => {
      await requestJSON(`/v1/huddle-explorer/folders/${encodeURIComponent(folder.folder_id)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
      await load();
    }, "Could not delete folder");
  };
  const moveFolder = async (folder: Folder, parentFolderID: string) => {
    if ((folder.parent_folder_id ?? "") === parentFolderID) return;
    await requestJSON(`/v1/huddle-explorer/folders/${encodeURIComponent(folder.folder_id)}`, { method: "PUT", json: { company_id: companyID, parent_folder_id: parentFolderID } });
  };
  const moveItem = async (item: Item, parentFolderID: string) => {
    if ((item.parent_folder_id ?? "") === parentFolderID) return;
    await requestJSON(`/v1/huddle-explorer/items/${encodeURIComponent(item.item_id)}`, { method: "PUT", json: { company_id: companyID, parent_folder_id: parentFolderID } });
  };
  const moveEntry = async (entry: DragEntry, parentFolderID: string) => {
    if (entry.kind === "folder" && parentFolderID && folderIsDescendant(folders, parentFolderID, entry.id)) return;
    await runMutation(async () => {
      if (entry.kind === "folder") {
        const folder = folders.find((candidate) => candidate.folder_id === entry.id);
        if (!folder) return;
        await moveFolder(folder, parentFolderID);
      } else {
        const item = items.find((candidate) => candidate.item_id === entry.id);
        if (!item) return;
        await moveItem(item, parentFolderID);
      }
      emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
      if (parentFolderID) setExpanded((current) => new Set([...current, parentFolderID]));
      await load();
    }, "Could not move Huddle Boards entry");
  };
  const removePlacement = async (item: Item) => {
    await runMutation(async () => {
      await requestJSON(`/v1/huddle-explorer/items/${encodeURIComponent(item.item_id)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
      await load();
    }, "Could not remove Huddle Board placement");
  };
  const toggleFolder = (folderID: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(folderID)) next.delete(folderID);
    else next.add(folderID);
    return next;
  });
  const openItem = (item: Item) => {
    setSelectedRowID(`item:${item.item_id}`);
    const detail: HuddleOpenResource = { resourceType: item.resource_type, resourceID: item.resource_id, name: item.name };
    window.dispatchEvent(new CustomEvent("mangorts:huddle-open", { detail }));
  };
  const openItemInNewTab = (item: Item) => {
    const opened = window.open(buildHuddleLogicGateRoute(item.resource_id), "_blank", "noopener,noreferrer");
    if (opened) opened.opener = null;
  };
  const beginDrag = (event: React.DragEvent<HTMLElement>, entry: DragEntry) => {
    draggingEntryRef.current = entry;
    setDragActive(true);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(HUDDLE_EXPLORER_DRAG_MIME, JSON.stringify(entry));
  };
  const clearDrag = () => {
    draggingEntryRef.current = null;
    setDragActive(false);
    setDropFolderID(null);
  };
  const draggedEntry = (event: React.DragEvent<HTMLElement>) => readDraggedEntry(event.dataTransfer) ?? draggingEntryRef.current;
  const canDropInsideFolder = (entry: DragEntry | null, folderID: string) => Boolean(entry)
    && !(entry?.kind === "folder" && folderIsDescendant(folders, folderID, entry.id));
  const folderIsEmpty = (folder: Folder) => !folders.some((candidate) => (candidate.parent_folder_id ?? "") === folder.folder_id)
    && !items.some((candidate) => (candidate.parent_folder_id ?? "") === folder.folder_id);

  const renderLevel = (parentID: string, depth: number): React.ReactNode => (
    <>
      {folders.filter((folder) => (folder.parent_folder_id ?? "") === parentID).map((folder) => {
        const rowID = `folder:${folder.folder_id}`;
        const open = expanded.has(folder.folder_id);
        const raised = raisedRowID === rowID || selectedRowID === rowID;
        const dropActive = dropFolderID === folder.folder_id;
        return (
          <div key={folder.folder_id}>
            <div
              draggable
              data-huddle-explorer-row="folder"
              data-huddle-row-raised={raisedRowID === rowID ? "true" : undefined}
              data-huddle-drop-active={dropActive ? "true" : undefined}
              onMouseEnter={() => setRaisedRowID(rowID)}
              onMouseLeave={() => setRaisedRowID((current) => current === rowID ? "" : current)}
              onContextMenu={(event) => { event.preventDefault(); setContextMenu({ kind: "folder", folder, x: event.clientX, y: event.clientY }); }}
              onDragStart={(event) => beginDrag(event, { kind: "folder", id: folder.folder_id })}
              onDragEnd={clearDrag}
              onDragOver={(event) => {
                if (!canDropInsideFolder(draggedEntry(event), folder.folder_id)) return;
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "move";
                setDropFolderID(folder.folder_id);
              }}
              onDragLeave={(event) => {
                const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
                if (related && event.currentTarget.contains(related)) return;
                setDropFolderID((current) => current === folder.folder_id ? null : current);
              }}
              onDrop={(event) => {
                const entry = draggedEntry(event);
                if (!canDropInsideFolder(entry, folder.folder_id) || !entry) return;
                event.preventDefault();
                event.stopPropagation();
                clearDrag();
                void moveEntry(entry, folder.folder_id);
              }}
              style={{ ...rowStyle(raised, dropActive), paddingLeft: 3 + depth * 14 }}
            >
              <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`} onClick={() => toggleFolder(folder.folder_id)} style={disclosureButtonStyle}><ExplorerDisclosureIcon open={open} color="#475569" /></button>
              <button type="button" data-huddle-folder-id={folder.folder_id} aria-current={selectedRowID === rowID ? "location" : undefined} title="Click to expand or collapse; right-click for folder actions; drag to move" onClick={() => { setSelectedRowID(rowID); toggleFolder(folder.folder_id); }} style={folderNameButtonStyle}><ExplorerRowIcon kind="folder" /><span style={rowTextStyle}>{folder.name}</span></button>
            </div>
            {open && <div style={folderContentsStyle}>{renderLevel(folder.folder_id, depth + 1)}</div>}
          </div>
        );
      })}
      {items.filter((item) => (item.parent_folder_id ?? "") === parentID).map((item) => {
        const rowID = `item:${item.item_id}`;
        const raised = raisedRowID === rowID || selectedRowID === rowID;
        return (
          <div
            key={item.item_id}
            draggable
            data-huddle-explorer-row={item.resource_type}
            data-huddle-row-raised={raisedRowID === rowID ? "true" : undefined}
            onMouseEnter={() => setRaisedRowID(rowID)}
            onMouseLeave={() => setRaisedRowID((current) => current === rowID ? "" : current)}
            onContextMenu={(event) => { event.preventDefault(); setContextMenu({ kind: "item", item, x: event.clientX, y: event.clientY }); }}
            onDragStart={(event) => beginDrag(event, { kind: "item", id: item.item_id })}
            onDragEnd={clearDrag}
            style={{ ...itemRowStyle(raised), paddingLeft: 18 + depth * 14 }}
          >
            <button type="button" title="Click to open; right-click for Huddle Board actions; drag to move" onClick={() => openItem(item)} style={itemNameButtonStyle}>
              <HuddleResourceIcon type={item.resource_type} />
              <span style={rowTextStyle}>{item.name}</span>
            </button>
          </div>
        );
      })}
    </>
  );

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Huddle Boards"
      data-sidebar-huddles-surface="elevated"
      style={sectionStyle(dropFolderID === "")}
    >
      <div style={headerStyle}>
        <span style={headerTitleStyle}><HuddleBoardIcon color="#6d28d9" size={15} /><span>Huddle Boards</span></span>
        <span style={headerLineStyle} />
        <span style={headerActionsStyle}>
          <button type="button" aria-label="Create Huddle Board" title="Create Huddle Board" onClick={() => void createHuddle()} style={addButtonStyle}>+ Board</button>
          <button type="button" aria-label="Create Huddle Board folder" title="Create folder" onClick={() => void createFolder()} style={addButtonStyle}>+ Folder</button>
        </span>
      </div>
      {error && <span role="alert" style={errorStyle}>{error}</span>}
      {dragActive && (
        <div
          role="group"
          aria-label="Move to Huddle Boards root"
          data-huddle-root-drop-target="true"
          style={rootDropZoneStyle(dropFolderID === "")}
          onDragOver={(event) => {
            if (!draggedEntry(event)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDropFolderID("");
          }}
          onDragLeave={() => setDropFolderID((current) => current === "" ? null : current)}
          onDrop={(event) => {
            const entry = draggedEntry(event);
            if (!entry) return;
            event.preventDefault();
            event.stopPropagation();
            clearDrag();
            void moveEntry(entry, "");
          }}
        >
          Move to root
        </div>
      )}
      <div style={treeStyle}>
        {renderLevel("", 0)}
        {folders.length + items.length === 0 && <span style={emptyStyle}>No Huddle Boards yet</span>}
      </div>
      {contextMenu?.kind === "item" && (
        <FrameRightClickMenu x={contextMenu.x} y={contextMenu.y} ariaLabel="Huddle Board actions" onClose={() => setContextMenu(null)} width={202}>
          <button type="button" style={menuButtonStyle} onClick={() => { openItemInNewTab(contextMenu.item); setContextMenu(null); }}>Open in new browser tab</button>
          <button type="button" style={menuButtonStyle} onClick={() => { const item = contextMenu.item; setContextMenu(null); void renameItem(item); }}>Rename</button>
          <button type="button" style={{ ...menuButtonStyle, color: "#be123c" }} onClick={() => { setConfirmation({ kind: "item", item: contextMenu.item, position: { x: contextMenu.x, y: contextMenu.y } }); setContextMenu(null); }}>Remove from Huddle Boards</button>
        </FrameRightClickMenu>
      )}
      {contextMenu?.kind === "folder" && (
        <FrameRightClickMenu x={contextMenu.x} y={contextMenu.y} ariaLabel="Huddle Board folder actions" onClose={() => setContextMenu(null)} width={180}>
          <button type="button" style={menuButtonStyle} onClick={() => { const folder = contextMenu.folder; setContextMenu(null); void createFolder(folder.folder_id); }}>Create folder inside</button>
          <button type="button" style={menuButtonStyle} onClick={() => { const folder = contextMenu.folder; setContextMenu(null); void renameFolder(folder); }}>Rename</button>
          <button
            type="button"
            disabled={!folderIsEmpty(contextMenu.folder)}
            title={folderIsEmpty(contextMenu.folder) ? "Move this empty folder to the Recycle Bin" : "Move or remove this folder's contents first"}
            style={{ ...menuButtonStyle, color: "#be123c", opacity: folderIsEmpty(contextMenu.folder) ? 1 : 0.48, cursor: folderIsEmpty(contextMenu.folder) ? "pointer" : "not-allowed" }}
            onClick={() => {
              if (!folderIsEmpty(contextMenu.folder)) return;
              setConfirmation({ kind: "folder", folder: contextMenu.folder, position: { x: contextMenu.x, y: contextMenu.y } });
              setContextMenu(null);
            }}
          >
            Delete empty folder
          </button>
        </FrameRightClickMenu>
      )}
      {confirmation?.kind === "item" && (
        <ConfirmActionMenu
          title="Remove from Huddle Boards"
          detail={`Remove “${confirmation.item.name}” from Huddle Boards? The Huddle Board and its Huddle Nodes will not be deleted.`}
          position={confirmation.position}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          requireDisplayNameConfirmation={false}
          onConfirm={() => { const item = confirmation.item; setConfirmation(null); void removePlacement(item); }}
          onCancel={() => setConfirmation(null)}
        />
      )}
      {confirmation?.kind === "folder" && (
        <ConfirmActionMenu
          title="Delete empty folder"
          detail={`Move the empty folder “${confirmation.folder.name}” to the Recycle Bin?`}
          position={confirmation.position}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          requireDisplayNameConfirmation={false}
          onConfirm={() => { const folder = confirmation.folder; setConfirmation(null); void deleteFolder(folder); }}
          onCancel={() => setConfirmation(null)}
        />
      )}
      {openNode && <HuddleNodePopup apiBase={apiBase} companyID={companyID} currentUserID={currentUserID} resource={openNode} requestJSON={requestJSON} onClose={() => { setOpenNode(null); void load(); }} />}
    </section>
  );
};

function sectionStyle(dropActive: boolean): React.CSSProperties {
  const surfaceShadow = "4px 5px 14px rgba(148,163,184,.2), -3px -3px 10px rgba(255,255,255,.82), inset 1px 1px 0 rgba(255,255,255,.76)";
  return { flex: "0 0 auto", minWidth: 0, display: "grid", gap: 6, margin: "0 1px 8px", padding: "8px 7px 9px", border: "1px solid rgba(148,163,184,.24)", borderRadius: 11, background: "linear-gradient(145deg,rgba(255,255,255,.92),rgba(248,250,252,.78))", boxShadow: dropActive ? `${surfaceShadow}, 0 0 0 2px rgba(109,40,217,.16)` : surfaceShadow, transition: "box-shadow 140ms ease" };
}
const headerStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", alignItems: "center", gap: 8, padding: "0 1px 0 2px", color: "#111827", fontSize: 12, fontWeight: 650 };
const headerTitleStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" };
const headerLineStyle: React.CSSProperties = { minWidth: 0, height: 1, background: "rgba(15,23,42,.12)" };
const headerActionsStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 4 };
const addButtonStyle: React.CSSProperties = { minWidth: 58, height: 22, border: "1px solid rgba(100,116,139,.25)", borderRadius: 5, background: "rgba(255,255,255,.74)", color: "#334155", cursor: "pointer", padding: "0 6px", font: "inherit", fontSize: 10.5, fontWeight: 700 };
const treeStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 3 };
function rootDropZoneStyle(active: boolean): React.CSSProperties { return { minHeight: 24, display: "grid", placeItems: "center", border: `1px dashed ${active ? "rgba(109,40,217,.65)" : "rgba(100,116,139,.34)"}`, borderRadius: 7, background: active ? "rgba(109,40,217,.08)" : "rgba(248,250,252,.68)", color: active ? "#6d28d9" : "#64748b", fontSize: 10.5, fontWeight: 750, transition: "background 120ms ease,border-color 120ms ease" }; }
const folderContentsStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 3 };
function rowStyle(raised: boolean, dropActive = false): React.CSSProperties { return { minWidth: 0, minHeight: 29, display: "grid", gridTemplateColumns: "14px minmax(0,1fr)", alignItems: "center", gap: 2, borderRadius: 8, background: dropActive ? "rgba(109,40,217,.08)" : raised ? "rgba(255,255,255,.78)" : "transparent", boxShadow: dropActive ? "inset 0 0 0 1px rgba(109,40,217,.34)" : raised ? "0 5px 12px rgba(100,116,139,.18), 0 1px 3px rgba(15,23,42,.08)" : "none", transform: raised ? "translateY(-2px)" : "translateY(0)", cursor: "grab", transition: "background 120ms ease,box-shadow 140ms ease,transform 120ms ease" }; }
function itemRowStyle(raised: boolean): React.CSSProperties { return { ...rowStyle(raised), gridTemplateColumns: "minmax(0,1fr)" }; }
const disclosureButtonStyle: React.CSSProperties = { width: 14, height: 22, display: "grid", placeItems: "center", border: 0, background: "transparent", cursor: "pointer", padding: 0 };
const folderNameButtonStyle: React.CSSProperties = { minWidth: 0, height: 29, display: "grid", gridTemplateColumns: "17px minmax(0,1fr)", alignItems: "center", gap: 5, border: 0, background: "transparent", color: "#111827", cursor: "pointer", padding: "0 3px", textAlign: "left", font: "inherit", fontSize: 11.5, fontWeight: 700 };
const itemNameButtonStyle: React.CSSProperties = { ...folderNameButtonStyle, gridTemplateColumns: "32px minmax(0,1fr)", fontWeight: 600 };
const rowTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const emptyStyle: React.CSSProperties = { minHeight: 34, display: "flex", alignItems: "center", padding: "0 6px", color: "rgba(15,23,42,.48)", fontSize: 11, fontWeight: 600 };
const errorStyle: React.CSSProperties = { margin: "0 2px", color: "#be123c", fontSize: 10.5, fontWeight: 700, lineHeight: 1.3 };
const menuButtonStyle: React.CSSProperties = { width: "100%", minHeight: 31, border: 0, background: "transparent", color: "#111827", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600, textAlign: "left", padding: "0 12px" };
