import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../icons/index.js";
import { createRequestJSON } from "../api/requestJSON";
import { emitExplorerContextUpdated, EVENT_HUDDLE_EXPLORER_FIND_REQUESTED } from "../dashboardEvents.js";
import { HuddleNodePopup, type HuddleOpenResource } from "./HuddleResourceSurface";
import { HuddlePeopleIcon, HuddleResourceIcon } from "./HuddleResourceIcon";

type Folder = { company_id: string; folder_id: string; parent_folder_id?: string | null; name: string };
type Item = { company_id: string; item_id: string; parent_folder_id?: string | null; resource_type: "huddle_logic_gate"; resource_id: string; name: string };
type Tree = { folders?: Folder[]; items?: Item[] };

export const HuddleExplorerSection: React.FC<{ apiBase: string; companyID: string; currentUserID: string }> = ({ apiBase, companyID, currentUserID }) => {
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [tree, setTree] = useState<Tree>({ folders: [], items: [] });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedRowID, setSelectedRowID] = useState("");
  const [pendingRevealRowID, setPendingRevealRowID] = useState<string | null>(null);
  const [raisedRowID, setRaisedRowID] = useState("");
  const [openNode, setOpenNode] = useState<HuddleOpenResource | null>(null);
  const load = useCallback(async () => {
    if (!companyID) return;
    setTree(await requestJSON<Tree>(`/v1/huddle-explorer?company_id=${encodeURIComponent(companyID)}`));
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
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
      setPendingRevealRowID(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expanded, pendingRevealRowID, tree]);
  const createFolder = async (parentFolderID = "") => {
    const name = window.prompt("Folder name", "New Folder")?.trim();
    if (!name) return;
    await requestJSON("/v1/huddle-explorer/folders", { method: "POST", json: { company_id: companyID, parent_folder_id: parentFolderID, name } });
    await load();
  };
  const renameFolder = async (folder: Folder) => {
    const name = window.prompt("Folder name", folder.name)?.trim();
    if (!name || name === folder.name) return;
    await requestJSON(`/v1/huddle-explorer/folders/${encodeURIComponent(folder.folder_id)}`, { method: "PUT", json: { company_id: companyID, name } });
    emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
    await load();
  };
  const deleteFolder = async (folder: Folder) => {
    if (!window.confirm(`Move empty folder “${folder.name}” to the Recycle Bin?`)) return;
    await requestJSON(`/v1/huddle-explorer/folders/${encodeURIComponent(folder.folder_id)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
    await load();
  };
  const moveFolder = async (folder: Folder, parentFolderID: string) => {
    await requestJSON(`/v1/huddle-explorer/folders/${encodeURIComponent(folder.folder_id)}`, { method: "PUT", json: { company_id: companyID, parent_folder_id: parentFolderID } });
    emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
    await load();
  };
  const moveItem = async (item: Item, parentFolderID: string) => {
    await requestJSON(`/v1/huddle-explorer/items/${encodeURIComponent(item.item_id)}`, { method: "PUT", json: { company_id: companyID, parent_folder_id: parentFolderID } });
    emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
    await load();
  };
  const removePlacement = async (item: Item) => {
    if (!window.confirm(`Remove “${item.name}” from the Huddles explorer?`)) return;
    await requestJSON(`/v1/huddle-explorer/items/${encodeURIComponent(item.item_id)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
    emitExplorerContextUpdated({ companyID, kind: "huddle_explorer" });
    await load();
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

  const renderLevel = (parentID: string, depth: number): React.ReactNode => (
    <>
      {folders.filter((folder) => (folder.parent_folder_id ?? "") === parentID).map((folder) => {
        const rowID = `folder:${folder.folder_id}`;
        const open = expanded.has(folder.folder_id);
        return (
          <div key={folder.folder_id}>
            <div
              data-huddle-explorer-row="folder"
              data-huddle-row-raised={raisedRowID === rowID ? "true" : undefined}
              onMouseEnter={() => setRaisedRowID(rowID)}
              onMouseLeave={() => setRaisedRowID((current) => current === rowID ? "" : current)}
              style={{ ...rowStyle(raisedRowID === rowID || selectedRowID === rowID), paddingLeft: 3 + depth * 12 }}
            >
              <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`} onClick={() => toggleFolder(folder.folder_id)} style={disclosureButtonStyle}><ExplorerDisclosureIcon open={open} color="#475569" /></button>
              <button type="button" data-huddle-folder-id={folder.folder_id} aria-current={selectedRowID === rowID ? "location" : undefined} title="Click to expand or collapse" onClick={() => { setSelectedRowID(rowID); toggleFolder(folder.folder_id); }} style={folderNameButtonStyle}><ExplorerRowIcon kind="folder" /><span style={rowTextStyle}>{folder.name}</span></button>
              <select aria-label={`Move ${folder.name}`} value={folder.parent_folder_id ?? ""} onChange={(event) => void moveFolder(folder, event.target.value)} style={selectStyle}><option value="">Root</option>{folders.filter((candidate) => candidate.folder_id !== folder.folder_id).map((candidate) => <option key={candidate.folder_id} value={candidate.folder_id}>{candidate.name}</option>)}</select>
              <button type="button" aria-label={`Create folder in ${folder.name}`} title="Create folder inside" onClick={() => void createFolder(folder.folder_id)} style={smallActionStyle}>+</button>
              <button type="button" aria-label={`Rename ${folder.name}`} title="Rename folder" onClick={() => void renameFolder(folder)} style={smallActionStyle}>✎</button>
              <button type="button" aria-label={`Delete ${folder.name}`} title="Delete empty folder" onClick={() => void deleteFolder(folder)} style={removeActionStyle}>X</button>
            </div>
            {open && <div style={{ display: "grid", gap: 3 }}>{renderLevel(folder.folder_id, depth + 1)}</div>}
          </div>
        );
      })}
      {items.filter((item) => (item.parent_folder_id ?? "") === parentID).map((item) => {
        const rowID = `item:${item.item_id}`;
        return (
          <div
            key={item.item_id}
            data-huddle-explorer-row={item.resource_type}
            data-huddle-row-raised={raisedRowID === rowID ? "true" : undefined}
            onMouseEnter={() => setRaisedRowID(rowID)}
            onMouseLeave={() => setRaisedRowID((current) => current === rowID ? "" : current)}
            style={{ ...itemRowStyle(raisedRowID === rowID || selectedRowID === rowID), paddingLeft: 18 + depth * 12 }}
          >
            <button type="button" title="Click to open" onClick={() => openItem(item)} style={itemNameButtonStyle}>
              <HuddleResourceIcon type={item.resource_type} />
              <span style={rowTextStyle}>{item.name}</span>
            </button>
            <select aria-label={`Move ${item.name}`} value={item.parent_folder_id ?? ""} onChange={(event) => void moveItem(item, event.target.value)} style={selectStyle}><option value="">Root</option>{folders.map((folder) => <option key={folder.folder_id} value={folder.folder_id}>{folder.name}</option>)}</select>
            <button type="button" aria-label={`Remove ${item.name} placement`} title="Remove placement" onClick={() => void removePlacement(item)} style={removeActionStyle}>X</button>
          </div>
        );
      })}
    </>
  );

  return (
    <section ref={sectionRef} tabIndex={-1} aria-label="Huddles" data-sidebar-huddles-surface="elevated" style={sectionStyle}>
      <div style={headerStyle}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><HuddlePeopleIcon color="#334155" size={15} /><span>Huddles</span></span>
        <span style={headerLineStyle} />
        <button type="button" aria-label="Create Huddle folder" title="Create folder" onClick={() => void createFolder()} style={addFolderButtonStyle}>+ Folder</button>
      </div>
      <div style={{ minWidth: 0, display: "grid", alignContent: "start", gap: 3 }}>
        {renderLevel("", 0)}
        {folders.length + items.length === 0 && <span style={emptyStyle}>No Huddles yet</span>}
      </div>
      {openNode && <HuddleNodePopup apiBase={apiBase} companyID={companyID} currentUserID={currentUserID} resource={openNode} requestJSON={requestJSON} onClose={() => { setOpenNode(null); void load(); }} />}
    </section>
  );
};

const sectionStyle: React.CSSProperties = { flex: "0 0 auto", minWidth: 0, display: "grid", gap: 6, margin: "0 1px 8px", padding: "8px 7px 9px", border: "1px solid rgba(148,163,184,.24)", borderRadius: 11, background: "linear-gradient(145deg,rgba(255,255,255,.92),rgba(248,250,252,.78))", boxShadow: "4px 5px 14px rgba(148,163,184,.2), -3px -3px 10px rgba(255,255,255,.82), inset 1px 1px 0 rgba(255,255,255,.76)" };
const headerStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", alignItems: "center", gap: 8, padding: "0 1px 0 2px", color: "#111827", fontSize: 12, fontWeight: 650 };
const headerLineStyle: React.CSSProperties = { minWidth: 0, height: 1, background: "rgba(15,23,42,.12)" };
const addFolderButtonStyle: React.CSSProperties = { minWidth: 58, height: 22, border: "1px solid rgba(100,116,139,.25)", borderRadius: 5, background: "rgba(255,255,255,.74)", color: "#334155", cursor: "pointer", padding: "0 6px", font: "inherit", fontSize: 10.5, fontWeight: 700 };
function rowStyle(raised: boolean): React.CSSProperties { return { minWidth: 0, minHeight: 31, display: "grid", gridTemplateColumns: "14px minmax(0,1fr) 58px 22px 22px 22px", alignItems: "center", gap: 2, borderRadius: 8, background: raised ? "rgba(255,255,255,.78)" : "transparent", boxShadow: raised ? "0 5px 12px rgba(100,116,139,.18), 0 1px 3px rgba(15,23,42,.08)" : "none", transform: raised ? "translateY(-2px)" : "translateY(0)", transition: "background 120ms ease,box-shadow 140ms ease,transform 120ms ease" }; }
function itemRowStyle(raised: boolean): React.CSSProperties { return { ...rowStyle(raised), gridTemplateColumns: "minmax(0,1fr) 58px 22px" }; }
const disclosureButtonStyle: React.CSSProperties = { width: 14, height: 22, display: "grid", placeItems: "center", border: 0, background: "transparent", cursor: "pointer", padding: 0 };
const folderNameButtonStyle: React.CSSProperties = { minWidth: 0, height: 29, display: "grid", gridTemplateColumns: "17px minmax(0,1fr)", alignItems: "center", gap: 5, border: 0, background: "transparent", color: "#111827", cursor: "pointer", padding: "0 3px", textAlign: "left", font: "inherit", fontSize: 11.5, fontWeight: 700 };
const itemNameButtonStyle: React.CSSProperties = { ...folderNameButtonStyle, gridTemplateColumns: "32px minmax(0,1fr)", fontWeight: 600 };
const rowTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const selectStyle: React.CSSProperties = { width: 58, height: 22, border: 0, borderRadius: 5, background: "rgba(255,255,255,.46)", color: "#64748b", fontSize: 9.5, padding: "0 2px", cursor: "pointer" };
const smallActionStyle: React.CSSProperties = { width: 22, height: 22, display: "grid", placeItems: "center", border: "1px solid rgba(100,116,139,.18)", borderRadius: 5, background: "rgba(255,255,255,.5)", color: "#475569", cursor: "pointer", padding: 0, fontSize: 11 };
const removeActionStyle: React.CSSProperties = { ...smallActionStyle, color: "#be123c" };
const emptyStyle: React.CSSProperties = { minHeight: 34, display: "flex", alignItems: "center", padding: "0 6px", color: "rgba(15,23,42,.48)", fontSize: 11, fontWeight: 600 };
