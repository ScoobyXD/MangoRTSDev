export const EXPLORER_ENTITY_DRAG_MIME = "application/x-mango-explorer-entity";

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(71,85,105,${alpha})`;
  const value = Number.parseInt(clean, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

export const KANBAN_DEFAULT_COLUMN_ITEM_COLOR = "#475569";

export const KANBAN_LOGIC_GATE_REQUESTED_COLOR = "#facc15";

export const KANBAN_LOGIC_GATE_BACKLOG_COLOR = "#8b5cf6";

export const KANBAN_LOGIC_GATE_PENDING_COLOR = "#6f7b8a";

export const KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR = "#f08a24";

export const KANBAN_LOGIC_GATE_REVIEW_COLOR = "#19a8ff";

export const KANBAN_LOGIC_GATE_DONE_COLOR = "#19c879";

export const KANBAN_NODE_PRIORITY_STYLE_OPTIONS = [
  {
    value: "1",
    label: "1\u00A0\u00A0URGENT(<1hr)",
    color: "#7f1d1d",
    borderColor: "rgba(220, 38, 38, 0.42)",
    surface: "linear-gradient(135deg, rgba(254, 226, 226, 0.96), rgba(254, 249, 195, 0.76))",
    glow: "rgba(220, 38, 38, 0.12)",
  },
  {
    value: "2",
    label: "2\u00A0\u00A0By end of day",
    color: "#7c2d12",
    borderColor: "rgba(234, 88, 12, 0.38)",
    surface: "linear-gradient(135deg, rgba(255, 247, 237, 0.96), rgba(254, 240, 138, 0.68))",
    glow: "rgba(234, 88, 12, 0.11)",
  },
  {
    value: "3",
    label: "3\u00A0\u00A0Tomorrow",
    color: "#064e3b",
    borderColor: "rgba(5, 150, 105, 0.38)",
    surface: "linear-gradient(135deg, rgba(236, 253, 245, 0.96), rgba(207, 250, 254, 0.70))",
    glow: "rgba(5, 150, 105, 0.11)",
  },
  {
    value: "4",
    label: "4\u00A0\u00A0Sprint (1 week)",
    color: "#312e81",
    borderColor: "rgba(79, 70, 229, 0.34)",
    surface: "linear-gradient(135deg, rgba(239, 246, 255, 0.96), rgba(221, 214, 254, 0.70))",
    glow: "rgba(79, 70, 229, 0.10)",
  },
  {
    value: "5",
    label: "5\u00A0\u00A0Later (low priority)",
    color: "#4c1d95",
    borderColor: "rgba(124, 58, 237, 0.30)",
    surface: "linear-gradient(135deg, rgba(248, 250, 252, 0.96), rgba(233, 213, 255, 0.62))",
    glow: "rgba(124, 58, 237, 0.10)",
  },
  {
    value: "0",
    label: "Not Assigned",
    color: "#64748b",
    borderColor: "rgba(100, 116, 139, 0.28)",
    surface: "linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(241, 245, 249, 0.76))",
    glow: "rgba(15, 23, 42, 0.08)",
  },
] as const;

export type KanbanDragPreviewItem = {
  label: string;
  color?: string;
};

export type ExplorerEntityDragItem = {
  nodeID: string;
  label: string;
};

export type ExplorerEntityDragPayload = {
  itemType: "node";
  nodeID: string;
  label: string;
} | {
  itemType: "node_batch";
  nodes: ExplorerEntityDragItem[];
};

export type KanbanGroupField = "person" | "priority" | "due_date" | "account";

export const KANBAN_GROUP_FIELDS: Array<{ value: KanbanGroupField; label: string }> = [
  { value: "person", label: "By person" },
  { value: "priority", label: "Priority" },
  { value: "due_date", label: "Due Date" },
  { value: "account", label: "Account" },
];

export function isNodeDropItemType(value: unknown): value is "node" {
  return value === "node";
}

export function attachStackedDragPreview(dataTransfer: DataTransfer, items: KanbanDragPreviewItem[], _accentColor: string, title: string): void {
  if (typeof document === "undefined" || items.length === 0) return;
  const iconKind = /process/i.test(title) ? "logic_gate" : "node";
  const layerCount = Math.min(3, items.length);
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.top = "-1000px";
  container.style.left = "-1000px";
  container.style.width = "56px";
  container.style.height = "56px";
  container.style.opacity = "0.72";
  container.style.filter = "grayscale(1) drop-shadow(0 12px 18px rgba(15, 23, 42, 0.26))";
  container.style.pointerEvents = "none";
  container.style.zIndex = "99999";

  for (let index = layerCount - 1; index >= 0; index -= 1) {
    const ghost = document.createElement("div");
    ghost.style.position = "absolute";
    ghost.style.left = `${index * 5}px`;
    ghost.style.top = `${index * 4}px`;
    ghost.style.width = "46px";
    ghost.style.height = "46px";
    ghost.style.display = "grid";
    ghost.style.placeItems = "center";
    ghost.style.border = "1px solid rgba(100, 116, 139, 0.32)";
    ghost.style.borderRadius = "8px";
    ghost.style.background = "rgba(248, 250, 252, 0.78)";
    ghost.style.color = "rgba(51, 65, 85, 0.72)";
    ghost.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.82), 0 6px 12px rgba(15, 23, 42, 0.12)";
    ghost.innerHTML = iconKind === "logic_gate" ? logicGateDragPreviewIcon() : nodeDragPreviewIcon();
    container.appendChild(ghost);
  }

  document.body.appendChild(container);
  dataTransfer.setDragImage(container, 24, 24);
  window.setTimeout(() => container.remove(), 0);
}

function nodeDragPreviewIcon(): string {
  return `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <path d="M7 3.5h7.25L18 7.25V20.5H7z" fill="rgba(255,255,255,0.58)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M14.25 3.5v4h4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M9.7 12h5.2M9.7 15h5.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;
}

function logicGateDragPreviewIcon(): string {
  return `<svg aria-hidden="true" width="26" height="24" viewBox="0 0 26 24" fill="none">
    <path d="M2.5 12h4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M19.3 12h4.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M7 6h6.1a6 6 0 0 1 0 12H7z" fill="rgba(255,255,255,0.58)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
  </svg>`;
}

export function sanitizeExplorerEntityDragPayload(value: unknown): ExplorerEntityDragPayload | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { itemType?: unknown; nodeID?: unknown; label?: unknown; nodes?: unknown };
  // Batch payloads come from Explorer multi-select. Sanitize each item so a
  // malformed row cannot poison the whole drop operation.
  if (candidate.itemType === "node_batch" && Array.isArray(candidate.nodes)) {
    const nodes: ExplorerEntityDragItem[] = [];
    const seen = new Set<string>();
    for (const item of candidate.nodes) {
      if (!item || typeof item !== "object") continue;
      const row = item as { nodeID?: unknown; label?: unknown };
      const rawNodeID = row.nodeID;
      if (typeof rawNodeID !== "string" || rawNodeID.trim() === "") continue;
      const nodeID = rawNodeID.trim();
      if (seen.has(nodeID)) continue;
      seen.add(nodeID);
      const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : nodeID;
      nodes.push({ nodeID, label });
    }
    return nodes.length > 0 ? { itemType: "node_batch", nodes } : null;
  }
  if (!isNodeDropItemType(candidate.itemType)) return null;
  const rawNodeID = candidate.nodeID;
  if (typeof rawNodeID !== "string" || rawNodeID.trim() === "") return null;
  const nodeID = rawNodeID.trim();
  const label = typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : nodeID;
  return { itemType: "node", nodeID, label };
}

export function parseExplorerEntityDragPayload(raw: string): ExplorerEntityDragPayload | null {
  try {
    return sanitizeExplorerEntityDragPayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function getExplorerEntityDragItems(payload: ExplorerEntityDragPayload | null): ExplorerEntityDragItem[] {
  if (!payload) return [];
  if (payload.itemType === "node_batch") return payload.nodes;
  return [{ nodeID: payload.nodeID, label: payload.label }];
}

export function parseExplorerEntityDragItems(raw: string): ExplorerEntityDragItem[] {
  return getExplorerEntityDragItems(parseExplorerEntityDragPayload(raw));
}

export function serializeExplorerEntityDragPayload(payload: ExplorerEntityDragPayload): string {
  return JSON.stringify(payload);
}

export function getKanbanPriorityGroupLabel(priority: number): string {
  if (priority === 1) return "1\u00A0\u00A0URGENT(<1hr)";
  if (priority === 2) return "2\u00A0\u00A0By end of day";
  if (priority === 3) return "3\u00A0\u00A0Tomorrow";
  if (priority === 4) return "4\u00A0\u00A0Sprint (1 week)";
  if (priority === 5) return "5\u00A0\u00A0Later (low priority)";
  return "Not Assigned";
}
