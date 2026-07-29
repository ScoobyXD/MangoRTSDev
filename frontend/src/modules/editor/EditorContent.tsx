import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu } from "../../app/ConfirmActionMenu";
import {
  getNodeTitle,
  MINI_GRID,
  NODE_H,
  NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX,
  NODE_W,
  canEditResourceAccess,
  persistedMapPositionsToNodePositions,
  resolveOpenNodeMapPosition,
  type NodeDirection,
  type NodeRecord,
  type NodeRelationship,
} from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, getNodeTitle as getLogicGateTitle, toLogicGateCanvasRecord, type LogicGateGVICAssignment, type LogicGateGVICRole, type LogicGateGVICPrincipalType, type LogicGateRecord } from "../logic-gate-map/shared";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { getNodeRecordSingleFlight, getNodeInformationProjectionSingleFlight, getNodeContentChangesSingleFlight, getNodeGVICAssignmentsSingleFlight, invalidateNodeRecordStoreCaches, primeNodeRecordStoreCaches, type NodeProjectionItem } from "../node-map/NodeRecordStore";
import { getNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph, upsertNodeMapPositionsInNodeRelationshipGraph, upsertNodeRelationshipGraphNode, upsertNodeRelationshipGraphRelationship } from "../node-map/NodeRelationshipGraph";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand } from "../workspace/workspaceEntityCommands";
import { buildLinkedNodePayloadFromSourceSide } from "../node-map/relationshipProjection";
import { getLogicGateRecordSingleFlight, getLogicGateInformationProjectionSingleFlight, invalidateLogicGateRecordStoreCaches, patchLogicGateRecordStoreGVICAssignments, type LogicGateProjectionItem } from "../logic-gate-map/LogicGateRecordStore";
import { getLogicGateRelationshipGraphSnapshot, subscribeLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { patchLogicGateGVICAssignmentsInCommunicationsWorkspaceCache } from "../communications/communicationsApi";
import { linkMangoResourceAttachment, loadMangoAttachmentObjectURL } from "../attachments/attachmentApi";
import { createRequestJSON, isAbortError } from "../api/requestJSON";
import { clearResourceMissing, isTerminalResourceNotFoundError } from "../api/missingResources";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange, type SelectionIntent } from "../selectionCoordinator";
import { getEditorDocumentIsolationState, type EditorRelatedNodeCreationKind, type EditorTabID } from "./editorTabs";
import { EDITOR_TAB_TEXT } from "./plainTextEditing";
import { createEditorScrollMemory } from "./editorScroll";
import { buildEditorIndentGuideSegments, type EditorIndentGuideSegment } from "./editorIndentGuides";
import {
  buildEditorTextBlockMetadataPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  selectCurrentEditorTextProjection,
} from "./editorProjection";
import { editorHTMLPatchForChange } from "./editorTextboxSync";
import { nodeContentChangeSeenGroupKey, type NodeContentChange } from "./nodeContentChanges";
import { EditorDocumentSurface } from "./EditorDocumentSurface";
import { EditorLinkedDocumentPanels } from "./EditorLinkedDocumentPanels";
import { formatNodeDueDateForEditor, normalizeNodeDueDateDraft } from "./editorDates";
import { EditorTabBar } from "./EditorTabBar";
import { NodeWorkspaceSurface } from "./NodeWorkspaceSurface";
import { NodeRelationshipsSurface } from "./NodeRelationshipsSurface";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  type NodeWorkspaceSaveController,
  type NodeImageNodeRequest,
} from "./NodeWorkspaceSurfaceShared";
import {
  deserializeEditorDocumentHTML,
  EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES,
  readEditorDocumentText,
  serializeEditorDocumentHTML,
  type EditorHighlightColor,
} from "./richTextEditing";
import {
  documentTargetKey,
  generateStableInformationID,
  shouldReadStoredSelectionForEvent,
  type DocumentSaveRequest,
  type DocumentSaveTarget,
  type LinkedEntityKind,
  type LinkedSelection,
} from "./editorTypes";
import { hydrateEditorAttachmentImageFrames } from "./editorImages";
import {
  EDITOR_DOCUMENT_FONT_SIZE_PX,
  EDITOR_DOCUMENT_LINE_HEIGHT,
  getEditorDocumentFontFamily,
  EDITOR_DOCUMENT_TOP_PX,
  EDITOR_DOCUMENT_MAX_FONT_SIZE_PX,
  EDITOR_DOCUMENT_MIN_FONT_SIZE_PX,
  useEditorPreferences,
} from "./useEditorPreferences";
import {
  getEditorSelectionOffsets,
  setEditorSelectionByOffsets,
  useEditorDocumentFormattingController,
  useEditorDocumentSurfaceHandlers,
  type EditorDocumentFormattingController,
  type EditorInlineStyleCommand,
  type EditorSelectionInlineFormatState,
  type EditorTextAlignment,
  type EditorTypingCaretBookmark,
} from "./useEditorDocumentSurfaceHandlers";
import { useEditorDocumentPersistence } from "./useEditorDocumentPersistence";
import { createEditorDocumentUndoHistory, resetEditorDocumentUndoHistory } from "./editorUndoHistory";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { invalidateWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
import { subscribeRealtimeScope } from "../realtime/realtimeWebSocket";
import { assignNodeToLogicGateStatus, moveLogicGateAssignment } from "../kanban/kanbanApi";
import { EntityPermissionsPanel } from "../permissions/EntityPermissionsDialog";
import { listProjectRelationshipsForResource, type ProjectRelationshipProjection } from "../project-management/projectManagementApi";
import { ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons";
import { commitEntityTitleMutation, createCommittedTitleEditBuffer, foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, subscribeCommittedEntityTitleUpdates } from "../realtime/committedEntityTitleUpdates";
import { preferResolvedEntityLabel } from "../entityLabels.js";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh";
import { listCompanyUserGroups, listCompanyUsers, type CompanyUserGroup, type CompanyUserGroupMember } from "../communications/communicationsApi";
import { useCompanyAccounts } from "../accounts/AccountFilterControl";
import { setNodeAccountAssignments, type Account } from "../accounts/accountsApi";
import { useMangoEditorDataFormat } from "./editorDataFormat";
import { LogicGateTiptapEditorSurface } from "./LogicGateTiptapEditorSurface.js";
import { parseMangoTiptapDocument } from "./tiptap/mangoTiptapDocument.js";

function editorSnapshotScope(resourceType: "node" | "logic_gate", resourceID: string): string {
  const cleanID = resourceID.trim();
  return cleanID ? `${resourceType}:${cleanID}` : "";
}

function clampEditorSelectionFontSize(value: number): number {
  return Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, Math.round(value)));
}

function responsiveEditorDocumentFontSize(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) return EDITOR_DOCUMENT_FONT_SIZE_PX;
  if (widthPx < 320) return 12;
  if (widthPx < 460) return 13;
  if (widthPx < 620) return 14;
  return EDITOR_DOCUMENT_FONT_SIZE_PX;
}

type EditorContentProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
  forcedEntityKind?: "node" | "logic_gate";
  forcedEntityID?: string;
  forcedLabel?: string;
  forcedEmptyMessage?: string;
  focusInformationID?: string;
  focusEmailMessageID?: string;
  focusRequestID?: number;
  focusInformationMode?: "focus" | "scroll";
  compactLinkedDocumentHeader?: boolean;
  onLogicGateTitleChange?: (update: { logicGateID: string; label: string }) => void;
};

type CompanyUser = {
  company_id: string;
  user_id: string;
  email?: string;
  display_name?: string;
  role?: string;
};

type EditorNodeBatchResponse = {
  nodes?: NodeRecord[];
  relationships?: NodeRelationship[];
  node_map_positions?: Array<{ entity_id?: string; node_id?: string; x: number; y: number; updated_timestamp?: string }>;
};

const EDITOR_RELATIONSHIP_WORLD_W = 12800;
const EDITOR_RELATIONSHIP_WORLD_H = 8800;
const EDITOR_SAVE_VERSION_INTERVAL_OPTIONS = [5, 10, 30, 60] as const;
const EDITOR_SAVE_VERSION_DEFAULT_INTERVAL_MINUTES = 10;
const EDITOR_AUTO_SAVE_VERSION_CREATION_ENABLED: boolean = false;
const LOGIC_GATE_OVERVIEW_DOCUMENT_ID = "logic-gate-overview";

type EditorSaveVersionItem = {
  information_id: string;
  source_information_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

type EditorSaveVersion = {
  company_id: string;
  resource_type: "node" | "logic_gate";
  resource_id: string;
  save_id: string;
  save_kind: "manual" | "auto" | "legacy";
  saved_by_user_id?: string;
  saved_by_display_name?: string;
  created_timestamp: string;
  updated_timestamp: string;
  item_count: number;
  items?: EditorSaveVersionItem[];
};

type EditorSaveVersionsPayload = {
  versions?: EditorSaveVersion[];
};

function editorSaveVersionsPath(resourceType: "node" | "logic_gate", resourceID: string): string {
  return resourceType === "node" ? `/v1/nodes/${resourceID}/save-versions` : `/v1/logic-gates/${resourceID}/save-versions`;
}

function editorSaveSettingsStorageKey(companyID: string, resourceType: "node" | "logic_gate", resourceID: string): string {
  return `mango-editor-save-settings-v1:${companyID}:${resourceType}:${resourceID}`;
}

function readEditorSaveIntervalMinutes(companyID: string, resourceType: "node" | "logic_gate", resourceID: string): number {
  if (typeof localStorage === "undefined") return EDITOR_SAVE_VERSION_DEFAULT_INTERVAL_MINUTES;
  const raw = localStorage.getItem(editorSaveSettingsStorageKey(companyID, resourceType, resourceID));
  const parsed = Number.parseInt(raw ?? "", 10);
  return EDITOR_SAVE_VERSION_INTERVAL_OPTIONS.includes(parsed as typeof EDITOR_SAVE_VERSION_INTERVAL_OPTIONS[number])
    ? parsed
    : EDITOR_SAVE_VERSION_DEFAULT_INTERVAL_MINUTES;
}

function writeEditorSaveIntervalMinutes(companyID: string, resourceType: "node" | "logic_gate", resourceID: string, minutes: number) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(editorSaveSettingsStorageKey(companyID, resourceType, resourceID), String(minutes));
}

function formatEditorSaveVersionTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function editorSaveVersionKindLabel(kind: string): string {
  return kind === "auto" ? "Auto save" : kind === "manual" ? "Manual save" : "Legacy save";
}

function editorSaveVersionPreview(version: EditorSaveVersion | null): string {
  if (!version) return "";
  const items = version.items ?? [];
  if (items.length === 0) return "";
  return items.map((item, index) => {
    const label = items.length > 1 ? `Text box ${index + 1}` : item.type || "Text box";
    return `${label}\n${item.information}`;
  }).join("\n\n");
}

function editorSaveVersionSignature(version: EditorSaveVersion): string {
  return JSON.stringify((version.items ?? []).map((item) => [item.source_information_id || item.information_id, item.information]));
}

function logicGateGVICAssignmentPrincipalType(assignment: LogicGateGVICAssignment): LogicGateGVICPrincipalType {
  return (assignment.principal_type?.trim() || "user") as LogicGateGVICPrincipalType;
}

function logicGateGVICAssignmentPrincipalID(assignment: LogicGateGVICAssignment): string {
  const principalType = logicGateGVICAssignmentPrincipalType(assignment);
  const principalID = assignment.principal_id?.trim() || "";
  const userID = assignment.user_id?.trim() || "";
  if (principalType === "user") return principalID || userID;
  return principalID;
}

type EditorGVICAssignmentInput = {
  role: LogicGateGVICRole;
  principal_type?: LogicGateGVICPrincipalType;
  principal_id?: string;
  user_id?: string;
};

type ResourceGVICPayload = {
  gvic_assignments?: LogicGateGVICAssignment[];
};

function toResourceGVICAssignmentInput(assignment: EditorGVICAssignmentInput): {
  role: LogicGateGVICRole;
  principal_type: LogicGateGVICPrincipalType;
  principal_id: string;
} {
  const principalType = assignment.principal_type?.trim() === "group" ? "group" : "user";
  return {
    role: assignment.role,
    principal_type: principalType,
    principal_id: (assignment.principal_id ?? assignment.user_id ?? "").trim(),
  };
}

function normalizeLogicGateGVICAssignments(assignments: LogicGateGVICAssignment[], logicGateID: string): LogicGateGVICAssignment[] {
  const fallbackLogicGateID = logicGateID.trim();
  return assignments.map((assignment) => {
    const principalType = logicGateGVICAssignmentPrincipalType(assignment);
    const principalID = logicGateGVICAssignmentPrincipalID(assignment);
    return {
      ...assignment,
      logic_gate_id: assignment.logic_gate_id?.trim() || assignment.resource_id?.trim() || fallbackLogicGateID,
      principal_type: principalType,
      principal_id: principalID,
      user_id: assignment.user_id?.trim() || (principalType === "user" ? principalID : ""),
    };
  });
}

function mergeAccountLists(primary: Account[], secondary: Account[]): Account[] {
  const byID = new Map<string, Account>();
  for (const account of [...primary, ...secondary]) {
    const accountID = account.account_id.trim();
    if (!accountID || byID.has(accountID)) continue;
    byID.set(accountID, { ...account, account_id: accountID });
  }
  return Array.from(byID.values());
}

function isNodeWorkspaceHeaderInformationType(type: string): boolean {
  return type === EDITOR_TEXT_BLOCK_TYPE || type === EDITOR_TEXT_BLOCK_CHAT_TYPE || type === EDITOR_ATTACHED_EMAIL_TYPE;
}

const LINKED_NODE_ACCESS_DENIED_MESSAGE = "You do not have permission to see this.";
const LINKED_ENTITY_NOT_FOUND_MESSAGE = "This resource no longer exists. It was deleted or something.";

function linkedEntityLoadErrorMessage(cause: unknown, entityKind: "" | "node" | "logic_gate"): string {
  if (isTerminalResourceNotFoundError(cause)) return LINKED_ENTITY_NOT_FOUND_MESSAGE;
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("node_not_found") || normalized.includes("logic_gate_not_found") || normalized.includes("not_found") || normalized.includes("404")) {
    return LINKED_ENTITY_NOT_FOUND_MESSAGE;
  }
  if (
    normalized.includes("access_denied") ||
    normalized.includes("company_access_denied") ||
    normalized.includes("forbidden") ||
    normalized.includes("403")
  ) {
    return entityKind === "logic_gate" ? "You do not have permission to see this." : LINKED_NODE_ACCESS_DENIED_MESSAGE;
  }
  return message || "Failed to load linked information";
}

const ProjectRelationshipsSurface: React.FC<{
  companyID: string;
  resourceType: "node" | "logic_gate";
  resourceID: string;
  resourceTitle: string;
  scope: string;
  topPx: number;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
}> = ({
  companyID,
  resourceType,
  resourceID,
  resourceTitle,
  scope,
  topPx,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
}) => {
  const [relationships, setRelationships] = useState<ProjectRelationshipProjection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cleanResourceID = resourceID.trim();
    if (!companyID || !cleanResourceID) {
      setRelationships([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void listProjectRelationshipsForResource({ companyID, resourceType, resourceID: cleanResourceID })
      .then((payload) => {
        if (!cancelled) setRelationships(payload.relationships ?? []);
      })
      .catch((cause) => {
        if (!cancelled && !isAbortError(cause)) setRelationships([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyID, resourceID, resourceType]);

  const openProject = useCallback((row: ProjectRelationshipProjection) => {
    const projectID = row.project_id.trim();
    if (!projectID) return;
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, {
      companyID,
      sourceFrameID: `${scope}:relationships-tab`,
      kind: "project",
      id: projectID,
      label: row.project_name?.trim() || projectID,
      selectedTreeID: `project-${projectID}`,
      changedAt: Date.now(),
    });
  }, [companyID, scope]);

  return (
    <div className="mango-editor-hover-highlight" style={{ position: "absolute", top: topPx, left: 12, right: 12, bottom: 12, zIndex: 2, pointerEvents: "auto", minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", border: `1px solid ${strokeColor}`, borderRadius: 12, background: panelBackground, color: surfaceText, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 10, padding: "12px 14px", borderBottom: `1px solid ${ruleColor}` }}>
        <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 950 }}>Relationships</div>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 11, fontWeight: 760 }}>{resourceTitle || (resourceType === "logic_gate" ? "Logic Gate" : "Node")}</div>
        </div>
        <span style={{ border: `1px solid ${strokeColor}`, borderRadius: 999, padding: "4px 8px", color: accent, fontSize: 11, fontWeight: 900 }}>{relationships.length} project{relationships.length === 1 ? "" : "s"}</span>
      </div>
      <div className="editor-document-scroll" style={{ minHeight: 0, overflow: "auto", padding: 12, display: "grid", alignContent: "start", gap: 8 }}>
        {loading ? (
          <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 10, padding: 12, color: surfaceText, opacity: 0.64, fontSize: 12, fontWeight: 760 }}>Loading projects</div>
        ) : relationships.length === 0 ? (
          <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 10, padding: 12, color: surfaceText, opacity: 0.64, fontSize: 12, fontWeight: 760 }}>No project relationships</div>
        ) : relationships.map((row) => {
          const projectID = row.project_id.trim();
          const label = row.project_name?.trim() || `Project ${projectID.slice(0, 8)}`;
          return (
            <button
              key={row.relationship_id}
              type="button"
              onClick={() => openProject(row)}
              title={label}
              style={{ minHeight: 40, display: "grid", gridTemplateColumns: "22px minmax(0, 1fr)", alignItems: "center", gap: 9, border: `1px solid ${strokeColor}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, color: surfaceText, cursor: "pointer", padding: "8px 10px", font: "inherit", textAlign: "left" }}
            >
              <ExplorerRowIcon kind="project" />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 850 }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

const EditorSaveSettingsSurface: React.FC<{
  topPx: number;
  resourceTitle: string;
  intervalMinutes: number;
  versions: EditorSaveVersion[];
  selectedSaveID: string;
  loading: boolean;
  saving: boolean;
  restoring: boolean;
  sortAscending: boolean;
  status: string;
  canEdit: boolean;
  accent: string;
  surfaceText: string;
  panelBackground: string;
  strokeColor: string;
  ruleColor: string;
  scrollbarAccent: string;
  scrollbarTrack: string;
  onIntervalChange: (minutes: number) => void;
  onSaveNow: () => void;
  onSelectSave: (saveID: string) => void;
  onToggleSort: () => void;
  onRestore: (saveID: string) => void;
}> = ({
  topPx,
  resourceTitle,
  intervalMinutes,
  versions,
  selectedSaveID,
  loading,
  saving,
  restoring,
  sortAscending,
  status,
  canEdit,
  accent,
  surfaceText,
  panelBackground,
  strokeColor,
  ruleColor,
  scrollbarAccent,
  scrollbarTrack,
  onIntervalChange,
  onSaveNow,
  onSelectSave,
  onToggleSort,
  onRestore,
}) => {
  const sortedVersions = useMemo(() => {
    return [...versions].sort((left, right) => {
      const compared = left.created_timestamp.localeCompare(right.created_timestamp);
      return sortAscending ? compared : -compared;
    });
  }, [sortAscending, versions]);
  const selectedVersion = sortedVersions.find((version) => version.save_id === selectedSaveID) ?? sortedVersions[0] ?? null;
  const preview = editorSaveVersionPreview(selectedVersion);

  return (
    <div className="mango-editor-hover-highlight" style={{ position: "absolute", top: topPx, left: 12, right: 12, bottom: 12, zIndex: 3, pointerEvents: "auto", minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", border: `1px solid ${strokeColor}`, borderRadius: 12, background: panelBackground, color: surfaceText, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: `1px solid ${ruleColor}` }}>
        <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 950 }}>Save Settings</div>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 11, fontWeight: 760 }}>{resourceTitle || "Editor"}</div>
        </div>
        <button
          type="button"
          disabled={!canEdit || saving}
          onClick={onSaveNow}
          style={{ minHeight: 30, border: `1px solid ${strokeColor}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: canEdit ? accent : "rgba(100,116,139,0.62)", cursor: canEdit && !saving ? "pointer" : "default", padding: "0 12px", fontSize: 12, fontWeight: 900 }}
        >
          {saving ? "Saving" : "Save"}
        </button>
      </div>
      <div className="editor-document-scroll" style={{ minHeight: 0, overflow: "auto", padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap: 12, alignItems: "start", ["--editor-document-scroll-accent" as string]: scrollbarAccent, ["--editor-document-scroll-track" as string]: scrollbarTrack }}>
        <section style={{ display: "grid", gap: 10, minWidth: 0 }}>
          <label style={{ display: "grid", gap: 5, border: `1px solid ${strokeColor}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, padding: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 900 }}>We auto save this every certain amount of time</span>
            <select
              value={intervalMinutes}
              disabled={!canEdit}
              onChange={(event) => onIntervalChange(Number.parseInt(event.currentTarget.value, 10))}
              style={{ minHeight: 30, border: `1px solid ${strokeColor}`, borderRadius: 7, background: "#ffffff", color: "#111827", font: "inherit", fontSize: 12, fontWeight: 760, padding: "4px 7px" }}
            >
              {EDITOR_SAVE_VERSION_INTERVAL_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>{minutes === 60 ? "Every hour" : `Every ${minutes} minutes`}</option>
              ))}
            </select>
          </label>
          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <strong style={{ fontSize: 11 }}>Saved versions</strong>
              <button type="button" onClick={onToggleSort} style={{ border: `1px solid ${strokeColor}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: surfaceText, cursor: "pointer", padding: "4px 7px", fontSize: 11, fontWeight: 800 }}>
                {sortAscending ? "Oldest first" : "Newest first"}
              </button>
            </div>
            <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
              {loading ? (
                <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, padding: 10, fontSize: 12, opacity: 0.7 }}>Loading saves</div>
              ) : sortedVersions.length === 0 ? (
                <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, padding: 10, fontSize: 12, opacity: 0.7 }}>No saved versions yet</div>
              ) : sortedVersions.map((version) => {
                const selected = selectedVersion?.save_id === version.save_id;
                return (
                  <button
                    key={version.save_id}
                    type="button"
                    onClick={() => onSelectSave(version.save_id)}
                    style={{ minHeight: 46, display: "grid", gap: 2, border: `1px solid ${selected ? accent : strokeColor}`, borderRadius: 8, background: selected ? EDITOR_NEU_ACTIVE_SURFACE : EDITOR_NEU_SURFACE, color: surfaceText, cursor: "pointer", textAlign: "left", padding: "7px 9px", font: "inherit" }}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                      <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{formatEditorSaveVersionTimestamp(version.created_timestamp)}</strong>
                      <span style={{ color: accent, fontSize: 10, fontWeight: 900 }}>{editorSaveVersionKindLabel(version.save_kind)}</span>
                    </span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.86)", fontSize: 10.5, fontWeight: 700 }}>
                      {version.saved_by_display_name || "Unknown user"} - {version.item_count} text box{version.item_count === 1 ? "" : "es"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
        <section style={{ minWidth: 0, display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ border: `1px solid ${strokeColor}`, borderRadius: 9, background: EDITOR_NEU_SURFACE, padding: 10, display: "grid", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
              <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>
                {selectedVersion ? formatEditorSaveVersionTimestamp(selectedVersion.created_timestamp) : "No save selected"}
              </strong>
              <button
                type="button"
                disabled={!canEdit || !selectedVersion || restoring}
                onClick={() => { if (selectedVersion) onRestore(selectedVersion.save_id); }}
                style={{ minHeight: 30, border: `1px solid ${strokeColor}`, borderRadius: 8, background: EDITOR_NEU_ACTIVE_SURFACE, color: canEdit && selectedVersion ? accent : "rgba(100,116,139,0.62)", cursor: canEdit && selectedVersion && !restoring ? "pointer" : "default", padding: "0 10px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }}
              >
                {restoring ? "Restoring" : "Overwrite with this save"}
              </button>
            </div>
            <pre style={{ margin: 0, minHeight: 220, maxHeight: 420, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", border: `1px solid ${ruleColor}`, borderRadius: 8, background: "#ffffff", color: "#111827", padding: 10, font: "11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace" }}>{preview || "Select a saved version to view it."}</pre>
          </div>
          {status && <div style={{ justifySelf: "start", border: `1px solid ${strokeColor}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: surfaceText, padding: "6px 8px", fontSize: 11, fontWeight: 800 }}>{status}</div>}
        </section>
      </div>
    </div>
  );
};

// Editor module: linked document canvas for node or logic-gate context.
export const EditorContent: React.FC<EditorContentProps> = ({ accent, widgetId, theme = "mango", forcedEntityKind, forcedEntityID = "", forcedLabel = "", forcedEmptyMessage = "", focusInformationID, focusEmailMessageID, focusRequestID, focusInformationMode = "focus", compactLinkedDocumentHeader = false, onLogicGateTitleChange }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const scope = widgetId?.trim() ? widgetId : "global";
  const outlineStyleStorageKey = `editor-outline-style-v1:${companyID}:${scope}`;
  const [linkedMapWidgetID, setLinkedMapWidgetID] = useState("");
  const [linkedLogicMapWidgetID, setLinkedLogicMapWidgetID] = useState("");
  const [linkedEntityKind, setLinkedEntityKind] = useState<"" | "node" | "logic_gate">("");
  const [linkedNodeID, setLinkedNodeID] = useState("");
  const [linkedEntityCanEdit, setLinkedEntityCanEdit] = useState(false);
  const [linkedNodeTitle, setLinkedNodeTitle] = useState("");
  const [linkedNodeInfoPreview, setLinkedNodeInfoPreview] = useState<string[]>([]);
  const [linkedNodeMetadataRows, setLinkedNodeMetadataRows] = useState<Array<{ label: string; value: string }>>([]);
  const [linkedNodeHistoryRows, setLinkedNodeHistoryRows] = useState<string[]>([]);
  const [nodeLogicGateIDs, setNodeLogicGateIDs] = useState<string[]>([]);
  const [nodeWorkspaceProjections, setNodeWorkspaceProjections] = useState<NodeProjectionItem[]>([]);
  const [logicGateWorkspaceProjections, setLogicGateWorkspaceProjections] = useState<LogicGateProjectionItem[]>([]);
  const [nodeWorkspaceLoadedNodeID, setNodeWorkspaceLoadedNodeID] = useState("");
  const [nodeContentChanges, setNodeContentChanges] = useState<NodeContentChange[]>([]);
  const [nodeContentChangesLoadedNodeID, setNodeContentChangesLoadedNodeID] = useState("");
  const [editorSnapshotLoadedScope, setEditorSnapshotLoadedScope] = useState("");
  const [nodeStatus, setNodeStatus] = useState("");
  const [nodePriorityDraft, setNodePriorityDraft] = useState("");
  const [nodePriorityRequirementError, setNodePriorityRequirementError] = useState("");
  const [nodeDueDateDraft, setNodeDueDateDraft] = useState("");
  const [nodeAccounts, setNodeAccounts] = useState<Account[]>([]);
  const [nodeGVICAssignments, setNodeGVICAssignments] = useState<LogicGateGVICAssignment[]>([]);
  const [logicGateGVICAssignments, setLogicGateGVICAssignments] = useState<LogicGateGVICAssignment[]>([]);
  const [logicGateGVICApplyToAssignedNodesBusy, setLogicGateGVICApplyToAssignedNodesBusy] = useState(false);
  const [logicGateGVICApplyConfirmationOpen, setLogicGateGVICApplyConfirmationOpen] = useState(false);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [companyUserGroups, setCompanyUserGroups] = useState<CompanyUserGroup[]>([]);
  const [companyUserGroupMembers, setCompanyUserGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [documentInformationID, setDocumentInformationID] = useState("");
  const [error, setError] = useState("");
  const [linkedEntityAccessDeniedMessage, setLinkedEntityAccessDeniedMessage] = useState("");
  const [activeTab, setActiveTab] = useState<EditorTabID>("editor");
  const [saveVersions, setSaveVersions] = useState<EditorSaveVersion[]>([]);
  const [saveVersionsLoading, setSaveVersionsLoading] = useState(false);
  const [currentUserID, setCurrentUserID] = useState("");
  const [currentUserLoaded, setCurrentUserLoaded] = useState(false);
  const [selectedSaveVersionID, setSelectedSaveVersionID] = useState("");
  const [saveVersionIntervalMinutes, setSaveVersionIntervalMinutes] = useState(EDITOR_SAVE_VERSION_DEFAULT_INTERVAL_MINUTES);
  const [saveVersionsSortAscending, setSaveVersionsSortAscending] = useState(false);
  const [saveVersionSaving, setSaveVersionSaving] = useState(false);
  const [saveVersionRestoring, setSaveVersionRestoring] = useState(false);
  const [saveVersionStatus, setSaveVersionStatus] = useState("");
  const { outlineStyle, setOutlineStyle } = useEditorPreferences(outlineStyleStorageKey);
  const [documentFontSize, setDocumentFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [selectionFontSize, setSelectionFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [selectionInlineFormat, setSelectionInlineFormat] = useState<EditorSelectionInlineFormatState>({ bold: false, underline: false, italic: false, strikethrough: false });
  const [selectionHighlightColor, setSelectionHighlightColor] = useState<EditorHighlightColor | null>(null);
  const [selectionTextAlignment, setSelectionTextAlignment] = useState<EditorTextAlignment>("left");
  const [nodeFormattingControllerAvailable, setNodeFormattingControllerAvailable] = useState(false);
  const [documentScrollTop, setDocumentScrollTop] = useState(0);
  const [indentGuideSegments, setIndentGuideSegments] = useState<EditorIndentGuideSegment[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editorHeaderHeightPx, setEditorHeaderHeightPx] = useState(0);
  const [relationshipTabAnchorCenterPx, setRelationshipTabAnchorCenterPx] = useState<number | null>(null);
  const editingTitleRef = useRef<HTMLSpanElement | null>(null);
  const editingTitleDraftRef = useRef("");
  const editingTitleActiveRef = useRef(false);
  const committedTitleEditBufferRef = useRef(createCommittedTitleEditBuffer());
  const editorDocumentRef = useRef<HTMLDivElement | null>(null);
  const attachmentHydrationCleanupRef = useRef<(() => void) | null>(null);
  const editorHeaderRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<EditorTabID>("editor");
  const restoringScrollRef = useRef(false);
  const scrollMemoryRef = useRef(createEditorScrollMemory());
  const documentUndoHistoryRef = useRef(createEditorDocumentUndoHistory());
  const flushPendingLocalInputRef = useRef<() => void>(() => undefined);
  const indentGuideFrameRef = useRef<number | null>(null);
  const outlineStyleRef = useRef(outlineStyle);
  const documentDraftRef = useRef("");
  const persistedDocumentRef = useRef("");
  const documentInformationIDRef = useRef("");
  const documentRevisionRef = useRef(0);
  const currentDocumentTargetKeyRef = useRef("");
  const persistedDocumentTargetKeyRef = useRef("");
  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<DocumentSaveRequest | null>(null);
  const queuedSaveRef = useRef<DocumentSaveRequest | null>(null);
  const saveInFlightRef = useRef(false);
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const lastSelectionRevisionRef = useRef(0);
  const lastLogicGateSelectionRevisionRef = useRef(0);
  const lastAppliedSelectionChangedAtRef = useRef(0);
  const shouldFocusEditorForSelectionRef = useRef(true);
  const pendingEditorFontSizeRef = useRef<number | null>(null);
  const restoreDocumentSelectionForHydrationRef = useRef<((root: HTMLElement) => boolean) | null>(null);
  const pendingEditorHighlightColorRef = useRef<EditorHighlightColor | null | undefined>(undefined);
  const pendingEditorInlineFormatRef = useRef<EditorSelectionInlineFormatState | null>(null);
  const pendingEditorTypingCaretRef = useRef<EditorTypingCaretBookmark | null>(null);
  const nodeFormattingControllerRef = useRef<EditorDocumentFormattingController | null>(null);
  const logicFormattingControllerRef = useRef<EditorDocumentFormattingController | null>(null);
  const nodeWorkspaceSaveControllerRef = useRef<NodeWorkspaceSaveController | null>(null);
  const autoSaveVersionTimerRef = useRef<number | null>(null);
  const saveVersionStatusTimerRef = useRef<number | null>(null);
  const saveVersionsRequestRef = useRef(0);
  const autoSaveVersionBusyRef = useRef(false);
  const lastAutoSaveVersionSignatureRef = useRef("");
  const nodePriorityRequirementTimerRef = useRef<number | null>(null);
  const nodeWorkspaceProjectionsRef = useRef<NodeProjectionItem[]>([]);
  const logicGateWorkspaceProjectionsRef = useRef<LogicGateProjectionItem[]>([]);
  const logicGateGVICAssignmentsRef = useRef<LogicGateGVICAssignment[]>([]);
  const logicGateGVICMutationSequenceRef = useRef(0);
  const logicGateGVICApplyToAssignedNodesRequestRef = useRef(0);
  const editorSnapshotRefreshTokenRef = useRef(0);
  const nodeContentChangesRefreshTokenRef = useRef(0);
  const linkedEditorTargetRef = useRef<{ kind: "" | "node" | "logic_gate"; id: string }>({ kind: "", id: "" });
  const linkedEntityAccessDenied = linkedEntityAccessDeniedMessage.trim().length > 0;
  const hasLinkedDocument = linkedNodeID.trim().length > 0 && !linkedEntityAccessDenied;
  const linkedEditorLoaded = linkedEntityKind === "node"
    ? nodeWorkspaceLoadedNodeID === linkedNodeID : editorSnapshotLoadedScope === editorSnapshotScope("logic_gate", linkedNodeID);
  const editorWriteEnabled = linkedEntityCanEdit && linkedEditorLoaded && currentUserLoaded && Boolean(currentUserID);
  const { accounts: companyAccounts } = useCompanyAccounts(companyID, linkedEntityKind === "node" && hasLinkedDocument);
  const nodeAccountOptions = useMemo(() => mergeAccountLists(companyAccounts, nodeAccounts), [companyAccounts, nodeAccounts]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  useEffect(() => {
    let cancelled = false;
    void fetchCurrentUser()
      .then((payload) => { if (!cancelled) setCurrentUserID(payload.user.user_id); })
      .catch(() => { if (!cancelled) setCurrentUserID(""); })
      .finally(() => { if (!cancelled) setCurrentUserLoaded(true); });
    return () => { cancelled = true; };
  }, []);



  useEffect(() => {
    nodeWorkspaceProjectionsRef.current = nodeWorkspaceProjections;
  }, [nodeWorkspaceProjections]);

  useEffect(() => {
    logicGateWorkspaceProjectionsRef.current = logicGateWorkspaceProjections;
  }, [logicGateWorkspaceProjections]);

  useEffect(() => {
    linkedEditorTargetRef.current = { kind: linkedEntityKind, id: linkedNodeID };
  }, [linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    const element = editorRootRef.current;
    if (!element) return;
    const updateFontSize = () => {
      const next = responsiveEditorDocumentFontSize(element.getBoundingClientRect().width);
      setDocumentFontSize((current) => (current === next ? current : next));
    };
    updateFontSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFontSize);
      return () => window.removeEventListener("resize", updateFontSize);
    }
    const observer = new ResizeObserver(updateFontSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  outlineStyleRef.current = outlineStyle;

  const scheduleIndentGuideUpdate = useCallback((text: string) => {
    if (indentGuideFrameRef.current !== null) {
      window.cancelAnimationFrame(indentGuideFrameRef.current);
      indentGuideFrameRef.current = null;
    }
    if (outlineStyleRef.current !== "indent-guides") {
      setIndentGuideSegments((current) => current.length > 0 ? [] : current);
      return;
    }

    // Guide calculation waits for the next frame so normal typing stays on the
    // browser's native editable path. The helper is pure, so API/headless edit
    // commands can share the same indentation contract later.
    indentGuideFrameRef.current = window.requestAnimationFrame(() => {
      indentGuideFrameRef.current = null;
      setIndentGuideSegments(buildEditorIndentGuideSegments(text, EDITOR_TAB_TEXT.length));
    });
  }, []);

  useEffect(() => {
    scheduleIndentGuideUpdate(editorDocumentRef.current ? readEditorDocumentText(editorDocumentRef.current) : documentDraftRef.current);
    return () => {
      if (indentGuideFrameRef.current !== null) {
        window.cancelAnimationFrame(indentGuideFrameRef.current);
        indentGuideFrameRef.current = null;
      }
    };
  }, [outlineStyle, scheduleIndentGuideUpdate]);

  const rememberCurrentDocumentScroll = useCallback(() => {
    const targetKey = currentDocumentTargetKeyRef.current;
    const element = editorDocumentRef.current;
    if (!targetKey || !element) return;
    scrollMemoryRef.current.remember(targetKey, element.scrollTop);
  }, []);

  const restoreEditorDocumentScroll = useCallback((targetKey: string) => {
    window.requestAnimationFrame(() => {
      const element = editorDocumentRef.current;
      if (!element || currentDocumentTargetKeyRef.current !== targetKey) return;
      const nextScrollTop = scrollMemoryRef.current.read(targetKey) ?? 0;
      element.scrollTop = nextScrollTop;
      setDocumentScrollTop(nextScrollTop);
    });
  }, []);

  const focusEditorDocumentWithoutScrollJump = useCallback((targetKey = currentDocumentTargetKeyRef.current) => {
    window.requestAnimationFrame(() => {
      const element = editorDocumentRef.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      if (targetKey && currentDocumentTargetKeyRef.current === targetKey) {
        const nextScrollTop = scrollMemoryRef.current.read(targetKey) ?? element.scrollTop;
        element.scrollTop = nextScrollTop;
        setDocumentScrollTop(nextScrollTop);
      }
    });
  }, []);

  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const editorDataFormat = useMangoEditorDataFormat(apiBase, companyID, requestJSON);
  useEffect(() => {
    let cancelled = false;
    if (!companyID) {
      setCompanyUsers([]);
      setCompanyUserGroups([]);
      setCompanyUserGroupMembers([]);
      return;
    }
    (async () => {
      try {
        const [users, groupsPayload] = await Promise.all([
          listCompanyUsers(companyID),
          listCompanyUserGroups(companyID),
        ]);
        if (!cancelled) {
          setCompanyUsers(users);
          setCompanyUserGroups(groupsPayload.groups);
          setCompanyUserGroupMembers(groupsPayload.members);
        }
      } catch {
        if (!cancelled) {
          setCompanyUsers([]);
          setCompanyUserGroups([]);
          setCompanyUserGroupMembers([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [companyID]);

  const invalidateDocumentTargetCaches = useCallback((target: DocumentSaveTarget) => {
    if (target.entityKind === "logic_gate") invalidateLogicGateRecordStoreCaches(apiBase, companyID, target.entityID);
    else invalidateNodeRecordStoreCaches(apiBase, companyID, target.entityID);
  }, [apiBase, companyID]);

  const { scheduleDocumentSave, flushPendingDocumentSave, saveDocumentNow } = useEditorDocumentPersistence({
    editorFormat: editorDataFormat.gate?.editor_format ?? "",
    apiBase,
    currentUserID,
    companyID,
    linkedEntityKind,
    linkedEntityID: linkedNodeID,
    documentInformationID,
    editorDocumentRef,
    attachmentHydrationCleanupRef,
    documentDraftRef,
    persistedDocumentRef,
    documentRevisionRef,
    documentInformationIDRef,
    currentDocumentTargetKeyRef,
    persistedDocumentTargetKeyRef,
    saveTimerRef,
    pendingSaveRef,
    queuedSaveRef,
    saveInFlightRef,
    setDocumentInformationID,
    setError,
    flushPendingLocalInput: () => flushPendingLocalInputRef.current(),
    requestJSON,
    invalidateDocumentTargetCaches,
  });

  const showSaveVersionStatus = useCallback((message: string) => {
    setSaveVersionStatus(message);
    if (saveVersionStatusTimerRef.current !== null) window.clearTimeout(saveVersionStatusTimerRef.current);
    saveVersionStatusTimerRef.current = window.setTimeout(() => {
      saveVersionStatusTimerRef.current = null;
      setSaveVersionStatus("");
    }, 3_000);
  }, []);

  const loadEditorSaveVersions = useCallback(async () => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    if (!companyID || !resourceType || !resourceID) {
      setSaveVersions([]);
      setSelectedSaveVersionID("");
      return;
    }
    const requestID = saveVersionsRequestRef.current + 1;
    saveVersionsRequestRef.current = requestID;
    setSaveVersionsLoading(true);
    try {
      const payload = await requestJSON<EditorSaveVersionsPayload>(`${editorSaveVersionsPath(resourceType, resourceID)}?company_id=${encodeURIComponent(companyID)}`);
      if (saveVersionsRequestRef.current !== requestID) return;
      const versions = payload.versions ?? [];
      setSaveVersions(versions);
      setSelectedSaveVersionID((current) => {
        if (current && versions.some((version) => version.save_id === current)) return current;
        return versions[0]?.save_id ?? "";
      });
    } catch (cause) {
      if (saveVersionsRequestRef.current !== requestID) return;
      setSaveVersions([]);
      setSelectedSaveVersionID("");
      setError(cause instanceof Error ? cause.message : "failed_to_load_save_versions");
    } finally {
      if (saveVersionsRequestRef.current === requestID) setSaveVersionsLoading(false);
    }
  }, [companyID, linkedEntityKind, linkedNodeID, requestJSON]);

  useEffect(() => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    saveVersionsRequestRef.current += 1;
    setSaveVersions([]);
    setSelectedSaveVersionID("");
    setSaveVersionsLoading(false);
    setSaveVersionStatus("");
    if (!companyID || !resourceType || !resourceID || linkedEntityAccessDenied) {
      setSaveVersionIntervalMinutes(EDITOR_SAVE_VERSION_DEFAULT_INTERVAL_MINUTES);
      return;
    }
    setSaveVersionIntervalMinutes(readEditorSaveIntervalMinutes(companyID, resourceType, resourceID));
    lastAutoSaveVersionSignatureRef.current = "";
  }, [companyID, linkedEntityAccessDenied, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    if (activeTab !== "save-settings" || linkedEntityAccessDenied) return;
    void loadEditorSaveVersions();
  }, [activeTab, linkedEntityAccessDenied, loadEditorSaveVersions]);

  const updateSaveVersionInterval = useCallback((minutes: number) => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    const nextMinutes = EDITOR_SAVE_VERSION_INTERVAL_OPTIONS.includes(minutes as typeof EDITOR_SAVE_VERSION_INTERVAL_OPTIONS[number])
      ? minutes
      : EDITOR_SAVE_VERSION_DEFAULT_INTERVAL_MINUTES;
    setSaveVersionIntervalMinutes(nextMinutes);
    if (companyID && resourceType && resourceID) {
      writeEditorSaveIntervalMinutes(companyID, resourceType, resourceID, nextMinutes);
    }
  }, [companyID, linkedEntityKind, linkedNodeID]);

  const showNodePriorityRequirementError = useCallback(() => {
    const message = "Must give node a priority";
    setNodePriorityRequirementError(message);
    if (nodePriorityRequirementTimerRef.current !== null) window.clearTimeout(nodePriorityRequirementTimerRef.current);
    nodePriorityRequirementTimerRef.current = window.setTimeout(() => {
      nodePriorityRequirementTimerRef.current = null;
      setNodePriorityRequirementError("");
    }, 2_400);
  }, []);
  const updateSelectionFontSize = useCallback((nextFontSize: number) => {
    setSelectionFontSize(clampEditorSelectionFontSize(nextFontSize));
  }, []);

  const currentFormattingController = useCallback(() => (
    linkedEntityKind === "node" ? nodeFormattingControllerRef.current : logicFormattingControllerRef.current
  ), [linkedEntityKind]);

  const applyEditorSelectionFontSizeValue = useCallback((nextFontSizeInput: number) => {
    if (!linkedEntityCanEdit) return;
    currentFormattingController()?.applyFontSizeValue(nextFontSizeInput);
  }, [currentFormattingController, linkedEntityCanEdit]);

  const updateSelectionInlineFormat = useCallback((nextFormat: EditorSelectionInlineFormatState) => {
    setSelectionInlineFormat(nextFormat);
  }, []);

  const toggleEditorInlineFormat = useCallback((command: EditorInlineStyleCommand) => {
    if (!linkedEntityCanEdit) return;
    currentFormattingController()?.toggleInlineFormat(command);
  }, [currentFormattingController, linkedEntityCanEdit]);

  const applyEditorSelectionHighlightColor = useCallback((color: EditorHighlightColor | null) => {
    if (!linkedEntityCanEdit) return;
    currentFormattingController()?.applyHighlightColor(color);
  }, [currentFormattingController, linkedEntityCanEdit]);

  const applyEditorSelectionFontSize = useCallback((delta: number) => {
    if (!linkedEntityCanEdit) return;
    currentFormattingController()?.adjustFontSize(delta);
  }, [currentFormattingController, linkedEntityCanEdit]);

  const selectTab = useCallback((tab: EditorTabID) => {
    rememberCurrentDocumentScroll();
    if (tab === activeTab) return;
    const nextDocumentIsVisible = getEditorDocumentIsolationState(tab).pointerEvents === "auto";
    if (!nextDocumentIsVisible && editorDocumentRef.current) {
      flushPendingDocumentSave(serializeEditorDocumentHTML(editorDocumentRef.current));
      editorDocumentRef.current.blur();
    }
    setActiveTab(tab);
    if (nextDocumentIsVisible) focusEditorDocumentWithoutScrollJump();
  }, [activeTab, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, rememberCurrentDocumentScroll]);

  useEffect(() => {
    return () => {
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(editorDocumentRef.current ? serializeEditorDocumentHTML(editorDocumentRef.current) : documentDraftRef.current);
    };
  }, [flushPendingDocumentSave, linkedEntityKind, linkedNodeID, rememberCurrentDocumentScroll]);

  const applyLoadedDocument = useCallback((entityKind: LinkedEntityKind, entityID: string, informationID: string, text: string, revision: number) => {
    const resolvedInformationID = informationID || (entityKind === "logic_gate" ? generateStableInformationID() : "");
    const targetKey = resolvedInformationID ? documentTargetKey({ entityKind, entityID, informationID: resolvedInformationID }) : `${entityKind}:${entityID}:`;
    const loadedText = text;
    const baseRevision = Number.isInteger(revision) && revision >= 0 ? revision : 0;
    const element = editorDocumentRef.current;
    const preserveSelection = currentDocumentTargetKeyRef.current === targetKey;
    if (element && preserveSelection) restoreDocumentSelectionForHydrationRef.current?.(element);
    const selectionOffsets = element && preserveSelection ? getEditorSelectionOffsets(element) : null;
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    documentDraftRef.current = loadedText;
    persistedDocumentRef.current = text;
    documentInformationIDRef.current = resolvedInformationID;
    documentRevisionRef.current = baseRevision;
    setDocumentInformationID(resolvedInformationID);
    currentDocumentTargetKeyRef.current = targetKey;
    persistedDocumentTargetKeyRef.current = targetKey;
    setSelectionFontSize(EDITOR_DOCUMENT_FONT_SIZE_PX);
    setSelectionInlineFormat({ bold: false, underline: false, italic: false, strikethrough: false });
    setSelectionHighlightColor(null);
    pendingEditorFontSizeRef.current = null;
    pendingEditorHighlightColorRef.current = undefined;
    pendingEditorInlineFormatRef.current = null;
    pendingEditorTypingCaretRef.current = null;
    setSelectionTextAlignment("left");
    restoringScrollRef.current = true;
    const restoredScrollTop = scrollMemoryRef.current.read(targetKey) ?? 0;
    if (element) {
      const nextHTML = deserializeEditorDocumentHTML(loadedText);
      attachmentHydrationCleanupRef.current?.();
      attachmentHydrationCleanupRef.current = null;
      if (element.innerHTML !== nextHTML) element.innerHTML = nextHTML;
      if (selectionOffsets) setEditorSelectionByOffsets(element, selectionOffsets.start, selectionOffsets.end);
      attachmentHydrationCleanupRef.current = hydrateEditorAttachmentImageFrames(element, (attachmentID, variant, options) => (
        loadMangoAttachmentObjectURL(apiBase, companyID, attachmentID, variant, options)
      ));
      element.scrollTop = restoredScrollTop;
    }
    setDocumentScrollTop(restoredScrollTop);
    scheduleIndentGuideUpdate(element ? readEditorDocumentText(element) : loadedText);
    restoreEditorDocumentScroll(targetKey);
    window.requestAnimationFrame(() => { restoringScrollRef.current = false; });
    if (activeTabRef.current === "editor" && shouldFocusEditorForSelectionRef.current) focusEditorDocumentWithoutScrollJump(targetKey);
  }, [apiBase, companyID, focusEditorDocumentWithoutScrollJump, restoreEditorDocumentScroll, scheduleIndentGuideUpdate]);

  const readLinkedMapWidgetID = useCallback((): string => {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    return resolveLinkedFrameByKindFromGraph({ startFrameID: scope, targetKind: "map", edges, registry });
  }, [scope]);

  const readLinkedLogicMapWidgetID = useCallback((): string => {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    return resolveLinkedFrameByKindFromGraph({ startFrameID: scope, targetKind: "logic-map", edges, registry });
  }, [scope]);

  const readSelectedNodeFromMap = useCallback((mapWidgetID: string): string => {
    if (!mapWidgetID) return "";
    try {
      const raw = localStorage.getItem(`node-map-state-v1:${companyID}:${mapWidgetID}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { selectedNodeID?: string };
      return typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "";
    } catch {
      return "";
    }
  }, [companyID]);

  const readSelectedLogicGateFromMap = useCallback((mapWidgetID: string): string => {
    if (!mapWidgetID) return "";
    try {
      const raw = localStorage.getItem(`logic-gate-map-state-v1:${companyID}:${mapWidgetID}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { selectedNodeID?: string; selectedLogicGateID?: string };
      if (typeof parsed.selectedLogicGateID === "string") return parsed.selectedLogicGateID;
      return typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "";
    } catch {
      return "";
    }
  }, [companyID]);

  const readSelectedNodeFromExplorerContext = useCallback((): LinkedSelection => {
    try {
      const raw = localStorage.getItem(`${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
      if (!raw) return { id: "", label: "" };
      const parsed = JSON.parse(raw) as { selectedNodeID?: string; selectedLabel?: string; selectionIntent?: SelectionIntent; ts?: number };
      return {
        id: typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "",
        label: typeof parsed.selectedLabel === "string" ? parsed.selectedLabel : "",
        changedAt: typeof parsed.ts === "number" && Number.isFinite(parsed.ts) ? parsed.ts : 0,
        selectionIntent: parsed.selectionIntent,
      };
    } catch {
      return { id: "", label: "" };
    }
  }, [companyID, scope]);

  const readSelectedLogicGateFromExplorerContext = useCallback((): LinkedSelection => {
    try {
      const raw = localStorage.getItem(`${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
      if (!raw) return { id: "", label: "" };
      const parsed = JSON.parse(raw) as { selectedLogicGateID?: string; selectedNodeID?: string; selectedLabel?: string; selectionIntent?: SelectionIntent; ts?: number };
      return {
        id: typeof parsed.selectedLogicGateID === "string" ? parsed.selectedLogicGateID : (typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : ""),
        label: typeof parsed.selectedLabel === "string" ? parsed.selectedLabel : "",
        changedAt: typeof parsed.ts === "number" && Number.isFinite(parsed.ts) ? parsed.ts : 0,
        selectionIntent: parsed.selectionIntent,
      };
    } catch {
      return { id: "", label: "" };
    }
  }, [companyID, scope]);

  const readNodeLabelFromGraph = useCallback((nodeID: string): string => {
    if (!nodeID) return "";
    const node = (getNodeRelationshipGraphSnapshot(apiBase, companyID).nodes ?? []).find((item) => item.node_id === nodeID);
    return node ? getNodeTitle(node) : "";
  }, [apiBase, companyID]);

  const readLogicGateLabelFromGraph = useCallback((logicGateID: string): string => {
    if (!logicGateID) return "";
    const logicGate = (getLogicGateRelationshipGraphSnapshot(apiBase, companyID).nodes ?? []).find((item) => item.node_id === logicGateID);
    return logicGate ? getLogicGateTitle(logicGate) : "";
  }, [apiBase, companyID]);

  const preserveNodeTitle = useCallback((candidate: string, current: string, nodeID: string): string => {
    const cleanCandidate = candidate.trim();
    const cleanCurrent = current.trim();
    const cleanNodeID = nodeID.trim();
    if (!cleanCandidate || (cleanNodeID && cleanCandidate === cleanNodeID)) return cleanCurrent;
    return cleanCandidate;
  }, []);

  const applyLogicGateGVICAssignments = useCallback((assignments: LogicGateGVICAssignment[], logicGateID: string): LogicGateGVICAssignment[] => {
    const normalized = normalizeLogicGateGVICAssignments(assignments, logicGateID);
    logicGateGVICAssignmentsRef.current = normalized;
    setLogicGateGVICAssignments(normalized);
    return normalized;
  }, []);

  const clearVisibleDocumentForSelection = useCallback(() => {
    setLinkedEntityAccessDeniedMessage("");
    setLinkedEntityCanEdit(false);
    setLinkedNodeInfoPreview([]);
    setLinkedNodeMetadataRows([]);
    setLinkedNodeHistoryRows([]);
    setNodeWorkspaceProjections([]);
    setLogicGateWorkspaceProjections([]);
    setEditorSnapshotLoadedScope("");
    setNodeStatus("");
    setNodePriorityDraft("");
    setNodeDueDateDraft("");
    setNodeGVICAssignments([]);
    applyLogicGateGVICAssignments([], "");
    documentDraftRef.current = "";
    persistedDocumentRef.current = "";
    documentRevisionRef.current = 0;
    documentInformationIDRef.current = "";
    currentDocumentTargetKeyRef.current = "";
    persistedDocumentTargetKeyRef.current = "";
    pendingSaveRef.current = null;
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    setDocumentInformationID("");
    pendingEditorFontSizeRef.current = null;
    pendingEditorHighlightColorRef.current = undefined;
    pendingEditorInlineFormatRef.current = null;
    pendingEditorTypingCaretRef.current = null;
    setSelectionTextAlignment("left");
    setSelectionFontSize(EDITOR_DOCUMENT_FONT_SIZE_PX);
    setSelectionInlineFormat({ bold: false, underline: false, italic: false, strikethrough: false });
    setSelectionHighlightColor(null);
    restoringScrollRef.current = false;
    if (editorDocumentRef.current) {
      attachmentHydrationCleanupRef.current?.();
      attachmentHydrationCleanupRef.current = null;
      editorDocumentRef.current.innerHTML = "";
      editorDocumentRef.current.scrollTop = 0;
    }
    setDocumentScrollTop(0);
    scheduleIndentGuideUpdate("");
  }, [applyLogicGateGVICAssignments, scheduleIndentGuideUpdate]);

  const applyLinkedNode = useCallback((nodeID: string, label = "", options: { focusEditor?: boolean } = {}) => {
    const shouldFocusEditor = options.focusEditor !== false;
    shouldFocusEditorForSelectionRef.current = shouldFocusEditor;
    if (nodeID) clearResourceMissing({ apiBase, companyID, resourceType: "node", resourceID: nodeID });
    const isSameEntity = linkedEntityKind === "node" && linkedNodeID === nodeID;
    if (!isSameEntity) {
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(editorDocumentRef.current ? serializeEditorDocumentHTML(editorDocumentRef.current) : documentDraftRef.current);
      clearVisibleDocumentForSelection();
    }
    const previousTitle = isSameEntity ? linkedNodeTitle : "";
    const nextTitle = nodeID ? preserveNodeTitle(label || readNodeLabelFromGraph(nodeID), previousTitle, nodeID) : "";
    setLinkedEntityKind(nodeID ? "node" : "");
    setLinkedNodeID(nodeID);
    if (!isSameEntity || !editingTitleActiveRef.current) setLinkedNodeTitle(nextTitle);
    if (nodeID && !isSameEntity && shouldFocusEditor) {
      setActiveTab("editor");
      focusEditorDocumentWithoutScrollJump();
    }
  }, [apiBase, clearVisibleDocumentForSelection, companyID, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, linkedEntityKind, linkedNodeID, linkedNodeTitle, preserveNodeTitle, readNodeLabelFromGraph, rememberCurrentDocumentScroll]);

  const applyLinkedLogicGate = useCallback((logicGateID: string, label = "", options: { focusEditor?: boolean } = {}) => {
    const shouldFocusEditor = options.focusEditor !== false;
    shouldFocusEditorForSelectionRef.current = shouldFocusEditor;
    if (logicGateID) clearResourceMissing({ apiBase, companyID, resourceType: "logic_gate", resourceID: logicGateID });
    const isSameEntity = linkedEntityKind === "logic_gate" && linkedNodeID === logicGateID;
    if (!isSameEntity) {
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(editorDocumentRef.current ? serializeEditorDocumentHTML(editorDocumentRef.current) : documentDraftRef.current);
      clearVisibleDocumentForSelection();
    }
    setLinkedEntityKind(logicGateID ? "logic_gate" : "");
    setLinkedNodeID(logicGateID);
    if (!isSameEntity) {
      setLinkedNodeTitle(logicGateID ? (label || readLogicGateLabelFromGraph(logicGateID)) : "");
    } else if (!editingTitleActiveRef.current) {
      setLinkedNodeTitle((current) => preferResolvedEntityLabel(current, label, "Logic Gate"));
    }
    if (logicGateID && !isSameEntity && shouldFocusEditor) {
      setActiveTab("editor");
      focusEditorDocumentWithoutScrollJump();
    }
  }, [apiBase, clearVisibleDocumentForSelection, companyID, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, linkedEntityKind, linkedNodeID, readLogicGateLabelFromGraph, rememberCurrentDocumentScroll]);

  useEffect(() => {
    if (!forcedEntityKind) return;
    const forcedID = forcedEntityID.trim();
    if (forcedEntityKind === "node") {
      applyLinkedNode(forcedID, forcedLabel, { focusEditor: false });
      return;
    }
    applyLinkedLogicGate(forcedID, forcedLabel, { focusEditor: false });
  }, [applyLinkedLogicGate, applyLinkedNode, forcedEntityID, forcedEntityKind, forcedLabel]);

  const shouldApplySelectionChangedAt = useCallback((changedAt?: number): boolean => {
    if (typeof changedAt !== "number" || !Number.isFinite(changedAt) || changedAt <= 0) return true;
    if (changedAt < lastAppliedSelectionChangedAtRef.current) return false;
    lastAppliedSelectionChangedAtRef.current = changedAt;
    return true;
  }, []);

  const updateNodeTitle = useCallback(async (nextTitle: string) => {
    const value = nextTitle.trim();
    if (!linkedEntityCanEdit) return;
    if (!linkedNodeID || !value) return;
    setError("");
    try {
      if (linkedEntityKind === "logic_gate") {
        const updated = await commitEntityTitleMutation(
          () => requestJSON<LogicGateRecord>(`/v1/logic-gates/${linkedNodeID}`, {
            method: "PUT",
            body: JSON.stringify({ company_id: companyID, header: value }),
          }),
          (result) => ({ companyID, entityType: "logic_gate", resourceID: result.logic_gate_id, title: result.header }),
        );
        setLinkedNodeTitle(updated.header);
        onLogicGateTitleChange?.({ logicGateID: updated.logic_gate_id, label: updated.header });
        upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateCanvasRecord(updated));
      } else {
        const updated = await commitEntityTitleMutation(
          () => requestJSON<NodeRecord>(`/v1/nodes/${linkedNodeID}`, {
            method: "PUT",
            body: JSON.stringify({ company_id: companyID, name: value }),
          }),
          (result) => ({ companyID, entityType: "node", resourceID: result.node_id, title: getNodeTitle(result) }),
        );
        setLinkedNodeTitle(getNodeTitle(updated));
        upsertNodeRelationshipGraphNode(apiBase, companyID, updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_entity");
    }
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, onLogicGateTitleChange, requestJSON]);

  const applyCommittedEditorTitle = useCallback((update: { entityType: "node" | "logic_gate"; resourceID: string; title: string }) => {
    const title = update.title.trim();
    if (!title) return;
    setLinkedNodeTitle(title);
    if (update.entityType === "logic_gate") onLogicGateTitleChange?.({ logicGateID: update.resourceID, label: title });
  }, [onLogicGateTitleChange]);

  const updateIsEditingTitle = useCallback((nextEditing: boolean) => {
    const wasEditing = editingTitleActiveRef.current;
    editingTitleActiveRef.current = nextEditing;
    setIsEditingTitle(nextEditing);
    if (nextEditing) {
      if ((linkedEntityKind === "node" || linkedEntityKind === "logic_gate") && linkedNodeID) {
        committedTitleEditBufferRef.current.begin(linkedEntityKind, linkedNodeID);
      }
      return;
    }
    if (!wasEditing || (linkedEntityKind !== "node" && linkedEntityKind !== "logic_gate") || !linkedNodeID) return;
    const deferred = committedTitleEditBufferRef.current.finish(linkedEntityKind, linkedNodeID);
    if (deferred) applyCommittedEditorTitle(deferred);
  }, [applyCommittedEditorTitle, linkedEntityKind, linkedNodeID]);

  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    if (update.companyID !== companyID || update.entityType !== linkedEntityKind || update.resourceID !== linkedNodeID || !update.title.trim()) return;
    const immediate = committedTitleEditBufferRef.current.receive(update);
    if (immediate) applyCommittedEditorTitle(immediate);
  }), [applyCommittedEditorTitle, companyID, linkedEntityKind, linkedNodeID]);

  const createRelatedNode = useCallback(async (kind: EditorRelatedNodeCreationKind) => {
    if (!linkedEntityCanEdit) return;
    if (!companyID || !linkedNodeID || linkedEntityKind !== "node") return;
    const directionByKind: Record<EditorRelatedNodeCreationKind, NodeDirection> = {
      parent: "top",
      peer: "right",
      child: "bottom",
    };
    const titleByKind: Record<EditorRelatedNodeCreationKind, string> = {
      parent: "new parent node",
      peer: "new peer node",
      child: "new child node",
    };
    const direction = directionByKind[kind];
    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    const occupiedPositions = persistedMapPositionsToNodePositions({
      positions: snapshot.node_map_positions ?? [],
      worldWidth: EDITOR_RELATIONSHIP_WORLD_W,
      worldHeight: EDITOR_RELATIONSHIP_WORLD_H,
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
    });
    const origin = occupiedPositions[linkedNodeID] ?? { x: 240, y: 240 };
    const clearance = MINI_GRID * 4;
    const horizontalGap = NODE_W + clearance;
    const verticalGap = NODE_H + clearance;
    const desired = {
      x: origin.x + (direction === "left" ? -horizontalGap : direction === "right" ? horizontalGap : 0),
      y: origin.y + (direction === "top" ? -verticalGap : direction === "bottom" ? verticalGap : 0),
    };
    const position = resolveOpenNodeMapPosition({
      desired,
      occupied: occupiedPositions,
      worldWidth: EDITOR_RELATIONSHIP_WORLD_W,
      worldHeight: EDITOR_RELATIONSHIP_WORLD_H,
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
    });
    const payload = buildLinkedNodePayloadFromSourceSide(direction);
    const clientID = createWorkspaceEntityBatchClientID(`editor-${kind}-node`);
    setError("");
    try {
      const response = await createWorkspaceEntityBatchCommand<EditorNodeBatchResponse>({
        companyID,
        entityKind: "node",
        mutationOrigin: "editor",
        items: [{
          client_id: clientID,
          name: titleByKind[kind],
          x: position.x,
          y: position.y,
        }],
        relationships: [{
          entity_id_a: linkedNodeID,
          client_id_b: clientID,
          a_position: payload.a_position,
          b_position: payload.b_position,
        }],
        requestJSON,
      });
      const node = response.nodes?.[0];
      if (!node) throw new Error("node_batch_create_missing_node");
      const relationship = response.relationships?.[0];
      upsertNodeRelationshipGraphNode(apiBase, companyID, node);
      if (relationship) upsertNodeRelationshipGraphRelationship(apiBase, companyID, relationship);
      upsertNodeMapPositionsInNodeRelationshipGraph(apiBase, companyID, response.node_map_positions ?? [{ entity_id: node.node_id, node_id: node.node_id, x: position.x, y: position.y }]);
      primeNodeRecordStoreCaches(apiBase, companyID, [{ node, relationships: relationship ? [relationship] : [] }]);
      invalidateWorkspaceSnapshot(apiBase, companyID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_related_node");
    }
  }, [apiBase, companyID, currentUserID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON]);

  const createNodeFromImageDocument = useCallback(async (input: NodeImageNodeRequest) => {
    if (!linkedEntityCanEdit) return;
    if (!companyID || linkedEntityKind !== "node") return;
    const title = input.title.trim() || "Image";
    const blockTitle = input.blockTitle?.trim() || "Image";
    const document = input.document.trim();
    if (!document) return;

    const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
    const occupiedPositions = persistedMapPositionsToNodePositions({
      positions: snapshot.node_map_positions ?? [],
      worldWidth: EDITOR_RELATIONSHIP_WORLD_W,
      worldHeight: EDITOR_RELATIONSHIP_WORLD_H,
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
    });
    const origin = linkedNodeID ? occupiedPositions[linkedNodeID] ?? { x: 240, y: 240 } : { x: 240, y: 240 };
    const position = resolveOpenNodeMapPosition({
      desired: { x: origin.x + NODE_W + MINI_GRID * 4, y: origin.y },
      occupied: occupiedPositions,
      worldWidth: EDITOR_RELATIONSHIP_WORLD_W,
      worldHeight: EDITOR_RELATIONSHIP_WORLD_H,
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
    });
    const clientID = createWorkspaceEntityBatchClientID("editor-image-node");
    const response = await createWorkspaceEntityBatchCommand<EditorNodeBatchResponse>({
      companyID,
      entityKind: "node",
      mutationOrigin: "editor",
      items: [{
        client_id: clientID,
        name: title,
        x: position.x,
        y: position.y,
      }],
      requestJSON,
    });
    const node = response.nodes?.[0];
    if (!node) throw new Error("image_node_batch_create_missing_node");
    const informationID = generateStableInformationID();
    const operationID = generateStableInformationID();
    const attachmentID = input.attachmentID?.trim();
    if (attachmentID) {
      await linkMangoResourceAttachment(requestJSON, {
        companyID,
        resourceType: "node",
        resourceID: node.node_id,
        attachmentID,
        relationshipKind: "inline_image",
        informationID,
        editorSurface: "node_text_block",
      });
    }
    if (editorDataFormat.gate?.editor_format === "tiptap_json") {
      const parsed = parseMangoTiptapDocument(input.tiptapDocument ?? document);
      if (!parsed.valid) throw new Error(`invalid_image_node_tiptap_document: ${parsed.error}`);
      const path = `/v1/editor-json/node/${node.node_id}/documents/${informationID}?company_id=${encodeURIComponent(companyID)}`;
      await requestJSON<unknown>(path, {
        method: "POST",
        body: JSON.stringify({
          operation_id: operationID,
          client_id: `editor-image-node:${currentUserID}`,
          base_revision: 0,
          schema_version: parsed.value.schema_version,
          document: parsed.value,
        }),
      });
      await requestJSON<unknown>(path, {
        method: "PATCH",
        body: JSON.stringify({ title: blockTitle, attachments: [] }),
      });
    } else {
      await requestJSON<unknown>(`/v1/editor-collaboration/node/${node.node_id}/documents/${informationID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "POST",
        body: JSON.stringify({
          operation_id: operationID,
          client_id: `editor-image-node:${currentUserID}`,
          base_revision: 0,
          patch: editorHTMLPatchForChange("", document),
        }),
      });
      await requestJSON<unknown>(`/v1/editor-collaboration/node/${node.node_id}/documents/${informationID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "PATCH",
        body: JSON.stringify(buildEditorTextBlockMetadataPayload({ title: blockTitle, document })),
      });
    }
    upsertNodeRelationshipGraphNode(apiBase, companyID, node);
    upsertNodeMapPositionsInNodeRelationshipGraph(apiBase, companyID, response.node_map_positions ?? [{ entity_id: node.node_id, node_id: node.node_id, x: position.x, y: position.y }]);
    primeNodeRecordStoreCaches(apiBase, companyID, [{ node, relationships: [] }]);
    invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
    invalidateWorkspaceSnapshot(apiBase, companyID);
  }, [apiBase, companyID, currentUserID, editorDataFormat.gate?.editor_format, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON]);

  const assignLinkedNodeToLogicGate = useCallback(async (logicGateID: string) => {
    if (!linkedEntityCanEdit) return;
    const cleanLogicGateID = logicGateID.trim();
    if (!companyID || !linkedNodeID || linkedEntityKind !== "node" || !cleanLogicGateID) return;
    const rawPriority = nodePriorityDraft.trim();
    const parsedPriority = Number(rawPriority);
    const priority = Number.isInteger(parsedPriority) && parsedPriority >= 1 && parsedPriority <= 5 ? parsedPriority : null;
    const currentLogicGateID = nodeLogicGateIDs.map((id) => id.trim()).find(Boolean) ?? "";
    const result = currentLogicGateID && currentLogicGateID !== cleanLogicGateID
      ? await moveLogicGateAssignment({
        apiBase,
        companyID,
        logicGateID: cleanLogicGateID,
        fromLogicGateID: currentLogicGateID,
        nodeID: linkedNodeID,
        status: "requested",
        priority: priority ?? undefined,
      })
      : await assignNodeToLogicGateStatus({
        apiBase,
        companyID,
        logicGateID: cleanLogicGateID,
        nodeID: linkedNodeID,
        status: "requested",
        priority: priority ?? undefined,
        nodeTitle: linkedNodeTitle || undefined,
      });
    const stableTitle = preserveNodeTitle(getNodeTitle(result.node), linkedNodeTitle, linkedNodeID);
    const resultNode = stableTitle && stableTitle !== getNodeTitle(result.node) ? { ...result.node, name: stableTitle } : result.node;
    invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    setNodeStatus(resultNode.status ?? "");
    setNodePriorityDraft(resultNode.priority == null ? "" : String(resultNode.priority));
    setNodeDueDateDraft(formatNodeDueDateForEditor(resultNode.due_date));
    setNodeLogicGateIDs(resultNode.logic_gate_ids ?? [cleanLogicGateID]);
    setNodeAccounts(resultNode.accounts ?? nodeAccounts);
    setLinkedNodeTitle((current) => preserveNodeTitle(getNodeTitle(resultNode), current || linkedNodeTitle, linkedNodeID));
    upsertNodeRelationshipGraphNode(apiBase, companyID, resultNode);
    invalidateWorkspaceSnapshot(apiBase, companyID);
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, linkedNodeTitle, nodeAccounts, nodeLogicGateIDs, nodePriorityDraft, preserveNodeTitle]);

  const updateNodePresetPatch = useCallback(async (patch: Record<string, unknown>) => {
    if (!linkedEntityCanEdit) return;
    if (!linkedNodeID || linkedEntityKind !== "node") return;
    setError("");
    try {
      const updated = await requestJSON<NodeRecord>(`/v1/nodes/${linkedNodeID}`, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, ...patch }),
      });
      setNodeStatus(updated.status ?? "");
      setNodePriorityDraft(updated.priority == null ? "" : String(updated.priority));
      setNodeDueDateDraft(formatNodeDueDateForEditor(updated.due_date));
      setNodeAccounts(updated.accounts ?? nodeAccounts);
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
      upsertNodeRelationshipGraphNode(apiBase, companyID, updated);
      invalidateWorkspaceSnapshot(apiBase, companyID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_node_fields");
    }
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, nodeAccounts, requestJSON]);

  const commitNodePriorityDraft = useCallback((draft: string) => {
    const raw = draft.trim();
    if (!raw || raw === "0") {
      void updateNodePresetPatch({ priority: null });
      return;
    }
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      setError("Priority must be 1 through 5");
      return;
    }
    setNodePriorityRequirementError("");
    void updateNodePresetPatch({ priority: parsed });
  }, [updateNodePresetPatch]);

  const commitNodeDueDateDraft = useCallback((draft: string) => {
    const normalized = normalizeNodeDueDateDraft(draft);
    if (normalized === null) {
      setError("Due date must use m/d/yy, m/d/yyyy, or yyyy-mm-dd");
      return;
    }
    void updateNodePresetPatch({ due_date: normalized });
  }, [updateNodePresetPatch]);

  const commitNodeAccountIDs = useCallback((accountIDs: string[]) => {
    if (!linkedEntityCanEdit) return;
    if (!companyID || !linkedNodeID || linkedEntityKind !== "node") return;
    const cleanAccountIDs = Array.from(new Set(accountIDs.map((id) => id.trim()).filter(Boolean)));
    const accountByID = new Map(nodeAccountOptions.map((account) => [account.account_id, account]));
    const previousAccounts = nodeAccounts;
    const optimisticAccounts = cleanAccountIDs.map((accountID) => accountByID.get(accountID) ?? {
      company_id: companyID,
      account_id: accountID,
      name: accountID,
      created_timestamp: "",
    });
    setNodeAccounts(optimisticAccounts);
    setError("");
    void setNodeAccountAssignments({
      companyID,
      nodeID: linkedNodeID,
      accountIDs: cleanAccountIDs,
    }).then((result) => {
      const savedAccounts = (result.node?.accounts ?? optimisticAccounts).map((account) => ({ ...account }));
      setNodeAccounts(savedAccounts);
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
      const currentNode = getNodeRelationshipGraphSnapshot(apiBase, companyID).nodes.find((node) => node.node_id === linkedNodeID);
      if (currentNode) {
        upsertNodeRelationshipGraphNode(apiBase, companyID, { ...currentNode, accounts: savedAccounts });
      }
      invalidateWorkspaceSnapshot(apiBase, companyID);
    }).catch((err) => {
      setNodeAccounts(previousAccounts);
      setError(err instanceof Error ? err.message : "failed_to_update_node_accounts");
    });
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, nodeAccountOptions, nodeAccounts]);

  const commitNodeStatus = useCallback((statusKey: string, statusLabel: string, _statusColor: string) => {
    if (!linkedEntityCanEdit) return;
    if (!companyID || !linkedNodeID || linkedEntityKind !== "node") return;
    const cleanStatusKey = statusKey.trim();
    const cleanStatusLabel = statusLabel.trim() || cleanStatusKey;
    if (!cleanStatusKey) return;
    const logicGateID = nodeLogicGateIDs.map((id) => id.trim()).find(Boolean) ?? "";
    if (!logicGateID) {
      void updateNodePresetPatch({ status: cleanStatusLabel });
      return;
    }
    const rawPriority = nodePriorityDraft.trim();
    const parsedPriority = Number(rawPriority);
    const priority = Number.isInteger(parsedPriority) && parsedPriority >= 1 && parsedPriority <= 5 ? parsedPriority : null;
    setError("");
    void moveLogicGateAssignment({
      apiBase,
      companyID,
      logicGateID,
      nodeID: linkedNodeID,
      status: cleanStatusKey,
      priority,
    }).then((result) => {
      setNodeStatus(result.node.status ?? cleanStatusLabel);
      setNodePriorityDraft(result.node.priority == null ? "" : String(result.node.priority));
      setNodeDueDateDraft(formatNodeDueDateForEditor(result.node.due_date));
      setNodeLogicGateIDs(result.node.logic_gate_ids ?? nodeLogicGateIDs);
      setNodeAccounts(result.node.accounts ?? nodeAccounts);
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
      upsertNodeRelationshipGraphNode(apiBase, companyID, result.node);
      invalidateWorkspaceSnapshot(apiBase, companyID);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "failed_to_update_node_status");
    });
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, nodeAccounts, nodeLogicGateIDs, nodePriorityDraft, updateNodePresetPatch]);

  const nodeGVICIsInherited = false;
  const nodeGVICReadOnlyReason = "";

  const saveResourceGVICAssignments = useCallback(async (resourceType: "node" | "logic_gate", resourceID: string, nextAssignments: LogicGateGVICAssignment[], applyToDescendants = false) => {
    const cleanResourceID = resourceID.trim();
    if (!cleanResourceID) return [];
    const payload = await requestJSON<ResourceGVICPayload>(`/v1/resources/${resourceType}/${cleanResourceID}/gvic`, {
      method: "PUT",
      body: JSON.stringify({
        company_id: companyID,
        gvic_assignments: nextAssignments.map(toResourceGVICAssignmentInput),
        ...(resourceType === "logic_gate" && applyToDescendants ? { apply_to_descendants: true } : {}),
      }),
    });
    return payload.gvic_assignments ?? [];
  }, [companyID, requestJSON]);

  const commandResourceGVICAssignments = useCallback(async (
    resourceType: "node" | "logic_gate",
    resourceID: string,
    operation: "add" | "remove",
    assignments: EditorGVICAssignmentInput[],
    applyToDescendants = false,
  ) => {
    const cleanResourceID = resourceID.trim();
    if (!cleanResourceID) return [];
    const payload = await requestJSON<ResourceGVICPayload>(`/v1/resources/${resourceType}/${cleanResourceID}/gvic/${operation}`, {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        gvic_assignments: assignments.map(toResourceGVICAssignmentInput),
        ...(resourceType === "logic_gate" && applyToDescendants ? { apply_to_descendants: true } : {}),
      }),
    });
    return payload.gvic_assignments ?? [];
  }, [companyID, requestJSON]);

  const saveNodeGVICAssignments = useCallback(async (nextAssignments: LogicGateGVICAssignment[]) => {
    if (!linkedNodeID || linkedEntityKind !== "node" || nodeGVICIsInherited) return;
    setError("");
    try {
      const assignments = await saveResourceGVICAssignments("node", linkedNodeID, nextAssignments);
      setNodeGVICAssignments(assignments);
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
      invalidateWorkspaceSnapshot(apiBase, companyID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_node_gvic");
    }
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, nodeGVICIsInherited, saveResourceGVICAssignments]);

  const commandLogicGateGVICAssignments = useCallback((
    operation: "add" | "remove",
    assignment: EditorGVICAssignmentInput,
    optimisticAssignments: LogicGateGVICAssignment[],
  ) => {
    const logicGateID = linkedNodeID.trim();
    if (!logicGateID || linkedEntityKind !== "logic_gate") return;
    const previousAssignments = logicGateGVICAssignmentsRef.current;
    const mutationSequence = ++logicGateGVICMutationSequenceRef.current;
    editorSnapshotRefreshTokenRef.current += 1;
    applyLogicGateGVICAssignments(optimisticAssignments, logicGateID);
    setError("");
    void commandResourceGVICAssignments("logic_gate", logicGateID, operation, [assignment]).then((assignments) => {
      const currentTarget = linkedEditorTargetRef.current;
      if (logicGateGVICMutationSequenceRef.current !== mutationSequence || currentTarget.kind !== "logic_gate" || currentTarget.id !== logicGateID) return;
      applyLogicGateGVICAssignments(assignments, logicGateID);
      patchLogicGateRecordStoreGVICAssignments(apiBase, companyID, logicGateID, assignments);
      patchLogicGateGVICAssignmentsInCommunicationsWorkspaceCache(companyID, logicGateID, assignments);
      invalidateWorkspaceSnapshot(apiBase, companyID);
    }).catch((err) => {
      const currentTarget = linkedEditorTargetRef.current;
      if (logicGateGVICMutationSequenceRef.current === mutationSequence && currentTarget.kind === "logic_gate" && currentTarget.id === logicGateID) {
        applyLogicGateGVICAssignments(previousAssignments, logicGateID);
      }
      setError(err instanceof Error ? err.message : "failed_to_update_logic_gate_gvic");
    });
  }, [apiBase, applyLogicGateGVICAssignments, commandResourceGVICAssignments, companyID, linkedEntityKind, linkedNodeID]);

  const applyLogicGateGVICToAssignedNodes = useCallback(() => {
    const logicGateID = linkedNodeID.trim();
    if (!logicGateID || linkedEntityKind !== "logic_gate" || !linkedEntityCanEdit || logicGateGVICApplyToAssignedNodesBusy) return;
    const mutationSequence = ++logicGateGVICMutationSequenceRef.current;
    const applyRequestID = ++logicGateGVICApplyToAssignedNodesRequestRef.current;
    editorSnapshotRefreshTokenRef.current += 1;
    setLogicGateGVICApplyToAssignedNodesBusy(true);
    setError("");
    void saveResourceGVICAssignments("logic_gate", logicGateID, logicGateGVICAssignmentsRef.current, true).then((assignments) => {
      const currentTarget = linkedEditorTargetRef.current;
      if (logicGateGVICMutationSequenceRef.current !== mutationSequence || currentTarget.kind !== "logic_gate" || currentTarget.id !== logicGateID) return;
      applyLogicGateGVICAssignments(assignments, logicGateID);
      patchLogicGateRecordStoreGVICAssignments(apiBase, companyID, logicGateID, assignments);
      patchLogicGateGVICAssignmentsInCommunicationsWorkspaceCache(companyID, logicGateID, assignments);
      invalidateWorkspaceSnapshot(apiBase, companyID);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "failed_to_apply_logic_gate_gvic_to_nodes");
    }).finally(() => {
      if (logicGateGVICApplyToAssignedNodesRequestRef.current === applyRequestID) {
        setLogicGateGVICApplyToAssignedNodesBusy(false);
      }
    });
  }, [apiBase, applyLogicGateGVICAssignments, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, logicGateGVICApplyToAssignedNodesBusy, saveResourceGVICAssignments]);

  const addNodeGVICPrincipal = useCallback((role: LogicGateGVICRole, principalType: LogicGateGVICPrincipalType, principalID: string) => {
    if (nodeGVICIsInherited) return;
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const singleUserRole = role === "generated";
    if (role === "verified" && principalType !== "user") return;
    if (singleUserRole) {
      if (principalType !== "user") return;
      const existing = nodeGVICAssignments.filter((assignment) => assignment.role === role);
      if (existing.length === 1 && logicGateGVICAssignmentPrincipalType(existing[0]) === "user" && logicGateGVICAssignmentPrincipalID(existing[0]) === cleanPrincipalID) return;
      const user = companyUsers.find((candidate) => candidate.user_id === cleanPrincipalID);
      void saveNodeGVICAssignments([
        ...nodeGVICAssignments.filter((assignment) => assignment.role !== role),
        {
          company_id: companyID,
          resource_id: linkedNodeID,
          role,
          principal_type: "user",
          principal_id: cleanPrincipalID,
          principal_name: user?.display_name ?? user?.email,
          user_id: cleanPrincipalID,
          user_display_name: user?.display_name,
          user_email: user?.email,
          created_timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }
    const existingPrincipalIDsForRole = new Set(nodeGVICAssignments
      .filter((assignment) => assignment.role === role && logicGateGVICAssignmentPrincipalType(assignment) === principalType)
      .map((assignment) => logicGateGVICAssignmentPrincipalID(assignment))
      .filter(Boolean));
    if (existingPrincipalIDsForRole.has(cleanPrincipalID)) return;
    if (principalType === "group") {
      const group = companyUserGroups.find((candidate) => candidate.group_id === cleanPrincipalID);
      void saveNodeGVICAssignments([
        ...nodeGVICAssignments,
        {
          company_id: companyID,
          resource_id: linkedNodeID,
          role,
          principal_type: "group",
          principal_id: cleanPrincipalID,
          principal_name: group?.name ?? cleanPrincipalID,
          user_id: "",
          created_timestamp: new Date().toISOString(),
        },
      ]);
      return;
    }
    const user = companyUsers.find((candidate) => candidate.user_id === cleanPrincipalID);
    void saveNodeGVICAssignments([
      ...nodeGVICAssignments,
      {
        company_id: companyID,
        resource_id: linkedNodeID,
        role,
        principal_type: "user",
        principal_id: cleanPrincipalID,
        principal_name: user?.display_name ?? user?.email,
        user_id: cleanPrincipalID,
        user_display_name: user?.display_name,
        user_email: user?.email,
        created_timestamp: new Date().toISOString(),
      },
    ]);
  }, [companyID, companyUserGroups, companyUsers, linkedNodeID, nodeGVICAssignments, nodeGVICIsInherited, saveNodeGVICAssignments]);

  const removeNodeGVICPrincipal = useCallback((role: LogicGateGVICRole, principalType: LogicGateGVICPrincipalType, principalID: string) => {
    if (nodeGVICIsInherited) return;
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const next = nodeGVICAssignments.filter((assignment) => !(
      assignment.role === role
      && logicGateGVICAssignmentPrincipalType(assignment) === principalType
      && logicGateGVICAssignmentPrincipalID(assignment) === cleanPrincipalID
    ));
    if (next.length === nodeGVICAssignments.length) return;
    void saveNodeGVICAssignments(next);
  }, [nodeGVICAssignments, nodeGVICIsInherited, saveNodeGVICAssignments]);

  const addLogicGateGVICPrincipal = useCallback((role: LogicGateGVICRole, principalType: LogicGateGVICPrincipalType, principalID: string) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const currentAssignments = logicGateGVICAssignmentsRef.current;
    const singleUserRole = role === "generated";
    if (role === "verified" && principalType !== "user") return;
    if (singleUserRole) {
      if (principalType !== "user") return;
      const existing = currentAssignments.filter((assignment) => assignment.role === role);
      if (existing.length === 1 && logicGateGVICAssignmentPrincipalType(existing[0]) === "user" && logicGateGVICAssignmentPrincipalID(existing[0]) === cleanPrincipalID) return;
      const user = companyUsers.find((candidate) => candidate.user_id === cleanPrincipalID);
      const optimisticAssignment: LogicGateGVICAssignment = {
        company_id: companyID,
        logic_gate_id: linkedNodeID,
        role,
        principal_type: "user",
        principal_id: cleanPrincipalID,
        principal_name: user?.display_name ?? user?.email,
        user_id: cleanPrincipalID,
        user_display_name: user?.display_name,
        user_email: user?.email,
        created_timestamp: new Date().toISOString(),
      };
      commandLogicGateGVICAssignments("add", { role, principal_type: "user", principal_id: cleanPrincipalID, user_id: cleanPrincipalID }, [
        ...currentAssignments.filter((assignment) => assignment.role !== role),
        optimisticAssignment,
      ]);
      return;
    }
    const existingPrincipalIDsForRole = new Set(currentAssignments
      .filter((assignment) => assignment.role === role && logicGateGVICAssignmentPrincipalType(assignment) === principalType)
      .map((assignment) => logicGateGVICAssignmentPrincipalID(assignment))
      .filter(Boolean));
    if (existingPrincipalIDsForRole.has(cleanPrincipalID)) return;
    if (principalType === "group") {
      const group = companyUserGroups.find((candidate) => candidate.group_id === cleanPrincipalID);
      const optimisticAssignment: LogicGateGVICAssignment = {
        company_id: companyID,
        logic_gate_id: linkedNodeID,
        role,
        principal_type: "group",
        principal_id: cleanPrincipalID,
        principal_name: group?.name ?? cleanPrincipalID,
        user_id: "",
        created_timestamp: new Date().toISOString(),
      };
      commandLogicGateGVICAssignments("add", { role, principal_type: "group", principal_id: cleanPrincipalID }, [
        ...currentAssignments,
        optimisticAssignment,
      ]);
      return;
    }
    const user = companyUsers.find((candidate) => candidate.user_id === cleanPrincipalID);
    const optimisticAssignment: LogicGateGVICAssignment = {
      company_id: companyID,
      logic_gate_id: linkedNodeID,
      role,
      principal_type: "user",
      principal_id: cleanPrincipalID,
      principal_name: user?.display_name ?? user?.email,
      user_id: cleanPrincipalID,
      user_display_name: user?.display_name,
      user_email: user?.email,
      created_timestamp: new Date().toISOString(),
    };
    commandLogicGateGVICAssignments("add", { role, principal_type: "user", principal_id: cleanPrincipalID, user_id: cleanPrincipalID }, [
      ...currentAssignments,
      optimisticAssignment,
    ]);
  }, [commandLogicGateGVICAssignments, companyID, companyUserGroups, companyUsers, linkedNodeID]);

  const removeLogicGateGVICPrincipal = useCallback((role: LogicGateGVICRole, principalType: LogicGateGVICPrincipalType, principalID: string) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const currentAssignments = logicGateGVICAssignmentsRef.current;
    const next = currentAssignments.filter((assignment) => !(
      assignment.role === role
      && logicGateGVICAssignmentPrincipalType(assignment) === principalType
      && logicGateGVICAssignmentPrincipalID(assignment) === cleanPrincipalID
    ));
    if (next.length === currentAssignments.length) return;
    commandLogicGateGVICAssignments("remove", {
      role,
      principal_type: principalType,
      principal_id: cleanPrincipalID,
      user_id: principalType === "user" ? cleanPrincipalID : undefined,
    }, next);
  }, [commandLogicGateGVICAssignments]);

  useEffect(() => {
    setIsEditingTitle(false);
    editingTitleActiveRef.current = false;
    committedTitleEditBufferRef.current.reset();
    editingTitleDraftRef.current = "";
    logicGateGVICApplyToAssignedNodesRequestRef.current += 1;
    setLogicGateGVICApplyToAssignedNodesBusy(false);
    setLogicGateGVICApplyConfirmationOpen(false);
  }, [linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    if (linkedEntityCanEdit) return;
    updateIsEditingTitle(false);
    pendingEditorFontSizeRef.current = null;
    pendingEditorHighlightColorRef.current = undefined;
    pendingEditorInlineFormatRef.current = null;
    pendingEditorTypingCaretRef.current = null;
    editorDocumentRef.current?.blur();
    window.getSelection()?.removeAllRanges();
  }, [linkedEntityCanEdit, linkedNodeID, updateIsEditingTitle]);

  useEffect(() => {
    const element = editorHeaderRef.current;
    if (!hasLinkedDocument || !element) {
      setEditorHeaderHeightPx(0);
      return;
    }

    let frameID = 0;
    const measure = () => {
      if (frameID) window.cancelAnimationFrame(frameID);
      frameID = window.requestAnimationFrame(() => {
        frameID = 0;
        setEditorHeaderHeightPx(Math.ceil(element.getBoundingClientRect().height));
      });
    };

    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      if (frameID) window.cancelAnimationFrame(frameID);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeTab, hasLinkedDocument, linkedEntityKind]);


  const refreshEditorSnapshot = useCallback(async () => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    const snapshotScope = resourceType ? editorSnapshotScope(resourceType, resourceID) : "";
    if (!companyID || !resourceType || !resourceID || !snapshotScope) return;

    const refreshToken = ++editorSnapshotRefreshTokenRef.current;
    const isCurrentTarget = () => {
      const currentTarget = linkedEditorTargetRef.current;
      return currentTarget.kind === resourceType && currentTarget.id === resourceID && editorSnapshotRefreshTokenRef.current === refreshToken;
    };

    try {
      setError("");
      if (resourceType === "node") {
        invalidateNodeRecordStoreCaches(apiBase, companyID, resourceID);
        const [projections, contentChanges] = await Promise.all([
          getNodeInformationProjectionSingleFlight(apiBase, companyID, resourceID),
          getNodeContentChangesSingleFlight(apiBase, companyID, resourceID),
        ]);
        if (!isCurrentTarget()) return;
        setNodeWorkspaceProjections(projections);
        setNodeWorkspaceLoadedNodeID(resourceID);
        setNodeContentChanges(contentChanges);
        setNodeContentChangesLoadedNodeID(resourceID);
        setEditorSnapshotLoadedScope(snapshotScope);
        return;
      }

      invalidateLogicGateRecordStoreCaches(apiBase, companyID, resourceID);
      const projections = await getLogicGateInformationProjectionSingleFlight(apiBase, companyID, resourceID);
      if (!isCurrentTarget()) return;
      setLogicGateWorkspaceProjections(projections);
      setEditorSnapshotLoadedScope(snapshotScope);

      const activeInformationID = documentInformationIDRef.current;
      const cleanFocusInformationID = focusInformationID?.trim() ?? "";
      const activeTextBox = activeInformationID
        ? projections.find((item) => item.type === EDITOR_TEXT_BLOCK_TYPE && item.information_id === activeInformationID)
        : undefined;
      const focusedTextBox = !activeTextBox && cleanFocusInformationID
        ? projections.find((item) => item.type === EDITOR_TEXT_BLOCK_TYPE && item.information_id === cleanFocusInformationID)
        : undefined;
      const currentTextBox = activeTextBox ?? focusedTextBox ?? selectCurrentEditorTextProjection(projections);
      if (!editorDataFormat.gate) return;
      if (editorDataFormat.gate.editor_format === "tiptap_json") {
        const informationID = currentTextBox?.information_id?.trim() || LOGIC_GATE_OVERVIEW_DOCUMENT_ID;
        setDocumentInformationID(informationID);
        documentInformationIDRef.current = informationID;
        documentDraftRef.current = "";
        persistedDocumentRef.current = "";
        return;
      }
      const localDocumentSaveActive = pendingSaveRef.current !== null || queuedSaveRef.current !== null || saveInFlightRef.current;
      if (!localDocumentSaveActive) applyLoadedDocument("logic_gate", resourceID, currentTextBox?.information_id ?? "", currentTextBox?.information ?? "", currentTextBox?.revision ?? 0);
    } catch (cause) {
      if (!isCurrentTarget()) return;
      if (isTerminalResourceNotFoundError(cause)) {
        clearVisibleDocumentForSelection();
        setLinkedEntityCanEdit(false);
        setLinkedEntityAccessDeniedMessage(LINKED_ENTITY_NOT_FOUND_MESSAGE);
        setError("");
        return;
      }
      setError(cause instanceof Error ? cause.message : "Failed to refresh linked information");
    }
  }, [apiBase, applyLoadedDocument, clearVisibleDocumentForSelection, companyID, editorDataFormat.gate, focusInformationID, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    const nodeID = linkedEntityKind === "node" ? linkedNodeID.trim() : "";
    const snapshotScope = nodeID ? editorSnapshotScope("node", nodeID) : "";
    if (!companyID || !nodeID || editorSnapshotLoadedScope !== snapshotScope) return undefined;
    let refreshTimer: number | null = null;
    const canonicalRefresh = createCoalescedCanonicalRefresh(refreshEditorSnapshot);
    const scheduleCanonicalRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        canonicalRefresh.request();
      }, 80);
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, `chat:node:${nodeID}`, {
      onAccepted() {
        scheduleCanonicalRefresh();
      },
      onChatMessageCreated(message) {
        if (message.company_id !== companyID || message.node_id !== nodeID) return;
        if (nodeWorkspaceProjectionsRef.current.some((item) => item.information_id === message.message_id)) return;
        scheduleCanonicalRefresh();
      },
      onChatMessageUpdated(message) {
        if (message.company_id !== companyID || message.node_id !== nodeID) return;
        if (!nodeWorkspaceProjectionsRef.current.some((item) => item.information_id === message.message_id)) return;
        scheduleCanonicalRefresh();
      },
      onChatMessageDeleted(message) {
        if (message.company_id !== companyID || message.node_id !== nodeID) return;
        if (!nodeWorkspaceProjectionsRef.current.some((item) => item.information_id === message.message_id)) return;
        scheduleCanonicalRefresh();
      },
    });
    return () => {
      unsubscribe();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      canonicalRefresh.dispose();
    };
  }, [apiBase, companyID, editorSnapshotLoadedScope, linkedEntityKind, linkedNodeID, refreshEditorSnapshot]);
  const currentEditorVersionSignature = useCallback(() => {
    if (linkedEntityKind === "node") {
      return JSON.stringify(nodeWorkspaceProjectionsRef.current
        .filter((item) => item.type === EDITOR_TEXT_BLOCK_TYPE)
        .map((item) => [item.information_id, item.information]));
    }
    if (linkedEntityKind === "logic_gate") {
      const element = editorDocumentRef.current;
      return element ? serializeEditorDocumentHTML(element) : documentDraftRef.current;
    }
    return "";
  }, [linkedEntityKind]);

  const flushCurrentEditorProjection = useCallback(async () => {
    if (linkedEntityKind === "node") {
      await nodeWorkspaceSaveControllerRef.current?.flushPendingProjectionSaves();
      return;
    }
    if (linkedEntityKind === "logic_gate") {
      await saveDocumentNow(editorDocumentRef.current ? serializeEditorDocumentHTML(editorDocumentRef.current) : documentDraftRef.current);
    }
  }, [linkedEntityKind, saveDocumentNow]);

  const saveCurrentEditorVersion = useCallback(async (saveKind: "manual" | "auto" = "manual") => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    if (!companyID || !resourceType || !resourceID || !linkedEntityCanEdit) return;
    setSaveVersionSaving(true);
    try {
      setError("");
      await flushCurrentEditorProjection();
      const version = await requestJSON<EditorSaveVersion>(editorSaveVersionsPath(resourceType, resourceID), {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, save_kind: saveKind }),
      });
      setSaveVersions((current) => [version, ...current.filter((item) => item.save_id !== version.save_id)]);
      setSelectedSaveVersionID(version.save_id);
      lastAutoSaveVersionSignatureRef.current = editorSaveVersionSignature(version) || currentEditorVersionSignature();
      showSaveVersionStatus(`${editorSaveVersionKindLabel(saveKind)} saved at ${formatEditorSaveVersionTimestamp(version.created_timestamp)}`);
      if (activeTabRef.current === "save-settings") void loadEditorSaveVersions();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "failed_to_save_version";
      if (saveKind === "manual") setError(message);
    } finally {
      setSaveVersionSaving(false);
    }
  }, [companyID, currentEditorVersionSignature, flushCurrentEditorProjection, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, loadEditorSaveVersions, requestJSON, showSaveVersionStatus]);

  const restoreEditorSaveVersion = useCallback(async (saveID: string) => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    const cleanSaveID = saveID.trim();
    if (!companyID || !resourceType || !resourceID || !cleanSaveID || !linkedEntityCanEdit) return;
    if (!window.confirm("Are you sure you want to overwrite the current editor with this saved version?")) return;
    setSaveVersionRestoring(true);
    try {
      setError("");
      await requestJSON<EditorSaveVersion>(`${editorSaveVersionsPath(resourceType, resourceID)}/${cleanSaveID}/restore`, {
        method: "POST",
        body: JSON.stringify({ company_id: companyID }),
      });
      lastAutoSaveVersionSignatureRef.current = "";
      showSaveVersionStatus("Current editor overwritten with saved version");
      await refreshEditorSnapshot();
      void loadEditorSaveVersions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "failed_to_restore_save_version");
    } finally {
      setSaveVersionRestoring(false);
    }
  }, [companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, loadEditorSaveVersions, refreshEditorSnapshot, requestJSON, showSaveVersionStatus]);

  useEffect(() => {
    if (autoSaveVersionTimerRef.current !== null) {
      window.clearInterval(autoSaveVersionTimerRef.current);
      autoSaveVersionTimerRef.current = null;
    }
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    if (!EDITOR_AUTO_SAVE_VERSION_CREATION_ENABLED) return;
    if (!companyID || !resourceType || !resourceID || !linkedEntityCanEdit || linkedEntityAccessDenied) return;
    const intervalMs = Math.max(1, saveVersionIntervalMinutes) * 60_000;
    autoSaveVersionTimerRef.current = window.setInterval(() => {
      if (autoSaveVersionBusyRef.current) return;
      const signature = currentEditorVersionSignature();
      if (!signature || signature === lastAutoSaveVersionSignatureRef.current) return;
      autoSaveVersionBusyRef.current = true;
      void saveCurrentEditorVersion("auto").finally(() => {
        autoSaveVersionBusyRef.current = false;
      });
    }, intervalMs);
    return () => {
      if (autoSaveVersionTimerRef.current !== null) {
        window.clearInterval(autoSaveVersionTimerRef.current);
        autoSaveVersionTimerRef.current = null;
      }
    };
  }, [companyID, currentEditorVersionSignature, linkedEntityAccessDenied, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, saveCurrentEditorVersion, saveVersionIntervalMinutes]);


  useEffect(() => () => {
    if (nodePriorityRequirementTimerRef.current !== null) window.clearTimeout(nodePriorityRequirementTimerRef.current);
    if (saveVersionStatusTimerRef.current !== null) window.clearTimeout(saveVersionStatusTimerRef.current);
    if (autoSaveVersionTimerRef.current !== null) window.clearInterval(autoSaveVersionTimerRef.current);
  }, []);

  useEffect(() => () => {
    attachmentHydrationCleanupRef.current?.();
    attachmentHydrationCleanupRef.current = null;
  }, []);

  useEffect(() => {
    setNodePriorityRequirementError("");
  }, [linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    const refresh = () => {
      setLinkedMapWidgetID(readLinkedMapWidgetID());
      setLinkedLogicMapWidgetID(readLinkedLogicMapWidgetID());
    };
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== FRAME_LINKS_KEY && event.key !== FRAME_REGISTRY_KEY) return;
      refresh();
    };
    const onGraphUpdated = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_FRAME_LINK_GRAPH_UPDATED, onGraphUpdated);
    };
  }, [readLinkedLogicMapWidgetID, readLinkedMapWidgetID]);

  useEffect(() => {
    if (forcedEntityKind) return;
    const applyLiveSelection = (selection: LiveSelectionChange): boolean => {
      if (selection.companyID !== companyID || selection.sourceFrameID === scope) return false;
      if (!shouldApplySelectionChangedAt(selection.changedAt)) return false;
      const focusEditor = selection.selectionIntent !== "navigate";
      if (selection.entityKind === "node") {
        applyLinkedNode(selection.entityID, selection.label, { focusEditor });
        return true;
      }
      if (selection.entityKind === "logic_gate") {
        applyLinkedLogicGate(selection.entityID, selection.label, { focusEditor });
        return true;
      }
      applyLinkedNode("", "", { focusEditor });
      return true;
    };
    const refresh = () => {
      const liveSelection = readLiveSelectionForFrame(companyID, scope);
      if (liveSelection) {
        const liveSelectionApplied = applyLiveSelection(liveSelection);
        if (liveSelectionApplied) return;
      }
      const selectedFromExplorer = readSelectedNodeFromExplorerContext();
      const selectedLogicFromExplorer = readSelectedLogicGateFromExplorerContext();
      const freshExplorerSelectionWindowMs = 30_000;
      const selectedFromExplorerIsFresh = !!selectedFromExplorer.id
        && !!selectedFromExplorer.changedAt
        && Date.now() - selectedFromExplorer.changedAt < freshExplorerSelectionWindowMs;
      const selectedLogicFromExplorerIsFresh = !!selectedLogicFromExplorer.id
        && !!selectedLogicFromExplorer.changedAt
        && Date.now() - selectedLogicFromExplorer.changedAt < freshExplorerSelectionWindowMs;
      if (selectedFromExplorerIsFresh || selectedLogicFromExplorerIsFresh) {
        if (
          selectedLogicFromExplorerIsFresh
          && (!selectedFromExplorerIsFresh || (selectedLogicFromExplorer.changedAt ?? 0) >= (selectedFromExplorer.changedAt ?? 0))
        ) {
          if (!shouldApplySelectionChangedAt(selectedLogicFromExplorer.changedAt)) return;
          applyLinkedLogicGate(selectedLogicFromExplorer.id, selectedLogicFromExplorer.label, { focusEditor: selectedLogicFromExplorer.selectionIntent !== "navigate" });
          return;
        }
        if (!shouldApplySelectionChangedAt(selectedFromExplorer.changedAt)) return;
        applyLinkedNode(selectedFromExplorer.id, selectedFromExplorer.label, { focusEditor: selectedFromExplorer.selectionIntent !== "navigate" });
        return;
      }
      const selectedFromMap = readSelectedNodeFromMap(linkedMapWidgetID);
      if (selectedFromMap) {
        applyLinkedNode(selectedFromMap);
        return;
      }
      const selectedFromLogicMap = readSelectedLogicGateFromMap(linkedLogicMapWidgetID || linkedMapWidgetID);
      if (selectedFromLogicMap) {
        applyLinkedLogicGate(selectedFromLogicMap);
        return;
      }
      if (selectedFromExplorer.id) {
        applyLinkedNode(selectedFromExplorer.id, selectedFromExplorer.label, { focusEditor: selectedFromExplorer.selectionIntent !== "navigate" });
        return;
      }
      if (selectedLogicFromExplorer.id) {
        applyLinkedLogicGate(selectedLogicFromExplorer.id, selectedLogicFromExplorer.label, { focusEditor: selectedLogicFromExplorer.selectionIntent !== "navigate" });
        return;
      }
      applyLinkedNode("");
    };
    // Initial restore only. Same-tab clicks use SelectionCoordinator payloads
    // below so the editor does not open a stale peer localStorage snapshot.
    refresh();
    const onMapStateUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; revision?: number; changedAt?: number; sourceExplorerID?: string; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapWidgetID) return;
      if (detail.sourceExplorerID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastSelectionRevisionRef.current, revision)) return;
      const eventSelectedNodeID = typeof detail.selectedNodeID === "string" ? detail.selectedNodeID : null;
      const eventHasSelection = eventSelectedNodeID !== null;
      if (revision > 0 && shouldReadStoredSelectionForEvent(hasSequenceGap(lastSelectionRevisionRef.current, revision), eventHasSelection)) refresh();
      if (revision > 0) lastSelectionRevisionRef.current = revision;
      if (eventSelectedNodeID !== null) {
        if (!shouldApplySelectionChangedAt(detail.changedAt)) return;
        applyLinkedNode(eventSelectedNodeID);
        return;
      }
      refresh();
    };
    const onLogicMapStateUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; selectedLogicGateID?: string; revision?: number; changedAt?: number; sourceExplorerID?: string; envelope?: ContextMutationEnvelope }>).detail;
      const logicContextFrameID = linkedLogicMapWidgetID || linkedMapWidgetID;
      if (!detail || detail.mapWidgetID !== logicContextFrameID) return;
      if (detail.sourceExplorerID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastLogicGateSelectionRevisionRef.current, revision)) return;
      const eventSelectedLogicGateID = typeof detail.selectedLogicGateID === "string"
        ? detail.selectedLogicGateID
        : (typeof detail.selectedNodeID === "string" ? detail.selectedNodeID : null);
      const eventHasSelection = eventSelectedLogicGateID !== null;
      if (revision > 0 && shouldReadStoredSelectionForEvent(hasSequenceGap(lastLogicGateSelectionRevisionRef.current, revision), eventHasSelection)) refresh();
      if (revision > 0) lastLogicGateSelectionRevisionRef.current = revision;
      if (eventSelectedLogicGateID !== null) {
        if (!shouldApplySelectionChangedAt(detail.changedAt)) return;
        applyLinkedLogicGate(eventSelectedLogicGateID);
        return;
      }
      refresh();
    };
    const unsubscribeLiveSelection = subscribeLiveSelection(scope, applyLiveSelection);
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapStateUpdated);
    window.addEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapStateUpdated);
    return () => {
      unsubscribeLiveSelection();
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapStateUpdated);
      window.removeEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapStateUpdated);
    };
  }, [applyLinkedLogicGate, applyLinkedNode, companyID, forcedEntityID, forcedEntityKind, linkedLogicMapWidgetID, linkedMapWidgetID, readSelectedLogicGateFromExplorerContext, readSelectedLogicGateFromMap, readSelectedNodeFromExplorerContext, readSelectedNodeFromMap, scope, shouldApplySelectionChangedAt]);

  useEffect(() => {
    if (forcedEntityKind) return;
    if (!linkedNodeID || linkedEntityKind !== "node") return;
    const syncTitleFromGraph = () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      const node = (snapshot.nodes ?? []).find((item) => item.node_id === linkedNodeID);
      if (!node) return;
      setLinkedEntityCanEdit(canEditResourceAccess(node));
      const rawNextTitle = getNodeTitle(node);
      setLinkedNodeTitle((current) => {
        if (editingTitleActiveRef.current) return current;
        const nextTitle = preserveNodeTitle(rawNextTitle, current, linkedNodeID);
        if (current === nextTitle) return current;
        invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
        return nextTitle;
      });
      setNodeStatus(node.status ?? "");
      setNodePriorityDraft(node.priority == null ? "" : String(node.priority));
      setNodeDueDateDraft(formatNodeDueDateForEditor(node.due_date));
      setNodeAccounts(node.accounts ?? []);
    };
    syncTitleFromGraph();
    return subscribeNodeRelationshipGraph(apiBase, companyID, syncTitleFromGraph);
  }, [apiBase, companyID, forcedEntityKind, linkedEntityKind, linkedNodeID, preserveNodeTitle]);

  useEffect(() => {
    if (forcedEntityKind) return;
    if (!linkedNodeID || linkedEntityKind !== "logic_gate") return;
    const syncTitleFromGraph = () => {
      const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      const logicGate = (snapshot.nodes ?? []).find((item) => item.node_id === linkedNodeID);
      if (!logicGate) return;
      setLinkedEntityCanEdit(canEditResourceAccess(logicGate));
      const nextTitle = getLogicGateTitle(logicGate);
      setLinkedNodeTitle((current) => {
        if (editingTitleActiveRef.current) return current;
        if (current === nextTitle) return current;
        invalidateLogicGateRecordStoreCaches(apiBase, companyID, linkedNodeID);
        return nextTitle;
      });
    };
    syncTitleFromGraph();
    return subscribeLogicGateRelationshipGraph(apiBase, companyID, syncTitleFromGraph);
  }, [apiBase, companyID, forcedEntityKind, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    let cancelled = false;
    editorSnapshotRefreshTokenRef.current += 1;
    if (!currentUserLoaded) {
      setLinkedEntityCanEdit(false);
      return;
    }
    const loadRefreshToken = editorSnapshotRefreshTokenRef.current;
    nodeContentChangesRefreshTokenRef.current += 1;
    const isCurrentLinkedLoad = () => !cancelled && editorSnapshotRefreshTokenRef.current === loadRefreshToken;
    if (!linkedNodeID) {
      setLinkedEntityAccessDeniedMessage("");
      setLinkedEntityCanEdit(false);
      setLinkedNodeTitle("");
      setLinkedNodeInfoPreview([]);
      setLinkedNodeMetadataRows([]);
      setLinkedNodeHistoryRows([]);
      setNodeLogicGateIDs([]);
      setNodeWorkspaceProjections([]);
      setLogicGateWorkspaceProjections([]);
      setEditorSnapshotLoadedScope("");
      setNodeWorkspaceLoadedNodeID("");
      setNodeContentChanges([]);
      setNodeContentChangesLoadedNodeID("");
      setNodeStatus("");
      setNodePriorityDraft("");
      setNodeDueDateDraft("");
      setNodeAccounts([]);
      setNodeGVICAssignments([]);
      applyLogicGateGVICAssignments([], "");
      documentDraftRef.current = "";
      documentRevisionRef.current = 0;
      persistedDocumentRef.current = "";
      documentInformationIDRef.current = "";
      currentDocumentTargetKeyRef.current = "";
      persistedDocumentTargetKeyRef.current = "";
      pendingSaveRef.current = null;
      resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
      setDocumentInformationID("");
      pendingEditorFontSizeRef.current = null;
      pendingEditorHighlightColorRef.current = undefined;
      pendingEditorInlineFormatRef.current = null;
      pendingEditorTypingCaretRef.current = null;
      setSelectionTextAlignment("left");
      setSelectionFontSize(EDITOR_DOCUMENT_FONT_SIZE_PX);
      setSelectionInlineFormat({ bold: false, underline: false, italic: false, strikethrough: false });
      setSelectionHighlightColor(null);
      if (editorDocumentRef.current) {
        attachmentHydrationCleanupRef.current?.();
        attachmentHydrationCleanupRef.current = null;
        editorDocumentRef.current.innerHTML = "";
        editorDocumentRef.current.scrollTop = 0;
      }
      setDocumentScrollTop(0);
      scheduleIndentGuideUpdate("");
      return;
    }
    setNodeWorkspaceLoadedNodeID("");
    setLogicGateWorkspaceProjections([]);
    setEditorSnapshotLoadedScope("");
    setLinkedEntityCanEdit(false);
    setNodeContentChanges([]);
    setNodeContentChangesLoadedNodeID("");
    setNodeLogicGateIDs([]);
    setNodeAccounts([]);
    setLinkedEntityAccessDeniedMessage("");
    const linkedDetailsTitleVersionAtStart = readCommittedEntityTitleVersion();
    (async () => {
      try {
        setError("");
        if (linkedEntityKind === "logic_gate") {
          const [details, projections] = await Promise.all([
            getLogicGateRecordSingleFlight(apiBase, companyID, linkedNodeID),
            getLogicGateInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
          ]);
          const snapshotScope = editorSnapshotScope("logic_gate", linkedNodeID);
          if (!isCurrentLinkedLoad()) return;
          setLinkedEntityCanEdit(canEditResourceAccess(details));
          const loadedLogicGateTitle = foldCommittedEntityTitlesSince(
            getLogicGateTitle({ header: details.logic_gate.header, title: details.logic_gate.header }),
            companyID,
            linkedDetailsTitleVersionAtStart,
            (current, update) => update.entityType === "logic_gate" && update.resourceID === linkedNodeID ? update.title : current,
          );
          setLinkedNodeTitle((current) => editingTitleActiveRef.current ? current : loadedLogicGateTitle);
          if (!editingTitleActiveRef.current) {
            onLogicGateTitleChange?.({ logicGateID: linkedNodeID, label: loadedLogicGateTitle });
          }
          setNodeStatus("");
          setNodePriorityDraft("");
          setNodeDueDateDraft("");
          setNodeLogicGateIDs([]);
          setNodeAccounts([]);
          setNodeGVICAssignments([]);
          applyLogicGateGVICAssignments(details.logic_gate.gvic_assignments ?? [], linkedNodeID);
          setNodeWorkspaceProjections([]);
          setLogicGateWorkspaceProjections(projections);
          setNodeWorkspaceLoadedNodeID("");
          setNodeContentChanges([]);
          setNodeContentChangesLoadedNodeID("");
          setEditorSnapshotLoadedScope(snapshotScope);
          const nonText = details.information.filter((item) => item.type !== EDITOR_TEXT_BLOCK_TYPE);
          const textBoxes = projections.filter((item) => item.type === EDITOR_TEXT_BLOCK_TYPE);
          setLinkedNodeInfoPreview(nonText.slice(0, 2).map((item) => `${item.type}: ${item.information}`));
          setLinkedNodeMetadataRows([
            { label: "Logic Gate ID", value: details.logic_gate.logic_gate_id },
            { label: "Created", value: details.logic_gate.created_timestamp },
            { label: "Relationships", value: String(details.relationships_count ?? details.relationships.length) },
            { label: "Information records", value: String(details.information_count ?? details.information.length) },
            { label: "Text boxes", value: String(textBoxes.length) },
          ]);
          const historyRows = [
            details.logic_gate.created_timestamp ? `Logic gate created at ${details.logic_gate.created_timestamp}` : "Logic gate created",
            ...details.information.slice(-4).map((item) => `${item.type} updated at ${item.updated_timestamp}`),
          ];
          setLinkedNodeHistoryRows(historyRows);
          const cleanFocusInformationID = focusInformationID?.trim() ?? "";
          const focusedTextBox = cleanFocusInformationID
            ? projections.find((item) => item.type === EDITOR_TEXT_BLOCK_TYPE && item.information_id === cleanFocusInformationID)
            : undefined;
          const currentTextBox = focusedTextBox ?? selectCurrentEditorTextProjection(projections);
          if (editorDataFormat.gate?.editor_format === "legacy_html") {
            applyLoadedDocument("logic_gate", linkedNodeID, currentTextBox?.information_id ?? "", currentTextBox?.information ?? "", currentTextBox?.revision ?? 0);
          } else {
            const informationID = currentTextBox?.information_id?.trim() || LOGIC_GATE_OVERVIEW_DOCUMENT_ID;
            setDocumentInformationID(informationID);
            documentInformationIDRef.current = informationID;
            documentRevisionRef.current = 0;
            documentDraftRef.current = "";
            persistedDocumentRef.current = "";
          }
          return;
        }
        invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
        const [details, projections, contentChanges, gvicAssignments] = await Promise.all([
          getNodeRecordSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeContentChangesSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeGVICAssignmentsSingleFlight(apiBase, companyID, linkedNodeID),
        ]);
        if (!isCurrentLinkedLoad()) return;
        const snapshotScope = editorSnapshotScope("node", linkedNodeID);
        setLinkedEntityCanEdit(canEditResourceAccess(details));
        const loadedNodeTitle = foldCommittedEntityTitlesSince(
          getNodeTitle(details.node),
          companyID,
          linkedDetailsTitleVersionAtStart,
          (current, update) => update.entityType === "node" && update.resourceID === linkedNodeID ? update.title : current,
        );
        setLinkedNodeTitle((current) => editingTitleActiveRef.current
          ? current
          : preserveNodeTitle(loadedNodeTitle, current, linkedNodeID));
        setNodeStatus(details.node.status ?? "");
        setNodePriorityDraft(details.node.priority == null ? "" : String(details.node.priority));
        setNodeDueDateDraft(formatNodeDueDateForEditor(details.node.due_date));
        setNodeLogicGateIDs(details.node.logic_gate_ids ?? []);
        setNodeAccounts(details.node.accounts ?? []);
        setNodeGVICAssignments(gvicAssignments);
        applyLogicGateGVICAssignments([], "");
        setNodeWorkspaceProjections(projections);
        setNodeWorkspaceLoadedNodeID(linkedNodeID);
        setNodeContentChanges(contentChanges);
        setNodeContentChangesLoadedNodeID(linkedNodeID);
        setEditorSnapshotLoadedScope(snapshotScope);
        const currentInformation = details.information.length > 0
          ? details.information
          : projections.map((item) => ({
            company_id: item.company_id,
            information_id: item.information_id,
            node_id: item.node_id,
            type: item.type,
            information: item.information,
            created_timestamp: item.created_timestamp,
            updated_timestamp: item.updated_timestamp,
          }));
        const visibleNodeInformation = currentInformation.filter((item) => !isNodeWorkspaceHeaderInformationType(item.type));
        const textBoxes = projections.filter((item) => item.type === EDITOR_TEXT_BLOCK_TYPE);
        setLinkedNodeInfoPreview(visibleNodeInformation.slice(0, 2).map((item) => `${item.type}: ${item.information}`));
        setLinkedNodeMetadataRows([
          { label: "Node ID", value: details.node.node_id },
          { label: "Created", value: details.node.created_timestamp },
          { label: "Relationships", value: String(details.relationships_count ?? details.relationships.length) },
          { label: "Information records", value: String(details.information_count ?? details.information.length) },
          { label: "Text boxes", value: String(textBoxes.length) },
        ]);
        const historyRows = [
          details.node.created_timestamp ? `Node created at ${details.node.created_timestamp}` : "Node created",
          ...visibleNodeInformation.slice(-4).map((item) => `${item.type} updated at ${item.updated_timestamp}`),
        ];
        setLinkedNodeHistoryRows(historyRows);
      } catch (cause) {
        if (!cancelled) {
          if (isAbortError(cause)) return;
          const message = linkedEntityLoadErrorMessage(cause, linkedEntityKind);
          if (message === LINKED_NODE_ACCESS_DENIED_MESSAGE || message === LINKED_ENTITY_NOT_FOUND_MESSAGE) {
            clearVisibleDocumentForSelection();
            setLinkedEntityCanEdit(false);
            setLinkedEntityAccessDeniedMessage(message);
            setError("");
            return;
          }
          setError(message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, applyLoadedDocument, applyLogicGateGVICAssignments, clearVisibleDocumentForSelection, companyID, currentUserLoaded, editorDataFormat.gate?.editor_format, focusInformationID, focusRequestID, linkedEntityKind, linkedNodeID, onLogicGateTitleChange, preserveNodeTitle, requestJSON, scheduleIndentGuideUpdate]);

  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : EDITOR_NEU_PANEL_BACKGROUND;
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#111827";
  const tabBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : EDITOR_NEU_SURFACE;
  const tabSelectedBackground = isDarkTheme ? "rgba(255,255,255,0.14)" : EDITOR_NEU_ACTIVE_SURFACE;
  const strokeColor = isDarkTheme ? "rgba(255,255,255,0.22)" : EDITOR_NEU_SOFT_BORDER;
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(148, 163, 184, 0.18)";
  const panelBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : EDITOR_NEU_SURFACE;
  const scrollbarAccent = theme === "light" ? "rgb(71, 85, 105)" : accent;
  const scrollbarTrack = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(100, 116, 139, 0.08)";
  const indentGuideColor = isDarkTheme ? "rgba(255,255,255,0.22)" : "rgba(15,23,42,0.2)";
  const editorPrimaryText = isDarkTheme ? surfaceText : "#111111";
  const documentIsolation = getEditorDocumentIsolationState(activeTab);
  const emptyMessage = forcedEntityKind && !hasLinkedDocument ? forcedEmptyMessage : "";
  const showIndentGuides = outlineStyle === "indent-guides" && indentGuideSegments.length > 0;
  const fullFrameTabActive = activeTab === "relationships" || activeTab === "permissions" || activeTab === "save-settings";
  const fallbackDocumentTopPx = fullFrameTabActive ? 46 : linkedEntityKind === "node" ? 128 : linkedEntityKind === "logic_gate" ? 188 : EDITOR_DOCUMENT_TOP_PX;
  const documentTopPx = hasLinkedDocument && editorHeaderHeightPx > 0 ? editorHeaderHeightPx + 6 : fallbackDocumentTopPx;
  const documentLineHeightPx = documentFontSize * EDITOR_DOCUMENT_LINE_HEIGHT;
  const documentBottomBufferPx = Math.round(documentLineHeightPx * EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES);
  const documentFontFamily = getEditorDocumentFontFamily(outlineStyle);
  const editorImageAttachmentContext = useMemo(() => (
    (linkedEntityKind === "node" || linkedEntityKind === "logic_gate") && linkedNodeID.trim()
      ? {
        requestJSON,
        apiBase,
        companyID,
        resourceType: linkedEntityKind,
        resourceID: linkedNodeID,
        informationID: documentInformationID || undefined,
        editorSurface: linkedEntityKind === "logic_gate" ? "logic_gate_editor" : "node_editor",
        onError: setError,
      }
      : undefined
  ), [apiBase, companyID, documentInformationID, linkedEntityKind, linkedNodeID, requestJSON]);
  const documentSurfaceHandlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef,
    scrollMemoryRef,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef,
    pendingEditorHighlightColorRef,
    pendingEditorInlineFormatRef,
    pendingEditorTypingCaretRef,
    outlineStyle,
    setDocumentScrollTop,
    scheduleDocumentSave: scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    rememberCurrentDocumentScroll,
    flushPendingDocumentSave,
    onSelectionFontSizeChange: updateSelectionFontSize,
    onSelectionInlineFormatChange: updateSelectionInlineFormat,
    onSelectionHighlightColorChange: setSelectionHighlightColor,
    onSelectionTextAlignmentChange: setSelectionTextAlignment,
    mentionUsers: companyUsers,
    mentionAccent: accent,
    mentionSurfaceText: surfaceText,
    mentionStrokeColor: strokeColor,
    entityLinkContext: { companyID, requestJSON },
    editorImageAttachmentContext,
  });
  const {
    mentionMenu: documentMentionMenu,
    insertTable: insertDocumentTable,
    restoreSelection: restoreDocumentSelection,
    flushPendingInput: flushDocumentInputBatch,
    ...documentSurfaceEventHandlers
  } = documentSurfaceHandlers;
  restoreDocumentSelectionForHydrationRef.current = restoreDocumentSelection;
  flushPendingLocalInputRef.current = () => { flushDocumentInputBatch(editorDocumentRef.current); };
  const restoreDocumentFormattingSelection = useCallback((root: HTMLElement) => {
    flushDocumentInputBatch(root);
    return restoreDocumentSelection(root);
  }, [flushDocumentInputBatch, restoreDocumentSelection]);
  const logicFormattingController = useEditorDocumentFormattingController({
    editorRef: editorDocumentRef,
    editable: editorWriteEnabled && linkedEntityKind !== "node",
    outlineStyle,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef,
    pendingEditorHighlightColorRef,
    pendingEditorInlineFormatRef,
    pendingEditorTypingCaretRef,
    restoreSelection: restoreDocumentFormattingSelection,
    insertTable: insertDocumentTable,
    scheduleDocumentSave: scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    onSelectionFontSizeChange: updateSelectionFontSize,
    onSelectionInlineFormatChange: updateSelectionInlineFormat,
    onSelectionHighlightColorChange: setSelectionHighlightColor,
    onSelectionTextAlignmentChange: setSelectionTextAlignment,
  });
  useEffect(() => {
    if (editorDataFormat.gate?.editor_format === "tiptap_json") {
      logicFormattingControllerRef.current = null;
      return undefined;
    }
    logicFormattingControllerRef.current = logicFormattingController;
    return () => {
      if (logicFormattingControllerRef.current === logicFormattingController) logicFormattingControllerRef.current = null;
    };
  }, [editorDataFormat.gate?.editor_format, logicFormattingController]);
  const handleNodeWorkspaceProjectionMutation = useCallback(() => {
    if (linkedEntityKind !== "node" || !linkedNodeID) return;
    editorSnapshotRefreshTokenRef.current += 1;
    nodeContentChangesRefreshTokenRef.current += 1;
    invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    void refreshEditorSnapshot();
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, refreshEditorSnapshot]);
  const markNodeContentChangeSeen = useCallback((changeID: string) => {
    if (linkedEntityKind !== "node" || !linkedNodeID || !changeID.trim()) return;
    const removedChange = nodeContentChanges.find((change) => change.change_id === changeID);
    const removedGroupKey = removedChange ? nodeContentChangeSeenGroupKey(removedChange) : "";
    const removedChanges = removedGroupKey
      ? nodeContentChanges.filter((change) => nodeContentChangeSeenGroupKey(change) === removedGroupKey)
      : removedChange ? [removedChange] : [];
    setNodeContentChanges((current) => current.filter((change) => removedGroupKey ? nodeContentChangeSeenGroupKey(change) !== removedGroupKey : change.change_id !== changeID));
    invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    void requestJSON<{ status: string }>(`/v1/nodes/${linkedNodeID}/changes/${changeID}/seen`, {
      method: "POST",
      body: JSON.stringify({ company_id: companyID }),
    }).catch((cause) => {
      if (removedChanges.length > 0) {
        setNodeContentChanges((current) => {
          const existingIDs = new Set(current.map((change) => change.change_id));
          const restored = removedChanges.filter((change) => !existingIDs.has(change.change_id));
          if (restored.length === 0) return current;
          return [...current, ...restored].sort((a, b) => a.created_timestamp.localeCompare(b.created_timestamp) || a.change_id.localeCompare(b.change_id));
        });
      }
      setError(cause instanceof Error ? cause.message : "failed_to_mark_node_change_seen");
    });
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, nodeContentChanges, requestJSON]);
  const markAllNodeContentChangesSeen = useCallback(() => {
    if (linkedEntityKind !== "node" || !linkedNodeID || nodeContentChanges.length === 0) return;
    const removedChanges = nodeContentChanges;
    setNodeContentChanges([]);
    invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    void requestJSON<{ status: string }>(`/v1/nodes/${linkedNodeID}/changes/seen-all`, {
      method: "POST",
      body: JSON.stringify({ company_id: companyID }),
    }).catch((cause) => {
      setNodeContentChanges((current) => {
        const existingIDs = new Set(current.map((change) => change.change_id));
        const restored = removedChanges.filter((change) => !existingIDs.has(change.change_id));
        if (restored.length === 0) return current;
        return [...current, ...restored].sort((a, b) => a.created_timestamp.localeCompare(b.created_timestamp) || a.change_id.localeCompare(b.change_id));
      });
      setError(cause instanceof Error ? cause.message : "failed_to_mark_node_changes_seen");
    });
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, nodeContentChanges, requestJSON]);
  const updateRelationshipTabAnchor = useCallback((anchor: { left: number; width: number } | null) => {
    const root = editorRootRef.current;
    if (!anchor || !root) {
      setRelationshipTabAnchorCenterPx(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    setRelationshipTabAnchorCenterPx(anchor.left + (anchor.width / 2) - rootRect.left);
  }, []);

  return (
    <div
      ref={editorRootRef}
      data-frame-interactive="true"
      data-mango-linked-entity-kind={linkedEntityKind || undefined}
      data-mango-linked-entity-id={linkedNodeID || undefined}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ width: "100%", height: "100%", position: "relative", background: surfaceBackground, color: surfaceText, overflow: "hidden", userSelect: "text", cursor: "text", boxShadow: isDarkTheme ? undefined : "inset 5px 5px 16px rgba(174, 174, 192, 0.16), inset -5px -5px 16px rgba(255,255,255,0.82)" }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, cursor: "text" }}>
        {hasLinkedDocument && (
          <div ref={editorHeaderRef} style={{ position: "absolute", top: 4, left: 8, right: 12, display: "grid", gap: 8, zIndex: 60, pointerEvents: "none" }}>
          <EditorTabBar
            activeTab={activeTab}
            outlineStyle={outlineStyle}
            accent={accent}
            strokeColor={strokeColor}
            surfaceText={surfaceText}
            tabBackground={tabBackground}
            tabSelectedBackground={tabSelectedBackground}
            outlineMenuAccent={scrollbarAccent}
            onSelectTab={selectTab}
            onAdjustSelectionFontSize={applyEditorSelectionFontSize}
            documentFontSize={selectionFontSize}
            onSetSelectionFontSize={applyEditorSelectionFontSizeValue}
            boldActive={selectionInlineFormat.bold}
            underlineActive={selectionInlineFormat.underline}
            italicActive={selectionInlineFormat.italic}
            strikethroughActive={selectionInlineFormat.strikethrough}
            highlightColor={selectionHighlightColor}
            textAlignment={selectionTextAlignment}
            onToggleBold={() => toggleEditorInlineFormat("bold")}
            onToggleUnderline={() => toggleEditorInlineFormat("underline")}
            onToggleItalic={() => toggleEditorInlineFormat("italic")}
            onToggleStrikethrough={() => toggleEditorInlineFormat("strikethrough")}
            onSetSelectionHighlightColor={applyEditorSelectionHighlightColor}
            onSetTextAlignment={(alignment) => currentFormattingController()?.applyTextAlignment(alignment)}
            formattingDisabled={documentIsolation.pointerEvents !== "auto" || !linkedEntityCanEdit || (linkedEntityKind === "node" && !nodeFormattingControllerAvailable)}
            onOutlineStyleFocus={() => setActiveTab("outline-styles")}
            onOutlineStyleChange={(nextOutlineStyle) => {
              setOutlineStyle(nextOutlineStyle);
              setActiveTab("outline-styles");
            }}
            onCreateRelatedNode={linkedEntityKind === "node" && linkedEntityCanEdit ? createRelatedNode : undefined}
            onInsertTable={linkedEntityCanEdit ? () => currentFormattingController()?.insertTable() : undefined}
            onSaveCurrentVersion={linkedEntityCanEdit ? () => { void saveCurrentEditorVersion("manual"); } : undefined}
            saveCurrentVersionDisabled={saveVersionRestoring}
            saveCurrentVersionBusy={saveVersionSaving}
            secondaryActions={linkedEntityKind === "logic_gate" ? [{
              id: "apply-gvic-to-assigned-nodes",
              label: logicGateGVICApplyToAssignedNodesBusy ? "Applying GVIC to assigned nodes" : "Apply GVIC to assigned nodes",
              disabled: !linkedEntityCanEdit || logicGateGVICApplyToAssignedNodesBusy,
              onSelect: () => setLogicGateGVICApplyConfirmationOpen(true),
            }] : []}
            onRelationshipTabAnchorChange={updateRelationshipTabAnchor}
            reserveHeaderOffset={!forcedEntityKind}
            singleLine
          />

          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 21, borderBottom: `1px solid ${ruleColor}`, transform: "translateY(8px)", pointerEvents: "none", zIndex: 1 }} />
          <EditorLinkedDocumentPanels
            activeTab={activeTab}
            linkedEntityKind={linkedEntityKind}
            linkedNodeTitle={linkedNodeTitle}
            linkedNodeInfoPreview={linkedNodeInfoPreview}
            linkedNodeMetadataRows={linkedNodeMetadataRows}
            linkedNodeHistoryRows={linkedNodeHistoryRows}
            canEdit={linkedEntityCanEdit}
            canEditGVIC={Boolean(linkedNodeID) && (linkedEntityKind === "logic_gate" || (linkedEntityKind === "node" && !nodeGVICIsInherited))}
            compactHeader={compactLinkedDocumentHeader}
            nodePresetFields={linkedEntityKind === "node" ? {
              status: nodeStatus || "",
              priorityDraft: nodePriorityDraft,
              priorityRequirementError: nodePriorityRequirementError,
              accounts: nodeAccounts,
              accountOptions: nodeAccountOptions,
              dueDateDraft: nodeDueDateDraft,
            } : null}
            gvicFields={linkedEntityKind === "node" ? {
              assignments: nodeGVICAssignments,
              inherited: nodeGVICIsInherited,
              readOnlyReason: nodeGVICReadOnlyReason,
            } : linkedEntityKind === "logic_gate" ? {
              assignments: logicGateGVICAssignments,
            } : null}
            companyUsers={companyUsers}
            companyUserGroups={companyUserGroups}
            companyUserGroupMembers={companyUserGroupMembers}
            isEditingTitle={isEditingTitle}
            editingTitleRef={editingTitleRef}
            editingTitleDraftRef={editingTitleDraftRef}
            accent={accent}
            titleTextColor={editorPrimaryText}
            panelBackground={panelBackground}
            ruleColor={ruleColor}
            onSetIsEditingTitle={updateIsEditingTitle}
            onUpdateTitle={updateNodeTitle}
            onCommitNodeStatus={commitNodeStatus}
            onSetNodePriorityDraft={setNodePriorityDraft}
            onCommitNodePriorityDraft={commitNodePriorityDraft}
            onCommitNodeAccountIDs={commitNodeAccountIDs}
            onSetNodeDueDateDraft={setNodeDueDateDraft}
            onCommitNodeDueDateDraft={commitNodeDueDateDraft}
            onAddGVICPrincipal={linkedEntityKind === "node" ? addNodeGVICPrincipal : addLogicGateGVICPrincipal}
            onRemoveGVICPrincipal={linkedEntityKind === "node" ? removeNodeGVICPrincipal : removeLogicGateGVICPrincipal}
          />

          </div>
        )}

        {logicGateGVICApplyConfirmationOpen && linkedEntityKind === "logic_gate" && (
          <ConfirmActionMenu
            title="Apply GVIC to assigned nodes?"
            detail="This replaces the GVIC assignments on every node currently assigned to this Logic Gate."
            confirmLabel="Yes"
            cancelLabel="No"
            confirmDisabled={!linkedEntityCanEdit || logicGateGVICApplyToAssignedNodesBusy}
            requireDisplayNameConfirmation={false}
            isDarkTheme={isDarkTheme}
            onConfirm={() => {
              setLogicGateGVICApplyConfirmationOpen(false);
              applyLogicGateGVICToAssignedNodes();
            }}
            onCancel={() => setLogicGateGVICApplyConfirmationOpen(false)}
          />
        )}


        {hasLinkedDocument && linkedEntityKind === "node" && activeTab === "relationships" && (
          <NodeRelationshipsSurface
            apiBase={apiBase}
            companyID={companyID}
            nodeID={linkedNodeID}
            nodeTitle={linkedNodeTitle}
            scope={scope}
            topPx={documentTopPx}
            accent={accent}
            surfaceText={surfaceText}
            panelBackground={panelBackground}
            strokeColor={strokeColor}
            ruleColor={ruleColor}
            scrollbarAccent={scrollbarAccent}
            scrollbarTrack={scrollbarTrack}
            relationshipAnchorCenterPx={relationshipTabAnchorCenterPx}
          />
        )}
        {hasLinkedDocument && linkedEntityKind === "logic_gate" && activeTab === "relationships" && (
          <ProjectRelationshipsSurface
            companyID={companyID}
            resourceType="logic_gate"
            resourceID={linkedNodeID}
            resourceTitle={linkedNodeTitle}
            scope={scope}
            topPx={documentTopPx}
            accent={accent}
            surfaceText={surfaceText}
            panelBackground={panelBackground}
            strokeColor={strokeColor}
            ruleColor={ruleColor}
          />
        )}
        {hasLinkedDocument && (linkedEntityKind === "node" || linkedEntityKind === "logic_gate") && activeTab === "permissions" && (
          <div className="mango-editor-hover-highlight" style={{ position: "absolute", top: documentTopPx, left: 12, right: 12, bottom: 12, zIndex: 2, pointerEvents: "auto", minHeight: 0 }}>
            <EntityPermissionsPanel
              requestJSON={requestJSON}
              companyID={companyID}
              entityType={linkedEntityKind}
              entityID={linkedNodeID}
              title={linkedNodeTitle || (linkedEntityKind === "logic_gate" ? "Logic Gate" : "Node")}
              variant="embedded"
              readOnly={!linkedEntityCanEdit}
            />
          </div>
        )}
        {hasLinkedDocument && (linkedEntityKind === "node" || linkedEntityKind === "logic_gate") && activeTab === "save-settings" && (
          <EditorSaveSettingsSurface
            topPx={documentTopPx}
            resourceTitle={linkedNodeTitle || (linkedEntityKind === "logic_gate" ? "Logic Gate" : "Node")}
            intervalMinutes={saveVersionIntervalMinutes}
            versions={saveVersions}
            selectedSaveID={selectedSaveVersionID}
            loading={saveVersionsLoading}
            saving={saveVersionSaving}
            restoring={saveVersionRestoring}
            sortAscending={saveVersionsSortAscending}
            status={saveVersionStatus}
            canEdit={editorWriteEnabled}
            accent={accent}
            surfaceText={surfaceText}
            panelBackground={panelBackground}
            strokeColor={strokeColor}
            ruleColor={ruleColor}
            scrollbarAccent={scrollbarAccent}
            scrollbarTrack={scrollbarTrack}
            onIntervalChange={updateSaveVersionInterval}
            onSaveNow={() => { void saveCurrentEditorVersion("manual"); }}
            onSelectSave={setSelectedSaveVersionID}
            onToggleSort={() => setSaveVersionsSortAscending((current) => !current)}
            onRestore={(saveID) => { void restoreEditorSaveVersion(saveID); }}
          />
        )}
        {hasLinkedDocument && linkedEntityKind === "node" && activeTab !== "relationships" && activeTab !== "permissions" && (
          <NodeWorkspaceSurface
            apiBase={apiBase}
            companyID={companyID}
            scope={scope}
            nodeID={linkedNodeID}
            canEdit={linkedEntityCanEdit}
            nodePriorityDraft={nodePriorityDraft}
            assignedLogicGateIDs={nodeLogicGateIDs}
            projections={nodeWorkspaceProjections}
            unseenChanges={nodeContentChangesLoadedNodeID === linkedNodeID ? nodeContentChanges : []}
            companyUsers={companyUsers}
            projectionsLoaded={nodeWorkspaceLoadedNodeID === linkedNodeID}
            editorSequence={0}
            hidden={documentIsolation.visibility === "hidden"}
            focusInformationID={focusInformationID}
            focusEmailMessageID={focusEmailMessageID}
            focusRequestID={focusRequestID}
            focusInformationMode={focusInformationMode}
            topPx={documentTopPx}
            accent={accent}
            surfaceText={surfaceText}
            panelBackground={panelBackground}
            strokeColor={strokeColor}
            ruleColor={ruleColor}
            scrollbarAccent={scrollbarAccent}
            scrollbarTrack={scrollbarTrack}
            outlineStyle={outlineStyle}
            formattingControllerRef={nodeFormattingControllerRef}
            requestJSON={requestJSON}
            onProjectionMutation={handleNodeWorkspaceProjectionMutation}
            onMarkChangeSeen={markNodeContentChangeSeen}
            onMarkAllChangesSeen={markAllNodeContentChangesSeen}
            onCreateNodeFromImage={createNodeFromImageDocument}
            onAssignToLogicGate={assignLinkedNodeToLogicGate}
            onRequireNodePriorityForLogicGateAssignment={showNodePriorityRequirementError}
            onSelectionFontSizeChange={updateSelectionFontSize}
            onSelectionInlineFormatChange={updateSelectionInlineFormat}
            onSelectionHighlightColorChange={setSelectionHighlightColor}
            onSelectionTextAlignmentChange={setSelectionTextAlignment}
            onFormattingControllerAvailabilityChange={setNodeFormattingControllerAvailable}
            onRegisterSaveController={(controller) => {
              nodeWorkspaceSaveControllerRef.current = controller;
            }}
            onError={setError}
          />
        )}
        {hasLinkedDocument && linkedEntityKind !== "node" && editorDataFormat.gate?.editor_format === "legacy_html" && (
          <EditorDocumentSurface
            documentRef={editorDocumentRef}
            surfaceID="logic-gate-editor"
            documentIsolation={documentIsolation}
            editable={editorWriteEnabled}
            documentTopPx={documentTopPx}
            documentFontSize={documentFontSize}
            documentLineHeightPx={documentLineHeightPx}
            documentFontFamily={documentFontFamily}
            documentBottomBufferPx={documentBottomBufferPx}
            documentScrollTop={documentScrollTop}
            showIndentGuides={showIndentGuides}
            indentGuideSegments={indentGuideSegments}
            indentGuideColor={indentGuideColor}
            surfaceText={surfaceText}
            caretColor={editorPrimaryText}
            scrollbarAccent={scrollbarAccent}
            scrollbarTrack={scrollbarTrack}
            {...documentSurfaceEventHandlers}
          />
        )}
        {hasLinkedDocument && linkedEntityKind === "logic_gate" && editorDataFormat.gate?.editor_format === "tiptap_json" && documentInformationID && (
          <React.Suspense fallback={<div aria-label="Loading JSON editor" style={{ position: "absolute", top: documentTopPx, right: 0, bottom: 0, left: 0 }} />}>
            <LogicGateTiptapEditorSurface
              key={`${companyID}:logic_gate:${linkedNodeID}:${documentInformationID}`}
              value={documentDraftRef.current}
              editable={editorWriteEnabled}
              style={{ position: "absolute", top: documentTopPx, right: 0, bottom: 0, left: 0, overflowY: "auto", color: editorPrimaryText, fontFamily: documentFontFamily, fontSize: documentFontSize, lineHeight: EDITOR_DOCUMENT_LINE_HEIGHT }}
              companyID={companyID}
              resourceID={linkedNodeID}
              documentID={documentInformationID}
              currentUserID={currentUserID}
              requestJSON={requestJSON}
              attachmentContext={editorImageAttachmentContext}
              mentionUsers={companyUsers}
              formattingControllerRef={logicFormattingControllerRef}
              onChange={(next) => { documentDraftRef.current = next; }}
              onFlush={(next) => { documentDraftRef.current = next; }}
              onError={setError}
              onRecoveryStorageError={setError}
              onRecoveryStorageRecovered={() => setError("")}
              onSelectionFontSizeChange={updateSelectionFontSize}
              onSelectionInlineFormatChange={updateSelectionInlineFormat}
              onSelectionHighlightColorChange={setSelectionHighlightColor}
              onSelectionTextAlignmentChange={setSelectionTextAlignment}
            />
          </React.Suspense>
        )}
        {linkedEntityCanEdit && editorDataFormat.gate?.editor_format === "legacy_html" && documentMentionMenu}
        {emptyMessage && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 28, textAlign: "center", fontSize: 13, fontWeight: 700, color: surfaceText, opacity: 0.72 }}>
            {emptyMessage}
          </div>
        )}
        {linkedEntityAccessDeniedMessage && (
          <div role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 28, textAlign: "center", fontSize: 14, fontWeight: 800, color: surfaceText, background: surfaceBackground, zIndex: 4 }}>
            {linkedEntityAccessDeniedMessage}
          </div>
        )}
        {error && <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "#b00020", zIndex: 3 }}>{error}</div>}
      </div>
    </div>
  );
};
