import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu } from "../../app/ConfirmActionMenu";
import { getNodeTitle, canEditResourceAccess, type NodeRecord, type NodeRelationship } from "../nodes/types";
import { getLogicGateTitle, type LogicGateRACIAssignment, type LogicGateRACIRole, type LogicGateRACIPrincipalType, type LogicGateRecord } from "../logic-gates/types";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED } from "../dashboardEvents";
import { getNodeRecordSingleFlight, getNodeInformationProjectionSingleFlight, getNodeTimelineEventsSingleFlight, invalidateNodeRecordStoreCaches, primeNodeRecordStoreCaches, type NodeProjectionItem, type NodeTimelineEventItem } from "../nodes/nodeRecordStore";
import { getNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph, upsertNodeRelationshipGraphNode, upsertNodeRelationshipGraphRelationship } from "../nodes/nodeRelationshipGraph";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand } from "../workspace/workspaceEntityCommands";
import { buildLinkedNodePayload } from "../nodes/relationshipRules";
import { getLogicGateRecordSingleFlight, getLogicGateInformationProjectionSingleFlight, invalidateLogicGateRecordStoreCaches, patchLogicGateRecordStoreRACIAssignments, type LogicGateProjectionItem } from "../logic-gates/logicGateRecordStore";
import { patchLogicGateRACIAssignmentsInCommunicationsWorkspaceCache } from "../communications/communicationsApi";
import { linkMangoResourceAttachment } from "../attachments/attachmentApi";
import { createRequestJSON, isAbortError } from "../api/requestJSON";
import { logicGateConversionErrorMessage } from "../huddles/logicGateConversion";
import { clearResourceMissing, isTerminalResourceNotFoundError } from "../api/missingResources";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { getEditorDocumentIsolationState, type EditorRelatedNodeCreationKind, type EditorTabID } from "./editorTabs";
import { EDITOR_TAB_TEXT } from "./plainTextEditing";
import { createEditorScrollMemory } from "./editorScroll";
import { buildEditorIndentGuideSegments, type EditorIndentGuideSegment } from "./editorIndentGuides";
import {
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  parseEditorTextBlockContent,
  selectCurrentEditorTextProjection,
} from "./editorProjection";
import { EditorLinkedDocumentPanels } from "./EditorLinkedDocumentPanels";
import { formatNodeDueDateForEditor, normalizeNodeDueDateDraft } from "./editorDates";
import { EditorTabBar } from "./EditorTabBar";
import { editorSaveNeedsFailureAttention } from "./EditorSaveStatusIcon.js";
import { mangoTiptapPendingStorageKey } from "./tiptap/mangoTiptapSync.js";
import { flushMangoTiptapResource } from "./tiptap/mangoTiptapFlushRegistry.js";
import {
  markEditorHistoryChanged,
  registerEditorHistoryExitSaver,
  saveEditorHistory,
  type EditorHistoryResourceRef,
} from "./editorExitHistory.js";
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
  readEditorDocumentText,
  serializeEditorDocumentHTML,
  type EditorHighlightColor,
} from "./richTextEditing";
import {
  generateStableInformationID,
  type DocumentSaveRequest,
  type DocumentSaveTarget,
} from "./editorTypes";
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
  useEditorDocumentFormattingController,
  useEditorDocumentSurfaceHandlers,
  type EditorDocumentFormattingController,
  type EditorInlineStyleCommand,
  type EditorSelectionInlineFormatState,
  type EditorTextAlignment,
  type EditorTypingCaretBookmark,
} from "./useEditorDocumentSurfaceHandlers";
import { useEditorDocumentPersistence } from "./useEditorDocumentPersistence";
import { durableEditorAttachmentInformationID } from "./editorAttachmentPreparation";
import { createEditorDocumentUndoHistory, resetEditorDocumentUndoHistory } from "./editorUndoHistory";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { fetchCurrentUser } from "../../auth/cognitoAuth";
import { invalidateResourcePolicyDependentCaches } from "../permissions/resourcePolicyCaches";
import { subscribeRealtimeScope } from "../realtime/realtimeWebSocket";
import { assignNodeToLogicGateStatus, moveLogicGateAssignment } from "../kanban/kanbanApi";
import { EntityPermissionsPanel } from "../permissions/EntityPermissionsDialog";
import { invalidateProjectRelationshipsForResource, listProjectRelationshipsForResource, type ProjectRelationshipProjection } from "../project-management/projectManagementApi";
import { ExplorerRowIcon } from "../../icons/index.js";
import { commitEntityTitleMutation, createCommittedTitleEditBuffer, foldCommittedEntityTitlesSince, readCommittedEntityTitleVersion, subscribeCommittedEntityTitleUpdates } from "../realtime/committedEntityTitleUpdates";
import { preferResolvedEntityLabel } from "../entityLabels.js";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh";
import { listCompanyUserGroups, listCompanyUsers, type CompanyUserGroup, type CompanyUserGroupMember } from "../communications/communicationsApi";
import { useCompanyAccounts } from "../accounts/AccountFilterControl";
import { setNodeAccountAssignments, type Account } from "../accounts/accountsApi";
import { useMangoEditorDataFormat } from "./editorDataFormat";
import { LogicGateTiptapEditorSurface } from "./LogicGateTiptapEditorSurface.js";
import { LogicGateKPISection } from "../huddles/LogicGateKPISection";
import { scheduleTransientInformationFocus } from "./transientInformationFocus.js";
import { parseMangoTiptapDocument } from "./tiptap/mangoTiptapDocument.js";
import type { EditorEntityLink } from "./editorEntityLinks.js";

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
  focusMentionUserID?: string;
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
};

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

function editorSaveVersionDocumentText(information: string): string {
  const document = parseEditorTextBlockContent(information).document || information;
  try {
    const envelope = JSON.parse(document) as { document?: unknown };
    const parts: string[] = [];
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const node = value as { text?: unknown; content?: unknown };
      if (typeof node.text === "string") parts.push(node.text);
      if (Array.isArray(node.content)) {
        for (const child of node.content) visit(child);
        if (node.content.length > 0) parts.push("\n");
      }
    };
    visit(envelope.document);
    return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return document.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function editorSaveVersionPreview(version: EditorSaveVersion | null): string {
  if (!version) return "";
  const items = version.items ?? [];
  if (items.length === 0) return "";
  return items.map((item, index) => {
    const label = items.length > 1 ? `Text box ${index + 1}` : item.type || "Text box";
    return `${label}\n${editorSaveVersionDocumentText(item.information) || "Empty text box"}`;
  }).join("\n\n");
}

function logicGateRACIAssignmentPrincipalType(assignment: LogicGateRACIAssignment): LogicGateRACIPrincipalType {
  return (assignment.principal_type?.trim() || "user") as LogicGateRACIPrincipalType;
}

function logicGateRACIAssignmentPrincipalID(assignment: LogicGateRACIAssignment): string {
  const principalType = logicGateRACIAssignmentPrincipalType(assignment);
  const principalID = assignment.principal_id?.trim() || "";
  const userID = assignment.user_id?.trim() || "";
  if (principalType === "user") return principalID || userID;
  return principalID;
}

type EditorRACIAssignmentInput = {
  role: LogicGateRACIRole;
  principal_type?: LogicGateRACIPrincipalType;
  principal_id?: string;
  user_id?: string;
};

type ResourceRACIPayload = {
  assignment_mode: "inherited" | "customized";
  effective_assignment_mode: "inherited" | "customized";
  effective_source: { resource_type: string; resource_id: string; resource_name?: string };
  overwritten_by_ancestor?: { resource_type: string; resource_id: string; sequence: number } | null;
  gvic_assignments?: LogicGateRACIAssignment[];
  effective_assignments?: Array<{
    role: LogicGateRACIRole;
    user_id: string;
    source_principal_type: LogicGateRACIPrincipalType;
    source_principal_id: string;
  }>;
  parent_policy?: {
    source: { resource_type: string; resource_id: string; resource_name?: string };
    gvic_assignments?: LogicGateRACIAssignment[];
  };
  has_descendants?: boolean;
  revision: string;
};

function displayRACIAssignments(payload: ResourceRACIPayload): LogicGateRACIAssignment[] {
  if (payload.effective_assignment_mode === "customized") return payload.gvic_assignments ?? [];
  if (payload.parent_policy) return payload.parent_policy.gvic_assignments ?? [];
  return (payload.effective_assignments ?? []).map((assignment) => ({
    company_id: "",
    created_timestamp: "",
    role: assignment.role,
    principal_type: "user",
    principal_id: assignment.user_id,
    user_id: assignment.user_id,
  }));
}

function toResourceRACIAssignmentInput(assignment: EditorRACIAssignmentInput): {
  role: LogicGateRACIRole;
  principal_type: LogicGateRACIPrincipalType;
  principal_id: string;
} {
  const principalType = assignment.principal_type?.trim() === "group" ? "group" : "user";
  return {
    role: assignment.role,
    principal_type: principalType,
    principal_id: (assignment.principal_id ?? assignment.user_id ?? "").trim(),
  };
}

function normalizeLogicGateRACIAssignments(assignments: LogicGateRACIAssignment[], logicGateID: string): LogicGateRACIAssignment[] {
  const fallbackLogicGateID = logicGateID.trim();
  return assignments.map((assignment) => {
    const principalType = logicGateRACIAssignmentPrincipalType(assignment);
    const principalID = logicGateRACIAssignmentPrincipalID(assignment);
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
  onSaveNow: () => void;
  onSelectSave: (saveID: string) => void;
  onExitPreview: () => void;
  onToggleSort: () => void;
  onRestore: (saveID: string) => void;
}> = ({
  topPx,
  resourceTitle,
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
  onSaveNow,
  onSelectSave,
  onExitPreview,
  onToggleSort,
  onRestore,
}) => {
  const sortedVersions = useMemo(() => {
    return [...versions].sort((left, right) => {
      const compared = left.created_timestamp.localeCompare(right.created_timestamp);
      return sortAscending ? compared : -compared;
    });
  }, [sortAscending, versions]);
  const selectedVersion = selectedSaveID
    ? sortedVersions.find((version) => version.save_id === selectedSaveID) ?? null
    : null;
  const preview = editorSaveVersionPreview(selectedVersion);

  return (
    <div className="mango-editor-hover-highlight" style={{ position: "absolute", top: topPx, left: 12, right: 12, bottom: 12, zIndex: 3, pointerEvents: "auto", minHeight: 0, display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", border: `1px solid ${strokeColor}`, borderRadius: 12, background: panelBackground, color: surfaceText, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: `1px solid ${ruleColor}` }}>
        <div style={{ minWidth: 0, display: "grid", gap: 3 }}>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 950 }}>Saved Versions</div>
          <div style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "rgba(100,116,139,0.82)", fontSize: 11, fontWeight: 760 }}>{resourceTitle || "Editor"}</div>
        </div>
        <button type="button" disabled={!canEdit || saving} onClick={onSaveNow} style={{ minHeight: 30, border: `1px solid ${strokeColor}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: canEdit ? accent : "rgba(100,116,139,0.62)", cursor: canEdit && !saving ? "pointer" : "default", padding: "0 12px", fontSize: 12, fontWeight: 900 }}>
          {saving ? "Saving version" : "Save version"}
        </button>
      </div>
      <div className="editor-document-scroll" style={{ minHeight: 0, overflow: "auto", padding: 12, display: "grid", gap: 12, alignContent: "start", ["--editor-document-scroll-accent" as string]: scrollbarAccent, ["--editor-document-scroll-track" as string]: scrollbarTrack }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <strong style={{ fontSize: 11 }}>Saved snapshots</strong>
          <button type="button" onClick={onToggleSort} style={{ border: `1px solid ${strokeColor}`, borderRadius: 7, background: EDITOR_NEU_SURFACE, color: surfaceText, cursor: "pointer", padding: "4px 7px", fontSize: 11, fontWeight: 800 }}>
            {sortAscending ? "Oldest first" : "Newest first"}
          </button>
        </div>
        {loading ? (
          <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, padding: 10, fontSize: 12, opacity: 0.7 }}>Loading saved versions</div>
        ) : sortedVersions.length === 0 ? (
          <div style={{ border: `1px dashed ${strokeColor}`, borderRadius: 8, padding: 10, fontSize: 12, opacity: 0.7 }}>No saved versions yet</div>
        ) : (
          <div data-editor-save-version-grid="true" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(120px, 1fr))", gap: 8, minWidth: 680 }}>
            {sortedVersions.map((version) => {
              const selected = selectedVersion?.save_id === version.save_id;
              const thumbnail = editorSaveVersionPreview(version);
              return (
                <button key={version.save_id} type="button" onClick={() => onSelectSave(version.save_id)} style={{ minWidth: 0, height: 128, display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", gap: 5, border: `2px solid ${selected ? accent : strokeColor}`, borderRadius: 9, background: selected ? EDITOR_NEU_ACTIVE_SURFACE : EDITOR_NEU_SURFACE, color: surfaceText, cursor: "pointer", textAlign: "left", padding: 8, font: "inherit", overflow: "hidden" }}>
                  <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.5 }}>{formatEditorSaveVersionTimestamp(version.created_timestamp)}</strong>
                  <span style={{ display: "block", overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "#334155", background: "#ffffff", border: `1px solid ${ruleColor}`, borderRadius: 5, padding: 5, font: "9px/1.25 ui-monospace, SFMono-Regular, Consolas, monospace" }}>{thumbnail || "Empty snapshot"}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: accent, fontSize: 9.5, fontWeight: 850 }}>{version.saved_by_display_name || "Unknown user"}</span>
                </button>
              );
            })}
          </div>
        )}
        {selectedVersion && (
          <section aria-label="Viewing old saved version" style={{ minWidth: 0, display: "grid", gap: 9, border: "4px solid #f59e0b", borderRadius: 12, background: "#fffbeb", padding: 10, boxShadow: "0 0 0 2px rgba(245,158,11,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ display: "grid", gap: 2 }}>
                <strong style={{ color: "#92400e", fontSize: 13 }}>Viewing an old saved snapshot</strong>
                <span style={{ color: "#92400e", fontSize: 10.5, fontWeight: 750 }}>Read-only preview. Your current editor has not changed.</span>
              </div>
              <div style={{ display: "flex", gap: 7 }}>
                <button type="button" onClick={onExitPreview} style={{ minHeight: 30, border: "1px solid #d97706", borderRadius: 8, background: "#ffffff", color: "#92400e", cursor: "pointer", padding: "0 10px", fontSize: 11, fontWeight: 900 }}>Exit preview</button>
                <button type="button" disabled={!canEdit || restoring} onClick={() => onRestore(selectedVersion.save_id)} style={{ minHeight: 30, border: "1px solid #b45309", borderRadius: 8, background: "#f59e0b", color: "#451a03", cursor: canEdit && !restoring ? "pointer" : "default", padding: "0 10px", fontSize: 11, fontWeight: 950 }}>
                  {restoring ? "Overwriting current" : "Overwrite current with this"}
                </button>
              </div>
            </div>
            <pre style={{ margin: 0, minHeight: 220, maxHeight: 460, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", border: "1px solid #f59e0b", borderRadius: 8, background: "#ffffff", color: "#111827", padding: 10, font: "11px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace" }}>{preview || "This saved snapshot is empty."}</pre>
          </section>
        )}
        {status && <div style={{ justifySelf: "start", border: `1px solid ${strokeColor}`, borderRadius: 8, background: EDITOR_NEU_SURFACE, color: surfaceText, padding: "6px 8px", fontSize: 11, fontWeight: 800 }}>{status}</div>}
      </div>
    </div>
  );
};
// Editor module: linked document canvas for node or logic-gate context.
export const EditorContent: React.FC<EditorContentProps> = ({ accent, widgetId, theme = "mango", forcedEntityKind, forcedEntityID = "", forcedLabel = "", forcedEmptyMessage = "", focusInformationID, focusMentionUserID, focusEmailMessageID, focusRequestID, focusInformationMode = "focus", compactLinkedDocumentHeader = false, onLogicGateTitleChange }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const scope = widgetId?.trim() ? widgetId : "global";
  const outlineStyleStorageKey = `editor-outline-style-v1:${companyID}:${scope}`;
  const [linkedEntityKind, setLinkedEntityKind] = useState<"" | "node" | "logic_gate">("");
  const [linkedNodeID, setLinkedNodeID] = useState("");
  const [linkedEntityCanEdit, setLinkedEntityCanEdit] = useState(false);
  const [linkedNodeTitle, setLinkedNodeTitle] = useState("");
  const [linkedNodeInfoPreview, setLinkedNodeInfoPreview] = useState<string[]>([]);
  const [linkedNodeMetadataRows, setLinkedNodeMetadataRows] = useState<Array<{ label: string; value: string }>>([]);
  const [linkedNodeHistoryRows, setLinkedNodeHistoryRows] = useState<string[]>([]);
  const [nodeLogicGateIDs, setNodeLogicGateIDs] = useState<string[]>([]);
  const [nodeWorkspaceProjections, setNodeWorkspaceProjections] = useState<NodeProjectionItem[]>([]);
  const [nodeTimelineEvents, setNodeTimelineEvents] = useState<NodeTimelineEventItem[]>([]);
  const [logicGateWorkspaceProjections, setLogicGateWorkspaceProjections] = useState<LogicGateProjectionItem[]>([]);
  const [nodeWorkspaceLoadedNodeID, setNodeWorkspaceLoadedNodeID] = useState("");
  const [editorSnapshotLoadedScope, setEditorSnapshotLoadedScope] = useState("");
  const [nodeStatus, setNodeStatus] = useState("");
  const [nodePriorityDraft, setNodePriorityDraft] = useState("");
  const [nodeDueDateDraft, setNodeDueDateDraft] = useState("");
  const [nodeAccounts, setNodeAccounts] = useState<Account[]>([]);
  const [nodeRACIAssignments, setNodeRACIAssignments] = useState<LogicGateRACIAssignment[]>([]);
  const [logicGateRACIAssignments, setLogicGateRACIAssignments] = useState<LogicGateRACIAssignment[]>([]);
  const [gvicPolicyMode, setRACIPolicyMode] = useState<"inherited" | "customized">("customized");
  const [gvicPolicyHasDescendants, setRACIPolicyHasDescendants] = useState(false);
  const [gvicPolicyOverwrittenByAncestor, setRACIPolicyOverwrittenByAncestor] = useState<ResourceRACIPayload["overwritten_by_ancestor"]>(null);
  const [gvicPolicyRevision, setRACIPolicyRevision] = useState("");
  const [logicGateRACIApplyToAssignedNodesBusy, setLogicGateRACIApplyToAssignedNodesBusy] = useState(false);
  const [logicGateRACIApplyConfirmationOpen, setLogicGateRACIApplyConfirmationOpen] = useState(false);
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
  const [saveVersionsSortAscending, setSaveVersionsSortAscending] = useState(false);
  const [saveVersionSaving, setSaveVersionSaving] = useState(false);
  const [saveVersionRestoring, setSaveVersionRestoring] = useState(false);
  const [saveVersionStatus, setSaveVersionStatus] = useState("");
  const [logicGateSaveFailed, setLogicGateSaveFailed] = useState(false);
  const { outlineStyle, setOutlineStyle } = useEditorPreferences(outlineStyleStorageKey);
  const [documentFontSize, setDocumentFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [selectionFontSize, setSelectionFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [selectionInlineFormat, setSelectionInlineFormat] = useState<EditorSelectionInlineFormatState>({ bold: false, underline: false, italic: false, strikethrough: false });
  const [selectionHighlightColor, setSelectionHighlightColor] = useState<EditorHighlightColor | null>(null);
  const [selectionTextAlignment, setSelectionTextAlignment] = useState<EditorTextAlignment>("left");
  const [nodeFormattingControllerAvailable, setNodeFormattingControllerAvailable] = useState(false);
  const [, setDocumentScrollTop] = useState(0);
  const [, setIndentGuideSegments] = useState<EditorIndentGuideSegment[]>([]);
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
  const handledTransientFocusRequestRef = useRef("");
  const lastAppliedSelectionChangedAtRef = useRef(0);
  const shouldFocusEditorForSelectionRef = useRef(true);
  const pendingEditorFontSizeRef = useRef<number | null>(null);
  const restoreDocumentSelectionForHydrationRef = useRef<((root: HTMLElement) => boolean) | null>(null);
  const pendingEditorHighlightColorRef = useRef<EditorHighlightColor | null | undefined>(undefined);
  const pendingEditorInlineFormatRef = useRef<EditorSelectionInlineFormatState | null>(null);
  const pendingEditorTypingCaretRef = useRef<EditorTypingCaretBookmark | null>(null);
  const nodeFormattingControllerRef = useRef<EditorDocumentFormattingController | null>(null);
  const logicFormattingControllerRef = useRef<EditorDocumentFormattingController | null>(null);
  const nodeWorkspaceSaveControllersRef = useRef(new Map<string, NodeWorkspaceSaveController>());
  const saveVersionStatusTimerRef = useRef<number | null>(null);
  const saveVersionsRequestRef = useRef(0);
  const nodeWorkspaceProjectionsRef = useRef<NodeProjectionItem[]>([]);
  const logicGateWorkspaceProjectionsRef = useRef<LogicGateProjectionItem[]>([]);
  const logicGateRACIAssignmentsRef = useRef<LogicGateRACIAssignment[]>([]);
  const logicGateRACIMutationSequenceRef = useRef(0);
  const logicGateRACIApplyToAssignedNodesRequestRef = useRef(0);
  const editorSnapshotRefreshTokenRef = useRef(0);
  const linkedEditorTargetRef = useRef<{ kind: "" | "node" | "logic_gate"; id: string }>({ kind: "", id: "" });
  const registerNodeWorkspaceSaveController = useCallback((nodeID: string, controller: NodeWorkspaceSaveController) => {
    const cleanNodeID = nodeID.trim();
    nodeWorkspaceSaveControllersRef.current.set(cleanNodeID, controller);
    return () => {
      if (nodeWorkspaceSaveControllersRef.current.get(cleanNodeID) === controller) {
        nodeWorkspaceSaveControllersRef.current.delete(cleanNodeID);
      }
    };
  }, []);
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

  const { scheduleDocumentSave, flushPendingDocumentSave } = useEditorDocumentPersistence({
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
    if (!companyID || !resourceType || !resourceID || linkedEntityAccessDenied) return;
  }, [companyID, linkedEntityAccessDenied, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    if (activeTab !== "save-settings" || linkedEntityAccessDenied) return;
    void loadEditorSaveVersions();
  }, [activeTab, linkedEntityAccessDenied, loadEditorSaveVersions]);


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
    setSelectionInlineFormat((current) => (
      current.bold === nextFormat.bold
      && current.underline === nextFormat.underline
      && current.italic === nextFormat.italic
      && current.strikethrough === nextFormat.strikethrough
        ? current
        : nextFormat
    ));
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

  const readNodeLabelFromGraph = useCallback((nodeID: string): string => {
    if (!nodeID) return "";
    const node = (getNodeRelationshipGraphSnapshot(apiBase, companyID).nodes ?? []).find((item) => item.node_id === nodeID);
    return node ? getNodeTitle(node) : "";
  }, [apiBase, companyID]);

  const preserveNodeTitle = useCallback((candidate: string, current: string, nodeID: string): string => {
    const cleanCandidate = candidate.trim();
    const cleanCurrent = current.trim();
    const cleanNodeID = nodeID.trim();
    if (!cleanCandidate || (cleanNodeID && cleanCandidate === cleanNodeID)) return cleanCurrent;
    return cleanCandidate;
  }, []);

  const applyLogicGateRACIAssignments = useCallback((assignments: LogicGateRACIAssignment[], logicGateID: string): LogicGateRACIAssignment[] => {
    const normalized = normalizeLogicGateRACIAssignments(assignments, logicGateID);
    logicGateRACIAssignmentsRef.current = normalized;
    setLogicGateRACIAssignments(normalized);
    return normalized;
  }, []);

  const clearVisibleDocumentForSelection = useCallback(() => {
    setLinkedEntityAccessDeniedMessage("");
    setLinkedEntityCanEdit(false);
    setLinkedNodeInfoPreview([]);
    setLinkedNodeMetadataRows([]);
    setLinkedNodeHistoryRows([]);
    setNodeWorkspaceProjections([]);
    setNodeTimelineEvents([]);
    setLogicGateWorkspaceProjections([]);
    setEditorSnapshotLoadedScope("");
    setNodeStatus("");
    setNodePriorityDraft("");
    setNodeDueDateDraft("");
    setNodeRACIAssignments([]);
    applyLogicGateRACIAssignments([], "");
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
  }, [applyLogicGateRACIAssignments, scheduleIndentGuideUpdate]);

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
      setLinkedNodeTitle(logicGateID ? (label || "Logic Gate") : "");
    } else if (!editingTitleActiveRef.current) {
      setLinkedNodeTitle((current) => preferResolvedEntityLabel(current, label, "Logic Gate"));
    }
    if (logicGateID && !isSameEntity && shouldFocusEditor) {
      setActiveTab("editor");
      focusEditorDocumentWithoutScrollJump();
    }
  }, [apiBase, clearVisibleDocumentForSelection, companyID, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, linkedEntityKind, linkedNodeID, rememberCurrentDocumentScroll]);

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
    if (!linkedEntityCanEdit || !companyID || !linkedNodeID || linkedEntityKind !== "node") return;
    const titleByKind: Record<EditorRelatedNodeCreationKind, string> = {
      parent: "new parent node",
      peer: "new peer node",
      child: "new child node",
    };
    const payload = buildLinkedNodePayload(kind);
    const clientID = createWorkspaceEntityBatchClientID(`editor-${kind}-node`);
    setError("");
    try {
      const response = await createWorkspaceEntityBatchCommand<EditorNodeBatchResponse>({
        companyID,
        entityKind: "node",
        mutationOrigin: "editor",
        items: [{ client_id: clientID, name: titleByKind[kind] }],
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
      primeNodeRecordStoreCaches(apiBase, companyID, [{ node, relationships: relationship ? [relationship] : [] }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_related_node");
    }
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON]);

  const createNodeFromImageDocument = useCallback(async (input: NodeImageNodeRequest) => {
    if (!linkedEntityCanEdit || !companyID || linkedEntityKind !== "node") return;
    const title = input.title.trim() || "Image";
    const blockTitle = input.blockTitle?.trim() || "Image";
    const document = input.document.trim();
    if (!document) return;

    const clientID = createWorkspaceEntityBatchClientID("editor-image-node");
    const response = await createWorkspaceEntityBatchCommand<EditorNodeBatchResponse>({
      companyID,
      entityKind: "node",
      mutationOrigin: "editor",
      items: [{ client_id: clientID, name: title }],
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
    await requestJSON<unknown>(path, { method: "PATCH", body: JSON.stringify({ title: blockTitle, attachments: [] }) });
    upsertNodeRelationshipGraphNode(apiBase, companyID, node);
    primeNodeRecordStoreCaches(apiBase, companyID, [{ node, relationships: [] }]);
    invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
  }, [apiBase, companyID, currentUserID, linkedEntityCanEdit, linkedEntityKind, requestJSON]);

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
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, linkedNodeTitle, nodeAccounts, nodeLogicGateIDs, nodePriorityDraft, preserveNodeTitle]);

  const linkLogicGateEntityFromEditor = useCallback(async (entity: EditorEntityLink) => {
    if (!linkedEntityCanEdit || linkedEntityKind !== "logic_gate" || !linkedNodeID) {
      throw new Error("You do not have permission to edit this Logic Gate.");
    }
    if (entity.entityType !== "project") {
      throw new Error("A Logic Gate can only be linked to a Project.");
    }
    const projectID = entity.entityID.trim();
    if (!projectID) throw new Error("Select a Project to link.");
    await requestJSON<unknown>(`/v1/projects/${encodeURIComponent(projectID)}/relationships`, {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        resource_type: "logic_gate",
        resource_id: linkedNodeID,
        position: 0,
      }),
    });
    invalidateProjectRelationshipsForResource({
      companyID,
      resourceType: "logic_gate",
      resourceID: linkedNodeID,
    });
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON]);

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
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "failed_to_update_node_status");
    });
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, nodeAccounts, nodeLogicGateIDs, nodePriorityDraft, updateNodePresetPatch]);

  const nodeRACIIsInherited = gvicPolicyMode === "inherited";

  const saveResourceRACIAssignments = useCallback(async (
    resourceType: "node" | "logic_gate",
    resourceID: string,
    nextAssignments: LogicGateRACIAssignment[] | undefined,
    descendantAction: "inherited_only" | "including_customized" = "inherited_only",
    assignmentMode: "inherited" | "customized" = gvicPolicyMode,
  ) => {
    const cleanResourceID = resourceID.trim();
    if (!cleanResourceID) return null;
    const payload = await requestJSON<ResourceRACIPayload>(`/v1/resources/${resourceType}/${cleanResourceID}/gvic`, {
      method: "PUT",
      headers: gvicPolicyRevision ? { "If-Match": gvicPolicyRevision } : undefined,
      body: JSON.stringify({
        company_id: companyID,
        assignment_mode: assignmentMode,
        ...(assignmentMode === "customized" && nextAssignments !== undefined
          ? { gvic_assignments: nextAssignments.map(toResourceRACIAssignmentInput) }
          : {}),
        descendant_action: descendantAction,
      }),
    });
    invalidateResourcePolicyDependentCaches(apiBase, companyID);
    setRACIPolicyMode(payload.effective_assignment_mode);
    setRACIPolicyHasDescendants(payload.has_descendants === true);
    setRACIPolicyOverwrittenByAncestor(payload.overwritten_by_ancestor ?? null);
    setRACIPolicyRevision(payload.revision);
    return payload;
  }, [apiBase, companyID, gvicPolicyMode, gvicPolicyRevision, requestJSON]);

  const commandResourceRACIAssignments = useCallback(async (
    resourceType: "node" | "logic_gate",
    resourceID: string,
    operation: "add" | "remove",
    assignments: EditorRACIAssignmentInput[],
  ) => {
    const changedKeys = new Set(assignments.map((assignment) => {
      const normalized = toResourceRACIAssignmentInput(assignment);
      return `${normalized.role}:${normalized.principal_type}:${normalized.principal_id}`;
    }));
    const current = resourceType === "logic_gate" ? logicGateRACIAssignmentsRef.current : nodeRACIAssignments;
    const next = operation === "remove"
      ? current.filter((assignment) => !changedKeys.has(`${assignment.role}:${logicGateRACIAssignmentPrincipalType(assignment)}:${logicGateRACIAssignmentPrincipalID(assignment)}`))
      : [...current, ...assignments.map((assignment) => ({ ...assignment, company_id: companyID, created_timestamp: new Date().toISOString(), principal_type: assignment.principal_type ?? "user", principal_id: assignment.principal_id ?? assignment.user_id ?? "", user_id: assignment.user_id ?? "" }))];
    return saveResourceRACIAssignments(resourceType, resourceID, next, "inherited_only", "customized");
  }, [companyID, nodeRACIAssignments, saveResourceRACIAssignments]);

  const saveNodeRACIAssignments = useCallback(async (nextAssignments: LogicGateRACIAssignment[]) => {
    if (!linkedNodeID || linkedEntityKind !== "node") return;
    setError("");
    try {
      const policy = await saveResourceRACIAssignments("node", linkedNodeID, nextAssignments, "inherited_only", "customized");
      if (!policy) return;
      setNodeRACIAssignments(displayRACIAssignments(policy));
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_node_gvic");
    }
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, saveResourceRACIAssignments]);

  const commandLogicGateRACIAssignments = useCallback((
    operation: "add" | "remove",
    assignment: EditorRACIAssignmentInput,
    _optimisticAssignments?: LogicGateRACIAssignment[],
  ) => {
    const logicGateID = linkedNodeID.trim();
    if (!logicGateID || linkedEntityKind !== "logic_gate") return;
    const previousAssignments = logicGateRACIAssignmentsRef.current;
    const mutationSequence = ++logicGateRACIMutationSequenceRef.current;
    editorSnapshotRefreshTokenRef.current += 1;
    setError("");
    void commandResourceRACIAssignments("logic_gate", logicGateID, operation, [assignment]).then((policy) => {
      const currentTarget = linkedEditorTargetRef.current;
      if (logicGateRACIMutationSequenceRef.current !== mutationSequence || currentTarget.kind !== "logic_gate" || currentTarget.id !== logicGateID) return;
      if (!policy) return;
      const assignments = displayRACIAssignments(policy);
      applyLogicGateRACIAssignments(assignments, logicGateID);
      patchLogicGateRecordStoreRACIAssignments(apiBase, companyID, logicGateID, assignments);
      patchLogicGateRACIAssignmentsInCommunicationsWorkspaceCache(companyID, logicGateID, assignments);
    }).catch((err) => {
      const currentTarget = linkedEditorTargetRef.current;
      if (logicGateRACIMutationSequenceRef.current === mutationSequence && currentTarget.kind === "logic_gate" && currentTarget.id === logicGateID) {
        applyLogicGateRACIAssignments(previousAssignments, logicGateID);
      }
      setError(err instanceof Error ? err.message : "failed_to_update_logic_gate_gvic");
    });
  }, [apiBase, applyLogicGateRACIAssignments, commandResourceRACIAssignments, companyID, linkedEntityKind, linkedNodeID]);

  const applyLogicGateRACIToAssignedNodes = useCallback(() => {
    const logicGateID = linkedNodeID.trim();
    if (!logicGateID || linkedEntityKind !== "logic_gate" || !linkedEntityCanEdit || logicGateRACIApplyToAssignedNodesBusy) return;
    const mutationSequence = ++logicGateRACIMutationSequenceRef.current;
    const applyRequestID = ++logicGateRACIApplyToAssignedNodesRequestRef.current;
    editorSnapshotRefreshTokenRef.current += 1;
    setLogicGateRACIApplyToAssignedNodesBusy(true);
    setError("");
    void saveResourceRACIAssignments("logic_gate", logicGateID, logicGateRACIAssignmentsRef.current, "including_customized", "customized").then((policy) => {
      const currentTarget = linkedEditorTargetRef.current;
      if (logicGateRACIMutationSequenceRef.current !== mutationSequence || currentTarget.kind !== "logic_gate" || currentTarget.id !== logicGateID) return;
      if (!policy) return;
      const assignments = displayRACIAssignments(policy);
      applyLogicGateRACIAssignments(assignments, logicGateID);
      patchLogicGateRecordStoreRACIAssignments(apiBase, companyID, logicGateID, assignments);
      patchLogicGateRACIAssignmentsInCommunicationsWorkspaceCache(companyID, logicGateID, assignments);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "failed_to_apply_logic_gate_gvic_to_nodes");
    }).finally(() => {
      if (logicGateRACIApplyToAssignedNodesRequestRef.current === applyRequestID) {
        setLogicGateRACIApplyToAssignedNodesBusy(false);
      }
    });
  }, [apiBase, applyLogicGateRACIAssignments, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, logicGateRACIApplyToAssignedNodesBusy, saveResourceRACIAssignments]);

  const applyLogicGateRACIToInheritedDescendants = useCallback(() => {
    const logicGateID = linkedNodeID.trim();
    if (!logicGateID || linkedEntityKind !== "logic_gate" || !linkedEntityCanEdit || logicGateRACIApplyToAssignedNodesBusy) return;
    const applyRequestID = ++logicGateRACIApplyToAssignedNodesRequestRef.current;
    setLogicGateRACIApplyToAssignedNodesBusy(true);
    setError("");
    void saveResourceRACIAssignments(
      "logic_gate",
      logicGateID,
      gvicPolicyMode === "customized" ? logicGateRACIAssignmentsRef.current : undefined,
      "inherited_only",
      gvicPolicyMode,
    ).then((policy) => {
      if (!policy) return;
      applyLogicGateRACIAssignments(displayRACIAssignments(policy), logicGateID);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : "failed_to_apply_inherited_gvic");
    }).finally(() => {
      if (logicGateRACIApplyToAssignedNodesRequestRef.current === applyRequestID) {
        setLogicGateRACIApplyToAssignedNodesBusy(false);
      }
    });
  }, [apiBase, applyLogicGateRACIAssignments, companyID, gvicPolicyMode, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, logicGateRACIApplyToAssignedNodesBusy, saveResourceRACIAssignments]);

  const addNodeRACIPrincipal = useCallback((role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const existingPrincipalIDsForRole = new Set(nodeRACIAssignments
      .filter((assignment) => assignment.role === role && logicGateRACIAssignmentPrincipalType(assignment) === principalType)
      .map((assignment) => logicGateRACIAssignmentPrincipalID(assignment))
      .filter(Boolean));
    if (existingPrincipalIDsForRole.has(cleanPrincipalID)) return;
    if (principalType === "group") {
      const group = companyUserGroups.find((candidate) => candidate.group_id === cleanPrincipalID);
      void saveNodeRACIAssignments([
        ...nodeRACIAssignments,
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
    void saveNodeRACIAssignments([
      ...nodeRACIAssignments,
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
  }, [companyID, companyUserGroups, companyUsers, linkedNodeID, nodeRACIAssignments, saveNodeRACIAssignments]);

  const removeNodeRACIPrincipal = useCallback((role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const next = nodeRACIAssignments.filter((assignment) => !(
      assignment.role === role
      && logicGateRACIAssignmentPrincipalType(assignment) === principalType
      && logicGateRACIAssignmentPrincipalID(assignment) === cleanPrincipalID
    ));
    if (next.length === nodeRACIAssignments.length) return;
    void saveNodeRACIAssignments(next);
  }, [nodeRACIAssignments, saveNodeRACIAssignments]);

  const addLogicGateRACIPrincipal = useCallback((role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const currentAssignments = logicGateRACIAssignmentsRef.current;
    const existingPrincipalIDsForRole = new Set(currentAssignments
      .filter((assignment) => assignment.role === role && logicGateRACIAssignmentPrincipalType(assignment) === principalType)
      .map((assignment) => logicGateRACIAssignmentPrincipalID(assignment))
      .filter(Boolean));
    if (existingPrincipalIDsForRole.has(cleanPrincipalID)) return;
    if (principalType === "group") {
      const group = companyUserGroups.find((candidate) => candidate.group_id === cleanPrincipalID);
      const optimisticAssignment: LogicGateRACIAssignment = {
        company_id: companyID,
        logic_gate_id: linkedNodeID,
        role,
        principal_type: "group",
        principal_id: cleanPrincipalID,
        principal_name: group?.name ?? cleanPrincipalID,
        user_id: "",
        created_timestamp: new Date().toISOString(),
      };
      commandLogicGateRACIAssignments("add", { role, principal_type: "group", principal_id: cleanPrincipalID }, [
        ...currentAssignments,
        optimisticAssignment,
      ]);
      return;
    }
    const user = companyUsers.find((candidate) => candidate.user_id === cleanPrincipalID);
    const optimisticAssignment: LogicGateRACIAssignment = {
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
    commandLogicGateRACIAssignments("add", { role, principal_type: "user", principal_id: cleanPrincipalID, user_id: cleanPrincipalID }, [
      ...currentAssignments,
      optimisticAssignment,
    ]);
  }, [commandLogicGateRACIAssignments, companyID, companyUserGroups, companyUsers, linkedNodeID]);

  const removeLogicGateRACIPrincipal = useCallback((role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => {
    const cleanPrincipalID = principalID.trim();
    if (!cleanPrincipalID) return;
    const currentAssignments = logicGateRACIAssignmentsRef.current;
    const next = currentAssignments.filter((assignment) => !(
      assignment.role === role
      && logicGateRACIAssignmentPrincipalType(assignment) === principalType
      && logicGateRACIAssignmentPrincipalID(assignment) === cleanPrincipalID
    ));
    if (next.length === currentAssignments.length) return;
    commandLogicGateRACIAssignments("remove", {
      role,
      principal_type: principalType,
      principal_id: cleanPrincipalID,
      user_id: principalType === "user" ? cleanPrincipalID : undefined,
    }, next);
  }, [commandLogicGateRACIAssignments]);

  useEffect(() => {
    setIsEditingTitle(false);
    editingTitleActiveRef.current = false;
    committedTitleEditBufferRef.current.reset();
    editingTitleDraftRef.current = "";
    logicGateRACIApplyToAssignedNodesRequestRef.current += 1;
    setLogicGateRACIApplyToAssignedNodesBusy(false);
    setLogicGateRACIApplyConfirmationOpen(false);
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
        const [projections, timelineEvents] = await Promise.all([
          getNodeInformationProjectionSingleFlight(apiBase, companyID, resourceID),
          getNodeTimelineEventsSingleFlight(apiBase, companyID, resourceID),
        ]);
        if (!isCurrentTarget()) return;
        setNodeWorkspaceProjections(projections);
        setNodeTimelineEvents(timelineEvents);
        setNodeWorkspaceLoadedNodeID(resourceID);
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
      const informationID = currentTextBox?.information_id?.trim() || LOGIC_GATE_OVERVIEW_DOCUMENT_ID;
      setDocumentInformationID(informationID);
      documentInformationIDRef.current = informationID;
      documentDraftRef.current = "";
      persistedDocumentRef.current = "";
      return;
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
  }, [apiBase, clearVisibleDocumentForSelection, companyID, editorDataFormat.gate, focusInformationID, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    const nodeID = linkedEntityKind === "node" ? linkedNodeID.trim() : "";
    const snapshotScope = nodeID ? editorSnapshotScope("node", nodeID) : "";
    if (!companyID || !nodeID || editorSnapshotLoadedScope !== snapshotScope) return undefined;
    let refreshTimer: number | null = null;
    let acceptedOnce = false;
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
        if (!acceptedOnce) {
          acceptedOnce = true;
          return;
        }
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
  const flushCurrentEditorProjection = useCallback(async () => {
    if (linkedEntityKind !== "node" && linkedEntityKind !== "logic_gate") return;
    await flushMangoTiptapResource({
      companyID,
      resourceType: linkedEntityKind,
      resourceID: linkedNodeID,
    });
    if (linkedEntityKind === "node") {
      await nodeWorkspaceSaveControllersRef.current.get(linkedNodeID.trim())?.flushPendingProjectionSaves();
    }
  }, [companyID, linkedEntityKind, linkedNodeID]);

  const createCurrentEditorVersion = useCallback(async () => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    if (!companyID || !resourceType || !resourceID) throw new Error("editor_history_resource_not_ready");
    await flushCurrentEditorProjection();
    return requestJSON<EditorSaveVersion>(editorSaveVersionsPath(resourceType, resourceID), {
      method: "POST",
      body: JSON.stringify({ company_id: companyID, save_kind: "manual" }),
    });
  }, [companyID, flushCurrentEditorProjection, linkedEntityKind, linkedNodeID, requestJSON]);

  const saveCurrentEditorVersion = useCallback(async () => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    if (!companyID || !resourceType || !resourceID || !linkedEntityCanEdit) return;
    const historyRef: EditorHistoryResourceRef = { companyID, resourceType, resourceID };
    setSaveVersionSaving(true);
    try {
      setError("");
      const version = await saveEditorHistory(historyRef, createCurrentEditorVersion);
      if (!version) return;
      setSaveVersions((current) => [version, ...current.filter((item) => item.save_id !== version.save_id)]);
      setSelectedSaveVersionID(version.save_id);
      showSaveVersionStatus(`Manual save saved at ${formatEditorSaveVersionTimestamp(version.created_timestamp)}`);
      if (activeTabRef.current === "save-settings") void loadEditorSaveVersions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "failed_to_save_version");
    } finally {
      setSaveVersionSaving(false);
    }
  }, [companyID, createCurrentEditorVersion, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, loadEditorSaveVersions, showSaveVersionStatus]);

  useEffect(() => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    if (!companyID || !resourceType || !resourceID || !linkedEntityCanEdit || linkedEntityAccessDenied) return undefined;
    return registerEditorHistoryExitSaver(
      { companyID, resourceType, resourceID },
      createCurrentEditorVersion,
    );
  }, [companyID, createCurrentEditorVersion, linkedEntityAccessDenied, linkedEntityCanEdit, linkedEntityKind, linkedNodeID]);

  const restoreEditorSaveVersion = useCallback(async (saveID: string) => {
    const resourceType = linkedEntityKind === "node" || linkedEntityKind === "logic_gate" ? linkedEntityKind : "";
    const resourceID = linkedNodeID.trim();
    const cleanSaveID = saveID.trim();
    if (!companyID || !resourceType || !resourceID || !cleanSaveID || !linkedEntityCanEdit) return;
    if (!window.confirm("Are you sure you want to overwrite the current editor with this saved version?")) return;
    setSaveVersionRestoring(true);
    try {
      setError("");
      const selectedVersion = saveVersions.find((version) => version.save_id === cleanSaveID);
      const jsonItems = (selectedVersion?.items ?? []).map((item) => {
        const content = parseEditorTextBlockContent(item.information);
        try {
          const document = JSON.parse(content.document);
          return { item, content, document };
        } catch {
          return null;
        }
      });
      const canRestoreJSON = jsonItems.length > 0
        && jsonItems.every((item) => item?.document?.format === "mango-tiptap-json");
      if (canRestoreJSON) {
        const desiredItems = jsonItems.filter((item): item is NonNullable<typeof item> => item !== null);
        const desiredIDs = new Set(desiredItems.map(({ item }) => item.source_information_id || item.information_id));
        const currentIDs = resourceType === "node"
          ? nodeWorkspaceProjectionsRef.current.filter((item) => item.type === EDITOR_TEXT_BLOCK_TYPE).map((item) => item.information_id)
          : [documentInformationIDRef.current].filter(Boolean);
        for (const documentID of currentIDs) {
          if (desiredIDs.has(documentID)) continue;
          const path = `/v1/editor-json/${resourceType}/${resourceID}/documents/${documentID}?company_id=${encodeURIComponent(companyID)}`;
          const snapshot = await requestJSON<{ revision: number; deleted?: boolean }>(path);
          if (snapshot.deleted) continue;
          await requestJSON(path, {
            method: "DELETE",
            body: JSON.stringify({
              operation_id: generateStableInformationID(),
              client_id: "editor-save-version-restore",
              base_revision: snapshot.revision,
            }),
          });
        }
        for (const { item, content, document } of desiredItems) {
          let documentID = item.source_information_id || item.information_id;
          let path = `/v1/editor-json/${resourceType}/${resourceID}/documents/${documentID}?company_id=${encodeURIComponent(companyID)}`;
          await requestJSON(path, {
            method: "PATCH",
            body: JSON.stringify({ title: content.title, attachments: content.attachments ?? [] }),
          });
          let snapshot = await requestJSON<{ revision: number; deleted?: boolean }>(path);
          if (snapshot.deleted) {
            documentID = generateStableInformationID();
            path = `/v1/editor-json/${resourceType}/${resourceID}/documents/${documentID}?company_id=${encodeURIComponent(companyID)}`;
            await requestJSON(path, {
              method: "PATCH",
              body: JSON.stringify({ title: content.title, attachments: content.attachments ?? [] }),
            });
            snapshot = await requestJSON<{ revision: number }>(path);
          }
          await requestJSON(path, {
            method: "POST",
            body: JSON.stringify({
              operation_id: generateStableInformationID(),
              client_id: "editor-save-version-restore",
              base_revision: snapshot.revision,
              schema_version: 1,
              document,
              annotations: [],
            }),
          });
        }
      } else {
        await requestJSON<EditorSaveVersion>(`${editorSaveVersionsPath(resourceType, resourceID)}/${cleanSaveID}/restore`, {
          method: "POST",
          body: JSON.stringify({ company_id: companyID }),
        });
      }
      markEditorHistoryChanged({ companyID, resourceType, resourceID });
      setSelectedSaveVersionID("");
      showSaveVersionStatus("Current editor overwritten with saved version");
      await refreshEditorSnapshot();
      void loadEditorSaveVersions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "failed_to_restore_save_version");
    } finally {
      setSaveVersionRestoring(false);
    }
  }, [companyID, editorDataFormat.gate?.editor_format, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, loadEditorSaveVersions, refreshEditorSnapshot, requestJSON, saveVersions, showSaveVersionStatus]);

  useEffect(() => () => {
    if (saveVersionStatusTimerRef.current !== null) window.clearTimeout(saveVersionStatusTimerRef.current);
  }, []);

  useEffect(() => () => {
    attachmentHydrationCleanupRef.current?.();
    attachmentHydrationCleanupRef.current = null;
  }, []);

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
    const current = readLiveSelectionForFrame(companyID, scope);
    if (current) applyLiveSelection(current);
    return subscribeLiveSelection(scope, applyLiveSelection);
  }, [applyLinkedLogicGate, applyLinkedNode, companyID, forcedEntityKind, scope, shouldApplySelectionChangedAt]);

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
    let cancelled = false;
    editorSnapshotRefreshTokenRef.current += 1;
    if (!currentUserLoaded) {
      setLinkedEntityCanEdit(false);
      return;
    }
    const loadRefreshToken = editorSnapshotRefreshTokenRef.current;
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
      setNodeTimelineEvents([]);
      setLogicGateWorkspaceProjections([]);
      setEditorSnapshotLoadedScope("");
      setNodeWorkspaceLoadedNodeID("");
      setNodeStatus("");
      setNodePriorityDraft("");
      setNodeDueDateDraft("");
      setNodeAccounts([]);
      setNodeRACIAssignments([]);
      applyLogicGateRACIAssignments([], "");
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
    setNodeLogicGateIDs([]);
    setNodeAccounts([]);
    setLinkedEntityAccessDeniedMessage("");
    const linkedDetailsTitleVersionAtStart = readCommittedEntityTitleVersion();
    (async () => {
      try {
        setError("");
        if (linkedEntityKind === "logic_gate") {
          const [details, projections, gvicPolicy] = await Promise.all([
            getLogicGateRecordSingleFlight(apiBase, companyID, linkedNodeID),
            getLogicGateInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
            requestJSON<ResourceRACIPayload>(`/v1/resources/logic_gate/${linkedNodeID}/gvic?company_id=${encodeURIComponent(companyID)}`),
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
          setNodeRACIAssignments([]);
          applyLogicGateRACIAssignments(displayRACIAssignments(gvicPolicy), linkedNodeID);
          setRACIPolicyMode(gvicPolicy.effective_assignment_mode);
          setRACIPolicyHasDescendants(gvicPolicy.has_descendants === true);
          setRACIPolicyOverwrittenByAncestor(gvicPolicy.overwritten_by_ancestor ?? null);
          setRACIPolicyRevision(gvicPolicy.revision);
          setNodeWorkspaceProjections([]);
          setNodeTimelineEvents([]);
          setLogicGateWorkspaceProjections(projections);
          setNodeWorkspaceLoadedNodeID("");
          setEditorSnapshotLoadedScope(snapshotScope);
          const nonText = details.information.filter((item) => item.type !== EDITOR_TEXT_BLOCK_TYPE);
          const textBoxes = projections.filter((item) => item.type === EDITOR_TEXT_BLOCK_TYPE);
          setLinkedNodeInfoPreview(nonText.slice(0, 2).map((item) => `${item.type}: ${item.information}`));
          setLinkedNodeMetadataRows([
            { label: "Logic Gate ID", value: details.logic_gate.logic_gate_id },
            { label: "Created", value: details.logic_gate.created_timestamp },
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
            const informationID = currentTextBox?.information_id?.trim() || LOGIC_GATE_OVERVIEW_DOCUMENT_ID;
            setDocumentInformationID(informationID);
            documentInformationIDRef.current = informationID;
            documentRevisionRef.current = 0;
            documentDraftRef.current = "";
            persistedDocumentRef.current = "";
          return;
        }
        invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
        const [details, projections, timelineEvents, gvicPolicy] = await Promise.all([
          getNodeRecordSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeTimelineEventsSingleFlight(apiBase, companyID, linkedNodeID),
          requestJSON<ResourceRACIPayload>(`/v1/resources/node/${linkedNodeID}/gvic?company_id=${encodeURIComponent(companyID)}`),
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
        setNodeRACIAssignments(displayRACIAssignments(gvicPolicy));
        setRACIPolicyMode(gvicPolicy.effective_assignment_mode);
        setRACIPolicyHasDescendants(gvicPolicy.has_descendants === true);
        setRACIPolicyOverwrittenByAncestor(gvicPolicy.overwritten_by_ancestor ?? null);
        setRACIPolicyRevision(gvicPolicy.revision);
        applyLogicGateRACIAssignments([], "");
        setNodeWorkspaceProjections(projections);
        setNodeTimelineEvents(timelineEvents);
        setNodeWorkspaceLoadedNodeID(linkedNodeID);
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
  }, [apiBase, applyLogicGateRACIAssignments, clearVisibleDocumentForSelection, companyID, currentUserLoaded, editorDataFormat.gate?.editor_format, focusInformationID, focusRequestID, linkedEntityKind, linkedNodeID, onLogicGateTitleChange, preserveNodeTitle, requestJSON, scheduleIndentGuideUpdate]);

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
  const editorPrimaryText = isDarkTheme ? surfaceText : "#111111";
  const documentIsolation = getEditorDocumentIsolationState(activeTab);
  const emptyMessage = forcedEntityKind && !hasLinkedDocument ? forcedEmptyMessage : "";
  const fullFrameTabActive = activeTab === "relationships" || activeTab === "permissions" || activeTab === "save-settings";
  const fallbackDocumentTopPx = fullFrameTabActive ? 46 : linkedEntityKind === "node" ? 128 : linkedEntityKind === "logic_gate" ? 188 : EDITOR_DOCUMENT_TOP_PX;
  const documentTopPx = hasLinkedDocument && editorHeaderHeightPx > 0 ? editorHeaderHeightPx + 6 : fallbackDocumentTopPx;
  const documentFontFamily = getEditorDocumentFontFamily(outlineStyle);
  const editorImageAttachmentContext = useMemo(() => (
    (linkedEntityKind === "node" || linkedEntityKind === "logic_gate") && linkedNodeID.trim()
      ? {
        requestJSON,
        apiBase,
        companyID,
        resourceType: linkedEntityKind,
        resourceID: linkedNodeID,
        informationID: durableEditorAttachmentInformationID(documentInformationID),
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
    insertTable: insertDocumentTable,
    restoreSelection: restoreDocumentSelection,
    flushPendingInput: flushDocumentInputBatch,
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
    invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    void refreshEditorSnapshot();
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, refreshEditorSnapshot]);
  const updateRelationshipTabAnchor = useCallback((anchor: { left: number; width: number } | null) => {
    const root = editorRootRef.current;
    if (!anchor || !root) {
      setRelationshipTabAnchorCenterPx(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    setRelationshipTabAnchorCenterPx(anchor.left + (anchor.width / 2) - rootRect.left);
  }, []);

  useEffect(() => {
    const informationID = focusInformationID?.trim() ?? "";
    if (linkedEntityKind !== "logic_gate" || !informationID || documentInformationID !== informationID) return undefined;
    const requestKey = `${linkedNodeID}:${informationID}:${focusMentionUserID ?? ""}:${focusRequestID ?? 0}`;
    if (handledTransientFocusRequestRef.current === requestKey) return undefined;
    handledTransientFocusRequestRef.current = requestKey;
    return scheduleTransientInformationFocus({ root: () => editorRootRef.current, informationID, mentionUserID: focusMentionUserID });
  }, [documentInformationID, focusInformationID, focusMentionUserID, focusRequestID, linkedEntityKind, linkedNodeID]);

  const logicGateConversionAction = {
    id: "convert-to-huddle",
    label: "Turn into Huddle Logic Gate",
    disabled: !linkedEntityCanEdit,
    onSelect: () => {
      if (!window.confirm("Convert this Logic Gate to a Huddle? This cannot be undone.")) return;
      void requestJSON<{ huddle_logic_gate_id: string; header: string }>(`/v1/logic-gates/${encodeURIComponent(linkedNodeID)}/convert-to-huddle`, {
        method: "POST",
        json: { company_id: companyID },
      }).then((item) => {
        window.dispatchEvent(new CustomEvent("mangorts:huddle-open", { detail: { resourceType: "huddle_logic_gate", resourceID: item.huddle_logic_gate_id, name: item.header } }));
      }).catch((cause) => setError(logicGateConversionErrorMessage(cause)));
    },
  };

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
            onSaveCurrentVersion={linkedEntityCanEdit ? () => { void saveCurrentEditorVersion(); } : undefined}
            saveCurrentVersionDisabled={saveVersionRestoring}
            saveCurrentVersionBusy={saveVersionSaving}
            saveStateStorageKey={linkedEntityKind === "logic_gate" && documentInformationID ? mangoTiptapPendingStorageKey({ companyID, resourceType: "logic_gate", resourceID: linkedNodeID, documentID: documentInformationID }) : undefined}
            secondaryActions={linkedEntityKind === "logic_gate" && gvicPolicyHasDescendants ? [{
              id: "apply-gvic-to-inherited-descendants",
              label: logicGateRACIApplyToAssignedNodesBusy ? "Applying" : "Apply to non-customized descendants",
              disabled: !linkedEntityCanEdit || logicGateRACIApplyToAssignedNodesBusy,
              onSelect: applyLogicGateRACIToInheritedDescendants,
            }, {
              id: "overwrite-gvic-descendants",
              label: "Apply to every descendant",
              disabled: !linkedEntityCanEdit || logicGateRACIApplyToAssignedNodesBusy,
              onSelect: () => setLogicGateRACIApplyConfirmationOpen(true),
            }, logicGateConversionAction] : linkedEntityKind === "logic_gate" ? [logicGateConversionAction] : []}
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
            canEditRACI={Boolean(linkedNodeID) && linkedEntityCanEdit}
            compactHeader={compactLinkedDocumentHeader}
            nodePresetFields={linkedEntityKind === "node" ? {
              status: nodeStatus || "",
              priorityDraft: nodePriorityDraft,
              accounts: nodeAccounts,
              accountOptions: nodeAccountOptions,
              dueDateDraft: nodeDueDateDraft,
            } : null}
            gvicFields={linkedEntityKind === "node" ? {
              assignments: nodeRACIAssignments,
              inherited: nodeRACIIsInherited,
              overwrittenByAncestor: gvicPolicyOverwrittenByAncestor,
            } : linkedEntityKind === "logic_gate" ? {
              assignments: logicGateRACIAssignments,
              overwrittenByAncestor: gvicPolicyOverwrittenByAncestor,
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
            onAddRACIPrincipal={linkedEntityKind === "node" ? addNodeRACIPrincipal : addLogicGateRACIPrincipal}
            onRemoveRACIPrincipal={linkedEntityKind === "node" ? removeNodeRACIPrincipal : removeLogicGateRACIPrincipal}
          />

          {linkedEntityKind === "logic_gate" && activeTab === "editor" && (
            <LogicGateKPISection companyID={companyID} logicGateID={linkedNodeID} canEdit={linkedEntityCanEdit} currentUserID={currentUserID} requestJSON={requestJSON} />
          )}

          </div>
        )}

        {logicGateRACIApplyConfirmationOpen && linkedEntityKind === "logic_gate" && (
          <ConfirmActionMenu
            title="Apply to every descendant?"
            detail="This also applies the policy to descendants that currently have customized GVIC assignments."
            confirmLabel="Apply"
            cancelLabel="No"
            confirmDisabled={!linkedEntityCanEdit || logicGateRACIApplyToAssignedNodesBusy}
            requireDisplayNameConfirmation={false}
            isDarkTheme={isDarkTheme}
            onConfirm={() => {
              setLogicGateRACIApplyConfirmationOpen(false);
              applyLogicGateRACIToAssignedNodes();
            }}
            onCancel={() => setLogicGateRACIApplyConfirmationOpen(false)}
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
              apiBase={apiBase}
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
            onSaveNow={() => { void saveCurrentEditorVersion(); }}
            onSelectSave={setSelectedSaveVersionID}
            onExitPreview={() => setSelectedSaveVersionID("")}
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
            nodeName={linkedNodeTitle}
            canEdit={linkedEntityCanEdit}
            assignedLogicGateIDs={nodeLogicGateIDs}
            projections={nodeWorkspaceProjections}
            initialTimelineEvents={nodeTimelineEvents}
            companyUsers={companyUsers}
            projectionsLoaded={nodeWorkspaceLoadedNodeID === linkedNodeID}
            editorSequence={0}
            hidden={documentIsolation.visibility === "hidden"}
            focusInformationID={focusInformationID}
            focusMentionUserID={focusMentionUserID}
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
            onCreateNodeFromImage={createNodeFromImageDocument}
            onAssignToLogicGate={assignLinkedNodeToLogicGate}
            onSelectionFontSizeChange={updateSelectionFontSize}
            onSelectionInlineFormatChange={updateSelectionInlineFormat}
            onSelectionHighlightColorChange={setSelectionHighlightColor}
            onSelectionTextAlignmentChange={setSelectionTextAlignment}
            onFormattingControllerAvailabilityChange={setNodeFormattingControllerAvailable}
            onRegisterSaveController={registerNodeWorkspaceSaveController}
            onError={setError}
          />
        )}
        {hasLinkedDocument && linkedEntityKind === "logic_gate" && documentInformationID && (
          <React.Suspense fallback={<div aria-label="Loading JSON editor" style={{ position: "absolute", top: documentTopPx, right: 0, bottom: 0, left: 0 }} />}>
            <LogicGateTiptapEditorSurface
              key={`${companyID}:logic_gate:${linkedNodeID}:${documentInformationID}`}
              className={logicGateSaveFailed ? "mango-editor-save-failed-frame" : undefined}
              dataAttributes={{ "data-logic-gate-information-id": documentInformationID }}
              value={documentDraftRef.current}
              editable={editorWriteEnabled}
              outlineStyle={outlineStyle}
              style={{ position: "absolute", top: documentTopPx, right: 0, bottom: 0, left: 0, overflowY: "auto", color: editorPrimaryText, fontFamily: documentFontFamily, fontSize: documentFontSize, lineHeight: EDITOR_DOCUMENT_LINE_HEIGHT }}
              companyID={companyID}
              resourceID={linkedNodeID}
              documentID={documentInformationID}
              currentUserID={currentUserID}
              requestJSON={requestJSON}
              attachmentContext={editorImageAttachmentContext}
              mentionUsers={companyUsers}
              formattingControllerRef={logicFormattingControllerRef}
              onEntityLink={linkLogicGateEntityFromEditor}
              onError={setError}
              onSaveStateChange={(state) => setLogicGateSaveFailed((current) => { const failed = editorSaveNeedsFailureAttention(state); return current === failed ? current : failed; })}
              onRecoveryStorageError={setError}
              onRecoveryStorageRecovered={() => setError("")}
              onSelectionFontSizeChange={updateSelectionFontSize}
              onSelectionInlineFormatChange={updateSelectionInlineFormat}
              onSelectionHighlightColorChange={setSelectionHighlightColor}
              onSelectionTextAlignmentChange={setSelectionTextAlignment}
            />
          </React.Suspense>
        )}
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
