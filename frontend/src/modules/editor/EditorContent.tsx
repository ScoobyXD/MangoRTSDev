import React, { useCallback, useEffect, useRef, useState } from "react";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, type NodeRecord } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, getNodeTitle as getLogicGateTitle, toLogicGateCanvasRecord, type LogicGateInformation, type LogicGateRecord } from "../logic-gate-map/shared";
import { EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { getNodeRecordSingleFlight, getNodeInformationProjectionSingleFlight, invalidateNodeRecordStoreCaches } from "../node-map/NodeRecordStore";
import { getNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { getLogicGateRecordSingleFlight, getLogicGateInformationProjectionSingleFlight, invalidateLogicGateRecordStoreCaches } from "../logic-gate-map/LogicGateRecordStore";
import { getLogicGateRelationshipGraphSnapshot, subscribeLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import type { NodeInformation } from "../node-map/shared";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange } from "../selectionCoordinator";
import { EDITOR_TAB_ITEMS, getEditorDocumentIsolationState, type EditorTabID } from "./editorTabs";
import { classifyEditorInputType, createEditorUndoHistory, recordEditorUndoChange, redoEditorText, resetEditorUndoHistory, snapshotEditorText, snapshotEditorTextArea, undoEditorText, type EditorTextChangeKind, type EditorTextSnapshot } from "./editorUndoHistory";
import { DEFAULT_EDITOR_OUTLINE_STYLE, EDITOR_TAB_TEXT, insertEditorEnterText, insertEditorTabText, isEditorOutlineStyleID, type EditorOutlineStyleID } from "./plainTextEditing";
import { createEditorScrollMemory } from "./editorScroll";
import { buildEditorIndentGuideSegments, type EditorIndentGuideSegment } from "./editorIndentGuides";

type LinkedEntityKind = "node" | "logic_gate";

type DocumentSaveTarget = {
  entityKind: LinkedEntityKind;
  entityID: string;
  informationID: string;
};

type DocumentSaveRequest = {
  target: DocumentSaveTarget;
  text: string;
};

type LinkedSelection = {
  id: string;
  label: string;
};

const EDITOR_AUTOSAVE_DELAY_MS = 550;

function documentTargetKey(target: DocumentSaveTarget): string {
  return `${target.entityKind}:${target.entityID}:${target.informationID}`;
}

function sameSaveRequest(a: DocumentSaveRequest | null, b: DocumentSaveRequest | null): boolean {
  if (!a || !b) return false;
  return documentTargetKey(a.target) === documentTargetKey(b.target) && a.text === b.text;
}

function generateStableInformationID(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0").slice(0, 12)}`;
}

function readStoredOutlineStyle(storageKey: string): EditorOutlineStyleID {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(storageKey);
    return raw && isEditorOutlineStyleID(raw) ? raw : DEFAULT_EDITOR_OUTLINE_STYLE;
  } catch {
    return DEFAULT_EDITOR_OUTLINE_STYLE;
  }
}

const EDITOR_OUTLINE_STYLE_ITEMS: ReadonlyArray<{ id: EditorOutlineStyleID; label: string }> = [
  { id: "automatic-outline-numbering", label: "Automatic Numbering" },
  { id: "indent-guides", label: "Indent Guides" },
];
const EDITOR_DOCUMENT_FONT_SIZE_PX = 15;
const EDITOR_DOCUMENT_LINE_HEIGHT = 1.55;
const EDITOR_DOCUMENT_LINE_HEIGHT_PX = EDITOR_DOCUMENT_FONT_SIZE_PX * EDITOR_DOCUMENT_LINE_HEIGHT;

function shouldReadStoredSelectionForEvent(hasGap: boolean, hasEventSelection: boolean): boolean {
  return hasGap && !hasEventSelection;
}

// Editor module: linked document canvas for node or logic-gate context.
export const EditorContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, theme = "teal" }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";
  const outlineStyleStorageKey = `editor-outline-style-v1:${companyID}:${scope}`;
  const [linkedMapWidgetID, setLinkedMapWidgetID] = useState("");
  const [linkedLogicMapWidgetID, setLinkedLogicMapWidgetID] = useState("");
  const [linkedEntityKind, setLinkedEntityKind] = useState<"" | "node" | "logic_gate">("");
  const [linkedNodeID, setLinkedNodeID] = useState("");
  const [linkedNodeTitle, setLinkedNodeTitle] = useState("");
  const [linkedNodeInfoPreview, setLinkedNodeInfoPreview] = useState<string[]>([]);
  const [linkedNodeMetadataRows, setLinkedNodeMetadataRows] = useState<Array<{ label: string; value: string }>>([]);
  const [linkedNodeHistoryRows, setLinkedNodeHistoryRows] = useState<string[]>([]);
  const [documentInformationID, setDocumentInformationID] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<EditorTabID>("editor");
  const [outlineStyle, setOutlineStyle] = useState<EditorOutlineStyleID>(() => readStoredOutlineStyle(outlineStyleStorageKey));
  const [documentScrollTop, setDocumentScrollTop] = useState(0);
  const [indentGuideSegments, setIndentGuideSegments] = useState<EditorIndentGuideSegment[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const editingTitleRef = useRef<HTMLSpanElement | null>(null);
  const editingTitleDraftRef = useRef("");
  const editorTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeTabRef = useRef<EditorTabID>("editor");
  const restoringScrollRef = useRef(false);
  const scrollMemoryRef = useRef(createEditorScrollMemory());
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
  const lastSelectionRevisionRef = useRef(0);
  const lastLogicGateSelectionRevisionRef = useRef(0);
  const editorUndoHistoryRef = useRef(createEditorUndoHistory());
  const lastEditorTextSnapshotRef = useRef<EditorTextSnapshot>(snapshotEditorText("", 0, 0));
  const pendingEditorInputKindRef = useRef<EditorTextChangeKind>("unknown");

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    try {
      localStorage.setItem(outlineStyleStorageKey, outlineStyle);
    } catch {
      // Local persistence is a convenience only. The document API stays usable
      // for headless agents even if browser storage is blocked.
    }
  }, [outlineStyle, outlineStyleStorageKey]);

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
    // browser's native textarea path. The helper is pure, so API/headless edit
    // commands can share the same indentation contract later.
    indentGuideFrameRef.current = window.requestAnimationFrame(() => {
      indentGuideFrameRef.current = null;
      setIndentGuideSegments(buildEditorIndentGuideSegments(text, EDITOR_TAB_TEXT.length));
    });
  }, [outlineStyle]);

  useEffect(() => {
    scheduleIndentGuideUpdate(editorTextAreaRef.current?.value ?? documentDraftRef.current);
    return () => {
      if (indentGuideFrameRef.current !== null) {
        window.cancelAnimationFrame(indentGuideFrameRef.current);
        indentGuideFrameRef.current = null;
      }
    };
  }, [outlineStyle, scheduleIndentGuideUpdate]);

  const rememberCurrentDocumentScroll = useCallback(() => {
    const targetKey = currentDocumentTargetKeyRef.current;
    const element = editorTextAreaRef.current;
    if (!targetKey || !element) return;
    scrollMemoryRef.current.remember(targetKey, element.scrollTop);
  }, []);

  const restoreEditorDocumentScroll = useCallback((targetKey: string) => {
    window.requestAnimationFrame(() => {
      const element = editorTextAreaRef.current;
      if (!element || currentDocumentTargetKeyRef.current !== targetKey) return;
      const nextScrollTop = scrollMemoryRef.current.read(targetKey) ?? 0;
      element.scrollTop = nextScrollTop;
      setDocumentScrollTop(nextScrollTop);
    });
  }, []);

  const focusEditorDocumentWithoutScrollJump = useCallback((targetKey = currentDocumentTargetKeyRef.current) => {
    window.requestAnimationFrame(() => {
      const element = editorTextAreaRef.current;
      if (!element) return;
      element.focus({ preventScroll: true });
      if (targetKey && currentDocumentTargetKeyRef.current === targetKey) {
        const nextScrollTop = scrollMemoryRef.current.read(targetKey) ?? element.scrollTop;
        element.scrollTop = nextScrollTop;
        setDocumentScrollTop(nextScrollTop);
      }
    });
  }, []);

  const requestJSON = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [apiBase]);

  const invalidateDocumentTargetCaches = useCallback((target: DocumentSaveTarget) => {
    if (target.entityKind === "logic_gate") invalidateLogicGateRecordStoreCaches(apiBase, companyID, target.entityID);
    else invalidateNodeRecordStoreCaches(apiBase, companyID, target.entityID);
  }, [apiBase, companyID]);

  const ensureDocumentInformationID = useCallback(() => {
    if (!documentInformationIDRef.current) {
      documentInformationIDRef.current = generateStableInformationID();
      setDocumentInformationID(documentInformationIDRef.current);
    }
    return documentInformationIDRef.current;
  }, []);

  const buildDocumentSaveRequest = useCallback((nextText: string): DocumentSaveRequest | null => {
    if (!linkedNodeID || (linkedEntityKind !== "node" && linkedEntityKind !== "logic_gate")) return null;
    if (!documentInformationIDRef.current && nextText.trim().length === 0) return null;
    const target = {
      entityKind: linkedEntityKind,
      entityID: linkedNodeID,
      informationID: ensureDocumentInformationID(),
    };
    currentDocumentTargetKeyRef.current = documentTargetKey(target);
    return { target, text: nextText };
  }, [ensureDocumentInformationID, linkedEntityKind, linkedNodeID]);

  const persistDocumentRequest = useCallback(async (request: DocumentSaveRequest) => {
    const targetKey = documentTargetKey(request.target);
    const isCurrentTarget = () => currentDocumentTargetKeyRef.current === targetKey;
    if (isCurrentTarget() && request.text === persistedDocumentRef.current && persistedDocumentTargetKeyRef.current === targetKey) return;

    setError("");
    try {
      if (request.text.trim().length === 0) {
        const path = request.target.entityKind === "logic_gate"
          ? `/v1/logic-gates/${request.target.entityID}/projection/${request.target.informationID}?company_id=${encodeURIComponent(companyID)}`
          : `/v1/nodes/${request.target.entityID}/projection/${request.target.informationID}?company_id=${encodeURIComponent(companyID)}`;
        await requestJSON<{ status: string }>(path, { method: "DELETE" });
        if (isCurrentTarget()) {
          persistedDocumentRef.current = "";
          persistedDocumentTargetKeyRef.current = targetKey;
        }
        invalidateDocumentTargetCaches(request.target);
        return;
      }

      const informationPayload = {
        company_id: companyID,
        type: "Text box",
        information: request.text,
        information_id: request.target.informationID,
      };
      if (request.target.entityKind === "logic_gate") {
        await requestJSON<LogicGateInformation>(`/v1/logic-gates/${request.target.entityID}/information`, {
          method: "POST",
          body: JSON.stringify(informationPayload),
        });
      } else {
        await requestJSON<NodeInformation>(`/v1/nodes/${request.target.entityID}/information`, {
          method: "POST",
          body: JSON.stringify(informationPayload),
        });
      }
      if (isCurrentTarget()) {
        setDocumentInformationID(request.target.informationID);
        persistedDocumentRef.current = request.text;
        persistedDocumentTargetKeyRef.current = targetKey;
      }
      invalidateDocumentTargetCaches(request.target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_save_document");
    }
  }, [companyID, invalidateDocumentTargetCaches, requestJSON]);

  const enqueueDocumentSave = useCallback((request: DocumentSaveRequest) => {
    if (saveInFlightRef.current) {
      queuedSaveRef.current = request;
      return;
    }

    // Autosaves must preserve the user's final text without POSTing every
    // keystroke. One request runs at a time; while it is running, we keep only
    // the newest queued value for this editor instance.
    saveInFlightRef.current = true;
    void (async () => {
      let nextRequest: DocumentSaveRequest | null = request;
      try {
        while (nextRequest) {
          const activeRequest: DocumentSaveRequest = nextRequest;
          queuedSaveRef.current = null;
          await persistDocumentRequest(activeRequest);
          const queued = queuedSaveRef.current;
          nextRequest = queued && !sameSaveRequest(queued, activeRequest) ? queued : null;
        }
      } finally {
        saveInFlightRef.current = false;
      }
    })();
  }, [persistDocumentRequest]);

  const scheduleDocumentSave = useCallback((nextText: string, immediate = false) => {
    documentDraftRef.current = nextText;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    const request = buildDocumentSaveRequest(nextText);
    pendingSaveRef.current = request;
    if (!request) return;

    if (immediate) {
      pendingSaveRef.current = null;
      enqueueDocumentSave(request);
      return;
    }

    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) enqueueDocumentSave(pending);
    }, EDITOR_AUTOSAVE_DELAY_MS);
  }, [buildDocumentSaveRequest, enqueueDocumentSave]);

  const flushPendingDocumentSave = useCallback((fallbackText?: string) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current ?? (typeof fallbackText === "string" ? buildDocumentSaveRequest(fallbackText) : null);
    pendingSaveRef.current = null;
    if (pending) enqueueDocumentSave(pending);
  }, [buildDocumentSaveRequest, enqueueDocumentSave]);

  const resetEditorTextUndo = useCallback((text: string, selectionStart = text.length, selectionEnd = selectionStart) => {
    resetEditorUndoHistory(editorUndoHistoryRef.current);
    lastEditorTextSnapshotRef.current = snapshotEditorText(text, selectionStart, selectionEnd);
    pendingEditorInputKindRef.current = "unknown";
  }, []);

  const syncEditorTextSelectionSnapshot = useCallback((element: HTMLTextAreaElement) => {
    const snapshot = lastEditorTextSnapshotRef.current;
    if (snapshot.value === element.value) lastEditorTextSnapshotRef.current = snapshotEditorTextArea(element);
  }, []);

  const recordEditorTextChange = useCallback((element: HTMLTextAreaElement, kindOverride?: EditorTextChangeKind) => {
    const after = snapshotEditorTextArea(element);
    recordEditorUndoChange(
      editorUndoHistoryRef.current,
      lastEditorTextSnapshotRef.current,
      after,
      kindOverride ?? pendingEditorInputKindRef.current,
    );
    lastEditorTextSnapshotRef.current = after;
    pendingEditorInputKindRef.current = "unknown";
    return after;
  }, []);

  const applyDocumentTextToEditor = useCallback((nextText: string) => {
    if (editorTextAreaRef.current) editorTextAreaRef.current.value = nextText;
    scheduleDocumentSave(nextText);
    scheduleIndentGuideUpdate(nextText);
  }, [scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const applyEditorUndoSnapshot = useCallback((element: HTMLTextAreaElement, snapshot: EditorTextSnapshot) => {
    element.value = snapshot.value;
    element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    lastEditorTextSnapshotRef.current = snapshot;
    pendingEditorInputKindRef.current = "unknown";
    scheduleDocumentSave(snapshot.value);
    scheduleIndentGuideUpdate(snapshot.value);
  }, [scheduleDocumentSave, scheduleIndentGuideUpdate]);

  const selectTab = useCallback((tab: EditorTabID) => {
    rememberCurrentDocumentScroll();
    if (tab === activeTab) return;
    if (activeTab === "editor" && tab !== "editor" && editorTextAreaRef.current) {
      flushPendingDocumentSave(editorTextAreaRef.current.value);
      editorTextAreaRef.current.blur();
    }
    setActiveTab(tab);
    if (tab === "editor") focusEditorDocumentWithoutScrollJump();
  }, [activeTab, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, rememberCurrentDocumentScroll]);

  useEffect(() => {
    return () => {
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(documentDraftRef.current);
    };
  }, [flushPendingDocumentSave, linkedEntityKind, linkedNodeID, rememberCurrentDocumentScroll]);

  const applyLoadedDocument = useCallback((entityKind: LinkedEntityKind, entityID: string, informationID: string, text: string) => {
    documentDraftRef.current = text;
    persistedDocumentRef.current = text;
    documentInformationIDRef.current = informationID;
    setDocumentInformationID(informationID);
    const targetKey = informationID ? documentTargetKey({ entityKind, entityID, informationID }) : `${entityKind}:${entityID}:`;
    currentDocumentTargetKeyRef.current = targetKey;
    persistedDocumentTargetKeyRef.current = targetKey;
    const element = editorTextAreaRef.current;
    restoringScrollRef.current = true;
    const restoredScrollTop = scrollMemoryRef.current.read(targetKey) ?? 0;
    if (element) {
      if (element.value !== text) element.value = text;
      resetEditorTextUndo(text, element.selectionStart, element.selectionEnd);
      element.scrollTop = restoredScrollTop;
    } else {
      resetEditorTextUndo(text);
    }
    setDocumentScrollTop(restoredScrollTop);
    scheduleIndentGuideUpdate(text);
    restoreEditorDocumentScroll(targetKey);
    window.requestAnimationFrame(() => {
      restoringScrollRef.current = false;
    });
    if (activeTabRef.current === "editor") focusEditorDocumentWithoutScrollJump(targetKey);
  }, [focusEditorDocumentWithoutScrollJump, resetEditorTextUndo, restoreEditorDocumentScroll, scheduleIndentGuideUpdate]);

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
      const parsed = JSON.parse(raw) as { selectedNodeID?: string; selectedLabel?: string };
      return {
        id: typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "",
        label: typeof parsed.selectedLabel === "string" ? parsed.selectedLabel : "",
      };
    } catch {
      return { id: "", label: "" };
    }
  }, [companyID, scope]);

  const readSelectedLogicGateFromExplorerContext = useCallback((): LinkedSelection => {
    try {
      const raw = localStorage.getItem(`${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
      if (!raw) return { id: "", label: "" };
      const parsed = JSON.parse(raw) as { selectedLogicGateID?: string; selectedNodeID?: string; selectedLabel?: string };
      return {
        id: typeof parsed.selectedLogicGateID === "string" ? parsed.selectedLogicGateID : (typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : ""),
        label: typeof parsed.selectedLabel === "string" ? parsed.selectedLabel : "",
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
    setLinkedNodeInfoPreview([]);
    setLinkedNodeMetadataRows([]);
    setLinkedNodeHistoryRows([]);
    documentDraftRef.current = "";
    persistedDocumentRef.current = "";
    documentInformationIDRef.current = "";
    currentDocumentTargetKeyRef.current = "";
    persistedDocumentTargetKeyRef.current = "";
    pendingSaveRef.current = null;
    setDocumentInformationID("");
    resetEditorTextUndo("", 0, 0);
    restoringScrollRef.current = false;
    if (editorTextAreaRef.current) {
      editorTextAreaRef.current.value = "";
      editorTextAreaRef.current.scrollTop = 0;
      editorTextAreaRef.current.setSelectionRange(0, 0);
    }
    setDocumentScrollTop(0);
    scheduleIndentGuideUpdate("");
  }, [resetEditorTextUndo, scheduleIndentGuideUpdate]);

  const applyLinkedNode = useCallback((nodeID: string, label = "") => {
    const isSameEntity = linkedEntityKind === "node" && linkedNodeID === nodeID;
    if (!isSameEntity) {
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(editorTextAreaRef.current?.value ?? documentDraftRef.current);
      clearVisibleDocumentForSelection();
    }
    setLinkedEntityKind(nodeID ? "node" : "");
    setLinkedNodeID(nodeID);
    setLinkedNodeTitle(nodeID ? (label || readNodeLabelFromGraph(nodeID)) : "");
    if (nodeID && !isSameEntity) {
      setActiveTab("editor");
      focusEditorDocumentWithoutScrollJump();
    }
  }, [clearVisibleDocumentForSelection, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, linkedEntityKind, linkedNodeID, readNodeLabelFromGraph, rememberCurrentDocumentScroll]);

  const applyLinkedLogicGate = useCallback((logicGateID: string, label = "") => {
    const isSameEntity = linkedEntityKind === "logic_gate" && linkedNodeID === logicGateID;
    if (!isSameEntity) {
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(editorTextAreaRef.current?.value ?? documentDraftRef.current);
      clearVisibleDocumentForSelection();
    }
    setLinkedEntityKind(logicGateID ? "logic_gate" : "");
    setLinkedNodeID(logicGateID);
    setLinkedNodeTitle(logicGateID ? (label || readLogicGateLabelFromGraph(logicGateID)) : "");
    if (logicGateID && !isSameEntity) {
      setActiveTab("editor");
      focusEditorDocumentWithoutScrollJump();
    }
  }, [clearVisibleDocumentForSelection, flushPendingDocumentSave, focusEditorDocumentWithoutScrollJump, linkedEntityKind, linkedNodeID, readLogicGateLabelFromGraph, rememberCurrentDocumentScroll]);

  const updateNodeTitle = useCallback(async (nextTitle: string) => {
    const value = nextTitle.trim();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_entity");
    }
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, requestJSON]);

  useEffect(() => {
    setIsEditingTitle(false);
    editingTitleDraftRef.current = "";
  }, [linkedNodeID]);

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
    const refresh = () => {
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
      const selectedFromExplorer = readSelectedNodeFromExplorerContext();
      if (selectedFromExplorer.id) {
        applyLinkedNode(selectedFromExplorer.id, selectedFromExplorer.label);
        return;
      }
      const selectedLogicFromExplorer = readSelectedLogicGateFromExplorerContext();
      if (selectedLogicFromExplorer.id) {
        applyLinkedLogicGate(selectedLogicFromExplorer.id, selectedLogicFromExplorer.label);
        return;
      }
      applyLinkedNode("");
    };
    // Initial restore only. Same-tab clicks use SelectionCoordinator payloads
    // below so the editor does not open a stale peer localStorage snapshot.
    refresh();
    const applyLiveSelection = (selection: LiveSelectionChange) => {
      if (selection.companyID !== companyID || selection.sourceFrameID === scope) return;
      if (selection.entityKind === "node") {
        applyLinkedNode(selection.entityID, selection.label);
        return;
      }
      if (selection.entityKind === "logic_gate") {
        applyLinkedLogicGate(selection.entityID, selection.label);
        return;
      }
      applyLinkedNode("");
    };
    const liveSelection = readLiveSelectionForFrame(companyID, scope);
    if (liveSelection) applyLiveSelection(liveSelection);
    const onMapStateUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; revision?: number; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapWidgetID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastSelectionRevisionRef.current, revision)) return;
      const eventSelectedNodeID = typeof detail.selectedNodeID === "string" ? detail.selectedNodeID : null;
      const eventHasSelection = eventSelectedNodeID !== null;
      if (revision > 0 && shouldReadStoredSelectionForEvent(hasSequenceGap(lastSelectionRevisionRef.current, revision), eventHasSelection)) refresh();
      if (revision > 0) lastSelectionRevisionRef.current = revision;
      if (eventSelectedNodeID !== null) {
        applyLinkedNode(eventSelectedNodeID);
        return;
      }
      refresh();
    };
    const onLogicMapStateUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; selectedLogicGateID?: string; revision?: number; envelope?: ContextMutationEnvelope }>).detail;
      const logicContextFrameID = linkedLogicMapWidgetID || linkedMapWidgetID;
      if (!detail || detail.mapWidgetID !== logicContextFrameID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastLogicGateSelectionRevisionRef.current, revision)) return;
      const eventSelectedLogicGateID = typeof detail.selectedLogicGateID === "string"
        ? detail.selectedLogicGateID
        : (typeof detail.selectedNodeID === "string" ? detail.selectedNodeID : null);
      const eventHasSelection = eventSelectedLogicGateID !== null;
      if (revision > 0 && shouldReadStoredSelectionForEvent(hasSequenceGap(lastLogicGateSelectionRevisionRef.current, revision), eventHasSelection)) refresh();
      if (revision > 0) lastLogicGateSelectionRevisionRef.current = revision;
      if (eventSelectedLogicGateID !== null) {
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
  }, [applyLinkedLogicGate, applyLinkedNode, companyID, linkedLogicMapWidgetID, linkedMapWidgetID, readSelectedLogicGateFromExplorerContext, readSelectedLogicGateFromMap, readSelectedNodeFromExplorerContext, readSelectedNodeFromMap, scope]);

  useEffect(() => {
    if (!linkedNodeID || linkedEntityKind !== "node") return;
    const syncTitleFromGraph = () => {
      const snapshot = getNodeRelationshipGraphSnapshot(apiBase, companyID);
      const node = (snapshot.nodes ?? []).find((item) => item.node_id === linkedNodeID);
      if (!node) return;
      const nextTitle = getNodeTitle(node);
      setLinkedNodeTitle((current) => {
        if (current === nextTitle) return current;
        invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
        return nextTitle;
      });
    };
    syncTitleFromGraph();
    return subscribeNodeRelationshipGraph(apiBase, companyID, syncTitleFromGraph);
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID]);

  useEffect(() => {
    if (!linkedNodeID || linkedEntityKind !== "logic_gate") return;
    const syncTitleFromGraph = () => {
      const snapshot = getLogicGateRelationshipGraphSnapshot(apiBase, companyID);
      const logicGate = (snapshot.nodes ?? []).find((item) => item.node_id === linkedNodeID);
      if (!logicGate) return;
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
      setLinkedNodeTitle("");
      setLinkedNodeInfoPreview([]);
      setLinkedNodeMetadataRows([]);
      setLinkedNodeHistoryRows([]);
      documentDraftRef.current = "";
      persistedDocumentRef.current = "";
      documentInformationIDRef.current = "";
      currentDocumentTargetKeyRef.current = "";
      persistedDocumentTargetKeyRef.current = "";
      pendingSaveRef.current = null;
      setDocumentInformationID("");
      resetEditorTextUndo("", 0, 0);
      if (editorTextAreaRef.current) {
        editorTextAreaRef.current.value = "";
        editorTextAreaRef.current.scrollTop = 0;
      }
      setDocumentScrollTop(0);
      scheduleIndentGuideUpdate("");
      return;
    }
    (async () => {
      try {
        setError("");
        if (linkedEntityKind === "logic_gate") {
          const [details, projections] = await Promise.all([
            getLogicGateRecordSingleFlight(apiBase, companyID, linkedNodeID),
            getLogicGateInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
          ]);
          if (cancelled) return;
          setLinkedNodeTitle(getLogicGateTitle({ header: details.logic_gate.header, title: details.logic_gate.header }));
          const nonText = details.information.filter((item) => item.type !== "Text box");
          const textBoxes = projections.filter((item) => item.type === "Text box");
          const nonBlankTextBoxes = textBoxes.filter((item) => item.information.trim().length > 0);
          setLinkedNodeInfoPreview(nonText.slice(0, 2).map((item) => `${item.type}: ${item.information}`));
          setLinkedNodeMetadataRows([
            { label: "Logic Gate ID", value: details.logic_gate.logic_gate_id },
            { label: "Created", value: details.logic_gate.created_timestamp },
            { label: "Relationships", value: String(details.relationships.length) },
            { label: "Information records", value: String(details.information.length) },
            { label: "Text boxes", value: String(projections.length) },
          ]);
          const historyRows = [
            details.logic_gate.created_timestamp ? `Logic gate created at ${details.logic_gate.created_timestamp}` : "Logic gate created",
            ...details.information.slice(-4).map((item) => `${item.type} updated at ${item.updated_timestamp}`),
          ];
          setLinkedNodeHistoryRows(historyRows);
          const first = nonBlankTextBoxes[0] ?? projections[0];
          const initialDocument = first?.information ?? "";
          applyLoadedDocument("logic_gate", linkedNodeID, first?.information_id ?? "", initialDocument);
          return;
        }
        const [details, projections] = await Promise.all([
          getNodeRecordSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
        ]);
        if (cancelled) return;
        setLinkedNodeTitle(getNodeTitle(details.node));
        const nonText = details.information.filter((item) => item.type !== "Text box");
        setLinkedNodeInfoPreview(nonText.slice(0, 2).map((item) => `${item.type}: ${item.information}`));
        setLinkedNodeMetadataRows([
          { label: "Node ID", value: details.node.node_id },
          { label: "Created", value: details.node.created_timestamp },
          { label: "Relationships", value: String(details.relationships.length) },
          { label: "Information records", value: String(details.information.length) },
          { label: "Text boxes", value: String(projections.length) },
        ]);
        const historyRows = [
          details.node.created_timestamp ? `Node created at ${details.node.created_timestamp}` : "Node created",
          ...details.information.slice(-4).map((item) => `${item.type} updated at ${item.updated_timestamp}`),
        ];
        setLinkedNodeHistoryRows(historyRows);
        const first = projections.find((item) => item.information.trim().length > 0) ?? projections[0];
        const initialDocument = first?.information ?? "";
        applyLoadedDocument("node", linkedNodeID, first?.information_id ?? "", initialDocument);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load linked information");
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, applyLoadedDocument, companyID, linkedEntityKind, linkedNodeID, scheduleIndentGuideUpdate]);

  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : "#ffffff";
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#0d1a1e";
  const tabBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.86)";
  const tabSelectedBackground = isDarkTheme ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.98)";
  const strokeColor = isDarkTheme ? "rgba(255,255,255,0.22)" : "rgba(3,25,30,0.22)";
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(3,25,30,0.14)";
  const panelBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255, 255, 255, 0.8)";
  const scrollbarAccent = theme === "light" ? "rgb(0, 233, 255)" : accent;
  const scrollbarTrack = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(0, 233, 255, 0.08)";
  const indentGuideColor = isDarkTheme ? "rgba(255,255,255,0.12)" : "rgba(3,25,30,0.12)";
  const documentIsolation = getEditorDocumentIsolationState(activeTab);
  const hasLinkedDocument = linkedNodeID.trim().length > 0;
  const showIndentGuides = outlineStyle === "indent-guides" && indentGuideSegments.length > 0;

  return (
    <div
      data-frame-interactive="true"
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ width: "100%", height: "100%", position: "relative", background: surfaceBackground, color: surfaceText, overflow: "hidden", userSelect: "text", cursor: "text" }}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0, cursor: "text" }}>
        {hasLinkedDocument && (
          <div style={{ position: "absolute", top: 4, left: 8, right: 12, display: "grid", gap: 8, zIndex: 5, pointerEvents: "none" }}>
          <div style={{ position: "relative", zIndex: 4, display: "flex", alignItems: "center", gap: 6, paddingLeft: 106, overflowX: "auto", scrollbarWidth: "none", pointerEvents: "auto" }}>
            {EDITOR_TAB_ITEMS.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button key={tab.id} type="button" onClick={() => selectTab(tab.id)} style={{ flex: "0 0 auto", whiteSpace: "nowrap", border: `1px solid ${selected ? accent : strokeColor}`, background: selected ? tabSelectedBackground : tabBackground, color: surfaceText, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}>
                  {tab.label}
                </button>
              );
            })}
          </div>
          
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 21, borderBottom: `1px solid ${ruleColor}`, transform: "translateY(8px)", pointerEvents: "none", zIndex: 1 }} />
          {activeTab === "editor" && (
            <div style={{ display: "grid", gap: 8, pointerEvents: "auto" }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.12em", color: accent, cursor: "text" }}>
                <span style={{ textTransform: "uppercase" }}>{linkedEntityKind === "logic_gate" ? "Logic Gate:" : "Node:"}</span>&nbsp;
                <span
                  ref={editingTitleRef}
                  contentEditable={isEditingTitle}
                  suppressContentEditableWarning
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!isEditingTitle) {
                      editingTitleDraftRef.current = linkedNodeTitle || (linkedEntityKind === "logic_gate" ? "new logic gate" : "new node");
                      setIsEditingTitle(true);
                    }
                  }}
                  onInput={(event) => {
                    editingTitleDraftRef.current = event.currentTarget.textContent ?? "";
                  }}
                  onBlur={() => {
                    if (!isEditingTitle) return;
                    const latestTitle = (editingTitleRef.current?.textContent ?? editingTitleDraftRef.current).trim();
                    void updateNodeTitle(latestTitle);
                    setIsEditingTitle(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const latestTitle = (editingTitleRef.current?.textContent ?? editingTitleDraftRef.current).trim();
                      void updateNodeTitle(latestTitle);
                      setIsEditingTitle(false);
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      if (editingTitleRef.current) editingTitleRef.current.textContent = linkedNodeTitle;
                      setIsEditingTitle(false);
                    }
                  }}
                  style={{ outline: "none", cursor: "text" }}
                >
                  {linkedNodeTitle || "\u00A0"}
                </span>
              </div>
              {linkedNodeInfoPreview.length > 0 && <div style={{ fontSize: 10, opacity: 0.7 }}>{linkedNodeInfoPreview.join(" - ")}</div>}
            </div>
          )}

          {activeTab === "outline-styles" && (
            <section style={{ display: "grid", gap: 8, maxWidth: 620, pointerEvents: "auto" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Outline Styles</div>
              <div role="radiogroup" aria-label="Outline styles" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {EDITOR_OUTLINE_STYLE_ITEMS.map((item) => {
                  const selected = outlineStyle === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setOutlineStyle(item.id)}
                      style={{
                        border: `1px solid ${selected ? accent : strokeColor}`,
                        background: selected ? tabSelectedBackground : panelBackground,
                        color: surfaceText,
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 800,
                        padding: "6px 8px",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {activeTab === "metadata" && linkedNodeMetadataRows.length > 0 && (
            <section style={{ display: "grid", gap: 6, maxWidth: 520, pointerEvents: "auto" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Metadata</div>
              <div style={{ display: "grid", gap: 4 }}>
                {linkedNodeMetadataRows.map((row) => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, background: panelBackground, border: `1px solid ${ruleColor}`, borderRadius: 6, padding: "4px 6px" }}>
                    <span style={{ opacity: 0.75 }}>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeTab === "history" && linkedNodeHistoryRows.length > 0 && (
            <section style={{ display: "grid", gap: 6, maxWidth: 640, pointerEvents: "auto" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>History</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3, fontSize: 11, background: panelBackground, border: `1px solid ${ruleColor}`, borderRadius: 6, padding: "6px 8px 6px 22px" }}>
                {linkedNodeHistoryRows.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}
              </ul>
            </section>
          )}
          </div>
        )}

        {hasLinkedDocument && showIndentGuides && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 86,
              right: 0,
              bottom: 0,
              left: 0,
              zIndex: 0,
              visibility: documentIsolation.visibility,
              pointerEvents: "none",
              boxSizing: "border-box",
              overflow: "hidden",
              padding: "0 18px 24px 24px",
              fontSize: EDITOR_DOCUMENT_FONT_SIZE_PX,
              lineHeight: EDITOR_DOCUMENT_LINE_HEIGHT,
              fontFamily: "'Manrope', 'Helvetica Neue', sans-serif",
            }}
          >
            <div style={{ position: "relative", transform: `translateY(-${documentScrollTop}px)` }}>
              {indentGuideSegments.map((segment) => (
                <div
                  key={`${segment.depth}-${segment.lineStart}-${segment.lineEnd}`}
                  style={{
                    position: "absolute",
                    top: segment.lineStart * EDITOR_DOCUMENT_LINE_HEIGHT_PX,
                    left: `calc(${segment.depth * EDITOR_TAB_TEXT.length}ch - ${EDITOR_TAB_TEXT.length / 2}ch)`,
                    height: Math.max(EDITOR_DOCUMENT_LINE_HEIGHT_PX, (segment.lineEnd - segment.lineStart + 1) * EDITOR_DOCUMENT_LINE_HEIGHT_PX),
                    borderLeft: `1px solid ${indentGuideColor}`,
                    opacity: 0.9,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {hasLinkedDocument && (
          <textarea
          ref={editorTextAreaRef}
          className="editor-document-scroll"
          aria-label="Linked document editor"
          aria-hidden={documentIsolation.ariaHidden}
          tabIndex={documentIsolation.tabIndex}
          spellCheck
          onBeforeInput={(event) => {
            pendingEditorInputKindRef.current = classifyEditorInputType((event.nativeEvent as InputEvent).inputType);
          }}
          onPaste={() => { pendingEditorInputKindRef.current = "paste"; }}
          onDrop={() => { pendingEditorInputKindRef.current = "paste"; }}
          onChange={(event) => {
            const snapshot = recordEditorTextChange(event.currentTarget);
            scheduleDocumentSave(snapshot.value);
            scheduleIndentGuideUpdate(snapshot.value);
          }}
          onSelect={(event) => syncEditorTextSelectionSnapshot(event.currentTarget)}
          onClick={(event) => syncEditorTextSelectionSnapshot(event.currentTarget)}
          onKeyUp={(event) => syncEditorTextSelectionSnapshot(event.currentTarget)}
          onBlur={(event) => {
            syncEditorTextSelectionSnapshot(event.currentTarget);
            rememberCurrentDocumentScroll();
            flushPendingDocumentSave(event.currentTarget.value);
          }}
          onScroll={(event) => {
            if (restoringScrollRef.current) return;
            const targetKey = currentDocumentTargetKeyRef.current;
            if (targetKey) scrollMemoryRef.current.remember(targetKey, event.currentTarget.scrollTop);
            setDocumentScrollTop(event.currentTarget.scrollTop);
          }}
          onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            const key = event.key.toLowerCase();
            const mod = event.ctrlKey || event.metaKey;
            if (mod && !event.altKey && (key === "z" || key === "y")) {
              const shouldRedo = key === "y" || event.shiftKey;
              event.preventDefault();
              const snapshot = shouldRedo
                ? redoEditorText(editorUndoHistoryRef.current, event.currentTarget.value)
                : undoEditorText(editorUndoHistoryRef.current, event.currentTarget.value);
              if (snapshot) applyEditorUndoSnapshot(event.currentTarget, snapshot);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.currentTarget.blur();
              return;
            }
            if (event.key === "Enter" && outlineStyle === "automatic-outline-numbering") {
              event.preventDefault();
              const before = snapshotEditorTextArea(event.currentTarget);
              const edit = insertEditorEnterText(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, outlineStyle);
              applyDocumentTextToEditor(edit.value);
              event.currentTarget.setSelectionRange(edit.selectionStart, edit.selectionEnd);
              recordEditorUndoChange(editorUndoHistoryRef.current, before, snapshotEditorTextArea(event.currentTarget), "lineBreak");
              lastEditorTextSnapshotRef.current = snapshotEditorTextArea(event.currentTarget);
              pendingEditorInputKindRef.current = "unknown";
              return;
            }
            if (event.key !== "Tab") return;

            event.preventDefault();
            // Textareas normally use Tab to leave the field. Here it is an
            // isolated editor edit group so one undo removes only this Tab.
            const before = snapshotEditorTextArea(event.currentTarget);
            const edit = insertEditorTabText(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
            applyDocumentTextToEditor(edit.value);
            event.currentTarget.setSelectionRange(edit.selectionStart, edit.selectionEnd);
            recordEditorUndoChange(editorUndoHistoryRef.current, before, snapshotEditorTextArea(event.currentTarget), "tab");
            lastEditorTextSnapshotRef.current = snapshotEditorTextArea(event.currentTarget);
            pendingEditorInputKindRef.current = "unknown";
          }}
          style={{
            position: "absolute",
            top: 86,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 1,
            border: 0,
            backgroundColor: "transparent",
            color: surfaceText,
            display: "block",
            visibility: documentIsolation.visibility,
            pointerEvents: documentIsolation.pointerEvents,
            boxSizing: "border-box",
            resize: "none",
            padding: "0 18px 24px 24px",
            outline: "none",
            fontSize: EDITOR_DOCUMENT_FONT_SIZE_PX,
            lineHeight: EDITOR_DOCUMENT_LINE_HEIGHT,
            fontFamily: "'Manrope', 'Helvetica Neue', sans-serif",
            whiteSpace: "pre-wrap",
            tabSize: 2,
            caretColor: accent,
            cursor: "text",
            overflowY: "auto",
            overflowX: "hidden",
            scrollbarGutter: "stable",
            ["--editor-document-scroll-accent" as string]: scrollbarAccent,
            ["--editor-document-scroll-track" as string]: scrollbarTrack,
          }}
        />
      )}
      {error && <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "#b00020", zIndex: 3 }}>{error}</div>}
      </div>
    </div>
  );
};
