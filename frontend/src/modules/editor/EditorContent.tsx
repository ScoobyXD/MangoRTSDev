import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getNodeTitle, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { EVENT_EXPLORER_CONTEXT_UPDATED, EVENT_FRAME_LINK_GRAPH_UPDATED, EVENT_NODE_MAP_SELECTION_UPDATED } from "../node-map/eventbus";
import { FRAME_LINKS_KEY, FRAME_REGISTRY_KEY, readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveLinkedFrameByKindFromGraph } from "../linkingGraph";
import { getNodeRecordSingleFlight, getNodeInformationProjectionSingleFlight, invalidateNodeRecordStoreCaches } from "../node-map/NodeRecordStore";
import { hasSequenceGap, isNewerSequence, readIncomingSequence, type ContextMutationEnvelope } from "../contextSyncContract";
import type { NodeInformation } from "../node-map/shared";

// Editor module: node-linked document canvas with a single Google-Doc-like editable surface.
export const EditorContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }> = ({ accent, widgetId }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";
  const [linkedMapWidgetID, setLinkedMapWidgetID] = useState("");
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
  const lastSelectionRevisionRef = useRef(0);

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
    const stableInformationID = documentInformationID
      || (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0").slice(0, 12)}`);
    setError("");
    try {
      await requestJSON<NodeInformation>(`/v1/nodes/${linkedNodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: "Text box",
          information: nextText,
          information_id: stableInformationID,
        }),
      });
      setDocumentInformationID(stableInformationID);
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_save_document");
    }
  }, [apiBase, companyID, documentInformationID, linkedNodeID, requestJSON]);

  const readLinkedMapWidgetID = useCallback((): string => {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    return resolveLinkedFrameByKindFromGraph({ startFrameID: scope, targetKind: "map", edges, registry });
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

  const updateNodeTitle = useCallback(async (nextTitle: string) => {
    const value = nextTitle.trim();
    if (!linkedNodeID || !value) return;
    setError("");
    try {
      const updated = await requestJSON<{ title: string }>(`/v1/nodes/${linkedNodeID}`, {
        method: "PUT",
        body: JSON.stringify({ company_id: companyID, title: value }),
      });
      setLinkedNodeTitle(updated.title);
      invalidateNodeRecordStoreCaches(apiBase, companyID, linkedNodeID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_update_node");
    }
  }, [apiBase, companyID, linkedNodeID, requestJSON]);

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
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [isEditingTitle]);

  useEffect(() => {
    if (!editorDocRef.current) return;
    const element = editorDocRef.current;
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse((editorDocRef.current?.textContent ?? "").length > 0);
    selection.removeAllRanges();
    selection.addRange(range);
  }, [linkedNodeID]);

  useEffect(() => {
    const refresh = () => setLinkedMapWidgetID(readLinkedMapWidgetID());
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
  }, [readLinkedMapWidgetID]);

  useEffect(() => {
    const refresh = () => {
      const selectedFromMap = readSelectedNodeFromMap(linkedMapWidgetID);
      if (selectedFromMap) {
        setLinkedNodeID(selectedFromMap);
        return;
      }
      setLinkedNodeID(readSelectedNodeFromExplorerContext());
    };
    refresh();
    const onStorage = (event: StorageEvent) => {
      const mapStateKey = linkedMapWidgetID ? `node-map-state-v1:${companyID}:${linkedMapWidgetID}` : "";
      const explorerContextKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      if (event.key && event.key !== mapStateKey && event.key !== explorerContextKey) return;
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
        setLinkedNodeID(detail.selectedNodeID);
        return;
      }
      refresh();
    };
    const onExplorerContextUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string; targetID?: string }>).detail;
      if (!detail) return;
      const expectedKey = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`;
      if (detail.key !== expectedKey && detail.targetID !== scope) return;
      const explorerSelected = readSelectedNodeFromExplorerContext();
      if (explorerSelected) {
        setLinkedNodeID(explorerSelected);
        return;
      }
      refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapStateUpdated);
    window.addEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT_NODE_MAP_SELECTION_UPDATED, onMapStateUpdated);
      window.removeEventListener(EVENT_EXPLORER_CONTEXT_UPDATED, onExplorerContextUpdated);
    };
  }, [companyID, linkedMapWidgetID, readSelectedNodeFromMap, readSelectedNodeFromExplorerContext, scope]);

  useEffect(() => {
    let cancelled = false;
    if (!linkedNodeID) {
      setLinkedNodeTitle("");
      setLinkedNodeInfoPreview([]);
      setLinkedNodeMetadataRows([]);
      setLinkedNodeHistoryRows([]);
      documentDraftRef.current = "";
      setDocumentInformationID("");
      if (editorDocRef.current) editorDocRef.current.textContent = "";
      return;
    }
    (async () => {
      try {
        setError("");
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
        const first = projections[0];
        const initialDocument = first?.information ?? "";
        documentDraftRef.current = initialDocument;
        setDocumentInformationID(first?.information_id ?? "");
        if (editorDocRef.current && editorDocRef.current.textContent !== initialDocument) editorDocRef.current.textContent = initialDocument;
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load linked node information");
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, companyID, linkedNodeID]);

  const tabItems = useMemo(() => ([
    { id: "editor", label: "Editor" },
    { id: "metadata", label: "Metadata" },
    { id: "history", label: "History" },
  ] as const), []);

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateRows: "auto 1fr", background: "#ffffff", color: "#0d1a1e", overflow: "hidden", userSelect: "text" }}>
      <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(3,25,30,0.14)", minHeight: 0 }} />
      <div style={{ position: "relative", minHeight: 0 }}>
      {linkedNodeID.trim().length > 0 && (
        <div style={{ position: "absolute", top: 4, left: 8, right: 12, display: "grid", gap: 8, zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 106 }}>
            {tabItems.map((tab) => {
              const selected = activeTab === tab.id;
              return (
                <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} style={{ border: `1px solid ${selected ? accent : "rgba(3,25,30,0.22)"}`, background: selected ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.86)", color: "#0d1a1e", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 10px", borderRadius: 4, cursor: "pointer" }}>
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === "editor" && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", color: accent, cursor: "text" }}>
                <span style={{ textTransform: "uppercase" }}>Node:</span>&nbsp;
                <span
                  ref={editingTitleRef}
                  contentEditable={isEditingTitle}
                  suppressContentEditableWarning
                  onClick={() => {
                    if (!isEditingTitle) {
                      editingTitleDraftRef.current = linkedNodeTitle || "new node";
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
                  style={{ outline: "none" }}
                >
                  {linkedNodeTitle || "\u00A0"}
                </span>
              </div>
              {linkedNodeInfoPreview.length > 0 && <div style={{ fontSize: 10, opacity: 0.7 }}>{linkedNodeInfoPreview.join(" • ")}</div>}
              <div style={{ fontSize: 11, opacity: 0.75 }}>Text box editing has been removed from this module.</div>
            </div>
          )}

          {activeTab === "metadata" && linkedNodeMetadataRows.length > 0 && (
            <section style={{ display: "grid", gap: 6, maxWidth: 520 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Metadata</div>
              <div style={{ display: "grid", gap: 4 }}>
                {linkedNodeMetadataRows.map((row) => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(3,25,30,0.14)", borderRadius: 6, padding: "4px 6px" }}>
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
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3, fontSize: 11, background: "rgba(255,255,255,0.8)", border: "1px solid rgba(3,25,30,0.14)", borderRadius: 6, padding: "6px 8px 6px 22px" }}>
                {linkedNodeHistoryRows.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      {linkedNodeID.trim().length > 0 && (
        <div style={{ position: "absolute", inset: 0, padding: "86px 24px 24px" }}>
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
