import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CommunicationsSharedInbox, EmailMailbox, EmailMessage } from "../../modules/communications/communicationsApi";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import { EditorContent } from "../../modules/editor/EditorContent";
import type { NodeRecord } from "../../modules/node-map/shared";
import type { LogicGateRecord } from "../../modules/logic-gate-map/shared";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import { EXPLORER_DRAG_MIME, getExplorerDragPayloadForSelection, readExplorerDragPayload } from "../../modules/company-explorer/companyExplorerDragDrop";
import { ACI_COLUMNS, HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, HOME_NODE_RAIL_HEIGHT_STORAGE_KEY, HOME_ROW_RESIZER_HEIGHT, INBOX_NO_LOGIC_GATE_ID, INBOX_PRIORITIES, RESPONSIBLE_STATUS_COLUMNS } from "./homeConstants";
import type { ComposeState, HomeViewID, InboxLogicGateNodeGroup } from "./homeTypes";
import { aciCellKey, buildAciInboxGroupsByCell, buildResponsibleInboxGroupsByCell, buildSharedInboxRows, cleanIDList, clampNumber, formatAddressList, hasExplorerDrag, hasTriageMessageDrag, logicGateIDsFromExplorerPayload, logicGateTitle, logicGateTreeID, messageDocument, nodeTitle, nodeTreeID, readTriageMessageIDs, responsibleCellKey, responsibleStatusLetter, setLogicGateDragData, setNodeDragData } from "./homeUtils";
import { allLogicGateRowsStyle, columnResizeGripStyle, columnResizeHandleStyle, composeStyle, dangerButtonStyle, deleteModalBackdropStyle, deleteModalDetailStyle, deleteModalStyle, detailStyle, detailSubjectStyle, emptySmallStyle, iframeStyle, inboxMatrixGridStyle, inputStyle, logicGateDisclosureStyle, logicGateInboxGroupCountStyle, logicGateInboxGroupHeaderStyle, logicGateInboxGroupStyle, logicGateInboxGroupTitleStyle, logicGateInboxNodeGuideStyle, logicGateInboxNodeIconStyle, logicGateInboxNodeListStyle, logicGateInboxNodeRemoveStyle, logicGateInboxNodeRowStyle, logicGateInboxNodeStatusStyle, logicGateInboxNodeTitleStyle, logicGateRaciCellStyle, logicGateRaciColumnHeaderStyle, logicGateRaciColumnLabelStyle, logicGateRaciColumnLetterStyle, logicGateRaciCornerStyle, logicGateRaciHeaderStyle, logicGateRaciMetaStyle, logicGateRaciPanelStyle, logicGateRaciPriorityHeaderStyle, logicGateRaciScrollStyle, logicGateRailHeaderStyle, logicGateRailSectionStyle, logicGateRailStyle, logicGateTreeRowStyle, logicGateTreeRowTextStyle, messagePlacementIconStyle, messageSelectDotStyle, mutedSmallStyle, myLogicGateFolderLabelStyle, myLogicGateGridStyle, myLogicGateGroupStyle, myLogicGateTileIconStyle, myLogicGateTileStyle, myLogicGateTileTextStyle, myLogicGatesListStyle, navButtonStyle, navLabelStyle, navMetaStyle, nodeEditorPopupBackdropStyle, nodeEditorPopupCloseButtonStyle, nodeEditorPopupStyle, panelHeaderStyle, panelTitleStyle, primaryButtonStyle, railRowResizeGripStyle, railRowResizeHandleStyle, sharedInboxCreateButtonStyle, sharedInboxCreateStyle, sharedInboxInputStyle, sharedInboxRowsStyle, shortcutRemoveStyle, sidebarNavStyle, sidebarSectionStyle, sidebarStyle, smallButtonStyle, textareaStyle, toolbarStyle } from "./homeStyles";
export function NodeEditorPopup({ nodeID, nodeTitle, onClose }: {
  nodeID: string;
  nodeTitle: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      style={nodeEditorPopupBackdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${nodeTitle} node editor`}
        data-frame-interactive="true"
        style={nodeEditorPopupStyle}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          title="Close node editor"
          onClick={onClose}
          style={nodeEditorPopupCloseButtonStyle}
        >
          X
        </button>
        <EditorContent
          accent="#ff8820"
          widgetId={`communications-node-editor-overlay:${nodeID}`}
          theme="mango"
          forcedEntityKind="node"
          forcedEntityID={nodeID}
          forcedLabel={nodeTitle}
        />
      </div>
    </div>
  );
}

export function HomeNavButton({ label, active, depth = 0, onClick }: {
  label: string;
  active: boolean;
  depth?: number;
  onClick: () => void;
}) {
  return (
    <button type="button" style={{ ...navButtonStyle(active), paddingLeft: 10 + depth * 14 }} onClick={onClick}>
      <span style={navLabelStyle}>{label}</span>
    </button>
  );
}

export function HomeSidebar({
  activeViewID,
  sharedInboxes,
  loadingSharedInboxes,
  newSharedInboxName,
  busy,
  onSelectView,
  onNewSharedInboxNameChange,
  onSubmitSharedInbox,
}: {
  activeViewID: HomeViewID;
  sharedInboxes: CommunicationsSharedInbox[];
  loadingSharedInboxes: boolean;
  newSharedInboxName: string;
  busy: string;
  onSelectView: (viewID: HomeViewID, mailbox?: EmailMailbox) => void;
  onNewSharedInboxNameChange: (value: string) => void;
  onSubmitSharedInbox: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <aside style={sidebarStyle}>
      <nav style={sidebarNavStyle} aria-label="Home triage">
        <HomeNavButton label="My Triage" active={activeViewID === "my-triage" || activeViewID === "primary"} onClick={() => onSelectView("my-triage", "primary")} />
        <section style={sidebarSectionStyle}>
          <button
            type="button"
            style={navButtonStyle(activeViewID === "shared-root")}
            onClick={() => onSelectView("shared-root", "primary")}
          >
            <span style={navLabelStyle}>Shared Triage</span>
            {loadingSharedInboxes && <span style={navMetaStyle}>Loading</span>}
          </button>
          <div style={sharedInboxRowsStyle}>
            {buildSharedInboxRows(sharedInboxes).map((row) => (
              <HomeNavButton
                key={row.folder.folder_id}
                label={row.folder.name}
                depth={row.depth}
                active={activeViewID === `shared:${row.folder.folder_id}`}
                onClick={() => onSelectView(`shared:${row.folder.folder_id}`, "primary")}
              />
            ))}
          </div>
          <form style={sharedInboxCreateStyle} onSubmit={onSubmitSharedInbox}>
            <input
              style={sharedInboxInputStyle}
              value={newSharedInboxName}
              onChange={(event) => onNewSharedInboxNameChange(event.target.value)}
              placeholder="New shared triage"
            />
            <button style={sharedInboxCreateButtonStyle} disabled={busy === "shared-inbox" || !newSharedInboxName.trim()} aria-label="Create Shared Triage">+</button>
          </form>
        </section>
        <HomeNavButton label="ACI Inbox" active={activeViewID === "aci-inbox"} onClick={() => onSelectView("aci-inbox", "all")} />
        <HomeNavButton label="R Inbox" active={activeViewID === "r-inbox"} onClick={() => onSelectView("r-inbox", "all")} />
        <HomeNavButton label="My Nodes" active={activeViewID === "my-nodes"} onClick={() => onSelectView("my-nodes", "all")} />
        <HomeNavButton label="My Logic Gates" active={activeViewID === "my-logic-gates"} onClick={() => onSelectView("my-logic-gates", "all")} />
      </nav>
    </aside>
  );
}

export function MessagePlacementIcon({ message, active }: { message: EmailMessage; active: boolean }) {
  const count = message.logic_gate_count ?? message.logic_gate_ids?.length ?? 0;
  if (count > 0) {
    return (
      <span style={messagePlacementIconStyle(active)} title={count === 1 ? "Sent to a Logic Gate" : `Sent to ${count} Logic Gates`}>
        <ExplorerRowIcon kind="logic_gate" />
      </span>
    );
  }
  return <span style={messageSelectDotStyle(active, message.unread)} title="Not sent to a Logic Gate" />;
}

type MyLogicGateGroup = {
  key: string;
  label: string;
  logicGates: LogicGateRecord[];
};

export function HomeColumnResizeHandle({
  dividerIndex,
  onPointerDown,
}: {
  dividerIndex: 0 | 1 | 2;
  onPointerDown: (dividerIndex: 0 | 1 | 2, event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Resize Home column ${dividerIndex + 1}`}
      style={columnResizeHandleStyle}
      onPointerDown={(event) => onPointerDown(dividerIndex, event)}
    >
      <span style={columnResizeGripStyle} />
    </button>
  );
}

export function useRailTopResize(storageKey: string, fallbackHeight = 240) {
  const railRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number; availableHeight: number } | null>(null);
  const [topHeight, setTopHeight] = useState(() => readRailTopHeight(storageKey, fallbackHeight));

  useEffect(() => {
    saveRailTopHeight(storageKey, topHeight);
  }, [storageKey, topHeight]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const maxTopHeight = Math.max(120, drag.availableHeight - HOME_ROW_RESIZER_HEIGHT - 160);
      setTopHeight(clampNumber(drag.startHeight + event.clientY - drag.startY, 96, maxTopHeight));
    };
    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const availableHeight = railRef.current?.clientHeight ?? window.innerHeight;
    dragRef.current = { startY: event.clientY, startHeight: topHeight, availableHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [topHeight]);

  return { railRef, topHeight, startResize };
}

export function readRailTopHeight(storageKey: string, fallbackHeight: number): number {
  try {
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) ? clampNumber(stored, 96, 520) : fallbackHeight;
  } catch {
    return fallbackHeight;
  }
}

export function saveRailTopHeight(storageKey: string, height: number): void {
  try {
    localStorage.setItem(storageKey, String(Math.round(height)));
  } catch {}
}

export function RailRowResizeHandle({ onPointerDown }: { onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      aria-label="Resize rail sections"
      style={railRowResizeHandleStyle}
      onPointerDown={onPointerDown}
    >
      <span style={railRowResizeGripStyle} />
    </button>
  );
}

export function LogicGateRail({
  loading,
  logicGateByID,
  folders,
  folderItems,
  allRows,
  selectedRowIDs,
  expandedRowIDs,
  search,
  myGroups,
  busy,
  getLogicGateDragIDs,
  onSearchChange,
  onToggleFolder,
  onSelectRow,
  onSelectShortcut,
  onOpenLogicGate,
  onAddShortcuts,
  onRemoveShortcut,
  onConvertMessages,
}: {
  loading: boolean;
  logicGateByID: Map<string, LogicGateRecord>;
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  allRows: ExplorerTreeNode[];
  selectedRowIDs: Set<string>;
  expandedRowIDs: Set<string>;
  search: string;
  myGroups: MyLogicGateGroup[];
  busy: boolean;
  getLogicGateDragIDs: (logicGateID: string) => string[];
  onSearchChange: (value: string) => void;
  onToggleFolder: (rowID: string) => void;
  onSelectRow: (row: ExplorerTreeNode, event: React.MouseEvent) => void;
  onSelectShortcut: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onAddShortcuts: (payload: ExplorerDragPayload | null) => void;
  onRemoveShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[]) => void;
}) {
  const railSplit = useRailTopResize(HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, 240);

  return (
    <aside ref={railSplit.railRef} style={logicGateRailStyle(railSplit.topHeight)}>
      <section
        style={logicGateRailSectionStyle}
        onDragOver={(event) => {
          if (!hasExplorerDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          const payload = readExplorerDragPayload(event.dataTransfer);
          if (logicGateIDsFromExplorerPayload(payload, folders, folderItems).length === 0) return;
          event.preventDefault();
          onAddShortcuts(payload);
        }}
      >
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>My Logic Gates</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <div style={myLogicGatesListStyle}>
          {myGroups.length === 0 ? (
            <div style={emptySmallStyle}>No shortcuts</div>
          ) : myGroups.map((group) => (
            <div key={group.key} style={myLogicGateGroupStyle}>
              <div style={myLogicGateFolderLabelStyle}>
                <ExplorerRowIcon kind="folder" />
                <span>{group.label}</span>
              </div>
              <div style={myLogicGateGridStyle}>
                {group.logicGates.map((logicGate) => (
                  <MyLogicGateTile
                    key={logicGate.logic_gate_id}
                    logicGate={logicGate}
                    selected={selectedRowIDs.has(logicGateTreeID(logicGate.logic_gate_id))}
                    busy={busy}
                    getLogicGateDragIDs={getLogicGateDragIDs}
                    logicGateByID={logicGateByID}
                    onSelectShortcut={onSelectShortcut}
                    onOpenLogicGate={onOpenLogicGate}
                    onRemoveShortcut={onRemoveShortcut}
                    onConvertMessages={onConvertMessages}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <RailRowResizeHandle onPointerDown={railSplit.startResize} />

      <section style={{ ...logicGateRailSectionStyle, gridTemplateRows: "auto auto minmax(0, 1fr)" }}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>All Logic Gates</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <input
          style={inputStyle}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search Logic Gates"
        />
        <div style={allLogicGateRowsStyle}>
          {allRows.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No Logic Gates</div>
          ) : allRows.map((row) => {
            const selected = selectedRowIDs.has(row.id);
            const isFolder = row.kind === "folder";
            const logicGateID = row.logicGateID ?? "";
            const logicGate = logicGateID ? logicGateByID.get(logicGateID) : undefined;
            return (
              <div
                key={row.id}
                draggable
                style={logicGateTreeRowStyle(row.depth, selected, row.kind === "logic_gate")}
                onClick={(event) => onSelectRow(row, event)}
                onDoubleClick={(event) => {
                  if (row.kind !== "logic_gate" || !logicGateID) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenLogicGate(logicGateID, logicGateTitle(logicGate));
                }}
                onDragStart={(event) => {
                  const payload = getExplorerDragPayloadForSelection(row, selectedRowIDs, allRows);
                  if (!payload) return;
                  event.dataTransfer.effectAllowed = row.kind === "folder" ? "copyMove" : "copy";
                  event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
                  event.dataTransfer.setData("text/plain", row.label);
                }}
                onDragOver={(event) => {
                  if (row.kind !== "logic_gate" || !hasTriageMessageDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  if (row.kind !== "logic_gate" || !logicGateID) return;
                  const messageIDs = readTriageMessageIDs(event.dataTransfer);
                  if (messageIDs.length === 0) return;
                  event.preventDefault();
                  onConvertMessages(logicGateID, messageIDs);
                }}
              >
                {isFolder ? (
                  <button
                    type="button"
                    draggable={false}
                    style={logicGateDisclosureStyle}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFolder(row.id);
                    }}
                  >
                    <ExplorerDisclosureIcon open={expandedRowIDs.has(row.id)} color="rgba(36, 18, 10, 0.62)" />
                  </button>
                ) : (
                  <span style={{ width: 18, flexShrink: 0 }} />
                )}
                <ExplorerRowIcon kind={row.kind} systemKey={row.systemKey} />
                <span style={logicGateTreeRowTextStyle}>{logicGate?.header || row.label}</span>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

export function MyLogicGateTile({
  logicGate,
  selected,
  busy,
  logicGateByID,
  getLogicGateDragIDs,
  onSelectShortcut,
  onOpenLogicGate,
  onRemoveShortcut,
  onConvertMessages,
}: {
  logicGate: LogicGateRecord;
  selected: boolean;
  busy: boolean;
  logicGateByID: Map<string, LogicGateRecord>;
  getLogicGateDragIDs: (logicGateID: string) => string[];
  onSelectShortcut: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onRemoveShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[]) => void;
}) {
  const logicGateID = logicGate.logic_gate_id;
  return (
    <button
      type="button"
      draggable
      style={myLogicGateTileStyle(selected)}
      onClick={(event) => onSelectShortcut(logicGateID, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenLogicGate(logicGateID, logicGateTitle(logicGate));
      }}
      onDragStart={(event) => {
        const dragIDs = getLogicGateDragIDs(logicGateID);
        setLogicGateDragData(event.dataTransfer, dragIDs, logicGateByID);
      }}
      onDragOver={(event) => {
        if (!hasTriageMessageDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const messageIDs = readTriageMessageIDs(event.dataTransfer);
        if (messageIDs.length === 0) return;
        event.preventDefault();
        onConvertMessages(logicGateID, messageIDs);
      }}
    >
      <span style={myLogicGateTileIconStyle}><ExplorerRowIcon kind="logic_gate" /></span>
      <span style={myLogicGateTileTextStyle}>{logicGateTitle(logicGate)}</span>
      <span
        role="button"
        tabIndex={0}
        aria-label="Remove shortcut"
        style={shortcutRemoveStyle}
        onClick={(event) => {
          event.stopPropagation();
          if (!busy) onRemoveShortcut(logicGateID);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !busy) {
            event.preventDefault();
            event.stopPropagation();
            onRemoveShortcut(logicGateID);
          }
        }}
      >
        x
      </span>
    </button>
  );
}

export function NodeInboxRail({
  loading,
  nodeByID,
  allRows,
  myNodes,
  selectedRowIDs,
  expandedRowIDs,
  search,
  getNodeDragIDs,
  onSearchChange,
  onToggleFolder,
  onSelectRow,
  onSelectNode,
  onOpenNode,
}: {
  loading: boolean;
  nodeByID: Map<string, NodeRecord>;
  allRows: ExplorerTreeNode[];
  myNodes: NodeRecord[];
  selectedRowIDs: Set<string>;
  expandedRowIDs: Set<string>;
  search: string;
  getNodeDragIDs: (nodeID: string) => string[];
  onSearchChange: (value: string) => void;
  onToggleFolder: (rowID: string) => void;
  onSelectRow: (row: ExplorerTreeNode, event: React.MouseEvent) => void;
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
}) {
  const myNodeOrderedRowIDs = useMemo(() => myNodes.map((node) => nodeTreeID(node.node_id)), [myNodes]);
  const railSplit = useRailTopResize(HOME_NODE_RAIL_HEIGHT_STORAGE_KEY, 220);

  return (
    <aside ref={railSplit.railRef} style={logicGateRailStyle(railSplit.topHeight)}>
      <section style={logicGateRailSectionStyle}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>My Nodes</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <div style={myLogicGatesListStyle}>
          {myNodes.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No responsible nodes</div>
          ) : (
            <div style={myLogicGateGridStyle}>
              {myNodes.map((node) => (
                <MyNodeTile
                  key={node.node_id}
                  node={node}
                  selected={selectedRowIDs.has(nodeTreeID(node.node_id))}
                  orderedRowIDs={myNodeOrderedRowIDs}
                  nodeByID={nodeByID}
                  getNodeDragIDs={getNodeDragIDs}
                  onSelectNode={onSelectNode}
                  onOpenNode={onOpenNode}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <RailRowResizeHandle onPointerDown={railSplit.startResize} />

      <section style={{ ...logicGateRailSectionStyle, gridTemplateRows: "auto auto minmax(0, 1fr)" }}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>All Nodes</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <input
          style={inputStyle}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search Nodes"
        />
        <div style={allLogicGateRowsStyle}>
          {allRows.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No nodes</div>
          ) : allRows.map((row) => {
            const selected = selectedRowIDs.has(row.id);
            const isFolder = row.kind === "folder";
            const nodeID = row.nodeID ?? "";
            const node = nodeID ? nodeByID.get(nodeID) : undefined;
            return (
              <div
                key={row.id}
                draggable
                style={logicGateTreeRowStyle(row.depth, selected, row.kind === "node")}
                onClick={(event) => onSelectRow(row, event)}
                onDoubleClick={(event) => {
                  if (row.kind !== "node" || !node) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenNode(node);
                }}
                onDragStart={(event) => {
                  const payload = getExplorerDragPayloadForSelection(row, selectedRowIDs, allRows);
                  if (!payload) return;
                  event.dataTransfer.effectAllowed = row.kind === "folder" ? "copyMove" : "copy";
                  event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
                  event.dataTransfer.setData("text/plain", row.label);
                }}
              >
                {isFolder ? (
                  <button
                    type="button"
                    draggable={false}
                    style={logicGateDisclosureStyle}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFolder(row.id);
                    }}
                  >
                    <ExplorerDisclosureIcon open={expandedRowIDs.has(row.id)} color="rgba(36, 18, 10, 0.62)" />
                  </button>
                ) : (
                  <span style={{ width: 18, flexShrink: 0 }} />
                )}
                <ExplorerRowIcon kind={row.kind} systemKey={row.systemKey} />
                <span style={logicGateTreeRowTextStyle}>{node ? nodeTitle(node) : row.label}</span>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

export function MyNodeTile({
  node,
  selected,
  orderedRowIDs,
  nodeByID,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
}: {
  node: NodeRecord;
  selected: boolean;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
}) {
  const nodeID = node.node_id;
  return (
    <button
      type="button"
      draggable
      style={myLogicGateTileStyle(selected)}
      onClick={(event) => onSelectNode(nodeID, orderedRowIDs, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenNode(node);
      }}
      onDragStart={(event) => {
        const dragIDs = getNodeDragIDs(nodeID);
        setNodeDragData(event.dataTransfer, dragIDs, nodeByID);
      }}
    >
      <span style={myLogicGateTileIconStyle}><ExplorerRowIcon kind="node" /></span>
      <span style={myLogicGateTileTextStyle}>{nodeTitle(node)}</span>
    </button>
  );
}

export function AciInboxMatrix({
  loading,
  nodes,
  nodeByID,
  logicGateByID,
  currentUserID,
  selectedRowIDs,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onOpenLogicGate,
}: {
  loading: boolean;
  nodes: NodeRecord[];
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  currentUserID: string;
  selectedRowIDs: Set<string>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
}) {
  const cellLogicGateGroups = useMemo(() => buildAciInboxGroupsByCell(nodes, nodeByID, logicGateByID, currentUserID), [currentUserID, logicGateByID, nodeByID, nodes]);
  const orderedRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of ACI_COLUMNS) {
        const groups = cellLogicGateGroups.get(aciCellKey(column.role, priority.value)) ?? [];
        for (const group of groups) ids.push(...group.nodeIDs);
      }
    }
    return cleanIDList(ids).map(nodeTreeID);
  }, [cellLogicGateGroups]);
  const placedCount = orderedRowIDs.length;

  return (
    <section style={logicGateRaciPanelStyle}>
      <div style={logicGateRaciHeaderStyle}>
        <h2 style={panelTitleStyle}>ACI Inbox</h2>
        <div style={logicGateRaciMetaStyle}>
          {placedCount > 0 && <span>{placedCount} active</span>}
          {loading && <span>Loading</span>}
        </div>
      </div>
      <div className="kanban-board-scroll" style={logicGateRaciScrollStyle}>
        <div style={inboxMatrixGridStyle(ACI_COLUMNS.length)}>
          <div style={logicGateRaciCornerStyle} />
          {ACI_COLUMNS.map((column) => (
            <div key={column.role} style={logicGateRaciColumnHeaderStyle}>
              <strong style={logicGateRaciColumnLetterStyle}>{column.letter}</strong>
              <span style={logicGateRaciColumnLabelStyle}>{column.label}</span>
            </div>
          ))}
          {INBOX_PRIORITIES.map((priority) => (
            <React.Fragment key={priority.value}>
              <div style={logicGateRaciPriorityHeaderStyle}>{priority.label}</div>
              {ACI_COLUMNS.map((column) => {
                const cellKey = aciCellKey(column.role, priority.value);
                const logicGateGroups = cellLogicGateGroups.get(cellKey) ?? [];
                return (
                  <div key={cellKey} style={logicGateRaciCellStyle(false)}>
                    {logicGateGroups.map((group) => (
                      <LogicGateInboxNodeGroupCard
                        key={group.logicGateID}
                        group={group}
                        selectedRowIDs={selectedRowIDs}
                        orderedRowIDs={orderedRowIDs}
                        nodeByID={nodeByID}
                        getNodeDragIDs={getNodeDragIDs}
                        onSelectNode={onSelectNode}
                        onOpenNode={onOpenNode}
                        onOpenLogicGate={onOpenLogicGate}
                      />
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ResponsibleInboxMatrix({
  loading,
  nodes,
  nodeByID,
  logicGateByID,
  currentUserID,
  selectedRowIDs,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onOpenLogicGate,
}: {
  loading: boolean;
  nodes: NodeRecord[];
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  currentUserID: string;
  selectedRowIDs: Set<string>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
}) {
  const cellLogicGateGroups = useMemo(() => buildResponsibleInboxGroupsByCell(nodes, nodeByID, logicGateByID, currentUserID), [currentUserID, logicGateByID, nodeByID, nodes]);
  const orderedRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of RESPONSIBLE_STATUS_COLUMNS) {
        const groups = cellLogicGateGroups.get(responsibleCellKey(column.status, priority.value)) ?? [];
        for (const group of groups) ids.push(...group.nodeIDs);
      }
    }
    return cleanIDList(ids).map(nodeTreeID);
  }, [cellLogicGateGroups]);
  const placedCount = orderedRowIDs.length;

  return (
    <section style={logicGateRaciPanelStyle}>
      <div style={logicGateRaciHeaderStyle}>
        <h2 style={panelTitleStyle}>R Inbox</h2>
        <div style={logicGateRaciMetaStyle}>
          {placedCount > 0 && <span>{placedCount} active</span>}
          {loading && <span>Loading</span>}
        </div>
      </div>
      <div className="kanban-board-scroll" style={logicGateRaciScrollStyle}>
        <div style={inboxMatrixGridStyle(RESPONSIBLE_STATUS_COLUMNS.length)}>
          <div style={logicGateRaciCornerStyle} />
          {RESPONSIBLE_STATUS_COLUMNS.map((column) => (
            <div key={column.status} style={logicGateRaciColumnHeaderStyle}>
              <strong style={logicGateRaciColumnLetterStyle}>{column.letter}</strong>
              <span style={logicGateRaciColumnLabelStyle}>{column.label}</span>
            </div>
          ))}
          {INBOX_PRIORITIES.map((priority) => (
            <React.Fragment key={priority.value}>
              <div style={logicGateRaciPriorityHeaderStyle}>{priority.label}</div>
              {RESPONSIBLE_STATUS_COLUMNS.map((column) => {
                const cellKey = responsibleCellKey(column.status, priority.value);
                const logicGateGroups = cellLogicGateGroups.get(cellKey) ?? [];
                return (
                  <div key={cellKey} style={logicGateRaciCellStyle(false)}>
                    {logicGateGroups.map((group) => (
                      <LogicGateInboxNodeGroupCard
                        key={group.logicGateID}
                        group={group}
                        selectedRowIDs={selectedRowIDs}
                        orderedRowIDs={orderedRowIDs}
                        nodeByID={nodeByID}
                        getNodeDragIDs={getNodeDragIDs}
                        onSelectNode={onSelectNode}
                        onOpenNode={onOpenNode}
                        onOpenLogicGate={onOpenLogicGate}
                      />
                    ))}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LogicGateInboxNodeGroupCard({
  group,
  selectedRowIDs,
  orderedRowIDs,
  nodeByID,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onOpenLogicGate,
  canRemoveNode,
  onRemovePlacement,
}: {
  group: InboxLogicGateNodeGroup;
  selectedRowIDs: Set<string>;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
  canRemoveNode?: (nodeID: string) => boolean;
  onRemovePlacement?: (nodeID: string) => void;
}) {
  const canOpenLogicGate = group.logicGateID !== INBOX_NO_LOGIC_GATE_ID;
  const firstNodeID = group.nodeIDs[0] ?? "";
  return (
    <div style={logicGateInboxGroupStyle}>
      <button
        type="button"
        disabled={!canOpenLogicGate}
        title={canOpenLogicGate ? `Open ${group.label} in Logic Gate Arena` : group.label}
        aria-label={canOpenLogicGate ? `Open ${group.label} in Logic Gate Arena` : group.label}
        style={logicGateInboxGroupHeaderStyle(canOpenLogicGate)}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          if (!canOpenLogicGate) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenLogicGate(group.logicGateID, group.label, firstNodeID);
        }}
      >
        <ExplorerRowIcon kind="logic_gate" />
        <span style={logicGateInboxGroupTitleStyle}>{group.label}</span>
        <span style={logicGateInboxGroupCountStyle}>{group.nodeIDs.length}</span>
      </button>
      <div className="kanban-board-scroll" style={logicGateInboxNodeListStyle}>
        {group.nodeIDs.map((nodeID) => {
          const node = nodeByID.get(nodeID);
          if (!node) return null;
          return (
            <LogicGateInboxNodeRow
              key={nodeID}
              node={node}
              selected={selectedRowIDs.has(nodeTreeID(nodeID))}
              orderedRowIDs={orderedRowIDs}
              nodeByID={nodeByID}
              getNodeDragIDs={getNodeDragIDs}
              onSelectNode={onSelectNode}
              onOpenNode={onOpenNode}
              onRemovePlacement={canRemoveNode?.(nodeID) ? onRemovePlacement : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export function LogicGateInboxNodeRow({
  node,
  selected,
  orderedRowIDs,
  nodeByID,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onRemovePlacement,
}: {
  node: NodeRecord;
  selected: boolean;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onRemovePlacement?: (nodeID: string) => void;
}) {
  const nodeID = node.node_id;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      style={logicGateInboxNodeRowStyle(selected)}
      onClick={(event) => onSelectNode(nodeID, orderedRowIDs, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenNode(node);
      }}
      onDragStart={(event) => {
        const dragIDs = getNodeDragIDs(nodeID);
        setNodeDragData(event.dataTransfer, dragIDs, nodeByID);
      }}
    >
      <span style={logicGateInboxNodeGuideStyle} />
      <span style={logicGateInboxNodeIconStyle}><ExplorerRowIcon kind="node" /></span>
      <span style={logicGateInboxNodeTitleStyle}>{nodeTitle(node)}</span>
      {onRemovePlacement ? (
        <button
          type="button"
          aria-label={`Remove ${nodeTitle(node)} from ACI inbox`}
          style={logicGateInboxNodeRemoveStyle}
          onClick={(event) => {
            event.stopPropagation();
            onRemovePlacement(nodeID);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          x
        </button>
      ) : (
        <span style={logicGateInboxNodeStatusStyle(node.status)}>{responsibleStatusLetter(node.status)}</span>
      )}
    </div>
  );
}

export function ComposePanel({ compose, busy, onChange, onCancel, onSubmit }: {
  compose: ComposeState;
  busy: boolean;
  onChange: (next: ComposeState) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const update = (patch: Partial<ComposeState>) => onChange({ ...compose, ...patch });
  return (
    <form style={composeStyle} onSubmit={onSubmit}>
      <div style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>{compose.replyToMessageID ? "Reply" : "New Message"}</h2>
        <button type="button" style={smallButtonStyle} onClick={onCancel}>Close</button>
      </div>
      <input style={inputStyle} value={compose.to} onChange={(event) => update({ to: event.target.value })} placeholder="To" />
      <input style={inputStyle} value={compose.cc} onChange={(event) => update({ cc: event.target.value })} placeholder="Cc" />
      <input style={inputStyle} value={compose.bcc} onChange={(event) => update({ bcc: event.target.value })} placeholder="Bcc" />
      <input style={inputStyle} value={compose.subject} onChange={(event) => update({ subject: event.target.value })} placeholder="Subject" />
      <textarea style={textareaStyle} value={compose.body} onChange={(event) => update({ body: event.target.value })} placeholder="Message" />
      <button style={primaryButtonStyle} disabled={busy}>{busy ? "Sending" : "Send"}</button>
    </form>
  );
}

export function MessageDetail({ message, loading, archiveAvailable, archiveLabel, busy, onReply, onArchive, onDelete, onToggleRead, onToggleStar }: {
  message: EmailMessage;
  loading: boolean;
  archiveAvailable: boolean;
  archiveLabel: string;
  busy: boolean;
  onReply: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
}) {
  return (
    <div style={detailStyle}>
      <div style={panelHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 style={detailSubjectStyle}>{message.subject || "(no subject)"}</h2>
          <div style={mutedSmallStyle}>From {formatAddressList(message.from) || "Unknown sender"} to {formatAddressList(message.to) || "me"}</div>
        </div>
        {loading && <span style={mutedSmallStyle}>Loading</span>}
      </div>
      <div style={toolbarStyle}>
        <button style={smallButtonStyle} disabled={busy} onClick={onReply}>Reply</button>
        <button style={smallButtonStyle} disabled={busy} onClick={onToggleRead}>{message.unread ? "Mark read" : "Mark unread"}</button>
        <button style={smallButtonStyle} disabled={busy} onClick={onToggleStar}>{message.starred ? "Unstar" : "Star"}</button>
        <button style={smallButtonStyle} disabled={busy || !archiveAvailable} onClick={onArchive}>{archiveLabel}</button>
        <button style={{ ...smallButtonStyle, ...dangerButtonStyle }} disabled={busy} onClick={onDelete}>Delete</button>
      </div>
      <iframe title="Email body" sandbox="" srcDoc={messageDocument(message.body || message.snippet || "")} style={iframeStyle} />
    </div>
  );
}

export function DeleteMessagesConfirmationModal({ count, busy, onConfirm, onCancel }: {
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={deleteModalBackdropStyle}>
      <div style={deleteModalStyle}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>
          {count === 1 ? "Are you sure you want to delete this?" : `Are you sure you want to delete these ${count} emails?`}
        </div>
        <div style={deleteModalDetailStyle}>
          This deletes the selected email{count === 1 ? "" : "s"} from your mailbox immediately.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" disabled={busy} onClick={onConfirm} style={{ border: "1px solid rgba(255,136,32,0.45)", background: "#ffffff", color: "#111111", cursor: busy ? "not-allowed" : "pointer", fontWeight: 700 }}>
            {busy ? "Deleting" : "Yes"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: "#8b123f", background: "#ffffff", cursor: busy ? "not-allowed" : "pointer", fontWeight: 700 }}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}

