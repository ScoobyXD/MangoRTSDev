import React, { useEffect, useMemo, useRef, useState } from "react";
import { EXPLORER_MAP_LINKS_KEY, NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX, NodeDetails, NodeRecord } from "../node-map/shared";
import { emitDashboardEvent, EVENT_EXPLORER_CONTEXT_UPDATED } from "../node-map/eventbus";
import { getWorkspaceSnapshot, refreshWorkspaceSnapshot, subscribeWorkspace } from "../node-map/workspaceStore";

type ExplorerTreeNode = {
  id: string;
  label: string;
  depth: number;
  kind: "folder" | "node";
  nodeID?: string;
  scopeLevel: number;
};

// Company Explorer module: tree navigation + node context handoff into Node Map and Editor.
export const CompanyExplorerContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }> = ({ accent, widgetId }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";

  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [selectedTreeID, setSelectedTreeID] = useState("folder-all");
  const [selectedNodeID, setSelectedNodeID] = useState("");
  const [selectedDetails, setSelectedDetails] = useState<NodeDetails | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["folder-root", "folder-nodes", "folder-notes", "folder-logic"]));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const treeViewportRef = useRef<HTMLDivElement | null>(null);
  const [treeScrollTop, setTreeScrollTop] = useState(0);
  const [treeViewportHeight, setTreeViewportHeight] = useState(480);

  const TREE_ROW_HEIGHT = 30;
  const TREE_OVERSCAN = 8;

  // Shared request helper for explorer detail/snapshot API calls.
  const requestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const headers = new Headers(init?.headers);
    // Avoid Content-Type on body-less requests to reduce CORS preflight chatter on GETs.
    if (init?.body != null && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      let reason = `request_failed_${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.error) reason = payload.error;
      } catch {
        // no-op
      }
      throw new Error(reason);
    }
    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await refreshWorkspaceSnapshot(apiBase, companyID);
        if (cancelled) return;
        setNodes(getWorkspaceSnapshot(apiBase, companyID).nodes ?? []);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_nodes");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase, companyID]);

  useEffect(() => {
    return subscribeWorkspace(apiBase, companyID, () => {
      setNodes(getWorkspaceSnapshot(apiBase, companyID).nodes ?? []);
    });
  }, [apiBase, companyID]);

  useEffect(() => {
    if (!selectedNodeID) {
      setSelectedDetails(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const payload = await requestJSON<NodeDetails>(`/v1/nodes/${selectedNodeID}?company_id=${encodeURIComponent(companyID)}`);
        if (!cancelled) setSelectedDetails(payload);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "failed_to_load_details");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedNodeID, companyID]);

  const unattachedNodeIDs = useMemo(() => {
    const attached = new Set<string>();
    for (const detail of selectedDetails?.relationships ?? []) {
      attached.add(detail.node_id_a);
      attached.add(detail.node_id_b);
    }
    return new Set(nodes.filter((node) => !attached.has(node.node_id)).map((node) => node.node_id));
  }, [nodes, selectedDetails]);

  // Build ctrl+f-friendly hierarchy rows (Company/Nodes/Logic Gates/Knowledge Notes).
  const treeRows = useMemo<ExplorerTreeNode[]>(() => {
    const rows: ExplorerTreeNode[] = [];
    rows.push({ id: "folder-root", label: "Company", depth: 0, kind: "folder", scopeLevel: 0 });

    rows.push({ id: "folder-nodes", label: "Nodes", depth: 1, kind: "folder", scopeLevel: 1 });
    if (expanded.has("folder-nodes")) {
      rows.push({ id: "folder-all", label: `All Nodes (${nodes.length})`, depth: 2, kind: "folder", scopeLevel: 1 });
      for (const node of nodes) {
        rows.push({ id: `node-${node.node_id}`, label: node.header || node.node_id, depth: 3, kind: "node", nodeID: node.node_id, scopeLevel: 3 });
      }
    }

    rows.push({ id: "folder-logic", label: "Logic Gates", depth: 1, kind: "folder", scopeLevel: 1 });
    if (expanded.has("folder-logic")) {
      rows.push({ id: "folder-logic-all", label: "All Logic Gates (coming soon)", depth: 2, kind: "folder", scopeLevel: 2 });
    }

    rows.push({ id: "folder-notes", label: "Knowledge Notes", depth: 1, kind: "folder", scopeLevel: 1 });
    if (expanded.has("folder-notes")) {
      rows.push({ id: "folder-notes-unattached", label: `Unattached Notes (${unattachedNodeIDs.size})`, depth: 2, kind: "folder", scopeLevel: 2 });
    }

    return rows;
  }, [expanded, nodes, unattachedNodeIDs]);

  const selectedTree = useMemo(() => treeRows.find((row) => row.id === selectedTreeID) ?? treeRows[0], [selectedTreeID, treeRows]);

  useEffect(() => {
    if (!treeViewportRef.current) return;
    const measure = () => {
      const height = treeViewportRef.current?.clientHeight ?? 0;
      if (height > 0) setTreeViewportHeight(height);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Virtualization window: keeps tree rendering fast when node counts grow.
  const virtualizedTree = useMemo(() => {
    const total = treeRows.length;
    if (total === 0) return { rows: [] as ExplorerTreeNode[], topSpacer: 0, bottomSpacer: 0 };
    const visibleCount = Math.max(1, Math.ceil(treeViewportHeight / TREE_ROW_HEIGHT));
    const start = Math.max(0, Math.floor(treeScrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN);
    const end = Math.min(total, start + visibleCount + TREE_OVERSCAN * 2);
    const rows = treeRows.slice(start, end);
    return {
      rows,
      topSpacer: start * TREE_ROW_HEIGHT,
      bottomSpacer: Math.max(0, (total - end) * TREE_ROW_HEIGHT),
    };
  }, [treeRows, treeViewportHeight, treeScrollTop]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPLORER_MAP_LINKS_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
      const linkedCanvasID = typeof parsed[scope] === "string" ? parsed[scope] : "";
      if (!linkedCanvasID) return;
      const key = `${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${linkedCanvasID}`;
      const payload = {
        sourceExplorerID: scope,
        selectedNodeID,
        selectedTreeID,
        scopeLevel: selectedTree?.scopeLevel ?? 0,
        selectedLabel: selectedTree?.label ?? "",
        ts: Date.now(),
      };
      localStorage.setItem(key, JSON.stringify(payload));
      emitDashboardEvent(EVENT_EXPLORER_CONTEXT_UPDATED, { key });
    } catch {
      // ignore local storage failures
    }
  }, [companyID, scope, selectedNodeID, selectedTreeID, selectedTree]);

  // Right-panel history summary derived from selected node details payload.
  const historyRows = useMemo(() => {
    if (!selectedDetails) return [];
    const nodeCreated = selectedDetails.node?.created_timestamp ? `Node created at ${selectedDetails.node.created_timestamp}` : "Node created";
    const infoEvents = (selectedDetails.information ?? []).slice(-4).map((item) => `${item.type} updated at ${item.updated_timestamp}`);
    return [nodeCreated, ...infoEvents].slice(0, 5);
  }, [selectedDetails]);

  // KPI strip used for fast operational scanning in explorer details pane.
  const kpiRows = useMemo(() => {
    const details = selectedDetails;
    if (!details) return [];
    return [
      { label: "Relationships", value: String(details.relationships?.length ?? 0) },
      { label: "Information Records", value: String(details.information?.length ?? 0) },
      { label: "Entity Type", value: "node" },
      { label: "Scope", value: selectedTree?.label ?? "Company" },
    ];
  }, [selectedDetails, selectedTree]);

  return (
    <div style={{ width: "100%", height: "100%", display: "grid", gridTemplateColumns: "minmax(220px, 0.95fr) minmax(280px, 1.1fr) minmax(220px, 0.95fr)", background: "#ffffff", color: "#0f1f23" }}>
      <div
        ref={treeViewportRef}
        onScroll={(event) => setTreeScrollTop((event.currentTarget as HTMLDivElement).scrollTop)}
        style={{ borderRight: "1px solid rgba(3,25,30,0.14)", overflow: "auto" }}
      >
        <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(3,25,30,0.14)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>Company Explorer</div>
        <div style={{ height: virtualizedTree.topSpacer }} />
        {virtualizedTree.rows.map((row) => {
          const isFolder = row.kind === "folder";
          const isOpen = expanded.has(row.id);
          const isSelected = selectedTreeID === row.id;
          return (
            <div
              key={row.id}
              onClick={() => {
                setSelectedTreeID(row.id);
                if (row.kind === "node") setSelectedNodeID(row.nodeID ?? "");
                if (row.kind === "folder" && row.id === "folder-all") setSelectedNodeID("");
              }}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 6,
                minHeight: TREE_ROW_HEIGHT,
                padding: "4px 8px",
                paddingLeft: 10 + row.depth * 16,
                fontSize: 12,
                cursor: "pointer",
                background: isSelected ? "rgba(0, 170, 190, 0.15)" : "transparent",
                borderBottom: "1px solid rgba(3,25,30,0.06)",
              }}
            >
              {row.depth > 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: 10 + row.depth * 16 - 8,
                    top: 0,
                    bottom: 0,
                    borderLeft: "1px solid rgba(15,56,66,0.22)",
                  }}
                />
              )}
              {isFolder ? (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    });
                  }}
                  style={{ border: "none", background: "transparent", width: 18, cursor: "pointer", color: "#326872", fontWeight: 700 }}
                >
                  {isOpen ? "▾" : "▸"}
                </button>
              ) : <span style={{ width: 18 }} />}
              <span>{row.label}</span>
            </div>
          );
        })}
        <div style={{ height: virtualizedTree.bottomSpacer }} />
      </div>

      <div style={{ borderRight: "1px solid rgba(3,25,30,0.14)", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(3,25,30,0.14)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>Details</div>
        <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{selectedTree?.label ?? "Company"}</div>
          {loading && <div style={{ fontSize: 12, opacity: 0.72 }}>Loading...</div>}
          {!loading && selectedDetails && (
            <>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Node ID: {selectedDetails.node.node_id}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Created: {selectedDetails.node.created_timestamp}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Relationships: {selectedDetails.relationships.length}</div>
              <div style={{ fontSize: 12, opacity: 0.82 }}>Information records: {selectedDetails.information.length}</div>
            </>
          )}
          {!selectedDetails && !loading && (
            <div style={{ fontSize: 12, opacity: 0.82 }}>Select a node-level file in the tree to view full details here.</div>
          )}
          {error && <div style={{ fontSize: 11, color: "#b00020" }}>{error}</div>}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
        <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(3,25,30,0.14)", fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: accent }}>Context</div>
        <div style={{ overflow: "auto", padding: 12, display: "grid", gap: 12, alignContent: "start" }}>
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>History</div>
            {historyRows.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>No history available for current scope.</div> : (
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 4 }}>
                {historyRows.map((item) => <li key={item} style={{ fontSize: 12 }}>{item}</li>)}
              </ul>
            )}
          </section>
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Metrics / KPI</div>
            {kpiRows.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>Select a node-level file to see KPI values.</div> : (
              <div style={{ display: "grid", gap: 6 }}>
                {kpiRows.map((row) => (
                  <div key={row.label} style={{ border: "1px solid rgba(4,31,38,0.16)", borderRadius: 8, padding: "6px 8px", display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span style={{ opacity: 0.8 }}>{row.label}</span>
                    <strong>{row.value}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Related Artifacts</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Artifacts support can be expanded here (documents, links, media).</div>
          </section>
        </div>
      </div>
    </div>
  );
};
