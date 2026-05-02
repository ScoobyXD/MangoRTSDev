import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, LogicGateInformation, getNodeTitle as getLogicGateTitle } from "../logic-gate-map/shared";
import { EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { getNodeRecordSingleFlight, getNodeInformationProjectionSingleFlight, invalidateNodeRecordStoreCaches } from "../node-map/NodeRecordStore";
import { getLogicGateRecordSingleFlight, getLogicGateInformationProjectionSingleFlight, invalidateLogicGateRecordStoreCaches } from "../logic-gate-map/LogicGateRecordStore";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import type { NodeInformation } from "../node-map/shared";

// Editor module: linked document canvas for node or logic-gate context.
export const EditorContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean; theme?: "teal" | "light" | "dark" }> = ({ accent, widgetId, theme = "teal" }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";
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
  const [activeTab, setActiveTab] = useState<"editor" | "metadata" | "history">("editor");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const editingTitleRef = useRef<HTMLSpanElement | null>(null);
  const editingTitleDraftRef = useRef("");
  const editorDocRef = useRef<HTMLDivElement | null>(null);
  const documentDraftRef = useRef("");
  const persistedDocumentRef = useRef("");
  const lastSelectionRevisionRef = useRef(0);
  const lastLogicGateSelectionRevisionRef = useRef(0);

  const requestJSON = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiBase}${path}`, { ...init, headers });
    if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [apiBase]);

  const saveDocument = useCallback(async (nextText: string) => {
    if (!linkedNodeID) return;
    // Avoid creating projection/history rows when nothing changed.
    if (nextText === persistedDocumentRef.current) return;
    if (nextText.trim().length === 0) {
      // Blank editor content is UI state only. Never persist it, because one empty
      // row per accidental blur becomes expensive noise at company/agent scale.
      documentDraftRef.current = persistedDocumentRef.current;
      if (editorDocRef.current && editorDocRef.current.textContent !== persistedDocumentRef.current) {
        editorDocRef.current.textContent = persistedDocumentRef.current;
      }
      return;
    }
    const stableInformationID = documentInformationID
      || (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0").slice(0, 12)}`);
    setError("");
    try {
      const informationPayload = {
        company_id: companyID,
        type: "Text box",
        information: nextText,
        information_id: stableInformationID,
      };
      if (linkedEntityKind === "logic_gate") {
        await requestJSON<LogicGateInformation>(`/v1/logic-gates/${linkedNodeID}/information`, {
          method: "POST",
          body: JSON.stringify(informationPayload),
        });
      } else {
        await requestJSON<NodeInformation>(`/v1/nodes/${linkedNodeID}/information`, {
          method: "POST",
          body: JSON.stringify(informationPayload),
        });
      }
      setDocumentInformationID(stableInformationID);
      persistedDocumentRef.current = nextText;
      if (linkedEntityKind === "logic_gate") invalidateLogicGateRecordStoreCaches(apiBase, companyID, linkedNodeID);
      else invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_save_document");
    }
  }, [apiBase, companyID, documentInformationID, linkedEntityKind, linkedNodeID, requestJSON]);

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

  const readSelectedNodeFromExplorerContext = useCallback((): string => {
    try {
      const raw = localStorage.getItem(`${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { selectedNodeID?: string };
      return typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "";
    } catch {
      return "";
    }
  }, [companyID, scope]);

  const readSelectedLogicGateFromExplorerContext = useCallback((): string => {
    try {
      const raw = localStorage.getItem(`${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { selectedLogicGateID?: string; selectedNodeID?: string };
      if (typeof parsed.selectedLogicGateID === "string") return parsed.selectedLogicGateID;
      return typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "";
    } catch {
      return "";
    }
  }, [companyID, scope]);

  const applyLinkedNode = useCallback((nodeID: string) => {
    setLinkedEntityKind(nodeID ? "node" : "");
    setLinkedNodeID(nodeID);
  }, []);

  const applyLinkedLogicGate = useCallback((logicGateID: string) => {
    setLinkedEntityKind(logicGateID ? "logic_gate" : "");
    setLinkedNodeID(logicGateID);
  }, []);

  const updateNodeTitle = useCallback(async (nextTitle: string) => {
    const value = nextTitle.trim();
    if (!linkedNodeID || !value) return;
    setError("");
    try {
      if (linkedEntityKind === "logic_gate") {
        const updated = await requestJSON<{ header: string }>(`/v1/logic-gates/${linkedNodeID}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, header: value }),
        });
        setLinkedNodeTitle(updated.header);
        invalidateLogicGateRecordStoreCaches(apiBase, companyID, linkedNodeID);
      } else {
        const updated = await requestJSON<{ title: string }>(`/v1/nodes/${linkedNodeID}`, {
          method: "PUT",
          body: JSON.stringify({ company_id: companyID, title: value }),
        });
        setLinkedNodeTitle(updated.title);
        invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
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
    if (!editorDocRef.current) return;
    const element = editorDocRef.current;
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [linkedNodeID]);

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
      const selectedFromLogicMap = readSelectedLogicGateFromMap(linkedLogicMapWidgetID);
      if (selectedFromLogicMap) {
        applyLinkedLogicGate(selectedFromLogicMap);
        return;
      }
      const selectedFromExplorer = readSelectedNodeFromExplorerContext();
      if (selectedFromExplorer) {
        applyLinkedNode(selectedFromExplorer);
        return;
      }
      const selectedLogicFromExplorer = readSelectedLogicGateFromExplorerContext();
      if (selectedLogicFromExplorer) {
        applyLinkedLogicGate(selectedLogicFromExplorer);
        return;
      }
      applyLinkedNode("");
    };
    refresh();
    const onStorage = (event: StorageEvent) => {
      const mapStateKey = linkedMapWidgetID ? `node-map-state-v1:${companyID}:${linkedMapWidgetID}` : "";
      const logicMapStateKey = linkedLogicMapWidgetID ? `logic-gate-map-state-v1:${companyID}:${linkedLogicMapWidgetID}` : "";
      const explorerContextKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      const logicExplorerContextKey = `${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      if (event.key && event.key !== mapStateKey && event.key !== logicMapStateKey && event.key !== explorerContextKey && event.key !== logicExplorerContextKey) return;
      refresh();
    };
    const onMapStateUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; revision?: number; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedMapWidgetID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastSelectionRevisionRef.current, revision)) return;
      if (revision > 0 && hasSequenceGap(lastSelectionRevisionRef.current, revision)) refresh();
      if (revision > 0) lastSelectionRevisionRef.current = revision;
      if (typeof detail.selectedNodeID === "string") {
        applyLinkedNode(detail.selectedNodeID);
        return;
      }
      refresh();
    };
    const onLogicMapStateUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ mapWidgetID?: string; selectedNodeID?: string; selectedLogicGateID?: string; revision?: number; envelope?: ContextMutationEnvelope }>).detail;
      if (!detail || detail.mapWidgetID !== linkedLogicMapWidgetID) return;
      const revision = readIncomingSequence(detail);
      if (revision > 0 && !isNewerSequence(lastLogicGateSelectionRevisionRef.current, revision)) return;
      if (revision > 0 && hasSequenceGap(lastLogicGateSelectionRevisionRef.current, revision)) refresh();
      if (revision > 0) lastLogicGateSelectionRevisionRef.current = revision;
      const selected = typeof detail.selectedLogicGateID === "string" ? detail.selectedLogicGateID : detail.selectedNodeID;
      if (typeof selected === "string") {
        applyLinkedLogicGate(selected);
        return;
      }
      refresh();
    };
    const onExplorerContextUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; targetID?: string }>).detail;
      if (!detail) return;
      const expectedKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      const expectedLogicKey = `${LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      if (detail.key !== expectedKey && detail.key !== expectedLogicKey && detail.targetID !== scope) return;
      const explorerSelected = readSelectedNodeFromExplorerContext();
      if (explorerSelected) {
        applyLinkedNode(explorerSelected);
        return;
      }
      const logicExplorerSelected = readSelectedLogicGateFromExplorerContext();
      if (logicExplorerSelected) {
        applyLinkedLogicGate(logicExplorerSelected);
        return;
      }
      refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapStateUpdated);
    window.addEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapStateUpdated);
    window.addEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapStateUpdated);
      window.removeEventListener(EVENT_LOGIC_GATE_MAP_SELECTION_UPDATED, onLogicMapStateUpdated);
      window.removeEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    };
  }, [applyLinkedLogicGate, applyLinkedNode, companyID, linkedLogicMapWidgetID, linkedMapWidgetID, readSelectedLogicGateFromExplorerContext, readSelectedLogicGateFromMap, readSelectedNodeFromExplorerContext, readSelectedNodeFromMap, scope]);

  useEffect(() => {
    let cancelled = false;
    if (!linkedNodeID) {
      setLinkedNodeTitle("");
      setLinkedNodeInfoPreview([]);
      setLinkedNodeMetadataRows([]);
      setLinkedNodeHistoryRows([]);
      documentDraftRef.current = "";
      persistedDocumentRef.current = "";
      setDocumentInformationID("");
      if (editorDocRef.current) editorDocRef.current.textContent = "";
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
          documentDraftRef.current = initialDocument;
          persistedDocumentRef.current = initialDocument;
          setDocumentInformationID(first?.information_id ?? "");
          if (editorDocRef.current && editorDocRef.current.textContent !== initialDocument) editorDocRef.current.textContent = initialDocument;
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
        documentDraftRef.current = initialDocument;
        persistedDocumentRef.current = initialDocument;
        setDocumentInformationID(first?.information_id ?? "");
        if (editorDocRef.current && editorDocRef.current.textContent !== initialDocument) editorDocRef.current.textContent = initialDocument;
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load linked information");
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, companyID, linkedEntityKind, linkedNodeID]);

  const tabItems = useMemo(() => ([
    { id: "editor", label: "Editor" },
    { id: "metadata", label: "Metadata" },
    { id: "history", label: "History" },
  ] as const), []);
  const isDarkTheme = theme === "dark";
  const surfaceBackground = isDarkTheme ? "#0f1216" : "#ffffff";
  const surfaceText = isDarkTheme ? "#f4f7fa" : "#0d1a1e";
  const tabBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.86)";
  const tabSelectedBackground = isDarkTheme ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.98)";
  const strokeColor = isDarkTheme ? "rgba(255,255,255,0.22)" : "rgba(3,25,30,0.22)";
  const ruleColor = isDarkTheme ? "rgba(255,255,255,0.16)" : "rgba(3,25,30,0.14)";
  const panelBackground = isDarkTheme ? "rgba(255,255,255,0.08)" : "rgba(255, 255, 255, 0.8)";

  return (
    <div
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      style={{ width: "100%", height: "100%", display: "grid", gridTemplateRows: "auto 1fr", background: surfaceBackground, color: surfaceText, overflow: "hidden", userSelect: "text", cursor: "text" }}
    >
      <div style={{ position: "relative", minHeight: 0, cursor: "text" }}>
      {linkedNodeID.trim().length > 0 && (
        <div style={{ position: "absolute", top: 4, left: 8, right: 12, display: "grid", gap: 8, zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 106 }}>
            {tabItems.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} style={{ border: `1px solid ${selected ? accent : strokeColor}`, background: selected ? tabSelectedBackground : tabBackground, color: surfaceText, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}>
                  {tab.label}
                </button>
              );
            })}
          </div>
          
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 21, borderBottom: `1px solid ${ruleColor}`, transform: "translateY(8px)", pointerEvents: "none", zIndex: 1 }} />
          {activeTab === "editor" && (
            <div style={{ display: "grid", gap: 8 }}>
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
              {linkedNodeInfoPreview.length > 0 && <div style={{ fontSize: 10, opacity: 0.7 }}>{linkedNodeInfoPreview.join(" • ")}</div>}
            </div>
          )}

          {activeTab === "metadata" && linkedNodeMetadataRows.length > 0 && (
            <section style={{ display: "grid", gap: 6, maxWidth: 520 }}>
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
            <section style={{ display: "grid", gap: 6, maxWidth: 640 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>History</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3, fontSize: 11, background: panelBackground, border: `1px solid ${ruleColor}`, borderRadius: 6, padding: "6px 8px 6px 22px" }}>
                {linkedNodeHistoryRows.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      {linkedNodeID.trim().length > 0 && (
        <div style={{ position: "absolute", inset: 0, padding: "86px 24px 24px", cursor: "text" }}>
          <div
            ref={editorDocRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck
            onInput={(event) => { documentDraftRef.current = event.currentTarget.textContent ?? ""; }}
            onBlur={(event) => {
              const nextText = event.currentTarget.textContent ?? "";
              documentDraftRef.current = nextText;
              void saveDocument(nextText);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            style={{ minHeight: "100%", outline: "none", fontSize: 15, lineHeight: 1.55, fontFamily: "'Manrope', 'Helvetica Neue', sans-serif", whiteSpace: "pre-wrap", caretColor: accent, cursor: "text" }}
          />
        </div>
      )}
      {error && <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "#b00020", zIndex: 3 }}>{error}</div>}
      </div>
    </div>
  );
};
