import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal";
import { PinToSidebarIcon } from "../../app/nodeEditorPopupControls";
import { requestAppSidebarPin } from "../../app/sidebarPins";
import { HeaderRecycleBinIcon } from "../../icons/index.js";
import type { CompanyUser, CompanyUserGroup, CompanyUserGroupMember } from "../communications/communicationsApi";
import { RACIAssignmentBoard } from "../editor/EditorLinkedDocumentPanels";
import {
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
} from "../editor/NodeWorkspaceSurfaceShared";
import type { EditorTabID } from "../editor/editorTabs";
import { UniversalEntityPicker, type UniversalEntityPickerAnchor } from "../editor/UniversalEntityPicker";
import type { LogicGateRACIAssignment, LogicGateRACIPrincipalType, LogicGateRACIRole } from "../logic-gates/types";
import { EntityPermissionsDialog } from "../permissions/EntityPermissionsDialog";
import {
  BareMangoEditorDocument,
  BareMangoEditorToolbar,
  useBareMangoEditorControls,
} from "./BareMangoEditor";
import { HuddleResourceIcon } from "./HuddleResourceIcon";
import { HuddleLogicGateCards, type HuddleLogicGateCardItem } from "./HuddleLogicGateCards";
import { DEFAULT_HUDDLE_COLUMN_LAYOUT, resizeHuddleColumns, type HuddleColumnLayout } from "./huddleColumnLayout";

export type HuddleResourceType = "huddle_logic_gate" | "huddle_node";
export type HuddleOpenResource = { resourceType: HuddleResourceType; resourceID: string; name: string };
export type HuddleRequestJSON = <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;

type HuddleGate = { company_id: string; huddle_logic_gate_id: string; header: string };
type HuddleNode = { company_id: string; huddle_node_id: string; huddle_logic_gate_id: string; name: string };
type RACIPolicy = {
  effective_assignment_mode?: "inherited" | "customized";
  gvic_assignments?: LogicGateRACIAssignment[];
  revision?: string;
};

type HuddleResourceSurfaceProps = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  resource: HuddleOpenResource;
  requestJSON: HuddleRequestJSON;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onClose: () => void;
  onOpenNode: (node: HuddleOpenResource) => void;
  onDeleted?: () => void;
};

export const HuddleResourceSurface: React.FC<HuddleResourceSurfaceProps> = ({
  apiBase,
  companyID,
  currentUserID,
  resource,
  requestJSON,
  fullscreen,
  onToggleFullscreen,
  onClose,
  onOpenNode,
  onDeleted,
}) => {
  const editorControls = useBareMangoEditorControls();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [name, setName] = useState(resource.name);
  const [savedName, setSavedName] = useState(resource.name);
  const [nodes, setNodes] = useState<HuddleNode[]>([]);
  const [logicGateCards, setLogicGateCards] = useState<HuddleLogicGateCardItem[]>([]);
  const [logicGatePickerAnchor, setLogicGatePickerAnchor] = useState<UniversalEntityPickerAnchor | null>(null);
  const [raci, setRaci] = useState<LogicGateRACIAssignment[]>([]);
  const [raciRevision, setRaciRevision] = useState("");
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [companyUserGroups, setCompanyUserGroups] = useState<CompanyUserGroup[]>([]);
  const [companyUserGroupMembers, setCompanyUserGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [activeTab, setActiveTab] = useState<EditorTabID>("editor");
  const [permissions, setPermissions] = useState(false);
  const [columnLayout, setColumnLayout] = useState<HuddleColumnLayout>(DEFAULT_HUDDLE_COLUMN_LAYOUT);
  const [nodeLeftFraction, setNodeLeftFraction] = useState(0.62);
  const [error, setError] = useState("");
  const isGate = resource.resourceType === "huddle_logic_gate";

  const load = useCallback(async () => {
    setError("");
    try {
      const [item, policy, usersPayload, groupsPayload, cardsPayload] = await Promise.all([
        isGate
          ? requestJSON<HuddleGate>(`/v1/huddle-logic-gates/${encodeURIComponent(resource.resourceID)}?company_id=${encodeURIComponent(companyID)}`)
          : requestJSON<HuddleNode>(`/v1/huddle-nodes/${encodeURIComponent(resource.resourceID)}?company_id=${encodeURIComponent(companyID)}`),
        requestJSON<RACIPolicy>(`/v1/resources/${resource.resourceType}/${encodeURIComponent(resource.resourceID)}/gvic?company_id=${encodeURIComponent(companyID)}`),
        requestJSON<{ users?: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`),
        requestJSON<{ groups?: CompanyUserGroup[]; members?: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups`),
        requestJSON<{ logic_gates?: HuddleLogicGateCardItem[] }>(`${isGate ? "/v1/huddle-logic-gates" : "/v1/huddle-nodes"}/${encodeURIComponent(resource.resourceID)}/logic-gates?company_id=${encodeURIComponent(companyID)}`),
      ]);
      const loadedName = isGate ? (item as HuddleGate).header : (item as HuddleNode).name;
      setName(loadedName);
      setSavedName(loadedName);
      setRaci(policy.gvic_assignments ?? []);
      setRaciRevision(policy.revision ?? "");
      setCompanyUsers(usersPayload.users ?? []);
      setCompanyUserGroups(groupsPayload.groups ?? []);
      setCompanyUserGroupMembers(groupsPayload.members ?? []);
      setLogicGateCards(cardsPayload.logic_gates ?? []);
      if (isGate) {
        const data = await requestJSON<{ huddle_nodes?: HuddleNode[] }>(`/v1/huddle-logic-gates/${encodeURIComponent(resource.resourceID)}/nodes?company_id=${encodeURIComponent(companyID)}`);
        setNodes(data.huddle_nodes ?? []);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Huddle");
    }
  }, [companyID, isGate, requestJSON, resource.resourceID, resource.resourceType]);

  useEffect(() => { void load(); }, [load]);

  const saveName = async () => {
    const clean = name.trim();
    if (!clean) {
      setName(savedName);
      return;
    }
    if (clean === savedName) return;
    try {
      const item = await requestJSON<HuddleGate | HuddleNode>(
        `${isGate ? "/v1/huddle-logic-gates/" : "/v1/huddle-nodes/"}${encodeURIComponent(resource.resourceID)}`,
        { method: "PUT", json: { company_id: companyID, [isGate ? "header" : "name"]: clean } },
      );
      const committed = isGate ? (item as HuddleGate).header : (item as HuddleNode).name;
      setName(committed);
      setSavedName(committed);
    } catch (cause) {
      setName(savedName);
      setError(cause instanceof Error ? cause.message : "Could not rename Huddle");
    }
  };

  const saveRaci = async (next: LogicGateRACIAssignment[]) => {
    setError("");
    try {
      const policy = await requestJSON<RACIPolicy>(`/v1/resources/${resource.resourceType}/${encodeURIComponent(resource.resourceID)}/gvic`, {
        method: "PUT",
        headers: raciRevision ? { "If-Match": raciRevision } : undefined,
        json: {
          company_id: companyID,
          assignment_mode: "customized",
          gvic_assignments: next.map((assignment) => ({
            role: assignment.role,
            principal_type: assignment.principal_type === "group" ? "group" : "user",
            principal_id: (assignment.principal_id || assignment.user_id).trim(),
          })),
          idempotency_key: crypto.randomUUID(),
        },
      });
      setRaci(policy.gvic_assignments ?? next);
      setRaciRevision(policy.revision ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save RACI assignments");
    }
  };

  const addRaciPrincipal = (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => {
    const cleanID = principalID.trim();
    if (!cleanID) return;
    const next = raci.filter((assignment) => !(
      (assignment.principal_type === "group" ? "group" : "user") === principalType
      && (assignment.principal_id || assignment.user_id).trim() === cleanID
    ));
    next.push({
      company_id: companyID,
      resource_id: resource.resourceID,
      role,
      principal_type: principalType,
      principal_id: cleanID,
      user_id: principalType === "user" ? cleanID : "",
      created_timestamp: new Date().toISOString(),
    });
    void saveRaci(next);
  };

  const removeRaciPrincipal = (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => {
    void saveRaci(raci.filter((assignment) => !(
      assignment.role === role
      && (assignment.principal_type === "group" ? "group" : "user") === principalType
      && (assignment.principal_id || assignment.user_id).trim() === principalID.trim()
    )));
  };

  const createNode = async () => {
    try {
      const node = await requestJSON<HuddleNode>("/v1/huddle-nodes", {
        method: "POST",
        json: { company_id: companyID, huddle_logic_gate_id: resource.resourceID, name: "New Huddle Node" },
      });
      setNodes((current) => [...current, node]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create Huddle Node");
    }
  };

  const refreshLogicGateCards = async () => {
    const data = await requestJSON<{ logic_gates?: HuddleLogicGateCardItem[] }>(`${isGate ? "/v1/huddle-logic-gates" : "/v1/huddle-nodes"}/${encodeURIComponent(resource.resourceID)}/logic-gates?company_id=${encodeURIComponent(companyID)}`);
    setLogicGateCards(data.logic_gates ?? []);
  };

  const openLogicGatePicker = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setLogicGatePickerAnchor({ left: rect.left, top: rect.bottom + 6 });
  };

  const addLogicGate = async (logicGateID: string) => {
    try {
      await requestJSON(`/v1/huddle-logic-gates/${encodeURIComponent(resource.resourceID)}/logic-gates/${encodeURIComponent(logicGateID)}`, {
        method: "PUT",
        json: { company_id: companyID },
      });
      setLogicGatePickerAnchor(null);
      await refreshLogicGateCards();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add Logic Gate");
    }
  };

  const removeLogicGate = async (item: HuddleLogicGateCardItem) => {
    try {
      await requestJSON(`/v1/huddle-logic-gates/${encodeURIComponent(resource.resourceID)}/logic-gates/${encodeURIComponent(item.logic_gate_id)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      setLogicGateCards((current) => current.filter((candidate) => candidate.logic_gate_id !== item.logic_gate_id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove Logic Gate");
    }
  };

  const deleteResource = async () => {
    if (!window.confirm(`Move “${name}” to the Recycle Bin?`)) return;
    try {
      await requestJSON(`${isGate ? "/v1/huddle-logic-gates/" : "/v1/huddle-nodes/"}${encodeURIComponent(resource.resourceID)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      onDeleted?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete Huddle");
    }
  };

  const startGateResize = (divider: 0 | 1, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const startX = event.clientX;
    const startLayout = columnLayout;
    const onMove = (moveEvent: PointerEvent) => setColumnLayout(resizeHuddleColumns(startLayout, divider, (moveEvent.clientX - startX) / Math.max(1, rect.width - 16)));
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const startNodeResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const startX = event.clientX;
    const startFraction = nodeLeftFraction;
    const onMove = (moveEvent: PointerEvent) => setNodeLeftFraction(Math.max(0.35, Math.min(0.78, startFraction + (moveEvent.clientX - startX) / Math.max(1, rect.width - 8))));
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const selectToolbarTab = (tab: EditorTabID) => {
    if (tab === "permissions") {
      setActiveTab("permissions");
      setPermissions(true);
      return;
    }
    setActiveTab(tab === "editor" ? "editor" : activeTab);
  };

  const bodyTemplate = isGate
    ? `minmax(300px, ${columnLayout[0]}fr) 8px minmax(180px, ${columnLayout[1]}fr) 8px minmax(240px, ${columnLayout[2]}fr)`
    : `minmax(320px, ${nodeLeftFraction}fr) 8px minmax(260px, ${1 - nodeLeftFraction}fr)`;

  return (
    <section
      aria-label={isGate ? "Huddle Logic Gate" : "Huddle Node"}
      data-huddle-resource-surface={resource.resourceType}
      data-huddle-fullscreen={fullscreen ? "true" : undefined}
      style={surfaceStyle}
    >
      <header style={toolbarHeaderStyle}>
        <div style={{ minWidth: 0, overflowX: "auto", overflowY: "visible", padding: "1px 0" }}>
          <BareMangoEditorToolbar
            controls={editorControls}
            activeTab={activeTab}
            visibleTabIDs={isGate ? ["editor", "permissions", "format", "outline-styles"] : ["permissions"]}
            onSelectTab={selectToolbarTab}
            reserveHeaderOffset={false}
          />
        </div>
        <div aria-label="Huddle actions" style={actionGroupStyle}>
          <button type="button" title="Move to Recycle Bin" aria-label="Move to Recycle Bin" onClick={() => void deleteResource()} style={{ ...iconButtonStyle, color: "#be123c" }}><HeaderRecycleBinIcon /></button>
          <button type="button" title={`Pin ${isGate ? "Huddle Logic Gate" : "Huddle Node"}`} aria-label={`Pin ${isGate ? "Huddle Logic Gate" : "Huddle Node"}`} onClick={() => requestAppSidebarPin({ id: resource.resourceID, kind: resource.resourceType, name })} style={iconButtonStyle}><PinToSidebarIcon /></button>
          <button type="button" title={fullscreen ? "Exit fullscreen" : "Fullscreen"} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} aria-pressed={fullscreen} onClick={onToggleFullscreen} style={iconButtonStyle}><FullscreenIcon active={fullscreen} /></button>
          <button type="button" title="Close" aria-label="Close" onClick={onClose} style={closeButtonStyle}>X</button>
        </div>
      </header>

      <div style={identityHeaderStyle}>
        <strong style={identityLabelStyle}>{isGate ? "Huddle Logic Gate:" : "Huddle Node:"}</strong>
        <input
          aria-label={isGate ? "Huddle Logic Gate title" : "Huddle Node title"}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
          style={titleInputStyle}
        />
      </div>

      <div style={raciFrameStyle}>
        <RACIAssignmentBoard
          assignments={raci}
          companyUsers={companyUsers}
          companyUserGroups={companyUserGroups}
          companyUserGroupMembers={companyUserGroupMembers}
          accent="#334155"
          panelBackground={EDITOR_NEU_PANEL_BACKGROUND}
          ruleColor="rgba(148,163,184,.24)"
          canEdit
          onAddPrincipal={addRaciPrincipal}
          onRemovePrincipal={removeRaciPrincipal}
        />
      </div>

      <div role={error ? "alert" : undefined} aria-hidden={error ? undefined : "true"} style={error ? errorStyle : errorPlaceholderStyle}>{error}</div>

      <div
        ref={bodyRef}
        data-huddle-column-layout={isGate ? "three-resizable-columns" : "two-resizable-columns"}
        style={{ ...bodyStyle, gridTemplateColumns: bodyTemplate }}
      >
        {isGate ? (
          <div aria-label={`${name} editor column`} style={editorColumnStyle}>
            <BareMangoEditorDocument
              companyID={companyID}
              resourceType="huddle_logic_gate"
              resourceID={resource.resourceID}
              currentUserID={currentUserID}
              requestJSON={requestJSON}
              ariaLabel={`${name} editor`}
              controls={editorControls}
              style={{ padding: "22px 26px", background: "rgba(255,255,255,.72)" }}
            />
          </div>
        ) : (
          <section aria-label={`${name} Logic Gate snapshot`} data-huddle-node-snapshot="true" style={relationshipColumnStyle}>
            <div style={relationshipColumnHeaderStyle}><strong>Logic Gate snapshot</strong></div>
            <HuddleLogicGateCards items={logicGateCards} emptyLabel="No Logic Gates were linked when this Huddle Node was created." />
          </section>
        )}
        <div role="separator" aria-label={isGate ? "Resize Huddle editor and Logic Gate columns" : "Resize Huddle Node snapshot and chat columns"} aria-orientation="vertical" onPointerDown={isGate ? (event) => startGateResize(0, event) : startNodeResize} style={columnResizeHandleStyle}><span style={columnResizeGripStyle} /></div>
        {isGate ? (
          <section aria-label="Huddle Logic Gates" style={relationshipColumnStyle}>
            <div style={relationshipColumnHeaderStyle}>
              <strong>Logic Gates</strong>
              <button type="button" aria-label="Add Logic Gate" title="Add Logic Gate" onClick={openLogicGatePicker} style={createNodeButtonStyle}>+</button>
            </div>
            <HuddleLogicGateCards items={logicGateCards} emptyLabel="No Logic Gates linked yet." onRemove={(item) => void removeLogicGate(item)} />
          </section>
        ) : (
          <div aria-label="Reserved Huddle Node chat column" style={emptyColumnStyle} />
        )}
        {isGate && (
          <>
            <div role="separator" aria-label="Resize Huddle middle and Node columns" aria-orientation="vertical" onPointerDown={(event) => startGateResize(1, event)} style={columnResizeHandleStyle}><span style={columnResizeGripStyle} /></div>
            <aside aria-label="Huddle Nodes" style={nodeColumnStyle}>
              <div style={nodeColumnHeaderStyle}>
                <strong>Huddle Nodes</strong>
                <button type="button" aria-label="Create Huddle Node" title="Create Huddle Node" onClick={() => void createNode()} style={createNodeButtonStyle}>+</button>
              </div>
              <div style={{ minHeight: 0, overflowY: "auto", display: "grid", alignContent: "start", gap: 8, padding: "4px 2px" }}>
                {nodes.length === 0 && <div style={emptyNodesStyle}>No Huddle Nodes</div>}
                {nodes.map((node) => (
                  <button
                    key={node.huddle_node_id}
                    type="button"
                    data-huddle-node-card={node.huddle_node_id}
                    title="Click to open Huddle Node"
                    onClick={() => onOpenNode({ resourceType: "huddle_node", resourceID: node.huddle_node_id, name: node.name })}
                    style={nodeCardStyle}
                  >
                    <HuddleResourceIcon type="huddle_node" />
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
                  </button>
                ))}
              </div>
            </aside>
          </>
        )}
      </div>

      {permissions && (
        <EntityPermissionsDialog
          requestJSON={requestJSON}
          apiBase={apiBase}
          companyID={companyID}
          entityType={resource.resourceType}
          entityID={resource.resourceID}
          title={`${name} permissions`}
          onClose={() => { setPermissions(false); setActiveTab("editor"); }}
        />
      )}
      {isGate && logicGatePickerAnchor && (
        <UniversalEntityPicker
          companyID={companyID}
          requestJSON={requestJSON}
          sourceLabel="Huddle Logic Gate"
          linkTargetTypes={["logic_gate"]}
          initialMode="link"
          initialCategory="logic_gate"
          lockMode
          anchor={logicGatePickerAnchor}
          onChoose={async (entity, mode) => {
            if (mode !== "link" || entity.entityType !== "logic_gate") return;
            await addLogicGate(entity.entityID);
          }}
          onCancel={() => setLogicGatePickerAnchor(null)}
        />
      )}
    </section>
  );
};

export const HuddleNodePopup: React.FC<{
  apiBase: string;
  companyID: string;
  currentUserID: string;
  resource: HuddleOpenResource;
  requestJSON: HuddleRequestJSON;
  onClose: () => void;
}> = ({ apiBase, companyID, currentUserID, resource, requestJSON, onClose }) => {
  const [fullscreen, setFullscreen] = useState(false);
  const [sidebarRight, setSidebarRight] = useState(320);
  useEffect(() => {
    const sidebar = document.querySelector<HTMLElement>('[data-app-sidebar="primary"]');
    const measure = () => setSidebarRight(Math.max(0, Math.ceil(sidebar?.getBoundingClientRect().right ?? 320)));
    measure();
    const observer = sidebar && typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (sidebar) observer?.observe(sidebar);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  return (
    <AppModalPortal trapFocus={!fullscreen} onRequestClose={onClose}>
      <div
        role="presentation"
        data-huddle-node-popup="almost-fullscreen"
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        style={{ ...popupBackdropStyle, left: fullscreen ? 0 : sidebarRight, top: fullscreen ? 0 : 8, right: fullscreen ? 0 : 8, bottom: fullscreen ? 0 : 8, padding: fullscreen ? 0 : 8 }}
      >
        <div role="dialog" aria-modal="true" aria-label="Huddle Node" onMouseDown={(event) => event.stopPropagation()} style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}>
          <HuddleResourceSurface
            apiBase={apiBase}
            companyID={companyID}
            currentUserID={currentUserID}
            resource={resource}
            requestJSON={requestJSON}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen((current) => !current)}
            onClose={onClose}
            onOpenNode={() => undefined}
          />
        </div>
      </div>
    </AppModalPortal>
  );
};

const FullscreenIcon: React.FC<{ active: boolean }> = ({ active }) => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
    {active ? (
      <><path d="M6.2 2.2v3.6H2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M9.8 13.8v-3.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>
    ) : (
      <><path d="M2.6 6V2.6H6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M13.4 10v3.4H10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></>
    )}
  </svg>
);

const surfaceStyle: React.CSSProperties = { width: "100%", height: "100%", minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "40px 54px auto auto minmax(0,1fr)", overflow: "hidden", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: EDITOR_NEU_PANEL_BACKGROUND, color: "#111827", boxShadow: EDITOR_NEU_PANEL_SHADOW };
const toolbarHeaderStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 8, padding: "6px 8px 4px 10px", borderBottom: "1px solid rgba(148,163,184,.16)", background: "linear-gradient(180deg,rgba(255,255,255,.8),rgba(248,250,252,.54))" };
const actionGroupStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6 };
const iconButtonStyle: React.CSSProperties = { width: 26, height: 26, display: "grid", placeItems: "center", border: "1px solid rgba(100,116,139,.25)", borderRadius: 7, background: EDITOR_NEU_SURFACE, color: "#334155", padding: 0, cursor: "pointer", boxShadow: "2px 2px 6px rgba(148,163,184,.2), -2px -2px 6px rgba(255,255,255,.86)" };
const closeButtonStyle: React.CSSProperties = { ...iconButtonStyle, border: "1px solid transparent", background: "linear-gradient(135deg,#ff5a6b,#ef334e)", color: "#fff", fontSize: 15, fontWeight: 800, boxShadow: "0 8px 18px rgba(239,51,78,.26), inset 1px 1px 0 rgba(255,255,255,.38)" };
const identityHeaderStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", gap: 7, margin: "5px 12px 2px", padding: "8px 12px", border: "1px solid rgba(255,255,255,.82)", borderRadius: 11, background: EDITOR_NEU_SURFACE, boxShadow: EDITOR_NEU_SHADOW };
const identityLabelStyle: React.CSSProperties = { flex: "0 0 auto", fontSize: 18, fontWeight: 850, color: "#111827" };
const titleInputStyle: React.CSSProperties = { minWidth: 0, flex: 1, border: 0, outline: 0, background: "transparent", color: "#111827", font: "inherit", fontSize: 18, fontWeight: 650, padding: 0 };
const raciFrameStyle: React.CSSProperties = { minWidth: 0, padding: "5px 12px 8px", overflowX: "auto", overflowY: "visible" };
const errorStyle: React.CSSProperties = { margin: "0 12px 5px", padding: "6px 9px", borderRadius: 7, background: "rgba(254,226,226,.82)", color: "#b91c1c", fontSize: 11, fontWeight: 750 };
const errorPlaceholderStyle: React.CSSProperties = { height: 0, minHeight: 0, overflow: "hidden" };
const bodyStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, display: "grid", gap: 0, padding: "4px 10px 10px", overflowX: "auto", overflowY: "hidden" };
const editorColumnStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, overflow: "hidden", border: "1px solid rgba(255,255,255,.84)", borderRadius: 12, background: "rgba(255,255,255,.72)", boxShadow: EDITOR_NEU_SHADOW };
const emptyColumnStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, border: "1px solid rgba(255,255,255,.72)", borderRadius: 12, background: "linear-gradient(145deg,rgba(246,249,252,.76),rgba(236,241,247,.62))", boxShadow: "inset 4px 4px 12px rgba(148,163,184,.12), inset -4px -4px 12px rgba(255,255,255,.72)" };
const relationshipColumnStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "40px minmax(0,1fr)", overflow: "hidden", padding: 9, border: "1px solid rgba(255,255,255,.84)", borderRadius: 12, background: EDITOR_NEU_SURFACE, boxShadow: EDITOR_NEU_SHADOW };
const relationshipColumnHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 3px 6px", color: "#243047", fontSize: 14 };
const columnResizeHandleStyle: React.CSSProperties = { minWidth: 8, height: "100%", display: "grid", placeItems: "center", cursor: "col-resize", touchAction: "none" };
const columnResizeGripStyle: React.CSSProperties = { width: 3, height: 42, borderRadius: 999, background: "linear-gradient(180deg,#67e8f9,#38bdf8,#a78bfa)", boxShadow: "0 0 8px rgba(56,189,248,.35)" };
const nodeColumnStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "40px minmax(0,1fr)", overflow: "hidden", padding: 9, border: "1px solid rgba(255,255,255,.84)", borderRadius: 12, background: EDITOR_NEU_SURFACE, boxShadow: EDITOR_NEU_SHADOW };
const nodeColumnHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 3px 6px", fontSize: 14 };
const createNodeButtonStyle: React.CSSProperties = { ...iconButtonStyle, width: 28, height: 28, fontSize: 18, lineHeight: 1 };
const emptyNodesStyle: React.CSSProperties = { padding: "12px 9px", color: "#64748b", fontSize: 12, fontWeight: 650 };
const nodeCardStyle: React.CSSProperties = { width: "100%", minWidth: 0, minHeight: 40, display: "grid", gridTemplateColumns: "32px minmax(0,1fr)", alignItems: "center", gap: 7, border: "1px solid rgba(148,163,184,.22)", borderRadius: 10, background: EDITOR_NEU_SURFACE, color: "#111827", padding: "7px 10px", textAlign: "left", font: "inherit", fontSize: 12, fontWeight: 750, cursor: "pointer", boxShadow: "3px 4px 10px rgba(148,163,184,.18), -3px -3px 9px rgba(255,255,255,.82)" };
const popupBackdropStyle: React.CSSProperties = { position: "fixed", zIndex: 11900, background: "rgba(15,23,42,.18)", borderRadius: 16 };
