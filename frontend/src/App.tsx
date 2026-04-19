import { FormEvent, useEffect, useMemo, useState } from "react";

type NodeInfoRecord = {
  information_id: string;
  type: string;
  information: string;
};

type NodeRelationshipRecord = {
  node_relationship_id: string;
  node_id_a: string;
  node_id_b: string;
  a_position: "Parent" | "Child" | "Peer";
  b_position: "Parent" | "Child" | "Peer";
};

type NodeSummary = {
  node_id: string;
  header: string;
};

type NodeDetailsResponse = {
  node: NodeSummary;
  information: NodeInfoRecord[];
  relationships: NodeRelationshipRecord[];
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";
const COMPANY_ID = import.meta.env.VITE_COMPANY_ID ?? "11111111-1111-1111-1111-111111111111";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Request failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

export default function App() {
  const [nodes, setNodes] = useState<NodeSummary[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodeDetails, setNodeDetails] = useState<NodeDetailsResponse | null>(null);
  const [newNodeHeader, setNewNodeHeader] = useState("");
  const [newTextBox, setNewTextBox] = useState("");
  const [newRelationType, setNewRelationType] = useState<"Child" | "Parent" | "Peer">("Child");
  const [newRelationHeader, setNewRelationHeader] = useState("");
  const [status, setStatus] = useState("Ready");

  const selectedNode = useMemo(
    () => nodes.find((node) => node.node_id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  async function loadNodeDetails(nodeId: string) {
    const details = await api<NodeDetailsResponse>(`/v1/nodes/${nodeId}?company_id=${COMPANY_ID}`);
    setNodeDetails(details);
  }

  async function createNode(header: string): Promise<NodeSummary> {
    const created = await api<NodeSummary>("/v1/nodes", {
      method: "POST",
      body: JSON.stringify({ company_id: COMPANY_ID, header }),
    });
    setNodes((prev) => [...prev, created]);
    return created;
  }

  async function addTextBox(nodeId: string, information: string) {
    await api(`/v1/nodes/${nodeId}/information`, {
      method: "POST",
      body: JSON.stringify({
        company_id: COMPANY_ID,
        type: "Text box",
        information,
      }),
    });
  }

  async function createRelationship(nodeIdA: string, nodeIdB: string, relationType: "Child" | "Parent" | "Peer") {
    const payload =
      relationType === "Child"
        ? { a_position: "Parent", b_position: "Child" }
        : relationType === "Parent"
          ? { a_position: "Child", b_position: "Parent" }
          : { a_position: "Peer", b_position: "Peer" };

    await api("/v1/node-relationships", {
      method: "POST",
      body: JSON.stringify({
        company_id: COMPANY_ID,
        node_id_a: nodeIdA,
        node_id_b: nodeIdB,
        ...payload,
      }),
    });
  }

  useEffect(() => {
    // Fresh MVP starts empty until first plus click.
    setStatus("Module ready. Click + to create your first node.");
  }, []);

  async function onCreateNode(e: FormEvent) {
    e.preventDefault();
    if (!newNodeHeader.trim()) {
      setStatus("Node title is required.");
      return;
    }
    try {
      const node = await createNode(newNodeHeader.trim());
      setSelectedNodeId(node.node_id);
      await loadNodeDetails(node.node_id);
      setNewNodeHeader("");
      setStatus("Node created and saved.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function onSaveTextBox(e: FormEvent) {
    e.preventDefault();
    if (!selectedNodeId) {
      setStatus("Select or create a node first.");
      return;
    }
    if (!newTextBox.trim()) {
      setStatus("Text box cannot be blank.");
      return;
    }
    try {
      await addTextBox(selectedNodeId, newTextBox.trim());
      await loadNodeDetails(selectedNodeId);
      setNewTextBox("");
      setStatus("Text box saved to database.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  async function onCreateRelation(e: FormEvent) {
    e.preventDefault();
    if (!selectedNodeId) {
      setStatus("Create/select a root node first.");
      return;
    }
    if (!newRelationHeader.trim()) {
      setStatus("Related node title is required.");
      return;
    }

    try {
      const relationNode = await createNode(newRelationHeader.trim());
      await createRelationship(selectedNodeId, relationNode.node_id, newRelationType);
      await loadNodeDetails(selectedNodeId);
      setNewRelationHeader("");
      setStatus(`${newRelationType} node created and linked.`);
    } catch (error) {
      setStatus((error as Error).message);
    }
  }

  return (
    <div style={{ width: "100%", height: "100%", background: "#f7f7f7", padding: 24, overflow: "auto" }}>
      <h1 style={{ marginBottom: 12 }}>Node Module (MVP)</h1>
      <p style={{ marginBottom: 16, color: "#555" }}>{status}</p>

      <section style={{ border: "1px solid #ddd", borderRadius: 12, background: "#fff", padding: 16, maxWidth: 980 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2>Module Type: Node</h2>
          <form onSubmit={onCreateNode} style={{ display: "flex", gap: 8 }}>
            <input
              value={newNodeHeader}
              onChange={(event) => setNewNodeHeader(event.target.value)}
              placeholder="Node title"
              style={{ border: "1px solid #ccc", borderRadius: 8, padding: "8px 10px", minWidth: 220 }}
            />
            <button type="submit" style={{ borderRadius: 8, border: 0, background: "#111", color: "#fff", padding: "8px 14px", cursor: "pointer" }}>
              +
            </button>
          </form>
        </div>

        {nodes.length === 0 ? (
          <div style={{ border: "1px dashed #aaa", borderRadius: 10, minHeight: 140, display: "grid", placeItems: "center", color: "#666" }}>
            Blank node module. Use + to create a node.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
            <div style={{ borderRight: "1px solid #eee", paddingRight: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Nodes</h3>
              {nodes.map((node) => (
                <button
                  key={node.node_id}
                  onClick={async () => {
                    setSelectedNodeId(node.node_id);
                    await loadNodeDetails(node.node_id);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    marginBottom: 8,
                    borderRadius: 8,
                    border: selectedNodeId === node.node_id ? "1px solid #111" : "1px solid #ddd",
                    background: selectedNodeId === node.node_id ? "#f1f1f1" : "#fff",
                    padding: "8px 10px",
                    cursor: "pointer",
                  }}
                >
                  {node.header}
                </button>
              ))}
            </div>

            <div>
              <h3 style={{ marginBottom: 10 }}>{selectedNode ? `Selected: ${selectedNode.header}` : "Select a node"}</h3>

              <form onSubmit={onSaveTextBox} style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                  value={newTextBox}
                  onChange={(event) => setNewTextBox(event.target.value)}
                  placeholder="Add text box data"
                  style={{ flex: 1, border: "1px solid #ccc", borderRadius: 8, padding: "8px 10px" }}
                />
                <button type="submit" style={{ borderRadius: 8, border: 0, background: "#14532d", color: "#fff", padding: "8px 14px", cursor: "pointer" }}>
                  Save Text
                </button>
              </form>

              <form onSubmit={onCreateRelation} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 18 }}>
                <select
                  value={newRelationType}
                  onChange={(event) => setNewRelationType(event.target.value as "Child" | "Parent" | "Peer")}
                  style={{ border: "1px solid #ccc", borderRadius: 8, padding: "8px 10px" }}
                >
                  <option value="Child">Child node</option>
                  <option value="Parent">Parent node</option>
                  <option value="Peer">Peer node</option>
                </select>
                <input
                  value={newRelationHeader}
                  onChange={(event) => setNewRelationHeader(event.target.value)}
                  placeholder="Related node title"
                  style={{ flex: 1, border: "1px solid #ccc", borderRadius: 8, padding: "8px 10px" }}
                />
                <button type="submit" style={{ borderRadius: 8, border: 0, background: "#1d4ed8", color: "#fff", padding: "8px 14px", cursor: "pointer" }}>
                  Create Relation
                </button>
              </form>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                  <h4 style={{ marginBottom: 8 }}>Text Boxes (saved)</h4>
                  {nodeDetails?.information.length ? (
                    <ul style={{ paddingLeft: 18 }}>
                      {nodeDetails.information.map((info) => (
                        <li key={info.information_id}>{info.information}</li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ color: "#666" }}>No text boxes yet.</p>
                  )}
                </div>

                <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 12 }}>
                  <h4 style={{ marginBottom: 8 }}>Linked Nodes</h4>
                  {nodeDetails?.relationships.length ? (
                    <ul style={{ paddingLeft: 18 }}>
                      {nodeDetails.relationships.map((rel) => (
                        <li key={rel.node_relationship_id}>
                          {rel.node_id_a === selectedNodeId ? `${rel.b_position}: ${rel.node_id_b}` : `${rel.a_position}: ${rel.node_id_a}`}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ color: "#666" }}>No relationships yet.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
