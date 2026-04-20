import React, { useEffect, useMemo, useRef, useState } from "react";

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

type NodeDirection = "left" | "right" | "top" | "bottom";
type NodePosition = { x: number; y: number };
type RelationshipAnchor = { from: NodeDirection; to: NodeDirection };

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

const NODE_W = 148;
const NODE_H = 96;
const MINI_GRID = 12;

function trimOrEmpty(value: string): string {
  return value.trim();
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function snapToGrid(value: number): number {
  return Math.round(value / MINI_GRID) * MINI_GRID;
}

function oppositeSide(direction: NodeDirection): NodeDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

function relationFromDirection(direction: NodeDirection): { a: "Parent" | "Child" | "Peer"; b: "Parent" | "Child" | "Peer" } {
  if (direction === "left" || direction === "right") return { a: "Peer", b: "Peer" };
  if (direction === "top") return { a: "Parent", b: "Child" };
  return { a: "Child", b: "Parent" };
}

export const NodesContent: React.FC<{ accent: string }> = ({ accent }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 420 });
  const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>({});

  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [relationships, setRelationships] = useState<NodeRelationship[]>([]);
  const [relationshipAnchors, setRelationshipAnchors] = useState<Record<string, RelationshipAnchor>>({});
  const [selectedNodeID, setSelectedNodeID] = useState<string>("");
  const [details, setDetails] = useState<NodeDetails | null>(null);
  const [newNodeHeader, setNewNodeHeader] = useState("");
  const [infoType, setInfoType] = useState<(typeof INFO_TYPES)[number]>("Text box");
  const [infoDraft, setInfoDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [dragState, setDragState] = useState<{ nodeID: string; pointerID: number; offsetX: number; offsetY: number } | null>(null);

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
      const nextNodes = payload.nodes ?? [];
      setNodes(nextNodes);
      if (!selectedNodeID && nextNodes.length > 0) {
        setSelectedNodeID(nextNodes[0].node_id);
      }
      if (selectedNodeID && !nextNodes.some((item) => item.node_id === selectedNodeID)) {
        setSelectedNodeID(nextNodes[0]?.node_id ?? "");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_load_nodes");
    } finally {
      setLoading(false);
    }
  };

  const loadGraphRelationships = async (graphNodes: NodeRecord[]) => {
    if (graphNodes.length === 0) {
      setRelationships([]);
      return;
    }
    try {
      const detailPayloads = await Promise.all(
        graphNodes.map((node) => requestJSON<NodeDetails>(`/v1/nodes/${node.node_id}?company_id=${encodeURIComponent(companyID)}`))
      );
      const dedup = new Map<string, NodeRelationship>();
      for (const detail of detailPayloads) {
        for (const rel of detail.relationships ?? []) dedup.set(rel.node_relationship_id, rel);
      }
      setRelationships(Array.from(dedup.values()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_load_relationships");
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
    void loadGraphRelationships(nodes);
  }, [nodes]);

  useEffect(() => {
    void loadDetails(selectedNodeID);
  }, [selectedNodeID]);

  useEffect(() => {
    const resize = () => {
      const bounds = canvasRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setCanvasSize({ width: Math.max(200, Math.floor(bounds.width)), height: Math.max(220, Math.floor(bounds.height)) });
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    const maxX = Math.max(0, canvasSize.width - NODE_W);
    const maxY = Math.max(0, canvasSize.height - NODE_H);

    setNodePositions((previous) => {
      const next: Record<string, NodePosition> = {};
      for (const [index, node] of nodes.entries()) {
        const existing = previous[node.node_id];
        if (existing) {
          next[node.node_id] = { x: clamp(snapToGrid(existing.x), 0, maxX), y: clamp(snapToGrid(existing.y), 0, maxY) };
          continue;
        }
        const perRow = Math.max(1, Math.floor(canvasSize.width / (NODE_W + 24)));
        const x = snapToGrid((index % perRow) * (NODE_W + 24) + 16);
        const y = snapToGrid(Math.floor(index / perRow) * (NODE_H + 24) + 16);
        next[node.node_id] = { x: clamp(x, 0, maxX), y: clamp(y, 0, maxY) };
      }
      return next;
    });
  }, [nodes, canvasSize.width, canvasSize.height]);

  useEffect(() => {
    if (!dragState) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerID || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      const maxX = Math.max(0, bounds.width - NODE_W);
      const maxY = Math.max(0, bounds.height - NODE_H);
      const x = clamp(snapToGrid(event.clientX - bounds.left - dragState.offsetX), 0, maxX);
      const y = clamp(snapToGrid(event.clientY - bounds.top - dragState.offsetY), 0, maxY);
      setNodePositions((previous) => ({ ...previous, [dragState.nodeID]: { x, y } }));
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId === dragState.pointerID) setDragState(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragState]);

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

  const createLinkedNode = async (sourceNodeID: string, direction: NodeDirection) => {
    const sourceNode = nodes.find((node) => node.node_id === sourceNodeID);
    if (!sourceNode) return;

    const node = await createNode(`${sourceNode.header} ${direction}`);
    if (!node) return;

    try {
      const pair = relationFromDirection(direction);
      const relationship = await requestJSON<NodeRelationship>("/v1/node-relationships", {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          node_id_a: sourceNodeID,
          node_id_b: node.node_id,
          a_position: pair.a,
          b_position: pair.b,
        }),
      });

      const origin = nodePositions[sourceNodeID] ?? { x: 24, y: 24 };
      const gap = 154;
      const shift =
        direction === "left" ? { x: -gap, y: 0 }
          : direction === "right" ? { x: gap, y: 0 }
            : direction === "top" ? { x: 0, y: -116 }
              : { x: 0, y: 116 };

      const maxX = Math.max(0, canvasSize.width - NODE_W);
      const maxY = Math.max(0, canvasSize.height - NODE_H);
      setNodePositions((previous) => ({
        ...previous,
        [node.node_id]: {
          x: clamp(snapToGrid(origin.x + shift.x), 0, maxX),
          y: clamp(snapToGrid(origin.y + shift.y), 0, maxY),
        },
      }));
      setRelationshipAnchors((previous) => ({
        ...previous,
        [relationship.node_relationship_id]: { from: direction, to: oppositeSide(direction) },
      }));

      await loadDetails(sourceNodeID);
      await loadGraphRelationships([...nodes, node]);
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
      setNodePositions((previous) => {
        const next = { ...previous };
        delete next[removedID];
        return next;
      });
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

  const selectedNode = useMemo(
    () => nodes.find((item) => item.node_id === selectedNodeID) ?? null,
    [nodes, selectedNodeID]
  );

  const nodeByID = useMemo(() => Object.fromEntries(nodes.map((node) => [node.node_id, node])), [nodes]);

  const getAnchorPoint = (nodeID: string, side: NodeDirection) => {
    const pos = nodePositions[nodeID];
    if (!pos) return { x: 0, y: 0 };
    if (side === "left") return { x: pos.x, y: pos.y + NODE_H / 2 };
    if (side === "right") return { x: pos.x + NODE_W, y: pos.y + NODE_H / 2 };
    if (side === "top") return { x: pos.x + NODE_W / 2, y: pos.y };
    return { x: pos.x + NODE_W / 2, y: pos.y + NODE_H };
  };

  const inferAnchor = (relationship: NodeRelationship): RelationshipAnchor => {
    if (relationshipAnchors[relationship.node_relationship_id]) return relationshipAnchors[relationship.node_relationship_id];
    if (relationship.a_position === "Parent" && relationship.b_position === "Child") return { from: "top", to: "bottom" };
    if (relationship.a_position === "Child" && relationship.b_position === "Parent") return { from: "bottom", to: "top" };
    const a = nodePositions[relationship.node_id_a];
    const b = nodePositions[relationship.node_id_b];
    if (!a || !b) return { from: "right", to: "left" };
    return b.x >= a.x ? { from: "right", to: "left" } : { from: "left", to: "right" };
  };

  const connectionPaths = useMemo(() => {
    const maxX = canvasSize.width;
    const maxY = canvasSize.height;
    return relationships
      .filter((rel) => nodeByID[rel.node_id_a] && nodeByID[rel.node_id_b])
      .map((rel) => {
        const anchor = inferAnchor(rel);
        const from = getAnchorPoint(rel.node_id_a, anchor.from);
        const to = getAnchorPoint(rel.node_id_b, anchor.to);
        const lane = MINI_GRID * 2;
        const fromOut = anchor.from === "left" ? { x: from.x - lane, y: from.y }
          : anchor.from === "right" ? { x: from.x + lane, y: from.y }
            : anchor.from === "top" ? { x: from.x, y: from.y - lane }
              : { x: from.x, y: from.y + lane };
        const toIn = anchor.to === "left" ? { x: to.x - lane, y: to.y }
          : anchor.to === "right" ? { x: to.x + lane, y: to.y }
            : anchor.to === "top" ? { x: to.x, y: to.y - lane }
              : { x: to.x, y: to.y + lane };

        const horizontalFirst = anchor.from === "left" || anchor.from === "right";
        const cornerA = horizontalFirst ? { x: toIn.x, y: fromOut.y } : { x: fromOut.x, y: toIn.y };
        const points = [from, fromOut, cornerA, toIn, to].map((point) => ({
          x: clamp(snapToGrid(point.x), 0, maxX),
          y: clamp(snapToGrid(point.y), 0, maxY),
        }));
        return { id: rel.node_relationship_id, points };
      });
  }, [relationships, nodeByID, nodePositions, canvasSize.width, canvasSize.height, relationshipAnchors]);

  return (
    <div style={{ display: "grid", gap: 8, fontSize: 11, height: "100%", gridTemplateRows: "auto auto 1fr auto auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", fontWeight: 700 }}>[ Node Canvas ]</div>
        <div style={{ fontSize: 10, opacity: 0.75 }}>Drag nodes and use + handles to create relationships.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6 }}>
        <input value={newNodeHeader} onChange={(e) => setNewNodeHeader(e.target.value)} placeholder="Create node header" />
        <button onClick={() => { void createNode(newNodeHeader); setNewNodeHeader(""); }}>Add</button>
      </div>

      <div
        ref={canvasRef}
        style={{
          position: "relative",
          border: `1px solid ${accent}`,
          borderRadius: 10,
          overflow: "hidden",
          minHeight: 240,
          backgroundColor: "rgba(255,255,255,0.78)",
          backgroundImage: `linear-gradient(to right, rgba(17,17,17,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,17,17,0.08) 1px, transparent 1px)`,
          backgroundSize: `${MINI_GRID}px ${MINI_GRID}px`,
          backgroundPosition: "-1px -1px",
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
          {connectionPaths.map((path) => (
            <polyline
              key={path.id}
              points={path.points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke={accent}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.72}
            />
          ))}
        </svg>

        {nodes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", textAlign: "center", gap: 4, fontSize: 11, opacity: 0.8 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>Blank node canvas</div>
            <div>Add a node to start placing blocks.</div>
          </div>
        )}

        {nodes.map((node) => {
          const position = nodePositions[node.node_id] ?? { x: 12, y: 12 };
          const isSelected = node.node_id === selectedNodeID;

          return (
            <div
              key={node.node_id}
              style={{
                position: "absolute",
                left: position.x,
                top: position.y,
                width: NODE_W,
                height: NODE_H,
                borderRadius: 8,
                border: `1px solid ${isSelected ? accent : "#505050"}`,
                background: isSelected ? "#ffffff" : "rgba(252,252,252,0.93)",
                display: "grid",
                gridTemplateRows: "auto 1fr auto",
                boxShadow: isSelected ? "0 8px 20px rgba(0,0,0,0.18)" : "0 4px 12px rgba(0,0,0,0.12)",
                userSelect: "none",
                cursor: dragState?.nodeID === node.node_id ? "grabbing" : "grab",
                zIndex: isSelected ? 5 : 4,
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                setSelectedNodeID(node.node_id);
                setDragState({
                  nodeID: node.node_id,
                  pointerID: event.pointerId,
                  offsetX: event.clientX - bounds.left,
                  offsetY: event.clientY - bounds.top,
                });
              }}
            >
              <div style={{ borderBottom: "1px solid currentColor", padding: "8px 8px 7px", fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>
                <div style={{ whiteSpace: "normal", overflowWrap: "anywhere", maxHeight: 28, overflow: "hidden" }}>{node.header}</div>
              </div>
              <div style={{ padding: "5px 8px", fontSize: 10, display: "grid", gap: 2 }}>
                <div>ID: {node.node_id.slice(0, 8)}</div>
                <div>Info: {details?.node.node_id === node.node_id ? details.information.length : "-"}</div>
                <div>Rel: {details?.node.node_id === node.node_id ? details.relationships.length : "-"}</div>
              </div>
              <div style={{ padding: "4px 8px", fontSize: 9, opacity: 0.7 }}>drag to move</div>

              {([
                ["left", { left: -10, top: "50%", transform: "translate(-50%, -50%)" }],
                ["right", { right: -10, top: "50%", transform: "translate(50%, -50%)" }],
                ["top", { top: -10, left: "50%", transform: "translate(-50%, -50%)" }],
                ["bottom", { bottom: -10, left: "50%", transform: "translate(-50%, 50%)" }],
              ] as const).map(([direction, sideStyle]) => (
                <button
                  key={direction}
                  title={`Create ${direction} node`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void createLinkedNode(node.node_id, direction);
                  }}
                  style={{
                    position: "absolute",
                    ...sideStyle,
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    border: `1px solid ${accent}`,
                    background: "#ffffff",
                    color: accent,
                    display: isSelected ? "grid" : "none",
                    placeItems: "center",
                    fontSize: 14,
                    lineHeight: 1,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  +
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 200px) 1fr auto auto", gap: 6 }}>
        <select value={selectedNodeID} onChange={(e) => setSelectedNodeID(e.target.value)}>
          <option value="">Select node</option>
          {nodes.map((item) => (
            <option key={item.node_id} value={item.node_id}>{item.header}</option>
          ))}
        </select>
        <input value={infoDraft} onChange={(e) => setInfoDraft(e.target.value)} placeholder="Add selected-node information" disabled={!selectedNodeID} />
        <select value={infoType} onChange={(e) => setInfoType(e.target.value as (typeof INFO_TYPES)[number])} disabled={!selectedNodeID}>
          {INFO_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
        <button onClick={() => { void addInformation(); }} disabled={!selectedNodeID}>Info</button>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 10, opacity: 0.8 }}>Company: {companyID}</div>
          {selectedNode && <button onClick={() => { void deleteSelectedNode(); }}>Delete “{selectedNode.header}”</button>}
        </div>

        {loading && <div style={{ ...divider }}>Syncing with API...</div>}
        {error && <div style={{ ...divider, color: "#b00020" }}>Error: {error}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={{ ...divider, fontSize: 12 }}>[ relationships ]</div>
            <div style={{ display: "grid", gap: 2, maxHeight: 86, overflow: "auto" }}>
              {(details?.relationships ?? []).length === 0 ? <div style={{ ...divider }}>No relationships</div> : details?.relationships.map((rel) => (
                <div key={rel.node_relationship_id} style={{ ...divider, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {rel.node_id_a.slice(0, 6)}({rel.a_position}) → {rel.node_id_b.slice(0, 6)}({rel.b_position})
                </div>
              ))}
            </div>
          </div>

          <div>
            <div style={{ ...divider, fontSize: 12 }}>[ information ]</div>
            <div style={{ display: "grid", gap: 2, maxHeight: 86, overflow: "auto" }}>
              {(details?.information ?? []).length === 0 ? <div style={{ ...divider }}>No information</div> : details?.information.map((info) => (
                <div key={info.information_id} style={{ ...divider, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {info.type}: {info.information}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
