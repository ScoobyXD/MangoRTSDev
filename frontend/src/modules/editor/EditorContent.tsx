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
import { formatNodeDueDateForEditor, normalizeNodeDueDateDraft } from "./editorDates";
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
  EDITOR_DOCUMENT_FONT_SIZE_PX,
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
  theme?: "teal" | "light" | "dark";
  forcedEntityKind?: "node" | "logic_gate";
  forcedEntityID?: string;
  forcedLabel?: string;
  forcedEmptyMessage?: string;
};

// Editor module: linked document canvas for node or logic-gate context.
export const EditorContent: React.FC<EditorContentProps> = ({ accent, widgetId, theme = "teal", forcedEntityKind, forcedEntityID = "", forcedLabel = "", forcedEmptyMessage = "" }) => {
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
  const [nodeStatus, setNodeStatus] = useState("");
  const [nodeStatusColor, setNodeStatusColor] = useState("");
  const [nodePriorityDraft, setNodePriorityDraft] = useState("");
  const [nodeDueDateDraft, setNodeDueDateDraft] = useState("");
  const [nodeAssigneeDraft, setNodeAssigneeDraft] = useState("");
  const [documentInformationID, setDocumentInformationID] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<EditorTabID>("editor");
  const { outlineStyle, setOutlineStyle } = useEditorPreferences(outlineStyleStorageKey);
  const [documentFontSize, setDocumentFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [selectionFontSize, setSelectionFontSize] = useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
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
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const lastSelectionRevisionRef = useRef(0);
  const lastLogicGateSelectionRevisionRef = useRef(0);
  const lastAppliedSelectionChangedAtRef = useRef(0);
  const shouldFocusEditorForSelectionRef = useRef(true);
  const pendingEditorFontSizeRef = useRef<number | null>(null);

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

  const applyEditorSelectionFontSizeValue = useCallback((nextFontSizeInput: number) => {
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
    scheduleDocumentSave(serializeEditorDocumentHTML(element));
    scheduleIndentGuideUpdate(readEditorDocumentText(element));
  }, [scheduleDocumentSave, scheduleIndentGuideUpdate]);

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
    setLinkedNodeInfoPreview([]);
    setLinkedNodeMetadataRows([]);
    setLinkedNodeHistoryRows([]);
    setNodeStatus("");
    setNodeStatusColor("");
    setNodePriorityDraft("");
    setNodeDueDateDraft("");
    setNodeAssigneeDraft("");
    documentDraftRef.current = "";
    persistedDocumentRef.current = "";
    documentInformationIDRef.current = "";
    currentDocumentTargetKeyRef.current = "";
    persistedDocumentTargetKeyRef.current = "";
    pendingSaveRef.current = null;
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

  const updateNodePresetPatch = useCallback(async (patch: Record<string, unknown>) => {
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
      setNodeAssigneeDraft(updated.assignee_user_id ?? "");
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
      upsertNodeRelationshipGraphNode(apiBase, companyID, updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_node_fields");
    }
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID, requestJSON]);

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

  const commitNodeAssigneeDraft = useCallback((draft: string) => {
    const value = draft.trim();
    if (value && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      setError("Person in charge must be a user ID");
      return;
    }
    void updateNodePresetPatch({ assignee_user_id: value || null });
  }, [updateNodePresetPatch]);

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
      setNodeAssigneeDraft(node.assignee_user_id ?? "");
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
      setNodeStatus("");
      setNodeStatusColor("");
      setNodePriorityDraft("");
      setNodeDueDateDraft("");
      setNodeAssigneeDraft("");
      documentDraftRef.current = "";
      persistedDocumentRef.current = "";
      documentInformationIDRef.current = "";
      currentDocumentTargetKeyRef.current = "";
      persistedDocumentTargetKeyRef.current = "";
      pendingSaveRef.current = null;
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
          setNodeStatus("");
          setNodeStatusColor("");
          setNodePriorityDraft("");
          setNodeDueDateDraft("");
          setNodeAssigneeDraft("");
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
        setNodeStatus(details.node.status ?? "");
        setNodeStatusColor(details.node.status_color ?? "");
        setNodePriorityDraft(details.node.priority == null ? "" : String(details.node.priority));
        setNodeDueDateDraft(formatNodeDueDateForEditor(details.node.due_date));
        setNodeAssigneeDraft(details.node.assignee_user_id ?? "");
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
  const emptyMessage = forcedEntityKind && !hasLinkedDocument ? forcedEmptyMessage : "";
  const showIndentGuides = outlineStyle === "indent-guides" && indentGuideSegments.length > 0;
  const documentTopPx = linkedEntityKind === "node" ? 150 : EDITOR_DOCUMENT_TOP_PX;
  const documentLineHeightPx = documentFontSize * EDITOR_DOCUMENT_LINE_HEIGHT;
  const documentBottomBufferPx = Math.round(documentLineHeightPx * EDITOR_DOCUMENT_BOTTOM_BUFFER_LINES);
  const documentFontFamily = "'IBM Plex Mono', 'Consolas', 'Liberation Mono', monospace";
  const documentSurfaceHandlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef,
    scrollMemoryRef,
    pendingEditorFontSizeRef,
    outlineStyle,
    setDocumentScrollTop,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    rememberCurrentDocumentScroll,
    flushPendingDocumentSave,
    onSelectionFontSizeChange: updateSelectionFontSize,
  });

  return (
    <div
      ref={editorRootRef}
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
            documentFontSize={selectionFontSize}
            onSetSelectionFontSize={applyEditorSelectionFontSizeValue}
            onOutlineStyleFocus={() => setActiveTab("outline-styles")}
            onOutlineStyleChange={(nextOutlineStyle) => {
              setOutlineStyle(nextOutlineStyle);
              setActiveTab("outline-styles");
            }}
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
            nodePresetFields={linkedEntityKind === "node" ? {
              status: nodeStatus || "",
              statusColor: nodeStatusColor || "",
              priorityDraft: nodePriorityDraft,
              assigneeUserID: nodeAssigneeDraft,
              dueDateDraft: nodeDueDateDraft,
            } : null}
            isEditingTitle={isEditingTitle}
            editingTitleRef={editingTitleRef}
            editingTitleDraftRef={editingTitleDraftRef}
            accent={accent}
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
