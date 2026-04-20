import React, { useEffect, useState } from "react";

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

type NodeRecord = {
  company_id: string;
  node_id: string;
  header: string;
  created_timestamp: string;
};

type NodeRelationship = {
  company_id: string;
  node_relationship_id: string;
  node_id_a: string;
  node_id_b: string;
  a_position: "Parent" | "Child" | "Peer";
  b_position: "Parent" | "Child" | "Peer";
  created_timestamp: string;
};

type NodeInformation = {
  company_id: string;
  information_id: string;
  node_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

type NodeDetails = {
  node: NodeRecord;
  information: NodeInformation[];
  relationships: NodeRelationship[];
};

const INFO_TYPES = [
  "Text box",
  "Checklist",
  "Status",
  "Due date",
  "Employee name",
  "PDF",
  "PNG",
  "MOV",
  "Hyperlink",
] as const;

const RELATIONSHIP_POSITIONS = ["Peer", "Parent", "Child"] as const;

function trimOrEmpty(value: string): string {
  return value.trim();
}

export const NodesContent: React.FC<{ accent: string }> = ({ accent }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";

  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [selectedNodeID, setSelectedNodeID] = useState<string>("");
  const [details, setDetails] = useState<NodeDetails | null>(null);
  const [newNodeHeader, setNewNodeHeader] = useState("");
  const [relationHeader, setRelationHeader] = useState("");
  const [relationPosition, setRelationPosition] = useState<(typeof RELATIONSHIP_POSITIONS)[number]>("Peer");
  const [infoType, setInfoType] = useState<(typeof INFO_TYPES)[number]>("Text box");
  const [infoDraft, setInfoDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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

    if (response.status === 204) {
      return {} as T;
    }
    return response.json() as Promise<T>;
  };

  const loadNodes = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await requestJSON<{ nodes: NodeRecord[] }>(`/v1/nodes?company_id=${encodeURIComponent(companyID)}`);
      setNodes(payload.nodes ?? []);
      if (!selectedNodeID && payload.nodes.length > 0) {
        setSelectedNodeID(payload.nodes[0].node_id);
      }
      if (selectedNodeID && !payload.nodes.some((item) => item.node_id === selectedNodeID)) {
        setSelectedNodeID(payload.nodes[0]?.node_id ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_load_nodes");
    } finally {
      setLoading(false);
    }
  };

  const loadDetails = async (nodeID: string) => {
    if (!nodeID) {
      setDetails(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await requestJSON<NodeDetails>(`/v1/nodes/${nodeID}?company_id=${encodeURIComponent(companyID)}`);
      setDetails(payload);
    } catch (err) {
      setDetails(null);
      setError(err instanceof Error ? err.message : "failed_to_load_node");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadNodes();
  }, []);

  useEffect(() => {
    void loadDetails(selectedNodeID);
  }, [selectedNodeID]);

  const createNode = async (header: string): Promise<NodeRecord | null> => {
    const value = trimOrEmpty(header);
    if (!value) return null;
    setError("");
    try {
      const node = await requestJSON<NodeRecord>("/v1/nodes", {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, header: value }),
      });
      await loadNodes();
      setSelectedNodeID(node.node_id);
      return node;
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node");
      return null;
    }
  };

  const createLinkedNode = async () => {
    if (!selectedNodeID) return;
    const node = await createNode(relationHeader);
    if (!node) return;

    const pair = relationPosition === "Peer"
      ? { a: "Peer", b: "Peer" }
      : relationPosition === "Parent"
        ? { a: "Parent", b: "Child" }
        : { a: "Child", b: "Parent" };

    try {
      await requestJSON<NodeRelationship>("/v1/node-relationships", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          node_id_a: selectedNodeID,
          node_id_b: node.node_id,
          a_position: pair.a,
          b_position: pair.b,
        }),
      });
      setRelationHeader("");
      await loadDetails(selectedNodeID);
      await loadDetails(node.node_id);
      setSelectedNodeID(node.node_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node_relationship");
    }
  };

  const deleteSelectedNode = async () => {
    if (!selectedNodeID) return;
    setError("");
    try {
      await requestJSON<{ status: string }>(`/v1/nodes/${selectedNodeID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      });
      setDetails(null);
      const removedID = selectedNodeID;
      await loadNodes();
      if (selectedNodeID === removedID) {
        setSelectedNodeID("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_node");
    }
  };

  const addInformation = async () => {
    if (!selectedNodeID || !trimOrEmpty(infoDraft)) return;
    setError("");
    try {
      await requestJSON<NodeInformation>(`/v1/nodes/${selectedNodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: infoType,
          information: trimOrEmpty(infoDraft),
        }),
      });
      setInfoDraft("");
      await loadDetails(selectedNodeID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_add_node_information");
    }
  };

  return (
    <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
      <div style={{ fontSize: 12, textTransform: "uppercase" }}>[ Nodes ]</div>
      <div style={{ ...divider }}>Company: {companyID}</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4 }}>
        <input value={newNodeHeader} onChange={(e) => setNewNodeHeader(e.target.value)} placeholder="Create node header" />
        <button onClick={() => { void createNode(newNodeHeader); setNewNodeHeader(""); }}>Add</button>
      </div>

      <select value={selectedNodeID} onChange={(e) => setSelectedNodeID(e.target.value)}>
        <option value="">Select node</option>
        {nodes.map((item) => (
          <option key={item.node_id} value={item.node_id}>{item.header}</option>
        ))}
      </select>

      {selectedNodeID && (
        <div style={{ display: "grid", gap: 4 }}>
          <button onClick={() => { void deleteSelectedNode(); }}>Delete selected node</button>

          <div style={{ display: "grid", gridTemplateColumns: "95px 1fr auto", gap: 4 }}>
            <select value={relationPosition} onChange={(e) => setRelationPosition(e.target.value as (typeof RELATIONSHIP_POSITIONS)[number])}>
              {RELATIONSHIP_POSITIONS.map((position) => (
                <option key={position} value={position}>{position}</option>
              ))}
            </select>
            <input value={relationHeader} onChange={(e) => setRelationHeader(e.target.value)} placeholder="New related node header" />
            <button onClick={() => { void createLinkedNode(); }}>Create</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: 4 }}>
            <select value={infoType} onChange={(e) => setInfoType(e.target.value as (typeof INFO_TYPES)[number])}>
              {INFO_TYPES.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            <input value={infoDraft} onChange={(e) => setInfoDraft(e.target.value)} placeholder="Add node information" />
            <button onClick={() => { void addInformation(); }}>Info</button>
          </div>
        </div>
      )}

      {loading && <div style={{ ...divider }}>Syncing with API...</div>}
      {error && <div style={{ ...divider, color: "#b00020" }}>Error: {error}</div>}

      <div style={{ ...divider, fontSize: 12 }}>[ nodes table ]</div>
      <div style={{ display: "grid", gap: 2, maxHeight: 130, overflow: "auto" }}>
        {nodes.length === 0 ? <div style={{ ...divider }}>No nodes</div> : nodes.map((node) => (
          <div key={node.node_id} style={{ ...divider, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {node.header} · {node.node_id.slice(0, 8)}
          </div>
        ))}
      </div>

      <div style={{ ...divider, fontSize: 12 }}>[ node_relationships table ]</div>
      <div style={{ display: "grid", gap: 2, maxHeight: 130, overflow: "auto" }}>
        {(details?.relationships ?? []).length === 0 ? <div style={{ ...divider }}>No relationships</div> : details?.relationships.map((rel) => (
          <div key={rel.node_relationship_id} style={{ ...divider, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {rel.node_id_a.slice(0, 6)}({rel.a_position}) → {rel.node_id_b.slice(0, 6)}({rel.b_position})
          </div>
        ))}
      </div>

      <div style={{ ...divider, fontSize: 12 }}>[ node_information table ]</div>
      <div style={{ display: "grid", gap: 2, maxHeight: 130, overflow: "auto" }}>
        {(details?.information ?? []).length === 0 ? <div style={{ ...divider }}>No information</div> : details?.information.map((info) => (
          <div key={info.information_id} style={{ ...divider, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {info.type}: {info.information}
          </div>
        ))}
      </div>
    </div>
  );
};
