import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
type PanelEdge = "top" | "right" | "bottom" | "left";
type NodePosition = { x: number; y: number };
type RelationshipAnchor = { from: NodeDirection; to: NodeDirection };
type NodeCanvasState = { zoom: number; pan: { x: number; y: number }; selectedNodeID: string; nodePositions: Record<string, NodePosition> };

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
const SESSION_NODE_CANVAS_STATE = new Map<string, NodeCanvasState>();
const PANEL_MIN_WIDTH = 300;
const PANEL_MIN_HEIGHT = 220;

const panelResizeHandles: { key: string; edges: Partial<Record<PanelEdge, true>>; cursor: string; style: React.CSSProperties }[] = [
  { key: "top-left", edges: { top: true, left: true }, cursor: "nwse-resize", style: { top: -6, left: -6, width: 12, height: 12 } },
  { key: "top-right", edges: { top: true, right: true }, cursor: "nesw-resize", style: { top: -6, right: -6, width: 12, height: 12 } },
  { key: "bottom-left", edges: { bottom: true, left: true }, cursor: "nesw-resize", style: { bottom: -6, left: -6, width: 12, height: 12 } },
  { key: "bottom-right", edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -6, right: -6, width: 12, height: 12 } },
  { key: "top", edges: { top: true }, cursor: "ns-resize", style: { top: -4, left: 14, right: 14, height: 8 } },
  { key: "bottom", edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -4, left: 14, right: 14, height: 8 } },
  { key: "left", edges: { left: true }, cursor: "ew-resize", style: { left: -4, top: 14, bottom: 14, width: 8 } },
  { key: "right", edges: { right: true }, cursor: "ew-resize", style: { right: -4, top: 14, bottom: 14, width: 8 } },
];

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

type NodeDocBox = { local_id: string; x: number; y: number; w: number; h: number; information_id?: string; information: string };
const NODE_DOC_LINKS_KEY = "node-doc-widget-links-v1";
const NODE_DOC_MIN_W = 180;
const NODE_DOC_MIN_H = 36;

function parseDocBox(info: NodeInformation): NodeDocBox | null {
  if (info.type !== "Text box") return null;
  try {
    const parsed = JSON.parse(info.information) as { local_id?: string; x?: number; y?: number; w?: number; h?: number; text?: string };
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number" || typeof parsed?.text !== "string") return null;
    return {
      local_id: typeof parsed.local_id === "string" && parsed.local_id.trim() ? parsed.local_id : info.information_id,
      x: parsed.x,
      y: parsed.y,
      w: typeof parsed.w === "number" ? parsed.w : 320,
      h: typeof parsed.h === "number" ? parsed.h : 52,
      information_id: info.information_id,
      information: parsed.text,
    };
  } catch {
    return { local_id: info.information_id, x: 24, y: 56, w: 320, h: 52, information_id: info.information_id, information: info.information };
  }
}

export const NodeDocContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }> = ({ accent, widgetId }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const scope = widgetId?.trim() ? widgetId : "global";
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [linkedCanvasWidgetID, setLinkedCanvasWidgetID] = useState("");
  const [linkedNodeID, setLinkedNodeID] = useState("");
  const [linkedNodeHeader, setLinkedNodeHeader] = useState("");
  const [linkedNodeInfoPreview, setLinkedNodeInfoPreview] = useState<string[]>([]);
  const [boxes, setBoxes] = useState<NodeDocBox[]>([]);
  const [activeBoxID, setActiveBoxID] = useState<string>("");
  const [placing, setPlacing] = useState<{ id: string; pointerID: number; dx: number; dy: number } | null>(null);
  const [resizing, setResizing] = useState<{
    id: string;
    pointerID: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startBoxX: number;
    startBoxY: number;
    edges: { top?: true; right?: true; bottom?: true; left?: true };
  } | null>(null);
  const [error, setError] = useState("");

  const requestJSON = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }, [apiBase]);

  const readLinkedCanvasWidgetID = useCallback((): string => {
    try {
      const raw = localStorage.getItem(NODE_DOC_LINKS_KEY);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as Record<string, string>;
      return typeof parsed[scope] === "string" ? parsed[scope] : "";
    } catch {
      return "";
    }
  }, [scope]);

  const readSelectedNodeFromCanvas = useCallback((canvasWidgetID: string): string => {
    if (!canvasWidgetID) return "";
    try {
      const raw = localStorage.getItem(`node-canvas-state-v3:${companyID}:${canvasWidgetID}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw) as { selectedNodeID?: string };
      return typeof parsed.selectedNodeID === "string" ? parsed.selectedNodeID : "";
    } catch {
      return "";
    }
  }, [companyID]);

  const saveBox = useCallback(async (nodeID: string, box: NodeDocBox) => {
    const payload = JSON.stringify({ local_id: box.local_id, x: box.x, y: box.y, w: box.w, h: box.h, text: box.information });
    const created = await requestJSON<NodeInformation>(`/v1/nodes/${nodeID}/information`, {
      method: "POST",
      body: JSON.stringify({ company_id: companyID, type: "Text box", information: payload }),
    });
    setBoxes((prev) => prev.map((item) => (item.local_id === box.local_id ? { ...item, information_id: created.information_id } : item)));
  }, [companyID, requestJSON]);

  useEffect(() => {
    setLinkedCanvasWidgetID(readLinkedCanvasWidgetID());
    const timer = window.setInterval(() => {
      setLinkedCanvasWidgetID(readLinkedCanvasWidgetID());
    }, 500);
    return () => window.clearInterval(timer);
  }, [readLinkedCanvasWidgetID]);

  useEffect(() => {
    setLinkedNodeID(readSelectedNodeFromCanvas(linkedCanvasWidgetID));
    const timer = window.setInterval(() => {
      setLinkedNodeID(readSelectedNodeFromCanvas(linkedCanvasWidgetID));
    }, 500);
    return () => window.clearInterval(timer);
  }, [linkedCanvasWidgetID, readSelectedNodeFromCanvas]);

  useEffect(() => {
    let cancelled = false;
    if (!linkedNodeID) {
      setBoxes([]);
      setActiveBoxID("");
      setLinkedNodeHeader("");
      setLinkedNodeInfoPreview([]);
      return;
    }
    (async () => {
      try {
        setError("");
        const details = await requestJSON<NodeDetails>(`/v1/nodes/${linkedNodeID}?company_id=${encodeURIComponent(companyID)}`);
        if (cancelled) return;
        setLinkedNodeHeader(details.node.header);
        const nonText = details.information.filter((item) => item.type !== "Text box");
        setLinkedNodeInfoPreview([
          `Text boxes: ${details.information.length - nonText.length}`,
          ...nonText.slice(0, 2).map((item) => `${item.type}: ${item.information}`),
        ]);
        const latestByBox = new Map<string, NodeDocBox>();
        const orderedInfo = [...details.information].sort((a, b) => new Date(a.updated_timestamp).getTime() - new Date(b.updated_timestamp).getTime());
        for (const info of orderedInfo) {
          const parsed = parseDocBox(info);
          if (!parsed) continue;
          latestByBox.set(parsed.local_id, parsed);
        }
        const nextBoxes = Array.from(latestByBox.values());
        setBoxes(nextBoxes);
        if (nextBoxes.length > 0) setActiveBoxID(nextBoxes[nextBoxes.length - 1].local_id);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Failed to load linked node information");
      }
    })();
    return () => { cancelled = true; };
  }, [companyID, linkedNodeID, requestJSON]);

  useEffect(() => {
    if (!placing || !canvasRef.current) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== placing.pointerID || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      const x = clamp(event.clientX - bounds.left - placing.dx, 8, Math.max(8, bounds.width - 140));
      const y = clamp(event.clientY - bounds.top - placing.dy, 34, Math.max(34, bounds.height - 40));
      setBoxes((prev) => prev.map((item) => (item.local_id === placing.id ? { ...item, x, y } : item)));
    };
    const onUp = () => {
      const moved = boxes.find((item) => item.local_id === placing.id);
      if (linkedNodeID && moved) void saveBox(linkedNodeID, moved);
      setPlacing(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [boxes, linkedNodeID, placing, saveBox]);

  useEffect(() => {
    if (!resizing || !canvasRef.current) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== resizing.pointerID || !canvasRef.current) return;
      const bounds = canvasRef.current.getBoundingClientRect();
      const dx = event.clientX - resizing.startX;
      const dy = event.clientY - resizing.startY;
      setBoxes((prev) => prev.map((item) => {
        if (item.local_id !== resizing.id) return item;
        let nextX = resizing.startBoxX;
        let nextY = resizing.startBoxY;
        let nextW = resizing.startW;
        let nextH = resizing.startH;
        if (resizing.edges.right) nextW = resizing.startW + dx;
        if (resizing.edges.bottom) nextH = resizing.startH + dy;
        if (resizing.edges.left) {
          nextX = resizing.startBoxX + dx;
          nextW = resizing.startW - dx;
        }
        if (resizing.edges.top) {
          nextY = resizing.startBoxY + dy;
          nextH = resizing.startH - dy;
        }
        nextW = clamp(nextW, NODE_DOC_MIN_W, Math.max(NODE_DOC_MIN_W, bounds.width - 12));
        nextH = clamp(nextH, NODE_DOC_MIN_H, Math.max(NODE_DOC_MIN_H, bounds.height - 12));
        nextX = clamp(nextX, 8, Math.max(8, bounds.width - nextW - 8));
        nextY = clamp(nextY, 34, Math.max(34, bounds.height - nextH - 8));
        return { ...item, x: nextX, y: nextY, w: nextW, h: nextH };
      }));
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== resizing.pointerID) return;
      const next = boxes.find((item) => item.local_id === resizing.id);
      if (linkedNodeID && next) void saveBox(linkedNodeID, next);
      setResizing(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [boxes, linkedNodeID, resizing, saveBox]);

  const createBox = useCallback((initialText: string, x?: number, y?: number) => {
    const baseX = typeof x === "number" ? x : 24 + (boxes.length % 6) * 18;
    const baseY = typeof y === "number" ? y : 56 + (boxes.length % 6) * 14;
    const localID = `docbox-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    const next: NodeDocBox = { local_id: localID, x: baseX, y: baseY, w: 320, h: 52, information: initialText };
    setBoxes((prev) => [...prev, next]);
    setActiveBoxID(localID);
    if (linkedNodeID) void saveBox(linkedNodeID, next);
  }, [boxes.length, linkedNodeID, saveBox]);

  return (
    <div
      ref={canvasRef}
      style={{ position: "relative", width: "100%", height: "100%", background: "#ffffff", color: "#0d1a1e", overflow: "hidden" }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
        const current = boxes.find((item) => item.local_id === activeBoxID);
        if (current) return;
        createBox(event.key);
        event.preventDefault();
      }}
      onDoubleClick={(event) => {
        if (!canvasRef.current) return;
        const bounds = canvasRef.current.getBoundingClientRect();
        const x = clamp(event.clientX - bounds.left, 12, Math.max(12, bounds.width - 340));
        const y = clamp(event.clientY - bounds.top, 40, Math.max(40, bounds.height - 90));
        createBox("", x, y);
      }}
    >
      {linkedNodeHeader && (
        <div style={{ position: "absolute", top: 8, left: 10, right: 12, display: "grid", gap: 2, pointerEvents: "none" }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: accent }}>
            Node: {linkedNodeHeader}
          </div>
          <div style={{ fontSize: 10, opacity: 0.7 }}>
            {linkedNodeInfoPreview.length > 0 ? linkedNodeInfoPreview.join(" • ") : "No non-text node information yet"}
          </div>
        </div>
      )}
      {boxes.map((box) => (
        <div key={box.local_id} style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, minWidth: NODE_DOC_MIN_W, minHeight: NODE_DOC_MIN_H }}>
          <textarea
            value={box.information}
            onFocus={() => setActiveBoxID(box.local_id)}
            onChange={(event) => {
              const value = event.target.value;
              setBoxes((prev) => prev.map((item) => (item.local_id === box.local_id ? { ...item, information: value } : item)));
            }}
            onBlur={() => {
              if (!linkedNodeID) return;
              const latest = boxes.find((item) => item.local_id === box.local_id);
              if (latest) void saveBox(linkedNodeID, latest);
            }}
            style={{
              width: "100%",
              height: "100%",
              border: "1px solid rgba(0,0,0,0.38)",
              outline: box.local_id === activeBoxID ? `1px solid ${accent}` : "none",
              background: "rgba(255,255,255,0.42)",
              resize: "none",
              color: "#111",
              fontSize: 15,
              lineHeight: 1.45,
              fontFamily: "'Manrope', 'Helvetica Neue', sans-serif",
              padding: "6px 8px",
            }}
          />
          {([
            [{ top: true, left: true }, { top: -5, left: -5, cursor: "nwse-resize" }],
            [{ top: true }, { top: -5, left: 10, right: 10, height: 8, cursor: "ns-resize" }],
            [{ top: true, right: true }, { top: -5, right: -5, cursor: "nesw-resize" }],
            [{ right: true }, { top: 10, right: -5, bottom: 10, width: 8, cursor: "ew-resize" }],
            [{ bottom: true, right: true }, { bottom: -5, right: -5, cursor: "nwse-resize" }],
            [{ bottom: true }, { bottom: -5, left: 10, right: 10, height: 8, cursor: "ns-resize" }],
            [{ bottom: true, left: true }, { bottom: -5, left: -5, cursor: "nesw-resize" }],
            [{ left: true }, { top: 10, left: -5, bottom: 10, width: 8, cursor: "ew-resize" }],
          ] as const).map(([edges, style], index) => (
            <div
              key={`${box.local_id}-resize-${index}`}
              style={{ position: "absolute", ...style }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setActiveBoxID(box.local_id);
                setResizing({
                  id: box.local_id,
                  pointerID: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  startW: box.w,
                  startH: box.h,
                  startBoxX: box.x,
                  startBoxY: box.y,
                  edges,
                });
              }}
            />
          ))}
        </div>
      ))}
      {boxes.map((box) => (
        <div
          key={`${box.local_id}-handle`}
          style={{ position: "absolute", left: box.x - 12, top: box.y + 6, width: 8, height: 22, borderRadius: 999, background: "rgba(0,0,0,0.16)", cursor: "grab" }}
          onPointerDown={(event) => {
            event.preventDefault();
            setActiveBoxID(box.local_id);
            setPlacing({ id: box.local_id, pointerID: event.pointerId, dx: event.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0) - box.x, dy: event.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0) - box.y });
          }}
        />
      ))}
      {error && <div style={{ position: "absolute", bottom: 8, left: 10, fontSize: 10, color: "#b00020" }}>{error}</div>}
      {!linkedCanvasWidgetID && <div style={{ position: "absolute", top: 12, left: 10, fontSize: 11, opacity: 0.72 }}>Right-click selected modules and use “Link nodes”.</div>}
      {linkedCanvasWidgetID && !linkedNodeID && <div style={{ position: "absolute", top: 12, left: 10, fontSize: 11, opacity: 0.72 }}>Select a node in Node Canvas (Shift/Ctrl-click modules to multi-select and link).</div>}
    </div>
  );
};

export const NodesContent: React.FC<{ accent: string; widgetId?: string; hideTopControls?: boolean }> = ({ accent, widgetId, hideTopControls: _hideTopControls }) => {
  const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ?? "http://localhost:8080";
  const companyID = (import.meta.env.VITE_COMPANY_ID as string | undefined)?.trim() ?? "11111111-1111-1111-1111-111111111111";
  const canvasScope = widgetId?.trim() ? widgetId : "global";
  const canvasStateKey = `node-canvas-state-v3:${companyID}:${canvasScope}`;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1000, height: 560 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panInitialized, setPanInitialized] = useState(false);
  const [restoredViewport, setRestoredViewport] = useState(false);

  const WORLD_W = 3200;
  const WORLD_H = 2200;

  const [nodePositions, setNodePositions] = useState<Record<string, NodePosition>>({});
  const [nodes, setNodes] = useState<NodeRecord[]>([]);
  const [relationships, setRelationships] = useState<NodeRelationship[]>([]);
  const [relationshipAnchors, setRelationshipAnchors] = useState<Record<string, RelationshipAnchor>>({});
  const [selectedNodeID, setSelectedNodeID] = useState<string>("");
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<NodeDetails | null>(null);
  const [newNodeHeader, setNewNodeHeader] = useState("");
  const [infoType, setInfoType] = useState<(typeof INFO_TYPES)[number]>("Text box");
  const [infoDraft, setInfoDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailsPanelNodeID, setDetailsPanelNodeID] = useState<string>("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; worldX: number; worldY: number } | null>(null);
  const [nodeContextMenu, setNodeContextMenu] = useState<{ x: number; y: number; nodeID: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ nodeIDs: string[] } | null>(null);
  const [canvasActive, setCanvasActive] = useState(false);
  const [panelRect, setPanelRect] = useState({ x: 0, y: 10, width: 340, height: 360 });
  const [panelDrag, setPanelDrag] = useState<{ pointerID: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [panelResize, setPanelResize] = useState<{
    pointerID: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
    edges: Partial<Record<PanelEdge, true>>;
  } | null>(null);

  const [dragState, setDragState] = useState<{ nodeIDs: string[]; pointerID: number; offsets: Record<string, { x: number; y: number }> } | null>(null);
  const [panState, setPanState] = useState<{ pointerID: number; startMouseX: number; startMouseY: number; startPanX: number; startPanY: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number; active: boolean }>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    active: false,
  });
  const [selectionPointerID, setSelectionPointerID] = useState<number | null>(null);
  const restoredSelectionRef = useRef<string>("");

  useEffect(() => {
    const cached = SESSION_NODE_CANVAS_STATE.get(canvasStateKey);
    if (cached) {
      setZoom(clamp(cached.zoom, 0.45, 2.7));
      setPan(cached.pan);
      setPanInitialized(true);
      restoredSelectionRef.current = cached.selectedNodeID;
      setSelectedNodeID(cached.selectedNodeID);
      setSelectedNodeIDs(cached.selectedNodeID ? new Set([cached.selectedNodeID]) : new Set());
      setNodePositions(cached.nodePositions);
      setRestoredViewport(true);
      return;
    }
    try {
      const raw = localStorage.getItem(canvasStateKey);
      if (!raw) {
        setRestoredViewport(true);
        return;
      }
      const parsed = JSON.parse(raw) as {
        zoom?: number;
        pan?: { x?: number; y?: number };
        selectedNodeID?: string;
        nodePositions?: Record<string, { x?: number; y?: number }>;
      };
      if (typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)) {
        setZoom(clamp(parsed.zoom, 0.45, 2.7));
      }
      if (parsed.pan && typeof parsed.pan.x === "number" && typeof parsed.pan.y === "number") {
        setPan({ x: parsed.pan.x, y: parsed.pan.y });
        setPanInitialized(true);
      }
      if (typeof parsed.selectedNodeID === "string") {
        restoredSelectionRef.current = parsed.selectedNodeID;
        setSelectedNodeID(parsed.selectedNodeID);
        setSelectedNodeIDs(parsed.selectedNodeID ? new Set([parsed.selectedNodeID]) : new Set());
      }
      if (parsed.nodePositions && typeof parsed.nodePositions === "object") {
        const sanitized: Record<string, NodePosition> = {};
        for (const [key, value] of Object.entries(parsed.nodePositions)) {
          if (!value) continue;
          const x = typeof value.x === "number" ? value.x : 0;
          const y = typeof value.y === "number" ? value.y : 0;
          sanitized[key] = {
            x: clamp(snapToGrid(x), 0, WORLD_W - NODE_W),
            y: clamp(snapToGrid(y), 0, WORLD_H - NODE_H),
          };
        }
        setNodePositions(sanitized);
      }
    } catch {
      // ignore local cache parse errors
    } finally {
      setRestoredViewport(true);
    }
  }, [canvasStateKey]);

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

      const hasSelection = selectedNodeID && nextNodes.some((item) => item.node_id === selectedNodeID);
      if (hasSelection) return;

      const restoredSelection = restoredSelectionRef.current;
      if (restoredSelection && nextNodes.some((item) => item.node_id === restoredSelection)) {
        setSelectedNodeID(restoredSelection);
        setSelectedNodeIDs(new Set([restoredSelection]));
        return;
      }

      const fallback = nextNodes[0]?.node_id ?? "";
      setSelectedNodeID(fallback);
      setSelectedNodeIDs(fallback ? new Set([fallback]) : new Set());
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
    if (!detailsPanelNodeID) return;
    void loadDetails(detailsPanelNodeID);
  }, [detailsPanelNodeID]);

  useEffect(() => {
    const resize = () => {
      const bounds = viewportRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setCanvasSize({ width: Math.max(420, Math.floor(bounds.width)), height: Math.max(360, Math.floor(bounds.height)) });
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (panInitialized || !restoredViewport) return;
    const centeredX = canvasSize.width / 2 - (WORLD_W * zoom) / 2;
    const centeredY = canvasSize.height / 2 - (WORLD_H * zoom) / 2;
    setPan({ x: centeredX, y: centeredY });
    setPanInitialized(true);
  }, [panInitialized, restoredViewport, canvasSize.width, canvasSize.height, zoom]);

  useEffect(() => {
    if (!restoredViewport) return;
    try {
      const nextState = { zoom, pan, selectedNodeID, nodePositions };
      SESSION_NODE_CANVAS_STATE.set(canvasStateKey, nextState);
      localStorage.setItem(canvasStateKey, JSON.stringify(nextState));
    } catch {
      // ignore local storage quota/security errors
    }
  }, [canvasStateKey, restoredViewport, zoom, pan, selectedNodeID, nodePositions]);

  useEffect(() => {
    setNodePositions((previous) => {
      if (nodes.length === 0) return previous;
      const next: Record<string, NodePosition> = {};
      for (const [index, node] of nodes.entries()) {
        const existing = previous[node.node_id];
        if (existing) {
          next[node.node_id] = {
            x: clamp(snapToGrid(existing.x), 0, WORLD_W - NODE_W),
            y: clamp(snapToGrid(existing.y), 0, WORLD_H - NODE_H),
          };
          continue;
        }
        const perRow = Math.max(1, Math.floor(canvasSize.width / (NODE_W + 40)));
        const x = snapToGrid((index % perRow) * (NODE_W + 26) + 100);
        const y = snapToGrid(Math.floor(index / perRow) * (NODE_H + 26) + 120);
        next[node.node_id] = { x: clamp(x, 0, WORLD_W - NODE_W), y: clamp(y, 0, WORLD_H - NODE_H) };
      }
      return next;
    });
  }, [nodes, canvasSize.width]);

  useEffect(() => {
    if (!dragState) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerID || !viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      const mouseX = event.clientX - bounds.left;
      const mouseY = event.clientY - bounds.top;
      setNodePositions((previous) => {
        const next = { ...previous };
        for (const nodeID of dragState.nodeIDs) {
          const offset = dragState.offsets[nodeID];
          if (!offset) continue;
          const worldX = (mouseX - pan.x) / zoom - offset.x;
          const worldY = (mouseY - pan.y) / zoom - offset.y;
          next[nodeID] = {
            x: clamp(snapToGrid(worldX), 0, WORLD_W - NODE_W),
            y: clamp(snapToGrid(worldY), 0, WORLD_H - NODE_H),
          };
        }
        return next;
      });
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
  }, [dragState, pan.x, pan.y, zoom]);

  useEffect(() => {
    if (!panState) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== panState.pointerID) return;
      const dx = event.clientX - panState.startMouseX;
      const dy = event.clientY - panState.startMouseY;
      setPan({ x: panState.startPanX + dx, y: panState.startPanY + dy });
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId === panState.pointerID) setPanState(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [panState]);

  useEffect(() => {
    if (selectionPointerID === null || !selectionBox.active) return;

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== selectionPointerID) return;
      if (!viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      setSelectionBox((previous) => ({
        ...previous,
        currentX: clamp(event.clientX - bounds.left, 0, bounds.width),
        currentY: clamp(event.clientY - bounds.top, 0, bounds.height),
      }));
    };

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== selectionPointerID || !viewportRef.current) return;
      const minX = Math.min(selectionBox.startX, selectionBox.currentX);
      const maxX = Math.max(selectionBox.startX, selectionBox.currentX);
      const minY = Math.min(selectionBox.startY, selectionBox.currentY);
      const maxY = Math.max(selectionBox.startY, selectionBox.currentY);

      const selected = nodes.filter((node) => {
        const pos = nodePositions[node.node_id];
        if (!pos) return false;
        const left = pos.x * zoom + pan.x;
        const top = pos.y * zoom + pan.y;
        const right = left + NODE_W * zoom;
        const bottom = top + NODE_H * zoom;
        return right >= minX && left <= maxX && bottom >= minY && top <= maxY;
      });

      const nextSet = new Set(selected.map((item) => item.node_id));
      setSelectedNodeIDs(nextSet);
      if (selected.length > 0) setSelectedNodeID(selected[0].node_id);
      setSelectionPointerID(null);
      setSelectionBox((previous) => ({ ...previous, active: false }));
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [selectionPointerID, selectionBox, nodes, nodePositions, zoom, pan.x, pan.y]);

  useEffect(() => {
    const onWindowPointerDown = () => {
      setContextMenu(null);
      setNodeContextMenu(null);
    };
    window.addEventListener("pointerdown", onWindowPointerDown);
    return () => window.removeEventListener("pointerdown", onWindowPointerDown);
  }, []);

  useEffect(() => {
    const onWindowPointerDown = (event: PointerEvent) => {
      if (viewportRef.current?.contains(event.target as Node)) return;
      setCanvasActive(false);
    };
    window.addEventListener("pointerdown", onWindowPointerDown, true);
    return () => window.removeEventListener("pointerdown", onWindowPointerDown, true);
  }, []);

  useEffect(() => {
    if (!widgetId) return;
    const eventName = `nodes:create:${widgetId}`;
    const onCreate = (event: Event) => {
      const custom = event as CustomEvent<{ header?: string }>;
      const header = trimOrEmpty(custom.detail?.header ?? "");
      if (!header) return;
      void createNode(header);
    };
    window.addEventListener(eventName, onCreate as EventListener);
    return () => window.removeEventListener(eventName, onCreate as EventListener);
  }, [widgetId]);

  const createNode = async (header: string, worldPos?: { x: number; y: number }): Promise<NodeRecord | null> => {
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
      setSelectedNodeIDs(new Set([node.node_id]));
      if (worldPos) {
        setNodePositions((previous) => ({
          ...previous,
          [node.node_id]: {
            x: clamp(snapToGrid(worldPos.x - NODE_W / 2), 0, WORLD_W - NODE_W),
            y: clamp(snapToGrid(worldPos.y - NODE_H / 2), 0, WORLD_H - NODE_H),
          },
        }));
      }
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

      const origin = nodePositions[sourceNodeID] ?? { x: 120, y: 120 };
      const gap = 170;
      const shift =
        direction === "left" ? { x: -gap, y: 0 }
          : direction === "right" ? { x: gap, y: 0 }
            : direction === "top" ? { x: 0, y: -130 }
              : { x: 0, y: 130 };

      setNodePositions((previous) => ({
        ...previous,
        [node.node_id]: {
          x: clamp(snapToGrid(origin.x + shift.x), 0, WORLD_W - NODE_W),
          y: clamp(snapToGrid(origin.y + shift.y), 0, WORLD_H - NODE_H),
        },
      }));

      setRelationshipAnchors((previous) => ({
        ...previous,
        [relationship.node_relationship_id]: { from: direction, to: oppositeSide(direction) },
      }));

      await loadDetails(sourceNodeID);
      await loadGraphRelationships([...nodes, node]);
      setSelectedNodeID(node.node_id);
      setSelectedNodeIDs(new Set([node.node_id]));
      setDetailsPanelNodeID(node.node_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_create_node_relationship");
    }
  };

  const deleteNode = async (nodeID: string) => {
    if (!nodeID) return;
    setError("");
    try {
      await requestJSON<{ status: string }>(`/v1/nodes/${nodeID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      });
      setDetails((current) => (current?.node.node_id === nodeID ? null : current));
      if (detailsPanelNodeID === nodeID) setDetailsPanelNodeID("");
      await loadNodes();
      setSelectedNodeIDs((previous) => {
        const next = new Set(previous);
        next.delete(nodeID);
        return next;
      });
      setNodePositions((previous) => {
        const next = { ...previous };
        delete next[nodeID];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_node");
    }
  };

  const deleteNodes = async (nodeIDs: string[]) => {
    const unique = Array.from(new Set(nodeIDs.filter(Boolean)));
    if (unique.length === 0) return;
    setError("");
    try {
      await Promise.all(unique.map((nodeID) => requestJSON<{ status: string }>(`/v1/nodes/${nodeID}?company_id=${encodeURIComponent(companyID)}`, {
        method: "DELETE",
      })));
      setDetails((current) => (current && unique.includes(current.node.node_id) ? null : current));
      if (detailsPanelNodeID && unique.includes(detailsPanelNodeID)) setDetailsPanelNodeID("");
      await loadNodes();
      setSelectedNodeID("");
      setSelectedNodeIDs(new Set());
      setNodePositions((previous) => {
        const next = { ...previous };
        for (const id of unique) delete next[id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_delete_node");
    }
  };

  const addInformation = async (nodeID: string) => {
    if (!nodeID || !trimOrEmpty(infoDraft)) return;
    setError("");
    try {
      await requestJSON<NodeInformation>(`/v1/nodes/${nodeID}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: infoType,
          information: trimOrEmpty(infoDraft),
        }),
      });
      setInfoDraft("");
      await loadDetails(nodeID);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed_to_add_node_information");
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!canvasActive) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const nodeIDs = selectedNodeIDs.size > 0 ? Array.from(selectedNodeIDs) : (selectedNodeID ? [selectedNodeID] : []);
      if (nodeIDs.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      setConfirmDelete({ nodeIDs });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [canvasActive, selectedNodeID, selectedNodeIDs]);

  useEffect(() => {
    if (!panelDrag) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== panelDrag.pointerID || !viewportRef.current) return;
      const dx = event.clientX - panelDrag.startX;
      const dy = event.clientY - panelDrag.startY;
      const bounds = viewportRef.current.getBoundingClientRect();
      const maxX = Math.max(0, bounds.width - panelRect.width - 8);
      const maxY = Math.max(0, bounds.height - 56);
      setPanelRect((previous) => ({ ...previous, x: clamp(panelDrag.originX + dx, 0, maxX), y: clamp(panelDrag.originY + dy, 8, maxY) }));
    };
    const onUp = (event: PointerEvent) => { if (event.pointerId === panelDrag.pointerID) setPanelDrag(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [panelDrag, panelRect.width]);

  useEffect(() => {
    if (!panelResize) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== panelResize.pointerID || !viewportRef.current) return;
      const bounds = viewportRef.current.getBoundingClientRect();
      const dx = event.clientX - panelResize.startX;
      const dy = event.clientY - panelResize.startY;
      const maxX = Math.max(0, bounds.width - 8);
      const maxY = Math.max(8, bounds.height - 8);

      let nextX = panelResize.originX;
      let nextY = panelResize.originY;
      let nextW = panelResize.originW;
      let nextH = panelResize.originH;

      if (panelResize.edges.right) nextW = panelResize.originW + dx;
      if (panelResize.edges.bottom) nextH = panelResize.originH + dy;
      if (panelResize.edges.left) {
        nextX = panelResize.originX + dx;
        nextW = panelResize.originW - dx;
      }
      if (panelResize.edges.top) {
        nextY = panelResize.originY + dy;
        nextH = panelResize.originH - dy;
      }

      nextW = clamp(nextW, PANEL_MIN_WIDTH, maxX);
      nextH = clamp(nextH, PANEL_MIN_HEIGHT, maxY - 8);
      nextX = clamp(nextX, 0, maxX - nextW);
      nextY = clamp(nextY, 8, maxY - nextH);

      if (panelResize.edges.left) nextX = panelResize.originX + (panelResize.originW - nextW);
      if (panelResize.edges.top) nextY = panelResize.originY + (panelResize.originH - nextH);
      nextX = clamp(nextX, 0, maxX - nextW);
      nextY = clamp(nextY, 8, maxY - nextH);

      setPanelRect({ x: nextX, y: nextY, width: nextW, height: nextH });
    };
    const onUp = (event: PointerEvent) => { if (event.pointerId === panelResize.pointerID) setPanelResize(null); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [panelResize]);

  const detailsPanelNode = useMemo(() => nodes.find((item) => item.node_id === detailsPanelNodeID) ?? null, [nodes, detailsPanelNodeID]);
  const nodeByID = useMemo(() => Object.fromEntries(nodes.map((node) => [node.node_id, node])), [nodes]);

  useEffect(() => {
    if (!detailsPanelNode || !viewportRef.current) return;
    const bounds = viewportRef.current.getBoundingClientRect();
    setPanelRect((previous) => ({
      ...previous,
      x: previous.x === 0 ? Math.max(0, bounds.width - previous.width - 12) : clamp(previous.x, 0, Math.max(0, bounds.width - previous.width - 8)),
      y: clamp(previous.y, 8, Math.max(8, bounds.height - 56)),
    }));
  }, [detailsPanelNode]);

  const getAnchorPoint = (nodeID: string, side: NodeDirection) => {
    const pos = nodePositions[nodeID];
    if (!pos) return null;
    if (side === "left") return { x: pos.x, y: pos.y + NODE_H / 2 };
    if (side === "right") return { x: pos.x + NODE_W, y: pos.y + NODE_H / 2 };
    if (side === "top") return { x: pos.x + NODE_W / 2, y: pos.y };
    return { x: pos.x + NODE_W / 2, y: pos.y + NODE_H };
  };

  const inferAnchor = (relationship: NodeRelationship): RelationshipAnchor => {
    if (relationshipAnchors[relationship.node_relationship_id]) return relationshipAnchors[relationship.node_relationship_id];
    if (relationship.a_position === "Child" && relationship.b_position === "Parent") return { from: "top", to: "bottom" };
    if (relationship.a_position === "Parent" && relationship.b_position === "Child") return { from: "bottom", to: "top" };
    const a = nodePositions[relationship.node_id_a];
    const b = nodePositions[relationship.node_id_b];
    if (!a || !b) return { from: "right", to: "left" };
    return b.x >= a.x ? { from: "right", to: "left" } : { from: "left", to: "right" };
  };

  const connectionPaths = useMemo(() => {
    return relationships
      .filter((rel) => nodeByID[rel.node_id_a] && nodeByID[rel.node_id_b] && nodePositions[rel.node_id_a] && nodePositions[rel.node_id_b])
      .map((rel) => {
        const anchor = inferAnchor(rel);
        const from = getAnchorPoint(rel.node_id_a, anchor.from);
        const to = getAnchorPoint(rel.node_id_b, anchor.to);
        if (!from || !to) return null;
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
        const points = [from, fromOut, cornerA, toIn, to].map((point) => ({ x: snapToGrid(point.x), y: snapToGrid(point.y) }));
        return { id: rel.node_relationship_id, points };
      })
      .filter((path): path is { id: string; points: { x: number; y: number }[] } => !!path);
  }, [relationships, nodeByID, nodePositions, relationshipAnchors]);

  return (
    <div style={{ fontSize: 11, height: "100%" }}>
      <div
        ref={viewportRef}
        style={{
          position: "relative",
          overflow: "hidden",
          height: "100%",
          width: "100%",
          backgroundColor: "rgba(255,255,255,0.78)",
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setCanvasActive(true);
          setNodeContextMenu(null);
          if (!viewportRef.current) return;
          const bounds = viewportRef.current.getBoundingClientRect();
          const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
          const localY = clamp(event.clientY - bounds.top, 0, bounds.height);
          const worldX = clamp((localX - pan.x) / zoom, 0, WORLD_W);
          const worldY = clamp((localY - pan.y) / zoom, 0, WORLD_H);
          setContextMenu({ x: localX, y: localY, worldX, worldY });
        }}
        onWheel={(event) => {
          event.preventDefault();
          if (!viewportRef.current) return;
          const bounds = viewportRef.current.getBoundingClientRect();
          const cursorX = event.clientX - bounds.left;
          const cursorY = event.clientY - bounds.top;
          const worldX = (cursorX - pan.x) / zoom;
          const worldY = (cursorY - pan.y) / zoom;
          const delta = event.deltaY < 0 ? 1.1 : 0.9;
          const nextZoom = clamp(zoom * delta, 0.45, 2.7);
          setZoom(nextZoom);
          setPan({ x: cursorX - worldX * nextZoom, y: cursorY - worldY * nextZoom });
        }}
        onPointerDown={(event) => {
          if (!viewportRef.current) return;
          setCanvasActive(true);
          setContextMenu(null);
          setNodeContextMenu(null);
          const bounds = viewportRef.current.getBoundingClientRect();
          const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
          const localY = clamp(event.clientY - bounds.top, 0, bounds.height);

          if (event.ctrlKey || event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            setSelectionPointerID(event.pointerId);
            setSelectionBox({ startX: localX, startY: localY, currentX: localX, currentY: localY, active: true });
            return;
          }

          if (!(event.target as HTMLElement).closest("[data-node-card='true']")) {
            setSelectedNodeIDs(new Set());
            setSelectedNodeID("");
          }
          setPanState({
            pointerID: event.pointerId,
            startMouseX: event.clientX,
            startMouseY: event.clientY,
            startPanX: pan.x,
            startPanY: pan.y,
          });
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: WORLD_W,
            height: WORLD_H,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            backgroundImage: `linear-gradient(to right, rgba(17,17,17,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,17,17,0.08) 1px, transparent 1px)`,
            backgroundSize: `${MINI_GRID}px ${MINI_GRID}px`,
            backgroundPosition: "-1px -1px",
          }}
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

          {nodes.map((node) => {
            const position = nodePositions[node.node_id] ?? { x: 120, y: 120 };
            const isSelected = selectedNodeIDs.has(node.node_id);
            const isPrimary = node.node_id === selectedNodeID;

            return (
              <div
                key={node.node_id}
                data-node-card="true"
                style={{
                  position: "absolute",
                  left: position.x,
                  top: position.y,
                  width: NODE_W,
                  height: NODE_H,
                  borderRadius: 8,
                  border: `1px solid ${isSelected ? accent : "#505050"}`,
                  background: isSelected ? "#ffffff" : "rgba(252,252,252,0.93)",
                  outline: isSelected ? `2px solid ${accent}` : "none",
                  outlineOffset: isSelected ? 1 : 0,
                  display: "grid",
                  gridTemplateRows: "auto 1fr auto",
                  boxShadow: isSelected ? "0 0 0 3px rgba(111,231,238,0.32), 0 8px 20px rgba(0,0,0,0.2)" : "0 4px 12px rgba(0,0,0,0.12)",
                  userSelect: "none",
                  cursor: dragState?.nodeIDs.includes(node.node_id) ? "grabbing" : "grab",
                  zIndex: isPrimary ? 5 : 4,
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setDetailsPanelNodeID(node.node_id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setCanvasActive(true);
                  const bounds = viewportRef.current?.getBoundingClientRect();
                  if (!bounds) return;
                  const nextIDs = selectedNodeIDs.has(node.node_id) ? Array.from(selectedNodeIDs) : [node.node_id];
                  setSelectedNodeID(node.node_id);
                  setSelectedNodeIDs(new Set(nextIDs));
                  setContextMenu(null);
                  setNodeContextMenu({
                    x: clamp(event.clientX - bounds.left, 0, bounds.width),
                    y: clamp(event.clientY - bounds.top, 0, bounds.height),
                    nodeID: node.node_id,
                  });
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (event.ctrlKey || event.shiftKey) {
                    event.preventDefault();
                    const next = new Set(selectedNodeIDs);
                    if (next.has(node.node_id)) next.delete(node.node_id);
                    else next.add(node.node_id);
                    setSelectedNodeIDs(next);
                    setSelectedNodeID(next.has(node.node_id) ? node.node_id : (Array.from(next)[0] ?? ""));
                    return;
                  }
                  setContextMenu(null);
                  setNodeContextMenu(null);
                  const bounds = (event.currentTarget as HTMLDivElement).getBoundingClientRect();

                  const nextIDs = selectedNodeIDs.has(node.node_id) ? Array.from(selectedNodeIDs) : [node.node_id];
                  setSelectedNodeID(node.node_id);
                  setSelectedNodeIDs(new Set(nextIDs));

                  const offsets: Record<string, { x: number; y: number }> = {};
                  for (const id of nextIDs) {
                    const pos = nodePositions[id] ?? { x: 0, y: 0 };
                    const pointerWorldX = (event.clientX - bounds.left) / zoom + position.x;
                    const pointerWorldY = (event.clientY - bounds.top) / zoom + position.y;
                    offsets[id] = { x: pointerWorldX - pos.x, y: pointerWorldY - pos.y };
                  }
                  setDragState({ nodeIDs: nextIDs, pointerID: event.pointerId, offsets });
                }}
              >
                <div style={{ borderBottom: "1px solid currentColor", padding: "8px 8px 7px", fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>
                  <div style={{ whiteSpace: "normal", overflowWrap: "anywhere", maxHeight: 28, overflow: "hidden" }}>{node.header}</div>
                </div>
                {isSelected && (
                  <div style={{ position: "absolute", top: 6, right: 6, width: 12, height: 12, borderRadius: 999, background: accent, opacity: 0.85 }} />
                )}
                <div style={{ padding: "5px 8px", fontSize: 10, display: "grid", gap: 2 }}>
                  <div>ID: {node.node_id.slice(0, 8)}</div>
                  <div>Info: {details?.node.node_id === node.node_id ? details.information.length : "-"}</div>
                  <div>Rel: {details?.node.node_id === node.node_id ? details.relationships.length : "-"}</div>
                </div>
                <div style={{ padding: "4px 8px", fontSize: 9, opacity: 0.7 }}>drag to move · double-click for details</div>

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
                      display: isPrimary ? "grid" : "none",
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

        {selectionBox.active && (
          <div
            style={{
              position: "absolute",
              left: Math.min(selectionBox.startX, selectionBox.currentX),
              top: Math.min(selectionBox.startY, selectionBox.currentY),
              width: Math.abs(selectionBox.currentX - selectionBox.startX),
              height: Math.abs(selectionBox.currentY - selectionBox.startY),
              border: `1px dashed ${accent}`,
              backgroundColor: "rgba(111,231,238,0.2)",
              pointerEvents: "none",
              zIndex: 20,
            }}
          />
        )}

        {contextMenu && (
          <div
            style={{
              position: "absolute",
              left: contextMenu.x,
              top: contextMenu.y,
              transform: "translate(8px, 8px)",
              background: "rgba(255,255,255,0.95)",
              border: `1px solid ${accent}`,
              borderRadius: 8,
              padding: 4,
              zIndex: 40,
              boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "6px 8px" }}
              onClick={() => {
                const title = trimOrEmpty(newNodeHeader) || "New node";
                void createNode(title, { x: contextMenu.worldX, y: contextMenu.worldY });
                if (!trimOrEmpty(newNodeHeader)) setNewNodeHeader("");
                setContextMenu(null);
              }}
            >
              Create new node
            </button>
          </div>
        )}

        {nodeContextMenu && (
          <div
            style={{
              position: "absolute",
              left: nodeContextMenu.x,
              top: nodeContextMenu.y,
              transform: "translate(8px, 8px)",
              background: "rgba(255,255,255,0.95)",
              border: `1px solid ${accent}`,
              borderRadius: 8,
              padding: 4,
              zIndex: 41,
              boxShadow: "0 8px 22px rgba(0,0,0,0.16)",
              display: "grid",
              gap: 2,
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "6px 8px", textAlign: "left" }} onClick={() => { setDetailsPanelNodeID(nodeContextMenu.nodeID); setNodeContextMenu(null); }}>
              Edit node
            </button>
            <button style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 11, fontWeight: 700, padding: "6px 8px", color: "#a20026", textAlign: "left" }} onClick={() => { const ids = selectedNodeIDs.size > 0 ? Array.from(selectedNodeIDs) : [nodeContextMenu.nodeID]; setConfirmDelete({ nodeIDs: ids }); setNodeContextMenu(null); }}>
              Delete node
            </button>
          </div>
        )}

        {!!detailsPanelNode && (
          <div
            className="node-details-panel"
            style={{
              position: "absolute",
              top: panelRect.y,
              left: panelRect.x,
              width: panelRect.width,
              height: panelRect.height,
              boxSizing: "border-box",
              overflowY: "auto",
              overflowX: "hidden",
              zIndex: 35,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.35)",
              backgroundColor: "rgba(157, 224, 227, 0.72)",
              background: `
                linear-gradient(
                  135deg,
                  rgba(255,255,255,0.18) 0%,
                  rgba(255,255,255,0.08) 50%,
                  rgba(255,255,255,0.14) 100%
                )
              `,
              backdropFilter: "blur(30px) saturate(180%)",
              WebkitBackdropFilter: "blur(30px) saturate(180%)",
              boxShadow: `
                0 8px 32px rgba(0,0,0,0.18),
                inset 0 1px 0 rgba(255,255,255,0.6),
                inset 0 -1px 0 rgba(255,255,255,0.15)
              `,
              padding: 12,
              display: "grid",
              gap: 8,
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              color: "#1a1a1a",
              letterSpacing: "0.01em",
            }}
          >
            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "move" }}
              onPointerDown={(event) => {
                event.stopPropagation();
                setPanelDrag({ pointerID: event.pointerId, startX: event.clientX, startY: event.clientY, originX: panelRect.x, originY: panelRect.y });
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em" }}>{detailsPanelNode.header}</div>
              <button onClick={() => setDetailsPanelNodeID("")} style={{ border: "1px solid rgba(0,0,0,0.15)", background: "rgba(255,255,255,0.4)", borderRadius: 6, cursor: "pointer", width: 22, height: 22, fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 10, fontWeight: 500, opacity: 0.6, letterSpacing: "0.02em" }}>ID: {detailsPanelNode.node_id}</div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 6, alignItems: "center", minWidth: 0 }}>
              <input value={infoDraft} onChange={(e) => setInfoDraft(e.target.value)} placeholder="Add node information" style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 13, fontWeight: 400, padding: "6px 10px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 6, background: "rgba(255,255,255,0.45)", outline: "none", minWidth: 0, width: "100%" }} />
              <select value={infoType} onChange={(e) => setInfoType(e.target.value as (typeof INFO_TYPES)[number])} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 500, padding: "6px 8px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 6, background: "rgba(255,255,255,0.45)", cursor: "pointer", maxWidth: "100%" }}>
                {INFO_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <button onClick={() => { void addInformation(detailsPanelNode.node_id); }} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 600, padding: "6px 10px", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 6, background: "rgba(255,255,255,0.55)", cursor: "pointer", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>Info</button>
            </div>
            <button onClick={() => { void deleteNode(detailsPanelNode.node_id); }} style={{ justifySelf: "start", fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 600, padding: "6px 12px", border: "1px solid rgba(180,0,30,0.25)", borderRadius: 6, background: "rgba(255,255,255,0.45)", color: "#b00020", cursor: "pointer", letterSpacing: "0.02em" }}>Delete node</button>
            {loading && <div style={{ ...divider, fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>Syncing with API...</div>}
            {error && <div style={{ ...divider, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "#b00020" }}>Error: {error}</div>}
            <div>
              <div style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.7, marginBottom: 4 }}>[ relationships ]</div>
              <div style={{ display: "grid", gap: 2, maxHeight: 110, overflow: "auto" }}>
                {(details?.node.node_id === detailsPanelNode.node_id ? details.relationships : []).length === 0
                  ? <div style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, opacity: 0.55 }}>No relationships</div>
                  : (details?.relationships ?? []).map((rel) => (
                    <div key={rel.node_relationship_id} style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {rel.node_id_a.slice(0, 6)}({rel.a_position}) → {rel.node_id_b.slice(0, 6)}({rel.b_position})
                    </div>
                  ))}
              </div>
            </div>
            <div>
              <div style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.18em", opacity: 0.7, marginBottom: 4 }}>[ information ]</div>
              <div style={{ display: "grid", gap: 2, maxHeight: 130, overflow: "auto" }}>
                {(details?.node.node_id === detailsPanelNode.node_id ? details.information : []).length === 0
                  ? <div style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, opacity: 0.55 }}>No information</div>
                  : (details?.information ?? []).map((info) => (
                    <div key={info.information_id} style={{ ...divider, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, whiteSpace: "normal", overflowWrap: "anywhere" }}>
                      {info.type}: {info.information}
                    </div>
                  ))}
              </div>
            </div>
            {panelResizeHandles.map((handle) => (
              <div
                key={handle.key}
                style={{ position: "absolute", ...handle.style, cursor: handle.cursor, zIndex: 2 }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  setPanelResize({
                    pointerID: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: panelRect.x,
                    originY: panelRect.y,
                    originW: panelRect.width,
                    originH: panelRect.height,
                    edges: handle.edges,
                  });
                }}
              />
            ))}
          </div>
        )}

        {selectedNodeIDs.size > 1 && !selectionBox.active && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 10,
              zIndex: 30,
              background: "rgba(0,0,0,0.75)",
              color: "#fff",
              padding: "4px 8px",
              borderRadius: 6,
              fontSize: 10,
            }}
          >
            Group selected: {selectedNodeIDs.size}
          </div>
        )}

        {confirmDelete && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 60, display: "grid", placeItems: "center" }}>
            <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: `1px solid ${accent}`, background: "rgba(255,255,255,0.92)", padding: 12, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Are you sure you want to delete {confirmDelete.nodeIDs.length} node{confirmDelete.nodeIDs.length === 1 ? "" : "s"}?</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button onClick={() => { void deleteNodes(confirmDelete.nodeIDs); setConfirmDelete(null); }} style={{ border: `1px solid ${accent}`, background: "#d8fff6", cursor: "pointer", fontWeight: 700 }}>Yes</button>
                <button onClick={() => setConfirmDelete(null)} style={{ border: `1px solid ${accent}`, background: "#fff", cursor: "pointer", fontWeight: 700 }}>No</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
