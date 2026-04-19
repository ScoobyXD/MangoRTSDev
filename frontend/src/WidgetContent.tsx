import React, { useEffect, useMemo, useState } from "react";

const divider = { borderBottom: "1px solid currentColor", padding: "5px 0" };

export const RevenueContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Monthly Revenue ]</div>
    <div style={{ fontSize: 28, fontWeight: 700, color: "inherit" }}>$48.2K</div>
    <div style={{ ...divider, fontSize: 12 }}>+12.3% vs last month</div>
    <div style={{ fontSize: 12 }}>Forecast status: STABLE</div>
  </div>
);

export const UsersContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Active Users ]</div>
    <div style={{ fontSize: 28, fontWeight: 700, color: "inherit" }}>3,847</div>
    <div style={{ ...divider, fontSize: 12 }}>Sessions in last 10 min</div>
    <div style={{ fontSize: 12 }}>Regions synced: 04 / 04</div>
  </div>
);

export const AlertsContent: React.FC<{ accent: string }> = ({ accent }) => {
  const items = ["CPU > 90% on app-2", "Disk full on db-3", "SSL cert expiring in 4d", "Memory spike resolved"];
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "inherit" }}>[ Alerts Feed ]</div>
      {items.map((item, i) => (
        <div key={i} style={{ ...divider, fontSize: 12 }}>{String(i + 1).padStart(2, "0")} // {item}</div>
      ))}
    </div>
  );
};

export const TasksContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Sprint Tasks ]</div>
    <div style={{ fontSize: 30, fontWeight: 700, color: "inherit" }}>18/24</div>
    <div style={{ ...divider, fontSize: 12 }}>Completion ratio: 75%</div>
    <div style={{ fontSize: 12 }}>Open blockers: 02</div>
  </div>
);

export const ChartContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Analytics ]</div>
    <div style={{ ...divider, fontSize: 12 }}>Page views (WEEK): 84,120</div>
    <div style={{ ...divider, fontSize: 12 }}>Conversion: 3.4%</div>
    <div style={{ fontSize: 12, color: "inherit" }}>Trend: POSITIVE / LOW VOLATILITY</div>
  </div>
);

export const OrdersContent: React.FC<{ accent: string }> = ({ accent }) => {
  const orders = ["#4012 // SHIPPED", "#4011 // PROCESSING", "#4010 // DELIVERED", "#4009 // REFUNDED"];
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "inherit" }}>[ Recent Orders ]</div>
      {orders.map((item, i) => (
        <div key={i} style={{ ...divider, fontSize: 12 }}>{item}</div>
      ))}
    </div>
  );
};

export const NotificationsContent: React.FC<{ accent: string }> = ({ accent }) => {
  const notifs = ["New signup: jane@acme.co", "Payment received: $120.00", "Server restart complete", "Comment on PR #482"];
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", color: "inherit" }}>[ Notifications ]</div>
      {notifs.map((n, i) => (
        <div key={i} style={{ ...divider, fontSize: 12 }}>{n}</div>
      ))}
    </div>
  );
};

export const MapContent: React.FC<{ accent: string }> = ({ accent }) => (
  <div style={{ height: "100%", display: "grid", alignContent: "start", gap: 6 }}>
    <div style={{ fontSize: 12, textTransform: "uppercase", color: "inherit" }}>[ Geo Node ]</div>
    <div style={{ ...divider, fontSize: 12 }}>Primary: Zurich</div>
    <div style={{ ...divider, fontSize: 12 }}>Backup: Virginia</div>
    <div style={{ fontSize: 12 }}>Latency avg: 43ms</div>
  </div>
);

type CaseRecord = {
  id: string;
  title: string;
  responsible: string;
  parentId: string | null;
};

type CaseArtifact = {
  id: string;
  type: "email" | "message" | "doc" | "url" | "note";
  content: string;
  source_ref: string;
};

type CaseDetails = {
  case: {
    id: string;
    title: string;
    owner: string;
  };
  children: Array<{ id: string; title: string }>;
  artifacts: CaseArtifact[];
  activities: Array<{ id: string; event_type: string; payload: string; created_at: string }>;
};

const CASE_INDEX_KEY = "grid-dashboard-case-index-v1";

function loadCaseIndex(): CaseRecord[] {
  try {
    const raw = localStorage.getItem(CASE_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string" && typeof item.title === "string")
      .map((item) => ({
        id: item.id,
        title: item.title,
        responsible: typeof item.responsible === "string" ? item.responsible : "Unassigned",
        parentId: typeof item.parentId === "string" ? item.parentId : null,
      }));
  } catch {
    return [];
  }
}

function saveCaseIndex(records: CaseRecord[]) {
  localStorage.setItem(CASE_INDEX_KEY, JSON.stringify(records));
}

export const CaseHubContent: React.FC<{ accent: string }> = ({ accent }) => {
  const [records, setRecords] = useState<CaseRecord[]>(() => loadCaseIndex());
  const [selectedId, setSelectedId] = useState<string>(records[0]?.id ?? "");
  const [selectedDetails, setSelectedDetails] = useState<CaseDetails | null>(null);
  const [newCaseTitle, setNewCaseTitle] = useState<string>("");
  const [ownerDraft, setOwnerDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [linkDraft, setLinkDraft] = useState("");
  const [quickDraft, setQuickDraft] = useState("");
  const [childDraft, setChildDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "";

  const selected = records.find((item) => item.id === selectedId) ?? null;

  const requestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
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
    return response.json() as Promise<T>;
  };

  const save = (next: CaseRecord[]) => {
    setRecords(next);
    saveCaseIndex(next);
  };

  const createCase = async (title: string, parentId: string | null = null) => {
    if (!title.trim()) return;
    setError("");
    try {
      const payload = parentId
        ? await requestJSON<{ id: string; title: string; owner: string }>(`/v1/cases/${parentId}/children`, {
          method: "POST",
          body: JSON.stringify({ title: title.trim(), owner: ownerDraft.trim() || "unassigned" }),
        })
        : await requestJSON<{ id: string; title: string; owner: string }>("/v1/cases", {
          method: "POST",
          body: JSON.stringify({ title: title.trim(), owner: ownerDraft.trim() || "unassigned" }),
        });

      const nextItem: CaseRecord = {
        id: payload.id,
        title: payload.title,
        responsible: payload.owner,
        parentId,
      };
      const deduped = [nextItem, ...records.filter((item) => item.id !== nextItem.id)];
      save(deduped);
      setSelectedId(nextItem.id);
      setOwnerDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_case");
    }
  };

  const rememberSelected = (titleFallback?: string) => {
    if (!selected) return;
    const next = records.map((item) => (
      item.id === selected.id
        ? { ...item, title: selectedDetails?.case?.title || titleFallback || item.title, responsible: selectedDetails?.case?.owner || item.responsible }
        : item
    ));
    save(next);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const next = records.filter((item) => item.id !== selected.id);
    save(next);
    setSelectedId(next[0]?.id ?? "");
    setSelectedDetails(null);
  };

  const reloadSelected = async () => {
    if (!selectedId) {
      setSelectedDetails(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const details = await requestJSON<CaseDetails>(`/v1/cases/${selectedId}`);
      setSelectedDetails(details);
    } catch (err) {
      setSelectedDetails(null);
      setError(err instanceof Error ? err.message : "failed_to_load_case");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reloadSelected();
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !selectedDetails) return;
    rememberSelected(selectedDetails.case.title);
  }, [selectedDetails?.case.id, selectedDetails?.case.title, selectedDetails?.case.owner]);

  const addArtifact = async (type: CaseArtifact["type"], value: string) => {
    if (!selectedId || !value.trim()) return;
    setError("");
    try {
      await requestJSON(`/v1/cases/${selectedId}/artifacts`, {
        method: "POST",
        body: JSON.stringify({
          type,
          content: value.trim(),
          source_ref: type === "url" ? value.trim() : "",
          created_by: "ui",
        }),
      });
      await reloadSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_add_artifact");
    }
  };

  const deleteArtifact = async (artifactID: string) => {
    if (!selectedId) return;
    setError("");
    try {
      await requestJSON(`/v1/cases/${selectedId}/artifacts/${artifactID}`, { method: "DELETE" });
      await reloadSelected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_artifact");
    }
  };

  const noteArtifacts = selectedDetails?.artifacts?.filter((item) => item.type === "note") ?? [];
  const linkArtifacts = selectedDetails?.artifacts?.filter((item) => item.type === "url") ?? [];
  const childCount = selectedDetails?.children?.length ?? 0;
  const isLikelyUrl = (value: string) => /^https?:\/\//i.test(value.trim());

  return (
    <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Case Module ]</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
        <input value={newCaseTitle} onChange={(e) => setNewCaseTitle(e.target.value)} placeholder="Create case..." />
        <button onClick={() => { void createCase(newCaseTitle, null); setNewCaseTitle(""); }}>Add</button>
      </div>

      <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
        <option value="">Select case</option>
        {records.map((item) => (
          <option key={item.id} value={item.id}>{item.parentId ? "↳ " : ""}{item.title}</option>
        ))}
      </select>

      {selected ? (
        <div style={{ display: "grid", gap: 4, borderTop: `1px solid ${accent}`, paddingTop: 4 }}>
          <div style={{ ...divider }}>Owner: {selectedDetails?.case.owner || selected.responsible || "Unassigned"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input value={ownerDraft} onChange={(e) => setOwnerDraft(e.target.value)} placeholder="Owner used on new cases/children" />
            <button onClick={() => setOwnerDraft("")}>Clear</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Add note" />
            <button onClick={() => { void addArtifact("note", noteDraft); setNoteDraft(""); }}>Note</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} placeholder="Link email/doc URL" />
            <button onClick={() => { void addArtifact("url", linkDraft); setLinkDraft(""); }}>Link</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input
              value={quickDraft}
              onChange={(e) => setQuickDraft(e.target.value)}
              placeholder="Quick add note or paste URL"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !quickDraft.trim()) return;
                const value = quickDraft.trim();
                void addArtifact(isLikelyUrl(value) ? "url" : "note", value);
                setQuickDraft("");
              }}
            />
            <button onClick={() => {
              if (!quickDraft.trim()) return;
              const value = quickDraft.trim();
              void addArtifact(isLikelyUrl(value) ? "url" : "note", value);
              setQuickDraft("");
            }}>Quick</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
            <input value={childDraft} onChange={(e) => setChildDraft(e.target.value)} placeholder="Create child case" />
            <button onClick={() => { void createCase(childDraft, selected.id); setChildDraft(""); }}>Child</button>
          </div>

          <div style={{ ...divider }}>Children: {childCount} · Notes: {noteArtifacts.length} · Links: {linkArtifacts.length}</div>
          {loading && <div style={{ ...divider }}>Loading case from API...</div>}
          {error && <div style={{ ...divider, color: "#b00020" }}>Error: {error}</div>}
          <div style={{ display: "grid", gap: 2 }}>
            {linkArtifacts.slice(0, 4).map((artifact) => (
              <div key={artifact.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, alignItems: "center" }}>
                <span style={{ ...divider, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🔗 {artifact.content}</span>
                <button onClick={() => { void deleteArtifact(artifact.id); }}>×</button>
              </div>
            ))}
            {noteArtifacts.slice(0, 4).map((artifact) => (
              <div key={artifact.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, alignItems: "center" }}>
                <span style={{ ...divider, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>• {artifact.content}</span>
                <button onClick={() => { void deleteArtifact(artifact.id); }}>×</button>
              </div>
            ))}
          </div>
          <button onClick={deleteSelected}>Remove from local list</button>
        </div>
      ) : (
        <div style={{ ...divider }}>No case selected.</div>
      )}
    </div>
  );
};

type NodeRecord = {
  node_id: string;
  header: string;
};

type NodeInfoRecord = {
  information_id: string;
  information: string;
};

type NodeRelationshipRecord = {
  node_relationship_id: string;
  node_id_a: string;
  node_id_b: string;
  a_position: "Parent" | "Child" | "Peer";
  b_position: "Parent" | "Child" | "Peer";
};

type NodeDetailsResponse = {
  node: NodeRecord;
  information: NodeInfoRecord[];
  relationships: NodeRelationshipRecord[];
};

const NODE_INDEX_KEY = "grid-dashboard-node-index-v1";

function loadNodeIndex(): NodeRecord[] {
  try {
    const raw = localStorage.getItem(NODE_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.node_id === "string" && typeof item.header === "string");
  } catch {
    return [];
  }
}

function saveNodeIndex(nodes: NodeRecord[]) {
  localStorage.setItem(NODE_INDEX_KEY, JSON.stringify(nodes));
}

export const NodeModuleContent: React.FC<{ accent: string }> = ({ accent }) => {
  const [nodes, setNodes] = useState<NodeRecord[]>(() => loadNodeIndex());
  const [selectedNodeId, setSelectedNodeId] = useState<string>(loadNodeIndex()[0]?.node_id ?? "");
  const [details, setDetails] = useState<NodeDetailsResponse | null>(null);
  const [nodeDraft, setNodeDraft] = useState("");
  const [infoDraft, setInfoDraft] = useState("");
  const [relationType, setRelationType] = useState<"Child" | "Parent" | "Peer">("Child");
  const [relationNodeDraft, setRelationNodeDraft] = useState("");
  const [status, setStatus] = useState("Ready");
  const [busy, setBusy] = useState(false);

  const apiBase = ((import.meta.env.VITE_API_BASE as string | undefined)?.trim()
    || (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
    || "http://localhost:8080");
  const companyID = ((import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim()
    || "11111111-1111-1111-1111-111111111111");

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return response.json() as Promise<T>;
  };

  const persistNodes = (next: NodeRecord[]) => {
    setNodes(next);
    saveNodeIndex(next);
  };

  const createNode = async (header: string) => (
    request<NodeRecord>("/v1/nodes", {
      method: "POST",
      body: JSON.stringify({ company_id: companyID, header }),
    })
  );

  const loadNodeDetails = async (nodeID: string) => {
    const payload = await request<NodeDetailsResponse>(`/v1/nodes/${nodeID}?company_id=${companyID}`);
    setDetails(payload);
  };

  useEffect(() => {
    if (!selectedNodeId) {
      setDetails(null);
      return;
    }
    setBusy(true);
    loadNodeDetails(selectedNodeId)
      .then(() => setStatus("Loaded"))
      .catch((err) => setStatus(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setBusy(false));
  }, [selectedNodeId]);

  const onCreateNode = async () => {
    if (!nodeDraft.trim()) return;
    setBusy(true);
    try {
      const created = await createNode(nodeDraft.trim());
      const next = [created, ...nodes.filter((item) => item.node_id !== created.node_id)];
      persistNodes(next);
      setSelectedNodeId(created.node_id);
      setNodeDraft("");
      setStatus("Node created");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to create node");
    } finally {
      setBusy(false);
    }
  };

  const onSaveText = async () => {
    if (!selectedNodeId || !infoDraft.trim()) return;
    setBusy(true);
    try {
      await request(`/v1/nodes/${selectedNodeId}/information`, {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, type: "Text box", information: infoDraft.trim() }),
      });
      await loadNodeDetails(selectedNodeId);
      setInfoDraft("");
      setStatus("Text saved");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save text");
    } finally {
      setBusy(false);
    }
  };

  const onCreateRelation = async () => {
    if (!selectedNodeId || !relationNodeDraft.trim()) return;
    setBusy(true);
    try {
      const related = await createNode(relationNodeDraft.trim());
      const relationPayload = relationType === "Child"
        ? { a_position: "Parent", b_position: "Child" }
        : relationType === "Parent"
          ? { a_position: "Child", b_position: "Parent" }
          : { a_position: "Peer", b_position: "Peer" };
      await request("/v1/node-relationships", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          node_id_a: selectedNodeId,
          node_id_b: related.node_id,
          ...relationPayload,
        }),
      });
      const next = [related, ...nodes.filter((item) => item.node_id !== related.node_id)];
      persistNodes(next);
      await loadNodeDetails(selectedNodeId);
      setRelationNodeDraft("");
      setStatus(`${relationType} linked`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to create relation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 11, textTransform: "uppercase" }}>[ Node Module ]</div>
        <div style={{ opacity: 0.75 }}>{busy ? "Working..." : status}</div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <input value={nodeDraft} onChange={(e) => setNodeDraft(e.target.value)} placeholder="Node title" style={{ flex: 1, padding: "4px 6px", border: "1px solid currentColor", background: "transparent", color: "inherit" }} />
        <button onClick={() => void onCreateNode()} style={{ padding: "4px 8px", border: "1px solid currentColor", background: "transparent", color: "inherit" }}>+</button>
      </div>
      <select value={selectedNodeId} onChange={(e) => setSelectedNodeId(e.target.value)} style={{ padding: "4px 6px", border: "1px solid currentColor", background: "transparent", color: "inherit" }}>
        <option value="">Select node</option>
        {nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.header}</option>)}
      </select>
      <div style={{ display: "flex", gap: 4 }}>
        <input value={infoDraft} onChange={(e) => setInfoDraft(e.target.value)} placeholder="Text box data" style={{ flex: 1, padding: "4px 6px", border: "1px solid currentColor", background: "transparent", color: "inherit" }} />
        <button onClick={() => void onSaveText()} style={{ padding: "4px 8px", border: "1px solid currentColor", background: "transparent", color: "inherit" }}>Save</button>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <select value={relationType} onChange={(e) => setRelationType(e.target.value as "Child" | "Parent" | "Peer")} style={{ padding: "4px 6px", border: "1px solid currentColor", background: "transparent", color: "inherit" }}>
          <option value="Child">Child</option>
          <option value="Parent">Parent</option>
          <option value="Peer">Peer</option>
        </select>
        <input value={relationNodeDraft} onChange={(e) => setRelationNodeDraft(e.target.value)} placeholder="Related title" style={{ flex: 1, padding: "4px 6px", border: "1px solid currentColor", background: "transparent", color: "inherit" }} />
        <button onClick={() => void onCreateRelation()} style={{ padding: "4px 8px", border: "1px solid currentColor", background: "transparent", color: "inherit" }}>Link</button>
      </div>
      <div style={{ ...divider, borderTop: "1px solid currentColor", paddingTop: 4 }}>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Text</div>
        {(details?.information || []).slice(-2).map((item) => <div key={item.information_id}>• {item.information}</div>)}
        {!details?.information?.length && <div style={{ opacity: 0.75 }}>No text yet</div>}
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 2 }}>Relations</div>
        {(details?.relationships || []).slice(-2).map((item) => (
          <div key={item.node_relationship_id}>
            • {item.node_id_a === selectedNodeId ? `${item.b_position}: ${item.node_id_b}` : `${item.a_position}: ${item.node_id_a}`}
          </div>
        ))}
        {!details?.relationships?.length && <div style={{ opacity: 0.75 }}>No relations yet</div>}
      </div>
      <div style={{ opacity: 0.7 }}>API: {apiBase}</div>
    </div>
  );
};
