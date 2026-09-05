import React, { useEffect, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { requestAppSidebarPin } from "../../app/sidebarPins";
import { buildLogicGateRoute } from "../../app/deepLinkRoutes";
import { openAppPathInNewTab } from "../../app/resourceLinks";
import { AccountFilterControl } from "../accounts/AccountFilterControl";
import type { UniversalNestedGroup } from "../grouping/universalGrouping";
import { hasTriageMessageDrag, readTriageMessageDrag, type TriageMessageDragPayload } from "../triage/triageDragDrop";
import { PROCESS_NODE_DRAG, type ProcessStatus, type ProcessWorkNode } from "./processWork";
import { EXPLORER_ENTITY_DRAG_MIME, KANBAN_NODE_PRIORITY_STYLE_OPTIONS, parseExplorerEntityDragItems, attachStackedDragPreview, type ExplorerEntityDragItem } from "./shared";
import { KANBAN_PANEL_SHADOW } from "./KanbanContentModel";
import { STATUS_KANBAN_COLUMNS, compareStatusKanbanNodes, statusKanbanNodeMatchesFilter } from "./statusKanban";
import { StatusKanbanCard } from "./StatusKanbanCard";
import { StatusKanbanColumn } from "./StatusKanbanColumn";
import { formatStatusKanbanTimestamp } from "./statusKanbanPresentation";
import "./statusKanban.css";

type Group = UniversalNestedGroup<ProcessWorkNode, string>;
type Props = {
  companyID: string; processID: string; accent: string; isDark: boolean;
  nodes: ProcessWorkNode[]; selected: Set<string>; highlightedNodeID: string;
  canEdit: boolean; busy: boolean; userID: string; canResolveRequests: boolean;
  dateSort: boolean; dateDirection: "asc" | "desc";
  groupNodes: (nodes: ProcessWorkNode[], rootID: string) => Group[];
  hasGroups: boolean; groupingControl: React.ReactNode;
  personName: (id?: string) => string;
  onSelection: (node: ProcessWorkNode, selected: Set<string>) => void;
  onClearSelection: () => void;
  onOpen: (node: ProcessWorkNode) => void;
  onMove: (nodeIDs: string[], status: ProcessStatus, beforeNodeID?: string, priority?: number) => void;
  onTransferEmail: (sourceNodeID: string, targetNodeID: string) => void;
  onCreate: (status: ProcessStatus, priority: number) => Promise<ProcessWorkNode | undefined>;
  onAssign: (items: ExplorerEntityDragItem[], status: ProcessStatus, priority: number) => void;
  onTriage: (payload: TriageMessageDragPayload, status: ProcessStatus, priority?: number) => void;
  onRename: (node: ProcessWorkNode, title: string) => Promise<void>;
  onRemove: (nodeIDs: string[]) => void; onDelete: (nodeIDs: string[]) => void;
};
type Size = { width: number; height: number };
type Menu = { x: number; y: number; status: ProcessStatus; node?: ProcessWorkNode; groupID?: string; priority?: true; items?: ExplorerEntityDragItem[] };
const menuButton: React.CSSProperties = { width: "100%", padding: "7px 10px", border: 0, borderRadius: 6, background: "transparent", textAlign: "left", font: "inherit", cursor: "pointer" };

export function StatusKanbanBoard(props: Props) {
  const { companyID, processID, nodes, selected, canEdit, busy, accent, isDark } = props;
  const root = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [accountIDs, setAccountIDs] = useState<string[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [rename, setRename] = useState<{ node: ProcessWorkNode; title: string; groupID: string } | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const anchor = useRef("");
  const dragIDs = useRef<string[]>([]);
  const [hover, setHover] = useState<{ status: ProcessStatus; nodeID?: string; after?: boolean; transfer?: boolean } | null>(null);
  const sizeKey = `process-status-columns:${companyID}:${processID}`;
  const [sizes, setSizes] = useState<Partial<Record<ProcessStatus, Size>>>(() => {
    try { return JSON.parse(localStorage.getItem(sizeKey) || "{}"); } catch { return {}; }
  });
  const sizing = useRef<{ status: ProcessStatus; axis: "width" | "height"; x: number; y: number; size: Size } | null>(null);
  useEffect(() => {
    const move = (event: MouseEvent) => {
      const resize = sizing.current; if (!resize) return;
      event.preventDefault();
      const minimum = resize.status === "Requested" || resize.status === "Backlogs" ? 280 : 720;
      const size = { width: Math.max(180, Math.min(2000, resize.size.width + (resize.axis === "width" ? event.clientX - resize.x : 0))), height: Math.max(minimum, Math.min(10000, resize.size.height + (resize.axis === "height" ? event.clientY - resize.y : 0))) };
      setSizes((current) => { const next = { ...current, [resize.status]: size }; try { localStorage.setItem(sizeKey, JSON.stringify(next)); } catch { /* Resizing still works without browser storage. */ } return next; });
    };
    const end = () => { sizing.current = null; };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", end);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end); };
  }, [sizeKey]);
  useEffect(() => { if (rename) { renameInput.current?.focus(); renameInput.current?.select(); } }, [rename?.node.node_id]);
  const text = isDark ? "#f6f8fb" : "#111827", subtext = isDark ? "#b8c4cc" : "#475569";
  const line = isDark ? "rgba(255,255,255,0.16)" : "rgba(148,163,184,0.18)";
  const accounts = useMemo(() => [...new Map(nodes.flatMap((node) => node.accounts ?? []).map((account) => [account.account_id, account])).values()], [nodes]);
  const filtered = useMemo(() => nodes.filter((node) => statusKanbanNodeMatchesFilter(node, query, accountIDs)), [nodes, query, accountIDs]);
  const sort = (rows: ProcessWorkNode[]) => [...rows].sort((a, b) => compareStatusKanbanNodes(a, b, { dateAddedSort: props.dateSort, dateAddedDirection: props.dateDirection }));
  const columns = STATUS_KANBAN_COLUMNS.map((column) => {
    const saved = sizes?.[column.status];
    return { ...column, width: Number.isFinite(saved?.width) ? Math.max(180, Math.min(2000, saved!.width)) : column.width, height: Number.isFinite(saved?.height) ? Math.max(column.lane === "bottom" ? 280 : 720, Math.min(10000, saved!.height)) : column.height };
  });
  const main = columns.filter((column) => column.lane === "main"), bottom = columns.filter((column) => column.lane === "bottom");
  const boardWidth = main.reduce((width, column) => width + column.width, 30);
  const flatten = (groups: Group[]): ProcessWorkNode[] => groups.flatMap((group) => group.groups.length ? flatten(group.groups) : group.rows);
  const visibleOrder = [...new Map([...main, ...bottom].flatMap((column) => {
    const rows = filtered.filter((node) => node.status === column.status);
    return props.hasGroups ? flatten(props.groupNodes(rows, column.status)) : sort(rows);
  }).map((node) => [node.node_id, node])).values()];
  const selection = (node: ProcessWorkNode, event: React.MouseEvent) => {
    if (event.shiftKey && anchor.current) {
      const a = visibleOrder.findIndex((row) => row.node_id === anchor.current), b = visibleOrder.findIndex((row) => row.node_id === node.node_id);
      if (a >= 0 && b >= 0) { props.onSelection(node, new Set(visibleOrder.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.node_id))); return; }
    }
    anchor.current = node.node_id;
    const next = event.ctrlKey || event.metaKey ? new Set(selected) : new Set<string>();
    if (next.has(node.node_id)) next.delete(node.node_id); else next.add(node.node_id);
    props.onSelection(node, next);
  };
  const allowDrop = (event: React.DragEvent) => {
    if (canEdit && !busy && (event.dataTransfer.types.includes(PROCESS_NODE_DRAG) || event.dataTransfer.types.includes(EXPLORER_ENTITY_DRAG_MIME) || hasTriageMessageDrag(event.dataTransfer))) event.preventDefault();
  };
  const sourceIDs = (event: React.DragEvent): string[] => {
    try {
      const data = JSON.parse(event.dataTransfer.getData(PROCESS_NODE_DRAG));
      if (data.companyID !== companyID || data.logicGateID !== processID || !Array.isArray(data.nodeIDs)) return [];
      return [...new Set<string>(data.nodeIDs.filter((id: unknown) => typeof id === "string" && nodes.some((node) => node.node_id === id)))];
    } catch { return []; }
  };
  const transferSource = (ids: string[], targetID?: string) => ids.length === 1 && ids[0] !== targetID && nodes.find((node) => node.node_id === ids[0])?.created_from_email === true;
  const drop = (event: React.DragEvent, status: ProcessStatus, target?: ProcessWorkNode, priority?: number) => {
    event.preventDefault(); event.stopPropagation(); setHover(null);
    if (!canEdit || busy) return;
    const ids = sourceIDs(event);
    if (ids.length) {
      if (target && ids.includes(target.node_id)) return;
      if (target && transferSource(ids, target.node_id)) { props.onTransferEmail(ids[0], target.node_id); return; }
      const rect = event.currentTarget.getBoundingClientRect();
      const after = target && event.clientY >= rect.top + rect.height / 2;
      const siblings = sort(nodes.filter((node) => node.status === status && !ids.includes(node.node_id)));
      const next = target && after ? siblings[siblings.findIndex((node) => node.node_id === target.node_id) + 1]?.node_id : target?.node_id;
      props.onMove(ids, status, next, priority); return;
    }
    const triage = readTriageMessageDrag(event.dataTransfer);
    if (triage.messageIDs.length && (!triage.companyID || triage.companyID === companyID)) { props.onTriage(triage, status, priority); return; }
    const items = parseExplorerEntityDragItems(event.dataTransfer.getData(EXPLORER_ENTITY_DRAG_MIME));
    if (items.length) {
      if (priority) props.onAssign(items, status, priority);
      else setMenu({ x: event.clientX, y: event.clientY, status, priority: true, items });
    }
  };
  const createMenu = (status: ProcessStatus, event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); if (canEdit && !busy) setMenu({ x: event.clientX, y: event.clientY, status, priority: true }); };
  const firstLeafGroupID = (groups: Group[]): string | undefined => groups[0]?.groups.length ? firstLeafGroupID(groups[0].groups) : groups[0]?.id;
  const beginRename = (node: ProcessWorkNode, groupID?: string) => {
    setMenu(null);
    setRename({ node, title: node.node_title, groupID: groupID ?? (props.hasGroups ? firstLeafGroupID(props.groupNodes([node], node.status)) : undefined) ?? node.status });
  };
  const contextIDs = menu?.node && selected.has(menu.node.node_id) ? [...selected] : menu?.node ? [menu.node.node_id] : [];
  const renderNode = (node: ProcessWorkNode, status: ProcessStatus, priority?: number, groupID: string = status) => {
    const requested = node.status === "Requested";
    const canAccept = requested && canEdit && props.canResolveRequests && node.requested_by_user_id !== props.userID;
    const canCancel = requested && canEdit && node.requested_by_user_id === props.userID;
    const byline = node.placed_by_user_id ? `from: ${props.personName(node.placed_by_user_id) || "Unknown person"} ${formatStatusKanbanTimestamp(node.created_timestamp)}`.trim() : "";
    return <StatusKanbanCard key={`${groupID}:${node.node_id}`} node={node} editable={canEdit} busy={busy} color={node.is_issue ? "#7c6ee6" : columns.find((column) => column.status === status)!.color}
      selected={selected.has(node.node_id)} highlighted={props.highlightedNodeID === node.node_id} dragBefore={hover?.nodeID === node.node_id && !hover.after && !hover.transfer} dragAfter={hover?.nodeID === node.node_id && !!hover.after && !hover.transfer} emailTransferTarget={hover?.nodeID === node.node_id && !!hover.transfer}
      text={text} subtext={subtext} accent={accent} editingTitle={rename?.node.node_id === node.node_id && rename.groupID === groupID} renameTitleDraft={rename?.title ?? ""} renameInputRef={renameInput}
      onSetRenameTitleDraft={(title) => setRename((current) => current ? { ...current, title } : null)} onCancelRenameTitle={() => setRename(null)}
      onCommitRenameTitle={(title) => { if (!rename || busy) return; setRename(null); if (title.trim() && title.trim() !== node.node_title) void props.onRename(node, title.trim()); }}
      onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { if (!(event.target as HTMLElement).closest("button,input")) selection(node, event); }}
      onDoubleClick={(event) => { event.stopPropagation(); if (!(event.target as HTMLElement).closest("input")) props.onOpen(node); }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!selected.has(node.node_id)) props.onSelection(node, new Set([node.node_id])); setMenu({ x: event.clientX, y: event.clientY, status, node, groupID }); }}
      onDragStart={(event) => { const ids = selected.has(node.node_id) ? visibleOrder.filter((row) => selected.has(row.node_id)).map((row) => row.node_id) : [node.node_id]; dragIDs.current = ids; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(PROCESS_NODE_DRAG, JSON.stringify({ companyID, logicGateID: processID, nodeIDs: ids })); event.dataTransfer.setData("text/plain", node.node_title); attachStackedDragPreview(event.dataTransfer, ids.map((id) => ({ label: nodes.find((row) => row.node_id === id)?.node_title || "Node" })), accent, "Nodes"); }}
      onDragEnd={() => { dragIDs.current = []; setHover(null); }} onDragLeave={() => setHover(null)}
      onDragOver={(event) => { allowDrop(event); event.stopPropagation(); if (!event.defaultPrevented) return; const rect = event.currentTarget.getBoundingClientRect(); setHover({ status, nodeID: node.node_id, after: event.clientY >= rect.top + rect.height / 2, transfer: transferSource(dragIDs.current, node.node_id) }); }} onDrop={(event) => drop(event, status, node, priority)}
      requestedActions={canAccept ? { busy, onAccept: () => props.onMove([node.node_id], "Pending"), onDecline: () => props.onMove([node.node_id], "Backlogs") } : undefined}
      requestedStatusText={requested && !canAccept ? "Request pending" : undefined} requestedStatusAction={canCancel ? { label: "Cancel", title: "Cancel request", busy, onClick: () => props.onMove([node.node_id], "Backlogs") } : undefined} bylineText={byline} />;
  };
  const renderGroups = (groups: Group[], status: ProcessStatus, backlog: boolean, inheritedPriority?: number): React.ReactNode[] => groups.flatMap((group) => {
    const value = group.field === "priority" ? Number(group.key.split(":")[1]) : inheritedPriority;
    const priority = value && value >= 1 && value <= 5 ? value : undefined;
    const rows = flatten([group]);
    return [<div key={`group:${group.id}`} className="status-kanban__group" style={{ gridColumn: backlog ? "1 / -1" : undefined, marginLeft: backlog ? 0 : group.depth * 8, borderColor: line, background: isDark ? "rgba(15,23,42,0.52)" : "rgba(255,255,255,0.66)", color: text }}
      onDragOver={allowDrop} onDrop={(event) => drop(event, status, undefined, priority)}><span>{group.label}</span><span style={{ color: subtext }}>{new Set(rows.map((node) => node.node_id)).size}</span></div>,
      ...(group.groups.length ? renderGroups(group.groups, status, backlog, priority) : group.rows.map((node) => renderNode(node, status, priority, group.id)))];
  });
  const renderColumn = (column: typeof columns[number]) => {
    const rows = filtered.filter((node) => node.status === column.status), backlog = column.lane === "bottom";
    return <StatusKanbanColumn key={column.status} {...column} accent={accent} text={text} subtext={subtext} canEdit={canEdit} busy={busy} laneBackground={isDark ? "#1a2229" : "rgba(255,255,255,0.62)"} laneShadow={isDark ? "none" : KANBAN_PANEL_SHADOW}
      layout={backlog ? "backlog" : "column"} minimumHeight={backlog ? 280 : 720} stretchHeight={backlog} dropHighlighted={hover?.status === column.status && !hover.nodeID}
      onBlankMouseDown={(event) => { if (!(event.target as HTMLElement).closest("article,button,input")) props.onClearSelection(); }}
      onContextMenu={(event) => { event.preventDefault(); if (canEdit && !busy) setMenu({ x: event.clientX, y: event.clientY, status: column.status }); }}
      onCreate={(event) => createMenu(column.status, event)} onDragOver={(event) => { allowDrop(event); if (event.defaultPrevented) setHover({ status: column.status }); }} onDragLeave={() => setHover(null)} onDrop={(event) => drop(event, column.status)}
      onResizeStart={(axis, event) => { event.preventDefault(); event.stopPropagation(); sizing.current = { axis, status: column.status, x: event.clientX, y: event.clientY, size: column }; }}
      renderedCards={<>{props.hasGroups ? renderGroups(props.groupNodes(rows, column.status), column.status, backlog) : sort(rows).map((node) => renderNode(node, column.status))}
        {canEdit && <button className="status-kanban__create-buffer" type="button" disabled={busy} aria-label={`Create node in ${column.title}`} title={`Create node in ${column.title}`} style={{ gridColumn: backlog ? "1 / -1" : undefined }} onClick={(event) => createMenu(column.status, event)} onDragOver={allowDrop} onDrop={(event) => drop(event, column.status)} />}</>} />;
  };
  return <div ref={root} className={`status-kanban${isDark ? " status-kanban--dark" : ""}`} aria-label="Status Kanban board" onKeyDown={(event) => {
    if ((event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]")) return;
    if (event.key === "Escape") { props.onClearSelection(); setMenu(null); }
    if ((event.key === "Delete" || event.key === "Backspace") && canEdit && !busy && selected.size) { event.preventDefault(); props.onRemove([...selected]); }
    if (event.key === "F2" && canEdit && !busy && selected.size === 1) { const node = nodes.find((row) => selected.has(row.node_id)); if (node) { event.preventDefault(); beginRename(node); } }
  }}>
    <div className="status-kanban__filters" style={{ width: boardWidth }}>{props.groupingControl}<input aria-label="Search Kanban board" placeholder="Search board" value={query} onChange={(event) => { setQuery(event.target.value); props.onClearSelection(); }} /><AccountFilterControl accounts={accounts} selectedAccountIDs={accountIDs} onChange={(ids) => { setAccountIDs(ids); props.onClearSelection(); }} showLabel={false} style={{ width: 220, marginLeft: "auto" }} /></div>
    <div className="status-kanban__lanes" style={{ minWidth: boardWidth }}>
      <div className="status-kanban__main">{main.map(renderColumn)}</div>
      <div className="status-kanban__bottom" style={{ gridTemplateColumns: `minmax(180px, ${bottom[0].width}px) minmax(0, 1fr)` }}>{bottom.map(renderColumn)}</div>
    </div>
    {menu && <FrameRightClickMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
      {menu.priority ? KANBAN_NODE_PRIORITY_STYLE_OPTIONS.filter((option) => option.value !== "0").map((option) => <button type="button" key={option.value} style={menuButton} disabled={busy || !canEdit} onClick={() => {
        const pending = menu; setMenu(null);
        if (pending.items) props.onAssign(pending.items, pending.status, Number(option.value));
        else void props.onCreate(pending.status, Number(option.value)).then((node) => { if (node) { setQuery(""); setAccountIDs([]); props.onSelection(node, new Set([node.node_id])); beginRename(node); } });
      }}>{option.label}</button>) : <>
        {menu.node && <><button type="button" style={menuButton} onClick={() => { openAppPathInNewTab(buildLogicGateRoute(processID, menu.node!.node_id)); setMenu(null); }}>Open in new browser tab</button><button type="button" style={menuButton} onClick={() => { requestAppSidebarPin({ kind: "node", id: menu.node!.node_id, name: menu.node!.node_title }); setMenu(null); }}>Pin</button></>}
        {canEdit && <><button type="button" style={menuButton} disabled={busy} onClick={() => setMenu({ ...menu, priority: true })}>Create new node</button>
          {menu.node && <><button type="button" style={menuButton} disabled={busy} onClick={() => beginRename(menu.node!, menu.groupID)}>Rename node</button><button type="button" style={menuButton} disabled={busy} onClick={() => { props.onRemove(contextIDs); setMenu(null); }}>Remove {contextIDs.length > 1 ? "nodes" : "node"} from Kanban Board</button><button type="button" style={{ ...menuButton, color: "#dc2626" }} disabled={busy} onClick={() => { props.onDelete(contextIDs); setMenu(null); }}>Delete {contextIDs.length > 1 ? "nodes" : "node"}</button></>}
        </>}
      </>}
    </FrameRightClickMenu>}
  </div>;
}
