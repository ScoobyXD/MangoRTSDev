import React, { useCallback, useEffect, useRef, useState } from "react";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, type NodeRecord } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, getNodeTitle as getLogicGateTitle, toLogicGateCanvasRecord, type LogicGateRecord } from "../logic-gate-map/shared";
import { EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { getNodeRecordSingleFlight, getNodeInformationProjectionSingleFlight, invalidateNodeRecordStoreCaches } from "../node-map/NodeRecordStore";
import { getNodeRelationshipGraphSnapshot, subscribeNodeRelationshipGraph, upsertNodeRelationshipGraphNode } from "../node-map/NodeRelationshipGraph";
import { getLogicGateRecordSingleFlight, getLogicGateInformationProjectionSingleFlight, invalidateLogicGateRecordStoreCaches } from "../logic-gate-map/LogicGateRecordStore";
import { getLogicGateRelationshipGraphSnapshot, subscribeLogicGateRelationshipGraph, upsertLogicGateRelationshipGraphNode } from "../logic-gate-map/LogicGateRelationshipGraph";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import { readLiveSelectionForFrame, subscribeLiveSelection, type LiveSelectionChange, type SelectionIntent } from "../selectionCoordinator";
import { getEditorDocumentIsolationState, type EditorTabID } from "./editorTabs";
import { EDITOR_TAB_TEXT } from "./plainTextEditing";
import { createEditorScrollMemory } from "./editorScroll";
import { buildEditorIndentGuideSegments, type EditorIndentGuideSegment } from "./editorIndentGuides";
import { selectCurrentEditorTextProjection } from "./editorProjection";
import { EditorDocumentSurface } from "./EditorDocumentSurface";
import { EditorLinkedDocumentPanels } from "./EditorLinkedDocumentPanels";
import { EditorTabBar } from "./EditorTabBar";
import {
  deserializeEditorDocumentHTML,
  EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES,
  readEditorDocumentText,
  serializeEditorDocumentHTML,
} from "./richTextEditing";
import {
  documentTargetKey,
  shouldReadStoredSelectionForEvent,
  type DocumentSaveRequest,
  type DocumentSaveTarget,
  type LinkedEntityKind,
  type LinkedSelection,
} from "./editorTypes";
import {
  EDITOR_DOCUMENT_LINE_HEIGHT,
  EDITOR_DOCUMENT_TOP_PX,
  EDITOR_DOCUMENT_MAX_FONT_SIZE_PX,
  EDITOR_DOCUMENT_MIN_FONT_SIZE_PX,
  useEditorPreferences,
} from "./useEditorPreferences";
import { useEditorDocumentSurfaceHandlers } from "./useEditorDocumentSurfaceHandlers";
import { useEditorDocumentPersistence } from "./useEditorDocumentPersistence";

function clampEditorSelectionFontSize(value: number): number {
  return Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, Math.round(value)));
}

function getSelectionRangeInsideElement(element: HTMLElement): Range | null {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  return container === element || element.contains(container) ? range : null;
}

function readRangeFontSize(range: Range, fallbackFontSize: number): number {
  const container = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement;
  if (!container) return fallbackFontSize;
  const parsed = Number.parseFloat(window.getComputedStyle(container).fontSize);
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

// Editor module: linked document canvas for node or logic-gate context.
export const EditorContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, theme = "teal" }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";
  const outlineStyleStorageKey = `editor-outline-style-v1:${companyID}:${scope}`;
  const documentFontSizeStorageKey = `editor-document-font-size-v1:${companyID}:${scope}`;
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
  const { outlineStyle, setOutlineStyle, documentFontSize } = useEditorPreferences(outlineStyleStorageKey, documentFontSizeStorageKey);
  const [documentScrollTop, setDocumentScrollTop] = useState(0);
  const [indentGuideSegments, setIndentGuideSegments] = useState<EditorIndentGuideSegment[]>([]);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const editingTitleRef = useRef<HTMLSpanElement | null>(null);
  const editingTitleDraftRef = useRef("");
  const editorDocumentRef = useRef<HTMLDivElement | null>(null);
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
  const shouldFocusEditorForSelectionRef = useRef(true);
  const pendingEditorFontSizeRef = useRef<number | null>(null);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

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

  const applyEditorSelectionFontSize = useCallback((delta: number) => {
    const element = editorDocumentRef.current;
    if (!element) return;
    const range = getSelectionRangeInsideElement(element);
    const currentFontSize = range ? readRangeFontSize(range, documentFontSize) : documentFontSize;
    const nextFontSize = clampEditorSelectionFontSize(currentFontSize + delta);

    element.focus({ preventScroll: true });
    if (!range || range.collapsed) {
      pendingEditorFontSizeRef.current = nextFontSize;
      return;
    }

    const span = element.ownerDocument.createElement("span");
    span.style.fontSize = `${nextFontSize}px`;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    selectElementContents(span);
    pendingEditorFontSizeRef.current = null;
    scheduleDocumentSave(serializeEditorDocumentHTML(element));
    scheduleIndentGuideUpdate(readEditorDocumentText(element));
  }, [documentFontSize, scheduleDocumentSave, scheduleIndentGuideUpdate]);

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
    documentDraftRef.current = text;
    persistedDocumentRef.current = text;
    documentInformationIDRef.current = informationID;
    setDocumentInformationID(informationID);
    const targetKey = informationID ? documentTargetKey({ entityKind, entityID, informationID }) : `${entityKind}:${entityID}:`;
    currentDocumentTargetKeyRef.current = targetKey;
    persistedDocumentTargetKeyRef.current = targetKey;
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
      const parsed = JSON.parse(raw) as { selectedNodeID?: string; selectedLabel?: string; selectionIntent?: SelectionIntent };
      return {
        id: typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "",
        label: typeof parsed.selectedLabel === "string" ? parsed.selectedLabel : "",
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
      const parsed = JSON.parse(raw) as { selectedLogicGateID?: string; selectedNodeID?: string; selectedLabel?: string; selectionIntent?: SelectionIntent };
      return {
        id: typeof parsed.selectedLogicGateID === "string" ? parsed.selectedLogicGateID : (typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : ""),
        label: typeof parsed.selectedLabel === "string" ? parsed.selectedLabel : "",
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
    pendingEditorFontSizeRef.current = null;
    restoringScrollRef.current = false;
    if (editorDocumentRef.current) {
      editorDocumentRef.current.innerHTML = "";
      editorDocumentRef.current.scrollTop = 0;
    }
    setDocumentScrollTop(0);
    scheduleIndentGuideUpdate("");
  }, [scheduleIndentGuideUpdate]);

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
    const applyLiveSelection = (selection: LiveSelectionChange) => {
      if (selection.companyID !== companyID || selection.sourceFrameID === scope) return;
      const focusEditor = selection.selectionIntent !== "navigate";
      if (selection.entityKind === "node") {
        applyLinkedNode(selection.entityID, selection.label, { focusEditor });
        return;
      }
      if (selection.entityKind === "logic_gate") {
        applyLinkedLogicGate(selection.entityID, selection.label, { focusEditor });
        return;
      }
      applyLinkedNode("", "", { focusEditor });
    };
    const refresh = () => {
      const liveSelection = readLiveSelectionForFrame(companyID, scope);
      if (liveSelection) {
        applyLiveSelection(liveSelection);
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
      const selectedFromExplorer = readSelectedNodeFromExplorerContext();
      if (selectedFromExplorer.id) {
        applyLinkedNode(selectedFromExplorer.id, selectedFromExplorer.label, { focusEditor: selectedFromExplorer.selectionIntent !== "navigate" });
        return;
      }
      const selectedLogicFromExplorer = readSelectedLogicGateFromExplorerContext();
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
      pendingEditorFontSizeRef.current = null;
      if (editorDocumentRef.current) {
        editorDocumentRef.current.innerHTML = "";
        editorDocumentRef.current.scrollTop = 0;
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
          setLinkedNodeInfoPreview(nonText.slice(0, 2).map((item) => `${item.type}: ${item.information}`));
          setLinkedNodeMetadataRows([
            { label: "Logic Gate ID", value: details.logic_gate.logic_gate_id },
            { label: "Created", value: details.logic_gate.created_timestamp },
            { label: "Relationships", value: String(details.relationships.length) },
            { label: "Information records", value: String(details.information.length) },
            { label: "Text boxes", value: String(textBoxes.length) },
          ]);
          const historyRows = [
            details.logic_gate.created_timestamp ? `Logic gate created at ${details.logic_gate.created_timestamp}` : "Logic gate created",
            ...details.information.slice(-4).map((item) => `${item.type} updated at ${item.updated_timestamp}`),
          ];
          setLinkedNodeHistoryRows(historyRows);
          const currentTextBox = selectCurrentEditorTextProjection(projections);
          const initialDocument = currentTextBox?.information ?? "";
          applyLoadedDocument("logic_gate", linkedNodeID, currentTextBox?.information_id ?? "", initialDocument);
          return;
        }
        const [details, projections] = await Promise.all([
          getNodeRecordSingleFlight(apiBase, companyID, linkedNodeID),
          getNodeInformationProjectionSingleFlight(apiBase, companyID, linkedNodeID),
        ]);
        if (cancelled) return;
        setLinkedNodeTitle(getNodeTitle(details.node));
        const nonText = details.information.filter((item) => item.type !== "Text box");
        const textBoxes = projections.filter((item) => item.type === "Text box");
        setLinkedNodeInfoPreview(nonText.slice(0, 2).map((item) => `${item.type}: ${item.information}`));
        setLinkedNodeMetadataRows([
          { label: "Node ID", value: details.node.node_id },
          { label: "Created", value: details.node.created_timestamp },
          { label: "Relationships", value: String(details.relationships.length) },
          { label: "Information records", value: String(details.information.length) },
          { label: "Text boxes", value: String(textBoxes.length) },
        ]);
        const historyRows = [
          details.node.created_timestamp ? `Node created at ${details.node.created_timestamp}` : "Node created",
          ...details.information.slice(-4).map((item) => `${item.type} updated at ${item.updated_timestamp}`),
        ];
        setLinkedNodeHistoryRows(historyRows);
        const currentTextBox = selectCurrentEditorTextProjection(projections);
        const initialDocument = currentTextBox?.information ?? "";
        applyLoadedDocument("node", linkedNodeID, currentTextBox?.information_id ?? "", initialDocument);
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
  const indentGuideColor = isDarkTheme ? "rgba(255,255,255,0.22)" : "rgba(3,25,30,0.2)";
  const documentIsolation = getEditorDocumentIsolationState(activeTab);
  const hasLinkedDocument = linkedNodeID.trim().length > 0;
  const showIndentGuides = outlineStyle === "indent-guides" && indentGuideSegments.length > 0;
  const documentTopPx = EDITOR_DOCUMENT_TOP_PX;
  const documentLineHeightPx = documentFontSize * EDITOR_DOCUMENT_LINE_HEIGHT;
  const documentBottomBufferPx = Math.round(documentLineHeightPx * EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES);
  const documentFontFamily = "'IBM Plex Mono', 'Consolas', 'Liberation Mono', monospace";
  const documentSurfaceHandlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef,
    scrollMemoryRef,
    pendingEditorFontSizeRef,
    outlineStyle,
    documentFontSize,
    setDocumentScrollTop,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    rememberCurrentDocumentScroll,
    flushPendingDocumentSave,
  });

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
            onOutlineStyleFocus={() => setActiveTab("outline-styles")}
            onOutlineStyleChange={(nextOutlineStyle) => {
              setOutlineStyle(nextOutlineStyle);
              setActiveTab("outline-styles");
            }}
          />
          
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 21, borderBottom: `1px solid ${ruleColor}`, transform: "translateY(8px)", pointerEvents: "none", zIndex: 1 }} />
          <EditorLinkedDocumentPanels
            activeTab={activeTab}
            linkedEntityKind={linkedEntityKind}
            linkedNodeTitle={linkedNodeTitle}
            linkedNodeInfoPreview={linkedNodeInfoPreview}
            linkedNodeMetadataRows={linkedNodeMetadataRows}
            linkedNodeHistoryRows={linkedNodeHistoryRows}
            isEditingTitle={isEditingTitle}
            editingTitleRef={editingTitleRef}
            editingTitleDraftRef={editingTitleDraftRef}
            accent={accent}
            panelBackground={panelBackground}
            ruleColor={ruleColor}
            onSetIsEditingTitle={setIsEditingTitle}
            onUpdateTitle={updateNodeTitle}
          />

          </div>
        )}

        {hasLinkedDocument && (
          <EditorDocumentSurface
            documentRef={editorDocumentRef}
            documentIsolation={documentIsolation}
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
            accent={accent}
            scrollbarAccent={scrollbarAccent}
            scrollbarTrack={scrollbarTrack}
            {...documentSurfaceHandlers}
          />
        )}
        {error && <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "#b00020", zIndex: 3 }}>{error}</div>}
      </div>
    </div>
  );
};
