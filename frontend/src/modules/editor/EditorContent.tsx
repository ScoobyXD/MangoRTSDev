import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, getNodeTitle as getLogicGateTitle, toLogicGateCanvasRecord, type LogicGateRaciAssignment, type LogicGateRaciRole, type LogicGateRecord } from "../logic-gate-map/shared";
import { EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { getNodeRecordSingleFlight, getNodeInformationProjectionSingleFlight, getNodeContentChangesSingleFlight, invalidateNodeRecordStoreCaches, primeNodeRecordStoreCaches, type NodeProjectionItem } from "../node-map/NodeRecordStore";
import { getNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph, upsertNodeMapPositionsInNodeRelationshipGraph, upsertNodeRelationshipGraphNode, upsertNodeRelationshipGraphRelationship } from "../node-map/NodeRelationshipGraph";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand } from "../workspace/workspaceEntityCommands";
import { buildLinkedNodePayloadFromSourceSide } from "../node-map/relationshipProjection";
import { getLogicGateRecordSingleFlight, getLogicGateInformationProjectionSingleFlight, invalidateLogicGateRecordStoreCaches } from "../logic-gate-map/LogicGateRecordStore";
import { getLogicGateRelationshipGraphSnapshot, subscribeLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { createRequestJSON } from "../api/requestJSON";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange, type SelectionIntent } from "../selectionCoordinator";
import { getEditorDocumentIsolationState, type EditorRelatedNodeCreationKind, type EditorTabID } from "./editorTabs";
import { EDITOR_TAB_TEXT } from "./plainTextEditing";
import { createEditorScrollMemory } from "./editorScroll";
import { buildEditorIndentGuideSegments, type EditorIndentGuideSegment } from "./editorIndentGuides";
import {
  buildEditorTextBlockContentPayload,
  EDITOR_ATTACHED_EMAIL_TYPE,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  selectCurrentEditorTextProjection,
} from "./editorProjection";
import type { NodeContentChange } from "./nodeContentChanges";
import { EditorDocumentSurface } from "./EditorDocumentSurface";
import { EditorLinkedDocumentPanels } from "./EditorLinkedDocumentPanels";
import { formatNodeDueDateForEditor, normalizeNodeDueDateDraft } from "./editorDates";
import { EditorTabBar } from "./EditorTabBar";
import { NodeWorkspaceSurface } from "./NodeWorkspaceSurface";
import { NodeRelationshipsSurface } from "./NodeRelationshipsSurface";
import {
  deserializeEditorDocumentHTML,
  EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES,
  readEditorDocumentText,
  serializeEditorDocumentHTML,
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
import {
  EDITOR_DOCUMENT_FONT_SIZE_PX,
  EDITOR_DOCUMENT_LINE_HEIGHT,
  getEditorDocumentFontFamily,
  EDITOR_DOCUMENT_TOP_PX,
  EDITOR_DOCUMENT_MAX_FONT_SIZE_PX,
  EDITOR_DOCUMENT_MIN_FONT_SIZE_PX,
  useEditorPreferences,
} from "./useEditorPreferences";
import { useEditorDocumentSurfaceHandlers } from "./useEditorDocumentSurfaceHandlers";
import { useEditorDocumentPersistence } from "./useEditorDocumentPersistence";
import { createEditorDocumentUndoHistory, recordEditorDocumentUndoChange, resetEditorDocumentUndoHistory, snapshotEditorDocumentHTML } from "./editorUndoHistory";
import { getActiveCompanyID } from "../../auth/currentCompany";
import { invalidateWorkspaceSnapshot } from "../workspace/workspaceSnapshotCache";
import { subscribeWorkspaceStream } from "../workspace/workspaceStream";
import { getLogicGateArenaView, upsertKanbanCard } from "../kanban/kanbanApi";
import { nextCardPosition } from "../kanban/shared";
import { EntityPermissionsPanel } from "../permissions/EntityPermissionsDialog";
import {
  createEditorCollaborationClientID,
  editorCollaborationLabel,
  editorCollaboratorColor,
  canPublishEditorCollaborationDocumentHTML,
  parseEditorCollaborationWorkspaceEvent,
  publishEditorCollaborationEvent,
  sameEditorCollaborationTarget,
  type EditorCollaborationEventPayload,
} from "./editorCollaboration";

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

function getSelectionRangeInsideElement(element: HTMLElement): Range | null {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  return container === element || element.contains(container) ? range : null;
}

function getSelectionOffsetsInsideElement(element: HTMLElement): { start: number; end: number } | null {
  const range = getSelectionRangeInsideElement(element);
  if (!range) return null;
  const startRange = range.cloneRange();
  startRange.selectNodeContents(element);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(element);
  endRange.setEnd(range.endContainer, range.endOffset);
  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

function snapshotEditorElementForUndo(element: HTMLElement) {
  const offsets = getSelectionOffsetsInsideElement(element);
  const fallbackOffset = readEditorDocumentText(element).length;
  return snapshotEditorDocumentHTML(serializeEditorDocumentHTML(element), offsets?.start ?? fallbackOffset, offsets?.end ?? fallbackOffset);
}

function readRangeFontSize(range: Range, fallbackFontSize: number): number {
  const elementForNode = (node: Node | null): Element | null => {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
    return node instanceof Element ? node : null;
  };
  const container = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? (() => {
      const element = range.startContainer as Element;
      const nextChild = element.childNodes.item(range.startOffset);
      const previousChild = range.startOffset > 0 ? element.childNodes.item(range.startOffset - 1) : null;
      return elementForNode(nextChild ?? previousChild ?? element);
    })()
    : elementForNode(range.startContainer);
  if (!container) return fallbackFontSize;
  const view = container.ownerDocument.defaultView;
  if (!view) return fallbackFontSize;
  const parsed = Number.parseFloat(view.getComputedStyle(container).fontSize);
  return Number.isFinite(parsed) ? parsed : fallbackFontSize;
}

function selectElementContents(element: HTMLElement) {
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
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
  focusRequestID?: number;
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

type EditorCollaboratorPresence = {
  clientID: string;
  name: string;
  color: string;
  lastSeen: number;
};

const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDITOR_COLLABORATOR_TTL_MS = 30_000;
const EDITOR_COLLABORATION_SEND_DELAY_MS = 140;
const EDITOR_REMOTE_APPLY_IDLE_MS = 900;
const EDITOR_RELATIONSHIP_WORLD_W = 12800;
const EDITOR_RELATIONSHIP_WORLD_H = 8800;

function companyUserOptionLabel(user: CompanyUser): string {
  const name = (user.display_name ?? "").trim();
  const email = (user.email ?? "").trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user.user_id;
}

function findCompanyUserByAssigneeDraft(users: CompanyUser[], draft: string): CompanyUser | null {
  const value = draft.trim().toLowerCase();
  if (!value) return null;
  return users.find((user) => {
    const labels = [
      companyUserOptionLabel(user),
      user.display_name ?? "",
      user.email ?? "",
      user.user_id,
    ];
    return labels.some((label) => label.trim().toLowerCase() === value);
  }) ?? null;
}

function isNodeWorkspaceHeaderInformationType(type: string): boolean {
  return type === EDITOR_TEXT_BLOCK_TYPE || type === EDITOR_TEXT_BLOCK_CHAT_TYPE || type === EDITOR_ATTACHED_EMAIL_TYPE;
}

function workspaceEventDataString(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value.trim() : "";
}

// Editor module: linked document canvas for node or logic-gate context.
export const EditorContent: React.FC<EditorContentProps> = ({ accent, widgetId, theme = "mango", forcedEntityKind, forcedEntityID = "", forcedLabel = "", forcedEmptyMessage = "", focusInformationID, focusRequestID }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = getActiveCompanyID();
  const scope = widgetId?.trim() ? widgetId : "global";
  const outlineStyleStorageKey = `editor-outline-style-v1:${companyID}:${scope}`;
  const [linkedMapWidgetID, setLinkedMapWidgetID] = useState("");
  const [linkedLogicMapWidgetID, setLinkedLogicMapWidgetID] = useState("");
  const [linkedEntityKind, setLinkedEntityKind] = useState<"" | "node" | "logic_gate">("");
  const [linkedNodeID, setLinkedNodeID] = useState("");
  const [linkedEntityCanEdit, setLinkedEntityCanEdit] = useState(true);
  const [linkedNodeTitle, setLinkedNodeTitle] = useState("");
  const [linkedNodeInfoPreview, setLinkedNodeInfoPreview] = useState<string[]>([]);
  const [linkedNodeMetadataRows, setLinkedNodeMetadataRows] = useState<Array<{ label: string; value: string }>>([]);
  const [linkedNodeHistoryRows, setLinkedNodeHistoryRows] = useState<string[]>([]);
  const [nodeLogicGateIDs, setNodeLogicGateIDs] = useState<string[]>([]);
  const [nodeWorkspaceProjections, setNodeWorkspaceProjections] = useState<NodeProjectionItem[]>([]);
  const [nodeWorkspaceLoadedNodeID, setNodeWorkspaceLoadedNodeID] = useState("");
  const [nodeContentChanges, setNodeContentChanges] = useState<NodeContentChange[]>([]);
  const [nodeContentChangesLoadedNodeID, setNodeContentChangesLoadedNodeID] = useState("");
  const [nodeStatus, setNodeStatus] = useState("");
  const [nodeStatusColor, setNodeStatusColor] = useState("");
  const [nodePriorityDraft, setNodePriorityDraft] = useState("");
  const [nodePriorityRequirementError, setNodePriorityRequirementError] = useState("");
  const [nodeDueDateDraft, setNodeDueDateDraft] = useState("");
  const [nodeAssigneeDraft, setNodeAssigneeDraft] = useState("");
  const [nodeAssigneeUserID, setNodeAssigneeUserID] = useState("");
  const [logicGateRaciAssignments, setLogicGateRaciAssignments] = useState<LogicGateRaciAssignment[]>([]);
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [documentInformationID, setDocumentInformationID] = useState("");
  const [collaborators, setCollaborators] = useState<EditorCollaboratorPresence[]>([]);
  const [collaborationStatus, setCollaborationStatus] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<EditorTabID>("editor");
  const { outlineStyle, setOutlineStyle } = useEditorPreferences(outlineStyleStorageKey);
  const [documentFontSize, setDocumentFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [selectionFontSize, setSelectionFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [documentScrollTop, setDocumentScrollTop] = useState(0);
  const [indentGuideSegments, setIndentGuideSegments] = useState<EditorIndentGuideSegment[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editorHeaderHeightPx, setEditorHeaderHeightPx] = useState(0);
  const editingTitleRef = useRef<HTMLSpanElement | null>(null);
  const editingTitleDraftRef = useRef("");
  const editorDocumentRef = useRef<HTMLDivElement | null>(null);
  const editorHeaderRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<EditorTabID>("editor");
  const restoringScrollRef = useRef(false);
  const scrollMemoryRef = useRef(createEditorScrollMemory());
  const documentUndoHistoryRef = useRef(createEditorDocumentUndoHistory());
  const indentGuideFrameRef = useRef<number | null>(null);
  const documentDraftRef = useRef("");
  const persistedDocumentRef = useRef("");
  const documentInformationIDRef = useRef("");
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
  const collaborationClientIDRef = useRef(createEditorCollaborationClientID());
  const collaborationSendTimerRef = useRef<number | null>(null);
  const collaborationStatusTimerRef = useRef<number | null>(null);
  const nodePriorityRequirementTimerRef = useRef<number | null>(null);
  const pendingCollaborationHTMLRef = useRef<string | null>(null);
  const applyingRemoteCollaborationRef = useRef(false);
  const lastLocalCollaborationEditAtRef = useRef(0);
  const pendingRemoteCollaborationRef = useRef<EditorCollaborationEventPayload | null>(null);
  const remoteCollaborationTimerRef = useRef<number | null>(null);
  const remoteRevisionByClientRef = useRef(new Map<string, number>());
  const hasLinkedDocument = linkedNodeID.trim().length > 0;

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

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

  const scheduleIndentGuideUpdate = useCallback((text: string) => {
    if (indentGuideFrameRef.current !== null) {
      window.cancelAnimationFrame(indentGuideFrameRef.current);
      indentGuideFrameRef.current = null;
    }
    if (outlineStyle !== "indent-guides") {
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
  }, [outlineStyle]);

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

  useEffect(() => {
    let cancelled = false;
    if (!companyID) {
      setCompanyUsers([]);
      return;
    }
    (async () => {
      try {
        const payload = await requestJSON<{ users: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`);
        if (!cancelled) setCompanyUsers(payload.users ?? []);
      } catch {
        if (!cancelled) setCompanyUsers([]);
      }
    })();
    return () => { cancelled = true; };
  }, [companyID, requestJSON]);

  const companyUserByID = useMemo(() => {
    const items = new Map<string, CompanyUser>();
    for (const user of companyUsers) items.set(user.user_id, user);
    return items;
  }, [companyUsers]);

  const assigneeDraftForUserID = useCallback((userID: string): string => {
    const user = companyUserByID.get(userID);
    return user ? companyUserOptionLabel(user) : userID;
  }, [companyUserByID]);

  const syncNodeAssignee = useCallback((assigneeUserID?: string | null) => {
    const nextUserID = assigneeUserID ?? "";
    setNodeAssigneeUserID(nextUserID);
    setNodeAssigneeDraft(nextUserID ? assigneeDraftForUserID(nextUserID) : "");
  }, [assigneeDraftForUserID]);

  useEffect(() => {
    if (!nodeAssigneeUserID) return;
    const nextDraft = assigneeDraftForUserID(nodeAssigneeUserID);
    setNodeAssigneeDraft((current) => (current === "" || current === nodeAssigneeUserID ? nextDraft : current));
  }, [assigneeDraftForUserID, nodeAssigneeUserID]);

  const invalidateDocumentTargetCaches = useCallback((target: DocumentSaveTarget) => {
    if (target.entityKind === "logic_gate") invalidateLogicGateRecordStoreCaches(apiBase, companyID, target.entityID);
    else invalidateNodeRecordStoreCaches(apiBase, companyID, target.entityID);
  }, [apiBase, companyID]);

  const { scheduleDocumentSave, flushPendingDocumentSave } = useEditorDocumentPersistence({
    companyID,
    linkedEntityKind,
    linkedEntityID: linkedNodeID,
    documentDraftRef,
    persistedDocumentRef,
    documentInformationIDRef,
    currentDocumentTargetKeyRef,
    persistedDocumentTargetKeyRef,
    saveTimerRef,
    pendingSaveRef,
    queuedSaveRef,
    saveInFlightRef,
    setDocumentInformationID,
    setError,
    requestJSON,
    invalidateDocumentTargetCaches,
  });

  const publishCollaborationEvent = useCallback((eventType: EditorCollaborationEventPayload["eventType"], documentHTML?: string) => {
    if (!companyID || !linkedNodeID || (linkedEntityKind !== "node" && linkedEntityKind !== "logic_gate")) return;
    const revision = Date.now();
    void publishEditorCollaborationEvent(apiBase, companyID, {
      eventType,
      entityKind: linkedEntityKind,
      entityID: linkedNodeID,
      informationID: documentInformationIDRef.current || documentInformationID,
      clientID: collaborationClientIDRef.current,
      documentHTML,
      revision,
    }).catch(() => {
      // Collaboration is opportunistic; durable autosave remains the source of truth.
    });
  }, [apiBase, companyID, documentInformationID, linkedEntityKind, linkedNodeID]);

  const queueCollaborationDocumentUpdate = useCallback((documentHTML: string, immediate = false) => {
    if (applyingRemoteCollaborationRef.current) return;
    lastLocalCollaborationEditAtRef.current = Date.now();
    if (!canPublishEditorCollaborationDocumentHTML(documentHTML)) {
      pendingCollaborationHTMLRef.current = null;
      return;
    }
    pendingCollaborationHTMLRef.current = documentHTML;
    if (collaborationSendTimerRef.current !== null) {
      window.clearTimeout(collaborationSendTimerRef.current);
      collaborationSendTimerRef.current = null;
    }
    const publishPending = () => {
      collaborationSendTimerRef.current = null;
      const pendingHTML = pendingCollaborationHTMLRef.current;
      pendingCollaborationHTMLRef.current = null;
      if (pendingHTML !== null) publishCollaborationEvent("document_update", pendingHTML);
    };
    if (immediate) {
      publishPending();
      return;
    }
    collaborationSendTimerRef.current = window.setTimeout(publishPending, EDITOR_COLLABORATION_SEND_DELAY_MS);
  }, [publishCollaborationEvent]);

  const scheduleCollaborativeDocumentSave = useCallback((nextText: string, immediate = false) => {
    if (!linkedEntityCanEdit) return;
    scheduleDocumentSave(nextText, immediate);
    queueCollaborationDocumentUpdate(nextText, immediate);
  }, [linkedEntityCanEdit, queueCollaborationDocumentUpdate, scheduleDocumentSave]);

  const flashCollaborationStatus = useCallback((message: string) => {
    setCollaborationStatus(message);
    if (collaborationStatusTimerRef.current !== null) window.clearTimeout(collaborationStatusTimerRef.current);
    collaborationStatusTimerRef.current = window.setTimeout(() => {
      collaborationStatusTimerRef.current = null;
      setCollaborationStatus("");
    }, 2_400);
  }, []);

  const showNodePriorityRequirementError = useCallback(() => {
    const message = "Must give node a priority";
    setNodePriorityRequirementError(message);
    if (nodePriorityRequirementTimerRef.current !== null) window.clearTimeout(nodePriorityRequirementTimerRef.current);
    nodePriorityRequirementTimerRef.current = window.setTimeout(() => {
      nodePriorityRequirementTimerRef.current = null;
      setNodePriorityRequirementError("");
    }, 2_400);
  }, []);

  const applyRemoteCollaborationUpdate = useCallback((payload: EditorCollaborationEventPayload) => {
    const element = editorDocumentRef.current;
    if (!element || payload.documentHTML === undefined) return;
    if (linkedEntityKind !== payload.entityKind || linkedNodeID !== payload.entityID) return;
    const lastRevision = remoteRevisionByClientRef.current.get(payload.clientID) ?? 0;
    if (payload.revision <= lastRevision) return;
    remoteRevisionByClientRef.current.set(payload.clientID, payload.revision);

    const currentHTML = serializeEditorDocumentHTML(element);
    if (currentHTML === payload.documentHTML) return;
    applyingRemoteCollaborationRef.current = true;
    try {
      const nextHTML = deserializeEditorDocumentHTML(payload.documentHTML);
      element.innerHTML = nextHTML;
      resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
      documentDraftRef.current = payload.documentHTML;
      if (payload.informationID && !documentInformationIDRef.current) {
        documentInformationIDRef.current = payload.informationID;
        setDocumentInformationID(payload.informationID);
      }
      const informationID = payload.informationID || documentInformationIDRef.current;
      if (informationID) {
        persistedDocumentRef.current = payload.documentHTML;
        persistedDocumentTargetKeyRef.current = documentTargetKey({ entityKind: payload.entityKind, entityID: payload.entityID, informationID });
      }
      scheduleIndentGuideUpdate(readEditorDocumentText(element));
      flashCollaborationStatus(`${editorCollaborationLabel(payload.clientID, payload.clientName)} edited`);
    } finally {
      window.requestAnimationFrame(() => {
        applyingRemoteCollaborationRef.current = false;
      });
    }
  }, [flashCollaborationStatus, linkedEntityKind, linkedNodeID, scheduleIndentGuideUpdate]);

  const applyOrDeferRemoteCollaborationUpdate = useCallback((payload: EditorCollaborationEventPayload) => {
    const localEditorIsActive = Date.now() - lastLocalCollaborationEditAtRef.current < EDITOR_REMOTE_APPLY_IDLE_MS
      || pendingSaveRef.current !== null
      || saveInFlightRef.current;
    if (localEditorIsActive) {
      pendingRemoteCollaborationRef.current = payload;
      flashCollaborationStatus(`${editorCollaborationLabel(payload.clientID, payload.clientName)} edited`);
      if (remoteCollaborationTimerRef.current !== null) return;
      remoteCollaborationTimerRef.current = window.setTimeout(() => {
        remoteCollaborationTimerRef.current = null;
        const pending = pendingRemoteCollaborationRef.current;
        pendingRemoteCollaborationRef.current = null;
        if (pending) applyOrDeferRemoteCollaborationUpdate(pending);
      }, EDITOR_REMOTE_APPLY_IDLE_MS);
      return;
    }
    pendingRemoteCollaborationRef.current = null;
    applyRemoteCollaborationUpdate(payload);
  }, [applyRemoteCollaborationUpdate, flashCollaborationStatus, pendingSaveRef, saveInFlightRef]);

  const applyEditorSelectionFontSizeValue = useCallback((nextFontSizeInput: number) => {
    if (!linkedEntityCanEdit) return;
    const element = editorDocumentRef.current;
    if (!element) return;
    const range = getSelectionRangeInsideElement(element);
    const nextFontSize = clampEditorSelectionFontSize(nextFontSizeInput);
    setSelectionFontSize(nextFontSize);

    element.focus({ preventScroll: true });
    if (!range || range.collapsed) {
      pendingEditorFontSizeRef.current = nextFontSize;
      return;
    }

    const undoBefore = snapshotEditorElementForUndo(element);
    const fragment = range.extractContents();
    const stripFontSizes = (node: Node) => {
      if (node instanceof HTMLElement && node.tagName.toLowerCase() === "span") node.style.fontSize = "";
      node.childNodes.forEach(stripFontSizes);
    };
    fragment.childNodes.forEach(stripFontSizes);
    const span = element.ownerDocument.createElement("span");
    span.style.fontSize = `${nextFontSize}px`;
    span.appendChild(fragment);
    range.insertNode(span);
    selectElementContents(span);
    pendingEditorFontSizeRef.current = null;
    recordEditorDocumentUndoChange(documentUndoHistoryRef.current, undoBefore, snapshotEditorElementForUndo(element), "format");
    scheduleCollaborativeDocumentSave(serializeEditorDocumentHTML(element));
    scheduleIndentGuideUpdate(readEditorDocumentText(element));
  }, [linkedEntityCanEdit, scheduleCollaborativeDocumentSave, scheduleIndentGuideUpdate]);

  const updateSelectionFontSize = useCallback((nextFontSize: number) => {
    setSelectionFontSize(clampEditorSelectionFontSize(nextFontSize));
  }, []);

  const applyEditorSelectionFontSize = useCallback((delta: number) => {
    const element = editorDocumentRef.current;
    const range = element ? getSelectionRangeInsideElement(element) : null;
    const currentFontSize = range?.collapsed && pendingEditorFontSizeRef.current !== null
      ? pendingEditorFontSizeRef.current
      : (range ? readRangeFontSize(range, selectionFontSize) : selectionFontSize);
    applyEditorSelectionFontSizeValue(currentFontSize + delta);
  }, [applyEditorSelectionFontSizeValue, selectionFontSize]);

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

  const applyLoadedDocument = useCallback((entityKind: LinkedEntityKind, entityID: string, informationID: string, text: string) => {
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    documentDraftRef.current = text;
    persistedDocumentRef.current = text;
    documentInformationIDRef.current = informationID;
    setDocumentInformationID(informationID);
    const targetKey = informationID ? documentTargetKey({ entityKind, entityID, informationID }) : `${entityKind}:${entityID}:`;
    currentDocumentTargetKeyRef.current = targetKey;
    persistedDocumentTargetKeyRef.current = targetKey;
    setSelectionFontSize(EDITOR_DOCUMENT_FONT_SIZE_PX);
    pendingEditorFontSizeRef.current = null;
    const element = editorDocumentRef.current;
    restoringScrollRef.current = true;
    const restoredScrollTop = scrollMemoryRef.current.read(targetKey) ?? 0;
    if (element) {
      const nextHTML = deserializeEditorDocumentHTML(text);
      if (element.innerHTML !== nextHTML) element.innerHTML = nextHTML;
      element.scrollTop = restoredScrollTop;
    }
    setDocumentScrollTop(restoredScrollTop);
    scheduleIndentGuideUpdate(element ? readEditorDocumentText(element) : text);
    restoreEditorDocumentScroll(targetKey);
    window.requestAnimationFrame(() => {
      restoringScrollRef.current = false;
    });
    if (activeTabRef.current === "editor" && shouldFocusEditorForSelectionRef.current) focusEditorDocumentWithoutScrollJump(targetKey);
  }, [focusEditorDocumentWithoutScrollJump, restoreEditorDocumentScroll, scheduleIndentGuideUpdate]);

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

  const clearVisibleDocumentForSelection = useCallback(() => {
    setLinkedEntityCanEdit(true);
    setLinkedNodeInfoPreview([]);
    setLinkedNodeMetadataRows([]);
    setLinkedNodeHistoryRows([]);
    setNodeWorkspaceProjections([]);
    setNodeStatus("");
    setNodeStatusColor("");
    setNodePriorityDraft("");
    setNodeDueDateDraft("");
    syncNodeAssignee("");
    documentDraftRef.current = "";
    persistedDocumentRef.current = "";
    documentInformationIDRef.current = "";
    currentDocumentTargetKeyRef.current = "";
    persistedDocumentTargetKeyRef.current = "";
    pendingSaveRef.current = null;
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    setDocumentInformationID("");
    pendingEditorFontSizeRef.current = null;
    setSelectionFontSize(EDITOR_DOCUMENT_FONT_SIZE_PX);
    restoringScrollRef.current = false;
    if (editorDocumentRef.current) {
      editorDocumentRef.current.innerHTML = "";
      editorDocumentRef.current.scrollTop = 0;
    }
    setDocumentScrollTop(0);
    scheduleIndentGuideUpdate("");
  }, [scheduleIndentGuideUpdate, syncNodeAssignee]);

  const applyLinkedNode = useCallback((nodeID: string, label = "", options: { focusEditor?: boolean } = {}) => {
    const shouldFocusEditor = options.focusEditor !== false;
    shouldFocusEditorForSelectionRef.current = shouldFocusEditor;
    const isSameEntity = linkedEntityKind === "node" && linkedNodeID === nodeID;
    if (!isSameEntity) {
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(editorDocumentRef.current ? serializeEditorDocumentHTML(editorDocumentRef.current) : documentDraftRef.current);
      clearVisibleDocumentForSelection();
    }
    setLinkedEntityKind(nodeID ? "node" : "");
    setLinkedNodeID(nodeID);
    setLinkedNodeTitle(nodeID ? (label || readNodeLabelFromGraph(nodeID)) : "");
    if (nodeID && !isSameEntity && shouldFocusEditor) {
      setActiveTab("editor");
      focusEditorDocumentWithoutScrollJump();
    }
  }, [clearVisibleDocumentForSelection, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, linkedEntityKind, linkedNodeID, readNodeLabelFromGraph, rememberCurrentDocumentScroll]);

  const applyLinkedLogicGate = useCallback((logicGateID: string, label = "", options: { focusEditor?: boolean } = {}) => {
    const shouldFocusEditor = options.focusEditor !== false;
    shouldFocusEditorForSelectionRef.current = shouldFocusEditor;
    const isSameEntity = linkedEntityKind === "logic_gate" && linkedNodeID === logicGateID;
    if (!isSameEntity) {
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(editorDocumentRef.current ? serializeEditorDocumentHTML(editorDocumentRef.current) : documentDraftRef.current);
      clearVisibleDocumentForSelection();
    }
    setLinkedEntityKind(logicGateID ? "logic_gate" : "");
    setLinkedNodeID(logicGateID);
    setLinkedNodeTitle(logicGateID ? (label || readLogicGateLabelFromGraph(logicGateID)) : "");
    if (logicGateID && !isSameEntity && shouldFocusEditor) {
      setActiveTab("editor");
      focusEditorDocumentWithoutScrollJump();
    }
  }, [clearVisibleDocumentForSelection, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, linkedEntityKind, linkedNodeID, readLogicGateLabelFromGraph, rememberCurrentDocumentScroll]);

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
        const updated = await requestJSON<LogicGateRecord>(`/v1/logic-gates/${linkedNodeID}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, header: value }),
        });
        setLinkedNodeTitle(updated.header);
        invalidateLogicGateRecordStoreCaches(apiBase, companyID, linkedNodeID);
        upsertLogicGateRelationshipGraphNode(apiBase, companyID, toLogicGateCanvasRecord(updated));
      } else {
        const updated = await requestJSON<NodeRecord>(`/v1/nodes/${linkedNodeID}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, title: value }),
        });
        setLinkedNodeTitle(updated.title);
        invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
        upsertNodeRelationshipGraphNode(apiBase, companyID, updated);
      }
      invalidateWorkspaceSnapshot(apiBase, companyID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_entity");
    }
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON]);

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
        items: [{
          client_id: clientID,
          title: titleByKind[kind],
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
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON]);

  const createNodeFromImageDocument = useCallback(async (input: { title: string; document: string }) => {
    if (!linkedEntityCanEdit) return;
    if (!companyID || linkedEntityKind !== "node") return;
    const title = input.title.trim() || "Image";
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
      items: [{
        client_id: clientID,
        title,
        x: position.x,
        y: position.y,
      }],
      requestJSON,
    });
    const node = response.nodes?.[0];
    if (!node) throw new Error("image_node_batch_create_missing_node");
    const informationID = generateStableInformationID();
    await requestJSON<unknown>(`/v1/nodes/${node.node_id}/information`, {
      method: "POST",
      body: JSON.stringify({
        company_id: companyID,
        type: EDITOR_TEXT_BLOCK_TYPE,
        information: buildEditorTextBlockContentPayload({ title: "Image", document }),
        information_id: informationID,
      }),
    });
    upsertNodeRelationshipGraphNode(apiBase, companyID, node);
    upsertNodeMapPositionsInNodeRelationshipGraph(apiBase, companyID, response.node_map_positions ?? [{ entity_id: node.node_id, node_id: node.node_id, x: position.x, y: position.y }]);
    primeNodeRecordStoreCaches(apiBase, companyID, [{ node, relationships: [] }]);
    invalidateNodeRecordStoreCaches(apiBase, companyID, node.node_id);
    invalidateWorkspaceSnapshot(apiBase, companyID);
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON]);

  const assignLinkedNodeToLogicGate = useCallback(async (logicGateID: string) => {
    if (!linkedEntityCanEdit) return;
    const cleanLogicGateID = logicGateID.trim();
    if (!companyID || !linkedNodeID || linkedEntityKind !== "node" || !cleanLogicGateID) return;
    const view = await getLogicGateArenaView(apiBase, companyID, cleanLogicGateID);
    const pendingColumn = (view.columns ?? []).find((column) => column.title.trim().toLowerCase() === "pending") ?? view.columns?.[0];
    if (!pendingColumn) throw new Error("logic_gate_pending_column_not_found");
    await upsertKanbanCard({
      apiBase,
      companyID,
      boardID: view.board.board_id,
      columnID: pendingColumn.column_id,
      nodeID: linkedNodeID,
      nodeTitle: linkedNodeTitle || linkedNodeID,
      position: nextCardPosition(view.cards ?? [], pendingColumn.column_id),
    });
    invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    const details = await getNodeRecordSingleFlight(apiBase, companyID, linkedNodeID);
    setNodeStatus(details.node.status ?? "");
    setNodeStatusColor(details.node.status_color ?? "");
    setNodePriorityDraft(details.node.priority == null ? "" : String(details.node.priority));
    setNodeDueDateDraft(formatNodeDueDateForEditor(details.node.due_date));
    setNodeLogicGateIDs(details.node.logic_gate_ids ?? []);
    syncNodeAssignee(details.node.assignee_user_id);
    upsertNodeRelationshipGraphNode(apiBase, companyID, details.node);
    invalidateWorkspaceSnapshot(apiBase, companyID);
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, linkedNodeTitle, syncNodeAssignee]);

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
      setNodeStatusColor(updated.status_color ?? "");
      setNodePriorityDraft(updated.priority == null ? "" : String(updated.priority));
      setNodeDueDateDraft(formatNodeDueDateForEditor(updated.due_date));
      syncNodeAssignee(updated.assignee_user_id);
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
      upsertNodeRelationshipGraphNode(apiBase, companyID, updated);
      invalidateWorkspaceSnapshot(apiBase, companyID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_node_fields");
    }
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON, syncNodeAssignee]);

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

  const commitNodeAssigneeDraft = useCallback((draft: string) => {
    const value = draft.trim();
    if (!value) {
      syncNodeAssignee("");
      void updateNodePresetPatch({ assignee_user_id: null });
      return;
    }
    const selectedUser = findCompanyUserByAssigneeDraft(companyUsers, value);
    if (selectedUser) {
      syncNodeAssignee(selectedUser.user_id);
      void updateNodePresetPatch({ assignee_user_id: selectedUser.user_id });
      return;
    }
    if (!USER_ID_PATTERN.test(value)) {
      setError("Select a person from the company user list");
      return;
    }
    syncNodeAssignee(value);
    void updateNodePresetPatch({ assignee_user_id: value });
  }, [companyUsers, syncNodeAssignee, updateNodePresetPatch]);

  const saveLogicGateRaciAssignments = useCallback(async (nextAssignments: LogicGateRaciAssignment[]) => {
    if (!linkedEntityCanEdit) return;
    if (!linkedNodeID || linkedEntityKind !== "logic_gate") return;
    setError("");
    try {
      const payload = await requestJSON<{ raci_assignments?: LogicGateRaciAssignment[] }>(`/v1/logic-gates/${linkedNodeID}/raci`, {
        method: "PUT",
        body: JSON.stringify({
          company_id: companyID,
          assignments: nextAssignments.map((assignment) => ({
            role: assignment.role,
            user_id: assignment.user_id,
          })),
        }),
      });
      setLogicGateRaciAssignments(payload.raci_assignments ?? []);
      invalidateLogicGateRecordStoreCaches(apiBase, companyID, linkedNodeID);
      invalidateWorkspaceSnapshot(apiBase, companyID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_logic_gate_raci");
    }
  }, [apiBase, companyID, linkedEntityCanEdit, linkedEntityKind, linkedNodeID, requestJSON]);

  const addLogicGateRaciUser = useCallback((role: LogicGateRaciRole, userID: string) => {
    const cleanUserID = userID.trim();
    if (!cleanUserID) return;
    if (logicGateRaciAssignments.some((assignment) => assignment.role === role && assignment.user_id === cleanUserID)) return;
    const user = companyUsers.find((candidate) => candidate.user_id === cleanUserID);
    void saveLogicGateRaciAssignments([
      ...logicGateRaciAssignments,
      {
        company_id: companyID,
        logic_gate_id: linkedNodeID,
        role,
        user_id: cleanUserID,
        user_display_name: user?.display_name,
        user_email: user?.email,
        created_timestamp: new Date().toISOString(),
      },
    ]);
  }, [companyID, companyUsers, linkedNodeID, logicGateRaciAssignments, saveLogicGateRaciAssignments]);

  const removeLogicGateRaciUser = useCallback((role: LogicGateRaciRole, userID: string) => {
    const cleanUserID = userID.trim();
    if (!cleanUserID) return;
    const next = logicGateRaciAssignments.filter((assignment) => !(assignment.role === role && assignment.user_id === cleanUserID));
    if (next.length === logicGateRaciAssignments.length) return;
    void saveLogicGateRaciAssignments(next);
  }, [logicGateRaciAssignments, saveLogicGateRaciAssignments]);

  useEffect(() => {
    setIsEditingTitle(false);
    editingTitleDraftRef.current = "";
  }, [linkedNodeID]);

  useEffect(() => {
    if (linkedEntityCanEdit) return;
    setIsEditingTitle(false);
    pendingEditorFontSizeRef.current = null;
    editorDocumentRef.current?.blur();
    window.getSelection()?.removeAllRanges();
  }, [linkedEntityCanEdit, linkedNodeID]);

  useEffect(() => {
    if (!isEditingTitle || !editingTitleRef.current) return;
    const element = editingTitleRef.current;
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const nextRange = document.createRange();
    nextRange.selectNodeContents(element);
    nextRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }, [isEditingTitle]);

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

  useEffect(() => {
    if (!companyID || !linkedNodeID || (linkedEntityKind !== "node" && linkedEntityKind !== "logic_gate")) {
      setCollaborators([]);
      return;
    }
    const currentTarget = { entityKind: linkedEntityKind, entityID: linkedNodeID };
    return subscribeWorkspaceStream(apiBase, companyID, {
      onEvent(event) {
        if (event.event !== "workspace") return;
        const payload = parseEditorCollaborationWorkspaceEvent(event.data);
        if (!payload || payload.clientID === collaborationClientIDRef.current) return;
        if (!sameEditorCollaborationTarget(payload, currentTarget)) return;

        if (payload.eventType === "leave") {
          setCollaborators((current) => current.filter((item) => item.clientID !== payload.clientID));
          return;
        }

        const seenAt = Date.now();
        setCollaborators((current) => {
          const remaining = current.filter((item) => item.clientID !== payload.clientID && seenAt - item.lastSeen < EDITOR_COLLABORATOR_TTL_MS);
          return [
            ...remaining,
            {
              clientID: payload.clientID,
              name: editorCollaborationLabel(payload.clientID, payload.clientName),
              color: editorCollaboratorColor(payload.clientID),
              lastSeen: seenAt,
            },
          ];
        });

        if (payload.eventType === "document_update") {
          applyOrDeferRemoteCollaborationUpdate(payload);
        }
      },
    });
  }, [apiBase, applyOrDeferRemoteCollaborationUpdate, companyID, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    if (!companyID || linkedEntityKind !== "node" || !linkedNodeID) return;
    let cancelled = false;
    let refreshToken = 0;
    const refreshNodeWorkspaceProjections = () => {
      const token = ++refreshToken;
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
      void Promise.all([
        getNodeInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
        getNodeContentChangesSingleFlight(apiBase, companyID, linkedNodeID),
      ]).then(([projections, contentChanges]) => {
        if (cancelled || token !== refreshToken) return;
        setNodeWorkspaceProjections(projections);
        setNodeWorkspaceLoadedNodeID(linkedNodeID);
        setNodeContentChanges(contentChanges);
        setNodeContentChangesLoadedNodeID(linkedNodeID);
      }).catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to refresh linked information");
      });
    };

    const unsubscribe = subscribeWorkspaceStream(apiBase, companyID, {
      onEvent(_event, context) {
        const envelope = context.envelope;
        if (envelope?.type !== "node_information_created") return;
        if (workspaceEventDataString(envelope.data, "node_id") !== linkedNodeID) return;
        refreshNodeWorkspaceProjections();
      },
      onReplayBoundary() {
        refreshNodeWorkspaceProjections();
      },
      onGap(gap) {
        if (gap.scopes.some((scope) => scope.kind === "workspace" || scope.nodeID === linkedNodeID)) {
          refreshNodeWorkspaceProjections();
        }
      },
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    const intervalID = window.setInterval(() => {
      const now = Date.now();
      setCollaborators((current) => current.filter((item) => now - item.lastSeen < EDITOR_COLLABORATOR_TTL_MS));
    }, 5_000);
    return () => window.clearInterval(intervalID);
  }, []);

  useEffect(() => () => {
    if (collaborationSendTimerRef.current !== null) window.clearTimeout(collaborationSendTimerRef.current);
    if (collaborationStatusTimerRef.current !== null) window.clearTimeout(collaborationStatusTimerRef.current);
    if (nodePriorityRequirementTimerRef.current !== null) window.clearTimeout(nodePriorityRequirementTimerRef.current);
    if (remoteCollaborationTimerRef.current !== null) window.clearTimeout(remoteCollaborationTimerRef.current);
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
    if (!linkedNodeID || linkedEntityKind !== "node") return;
    const syncTitleFromGraph = () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      const node = (snapshot.nodes ?? []).find((item) => item.node_id === linkedNodeID);
      if (!node) return;
      setLinkedEntityCanEdit(canEditResourceAccess(node));
      const nextTitle = getNodeTitle(node);
      setLinkedNodeTitle((current) => {
        if (current === nextTitle) return current;
        invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
        return nextTitle;
      });
      setNodeStatus(node.status ?? "");
      setNodeStatusColor(node.status_color ?? "");
      setNodePriorityDraft(node.priority == null ? "" : String(node.priority));
      setNodeDueDateDraft(formatNodeDueDateForEditor(node.due_date));
      syncNodeAssignee(node.assignee_user_id);
    };
    syncTitleFromGraph();
    return subscribeNodeRelationshipGraph(apiBase, companyID, syncTitleFromGraph);
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, syncNodeAssignee]);

  useEffect(() => {
    if (!linkedNodeID || linkedEntityKind !== "logic_gate") return;
    const syncTitleFromGraph = () => {
      const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      const logicGate = (snapshot.nodes ?? []).find((item) => item.node_id === linkedNodeID);
      if (!logicGate) return;
      setLinkedEntityCanEdit(canEditResourceAccess(logicGate));
      const nextTitle = getLogicGateTitle(logicGate);
      setLinkedNodeTitle((current) => {
        if (current === nextTitle) return current;
        invalidateLogicGateRecordStoreCaches(apiBase, companyID, linkedNodeID);
        return nextTitle;
      });
    };
    syncTitleFromGraph();
    return subscribeLogicGateRelationshipGraph(apiBase, companyID, syncTitleFromGraph);
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    let cancelled = false;
    if (!linkedNodeID) {
      setLinkedEntityCanEdit(true);
      setLinkedNodeTitle("");
      setLinkedNodeInfoPreview([]);
      setLinkedNodeMetadataRows([]);
      setLinkedNodeHistoryRows([]);
      setNodeLogicGateIDs([]);
      setNodeWorkspaceProjections([]);
      setNodeWorkspaceLoadedNodeID("");
      setNodeContentChanges([]);
      setNodeContentChangesLoadedNodeID("");
      setNodeStatus("");
      setNodeStatusColor("");
      setNodePriorityDraft("");
      setNodeDueDateDraft("");
      syncNodeAssignee("");
      setLogicGateRaciAssignments([]);
      documentDraftRef.current = "";
      persistedDocumentRef.current = "";
      documentInformationIDRef.current = "";
      currentDocumentTargetKeyRef.current = "";
      persistedDocumentTargetKeyRef.current = "";
      pendingSaveRef.current = null;
      resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
      setDocumentInformationID("");
      pendingEditorFontSizeRef.current = null;
      setSelectionFontSize(EDITOR_DOCUMENT_FONT_SIZE_PX);
      if (editorDocumentRef.current) {
        editorDocumentRef.current.innerHTML = "";
        editorDocumentRef.current.scrollTop = 0;
      }
      setDocumentScrollTop(0);
      scheduleIndentGuideUpdate("");
      return;
    }
    setNodeWorkspaceLoadedNodeID("");
    setNodeContentChanges([]);
    setNodeContentChangesLoadedNodeID("");
    setNodeLogicGateIDs([]);
    (async () => {
      try {
        setError("");
        if (linkedEntityKind === "logic_gate") {
          const [details, projections] = await Promise.all([
            getLogicGateRecordSingleFlight(apiBase, companyID, linkedNodeID),
            getLogicGateInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
          ]);
          if (cancelled) return;
          setLinkedEntityCanEdit(canEditResourceAccess(details));
          setLinkedNodeTitle(getLogicGateTitle({ header: details.logic_gate.header, title: details.logic_gate.header }));
          setNodeStatus("");
          setNodeStatusColor("");
          setNodePriorityDraft("");
          setNodeDueDateDraft("");
          setNodeLogicGateIDs([]);
          syncNodeAssignee("");
          setLogicGateRaciAssignments(details.logic_gate.raci_assignments ?? []);
          setNodeWorkspaceProjections([]);
          setNodeWorkspaceLoadedNodeID("");
          setNodeContentChanges([]);
          setNodeContentChangesLoadedNodeID("");
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
          const initialDocument = currentTextBox?.information ?? "";
          applyLoadedDocument("logic_gate", linkedNodeID, currentTextBox?.information_id ?? "", initialDocument);
          return;
        }
        const [details, projections, contentChanges] = await Promise.all([
          getNodeRecordSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeContentChangesSingleFlight(apiBase, companyID, linkedNodeID),
        ]);
        if (cancelled) return;
        setLinkedEntityCanEdit(canEditResourceAccess(details));
        setLinkedNodeTitle(getNodeTitle(details.node));
        setNodeStatus(details.node.status ?? "");
        setNodeStatusColor(details.node.status_color ?? "");
        setNodePriorityDraft(details.node.priority == null ? "" : String(details.node.priority));
        setNodeDueDateDraft(formatNodeDueDateForEditor(details.node.due_date));
        setNodeLogicGateIDs(details.node.logic_gate_ids ?? []);
        syncNodeAssignee(details.node.assignee_user_id);
        setLogicGateRaciAssignments([]);
        setNodeWorkspaceProjections(projections);
        setNodeWorkspaceLoadedNodeID(linkedNodeID);
        setNodeContentChanges(contentChanges);
        setNodeContentChangesLoadedNodeID(linkedNodeID);
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
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load linked information");
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, applyLoadedDocument, companyID, focusInformationID, focusRequestID, linkedEntityKind, linkedNodeID, scheduleIndentGuideUpdate, syncNodeAssignee]);

  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : "#ffffff";
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#111827";
  const tabBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.86)";
  const tabSelectedBackground = isDarkTheme ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.98)";
  const strokeColor = isDarkTheme ? "rgba(255,255,255,0.22)" : "rgba(15,23,42,0.22)";
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.14)";
  const panelBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255, 255, 255, 0.8)";
  const scrollbarAccent = theme === "light" ? "rgb(71, 85, 105)" : accent;
  const scrollbarTrack = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(100, 116, 139, 0.08)";
  const indentGuideColor = isDarkTheme ? "rgba(255,255,255,0.22)" : "rgba(15,23,42,0.2)";
  const editorPrimaryText = isDarkTheme ? surfaceText : "#111111";
  const documentIsolation = getEditorDocumentIsolationState(activeTab);
  const emptyMessage = forcedEntityKind && !hasLinkedDocument ? forcedEmptyMessage : "";
  const showIndentGuides = outlineStyle === "indent-guides" && indentGuideSegments.length > 0;
  const fullFrameTabActive = activeTab === "relationships" || activeTab === "permissions";
  const fallbackDocumentTopPx = fullFrameTabActive ? 46 : linkedEntityKind === "node" ? 150 : linkedEntityKind === "logic_gate" ? 188 : EDITOR_DOCUMENT_TOP_PX;
  const documentTopPx = hasLinkedDocument ? Math.max(fallbackDocumentTopPx, editorHeaderHeightPx + 16) : fallbackDocumentTopPx;
  const documentLineHeightPx = documentFontSize * EDITOR_DOCUMENT_LINE_HEIGHT;
  const documentBottomBufferPx = Math.round(documentLineHeightPx * EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES);
  const documentFontFamily = getEditorDocumentFontFamily(outlineStyle);
  const documentSurfaceHandlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef,
    scrollMemoryRef,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef,
    outlineStyle,
    setDocumentScrollTop,
    scheduleDocumentSave: scheduleCollaborativeDocumentSave,
    scheduleIndentGuideUpdate,
    rememberCurrentDocumentScroll,
    flushPendingDocumentSave,
    onSelectionFontSizeChange: updateSelectionFontSize,
    mentionUsers: companyUsers,
    mentionAccent: accent,
    mentionSurfaceText: surfaceText,
    mentionStrokeColor: strokeColor,
  });
  const { mentionMenu: documentMentionMenu, ...documentSurfaceEventHandlers } = documentSurfaceHandlers;
  const handleNodeWorkspaceProjectionMutation = useCallback(() => {
    if (linkedEntityKind !== "node" || !linkedNodeID) return;
    invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID]);
  const markNodeContentChangeSeen = useCallback((changeID: string) => {
    if (linkedEntityKind !== "node" || !linkedNodeID || !changeID.trim()) return;
    const removedChange = nodeContentChanges.find((change) => change.change_id === changeID);
    setNodeContentChanges((current) => current.filter((change) => change.change_id !== changeID));
    invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    void requestJSON<{ status: string }>(`/v1/nodes/${linkedNodeID}/changes/${changeID}/seen`, {
      method: "POST",
      body: JSON.stringify({ company_id: companyID }),
    }).catch((cause) => {
      if (removedChange) {
        setNodeContentChanges((current) => {
          if (current.some((change) => change.change_id === removedChange.change_id)) return current;
          return [...current, removedChange].sort((a, b) => a.created_timestamp.localeCompare(b.created_timestamp) || a.change_id.localeCompare(b.change_id));
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
  const visibleCollaborators = useMemo(() => {
    const now = Date.now();
    return collaborators.filter((item) => now - item.lastSeen < EDITOR_COLLABORATOR_TTL_MS);
  }, [collaborators]);

  return (
    <div
      ref={editorRootRef}
      data-frame-interactive="true"
      data-mango-linked-entity-kind={linkedEntityKind || undefined}
      data-mango-linked-entity-id={linkedNodeID || undefined}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ width: "100%", height: "100%", position: "relative", background: surfaceBackground, color: surfaceText, overflow: "hidden", userSelect: "text", cursor: "text" }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, cursor: "text" }}>
        {hasLinkedDocument && (
          <div ref={editorHeaderRef} style={{ position: "absolute", top: 4, left: 8, right: 12, display: "grid", gap: 8, zIndex: 5, pointerEvents: "none" }}>
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
            onOutlineStyleFocus={() => setActiveTab("outline-styles")}
            onOutlineStyleChange={(nextOutlineStyle) => {
              setOutlineStyle(nextOutlineStyle);
              setActiveTab("outline-styles");
            }}
            onCreateRelatedNode={linkedEntityKind === "node" && linkedEntityCanEdit ? createRelatedNode : undefined}
            reserveHeaderOffset={!forcedEntityKind}
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
            nodePresetFields={linkedEntityKind === "node" ? {
              status: nodeStatus || "",
              statusColor: nodeStatusColor || "",
              priorityDraft: nodePriorityDraft,
              priorityRequirementError: nodePriorityRequirementError,
              assigneeDraft: nodeAssigneeDraft,
              dueDateDraft: nodeDueDateDraft,
            } : null}
            logicGateRaciFields={linkedEntityKind === "logic_gate" ? {
              assignments: logicGateRaciAssignments,
            } : null}
            companyUsers={companyUsers}
            isEditingTitle={isEditingTitle}
            editingTitleRef={editingTitleRef}
            editingTitleDraftRef={editingTitleDraftRef}
            accent={accent}
            titleTextColor={editorPrimaryText}
            panelBackground={panelBackground}
            ruleColor={ruleColor}
            onSetIsEditingTitle={setIsEditingTitle}
            onUpdateTitle={updateNodeTitle}
            onSetNodePriorityDraft={setNodePriorityDraft}
            onCommitNodePriorityDraft={commitNodePriorityDraft}
            onSetNodeAssigneeDraft={setNodeAssigneeDraft}
            onCommitNodeAssigneeDraft={commitNodeAssigneeDraft}
            onSetNodeDueDateDraft={setNodeDueDateDraft}
            onCommitNodeDueDateDraft={commitNodeDueDateDraft}
            onAddLogicGateRaciUser={addLogicGateRaciUser}
            onRemoveLogicGateRaciUser={removeLogicGateRaciUser}
          />

          </div>
        )}

        {hasLinkedDocument && (visibleCollaborators.length > 0 || collaborationStatus) && (
          <div style={{ position: "absolute", top: 42, right: 12, zIndex: 6, display: "flex", alignItems: "center", gap: 6, maxWidth: "58%", pointerEvents: "none", justifyContent: "flex-end", flexWrap: "wrap" }}>
            {collaborationStatus && (
              <div style={{ border: `1px solid ${strokeColor}`, background: tabSelectedBackground, color: surfaceText, borderRadius: 6, padding: "4px 7px", fontSize: 10, fontWeight: 700, boxShadow: "0 6px 18px rgba(0,0,0,0.08)" }}>
                {collaborationStatus}
              </div>
            )}
            {visibleCollaborators.map((collaborator) => (
              <div
                key={collaborator.clientID}
                title={collaborator.name}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, maxWidth: 150, border: `1px solid ${strokeColor}`, background: tabSelectedBackground, color: surfaceText, borderRadius: 6, padding: "3px 7px 3px 4px", fontSize: 10, fontWeight: 800, boxShadow: "0 6px 18px rgba(0,0,0,0.08)" }}
              >
                <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 999, background: collaborator.color, flex: "0 0 auto" }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{collaborator.name}</span>
              </div>
            ))}
          </div>
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
            theme={theme}
          />
        )}
        {hasLinkedDocument && (linkedEntityKind === "node" || linkedEntityKind === "logic_gate") && activeTab === "permissions" && (
          <div style={{ position: "absolute", top: documentTopPx, left: 12, right: 12, bottom: 12, zIndex: 2, pointerEvents: "auto", minHeight: 0 }}>
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
        {hasLinkedDocument && linkedEntityKind === "node" && activeTab !== "relationships" && activeTab !== "permissions" && (
          <NodeWorkspaceSurface
            apiBase={apiBase}
            companyID={companyID}
            nodeID={linkedNodeID}
            canEdit={linkedEntityCanEdit}
            nodePriorityDraft={nodePriorityDraft}
            assignedLogicGateIDs={nodeLogicGateIDs}
            projections={nodeWorkspaceProjections}
            unseenChanges={nodeContentChangesLoadedNodeID === linkedNodeID ? nodeContentChanges : []}
            companyUsers={companyUsers}
            projectionsLoaded={nodeWorkspaceLoadedNodeID === linkedNodeID}
            focusInformationID={focusInformationID}
            focusRequestID={focusRequestID}
            topPx={documentTopPx}
            accent={accent}
            surfaceText={surfaceText}
            panelBackground={panelBackground}
            strokeColor={strokeColor}
            ruleColor={ruleColor}
            scrollbarAccent={scrollbarAccent}
            scrollbarTrack={scrollbarTrack}
            outlineStyle={outlineStyle}
            requestJSON={requestJSON}
            onProjectionMutation={handleNodeWorkspaceProjectionMutation}
            onMarkChangeSeen={markNodeContentChangeSeen}
            onMarkAllChangesSeen={markAllNodeContentChangesSeen}
            onCreateNodeFromImage={createNodeFromImageDocument}
            onAssignToLogicGate={assignLinkedNodeToLogicGate}
            onRequireNodePriorityForLogicGateAssignment={showNodePriorityRequirementError}
            onError={setError}
          />
        )}
        {hasLinkedDocument && linkedEntityKind !== "node" && (
          <EditorDocumentSurface
            documentRef={editorDocumentRef}
            documentIsolation={documentIsolation}
            editable={linkedEntityCanEdit}
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
        {linkedEntityCanEdit && documentMentionMenu}
        {emptyMessage && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 28, textAlign: "center", fontSize: 13, fontWeight: 700, color: surfaceText, opacity: 0.72 }}>
            {emptyMessage}
          </div>
        )}
        {error && <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "#b00020", zIndex: 3 }}>{error}</div>}
      </div>
    </div>
  );
};
