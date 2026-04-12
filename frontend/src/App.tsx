import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { CONTENT_MAP, WIDGET_LIBRARY } from "./widgets";
import type { Widget, DragState, ResizeEdges } from "./types";

// ── Grid constants ──
const CELL_SIZE = 28;
const HEADER_H = 48;
const CROSS_ARM = 4;
const MIN_W = 3;
const MIN_H = 3;
const HANDLE = 6;
const CORNER_SIZE = 14;

// ── Color palettes for new widgets ──
const PALETTES = [
  { color: "#E8F5E9", accent: "#2E7D32" },
  { color: "#E3F2FD", accent: "#1565C0" },
  { color: "#FFF3E0", accent: "#E65100" },
  { color: "#F3E5F5", accent: "#6A1B9A" },
  { color: "#ECEFF1", accent: "#37474F" },
  { color: "#E0F7FA", accent: "#00695C" },
  { color: "#FCE4EC", accent: "#AD1457" },
  { color: "#F1F8E9", accent: "#558B2F" },
  { color: "#FFF8E1", accent: "#F57F17" },
  { color: "#EDE7F6", accent: "#4527A0" },
];

const THEME = {
  surface: "#f3f3f1",
  panel: "rgba(255,255,255,0.62)",
  line: "rgba(10,10,10,0.18)",
  text: "#121212",
  subtext: "#595959",
};

// ── Initial layout ──
const INITIAL_WIDGETS: Widget[] = [
  { id: "w-revenue", kind: "revenue",       x: 2,  y: 1,  w: 12, h: 9,  title: "Revenue",        color: "#DCE9DE", accent: "#1f8a4c" },
  { id: "w-users", kind: "users",           x: 14, y: 1,  w: 14, h: 9,  title: "Active Users",   color: "#d8e3ea", accent: "#2f6f9a" },
  { id: "w-alerts", kind: "alerts",         x: 30, y: 1,  w: 12, h: 14, title: "Alerts",         color: "#eadfcd", accent: "#b05d1e" },
  { id: "w-tasks", kind: "tasks",           x: 2,  y: 10, w: 10, h: 10, title: "Tasks",          color: "#dfd7e6", accent: "#6f2ea8" },
  { id: "w-chart", kind: "chart",           x: 12, y: 10, w: 16, h: 12, title: "Analytics",      color: "#d9dde0", accent: "#41535e" },
  { id: "w-orders", kind: "orders",         x: 2,  y: 20, w: 10, h: 10, title: "Recent Orders",  color: "#d6e9e4", accent: "#0f7968" },
  { id: "w-notifications", kind: "notifications",  x: 12, y: 22, w: 12, h: 10, title: "Notifications",  color: "#e8d7e2", accent: "#9a356f" },
  { id: "w-map", kind: "map",               x: 28, y: 15, w: 14, h: 17, title: "Map View",       color: "#dde6d8", accent: "#5e8d3a" },
];

// ── Helpers ──
function clamp(v: number, lo: number, hi: number) {
  if (lo > hi) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function coerceWidget(value: unknown): Widget | null {
  if (!isObject(value)) return null;
  const { id, kind, x, y, w, h, title, color, accent } = value;
  if (
    typeof id !== "string" ||
    typeof kind !== "string" ||
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof w !== "number" ||
    typeof h !== "number" ||
    typeof title !== "string" ||
    typeof color !== "string" ||
    typeof accent !== "string"
  ) {
    return null;
  }
  return {
    id,
    kind,
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    w: Math.max(MIN_W, Math.round(w)),
    h: Math.max(MIN_H, Math.round(h)),
    title,
    color,
    accent,
  };
}

function sanitizeWidgets(value: unknown): Widget[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const cleaned: Widget[] = [];
  for (const item of value) {
    const widget = coerceWidget(item);
    if (!widget || seen.has(widget.id)) continue;
    seen.add(widget.id);
    cleaned.push(widget);
  }
  return cleaned.length > 0 ? cleaned : null;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value);
}

function getPointer(e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) {
  if ("touches" in e && e.touches.length > 0) return { px: e.touches[0].clientX, py: e.touches[0].clientY };
  if ("clientX" in e) return { px: e.clientX, py: e.clientY };
  return { px: 0, py: 0 };
}

// ── Persistence ──
const WIDGET_KEY   = "grid-dashboard-v7";
const SETTINGS_KEY = "grid-dashboard-settings";

function loadWidgets(): Widget[] | null {
  try {
    const raw = localStorage.getItem(WIDGET_KEY);
    if (!raw) return null;
    return sanitizeWidgets(JSON.parse(raw));
  } catch {
    return null;
  }
}
function saveWidgets(w: Widget[]) {
  try { localStorage.setItem(WIDGET_KEY, JSON.stringify(w)); } catch {}
}
function loadSettings(): { bgColor?: string; crossColor?: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return {};
    return {
      bgColor: isHexColor(parsed.bgColor) ? parsed.bgColor : undefined,
      crossColor: isHexColor(parsed.crossColor) ? parsed.crossColor : undefined,
    };
  } catch {
    return {};
  }
}
function saveSettings(s: { bgColor: string; crossColor: string }) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

// ── Grid crosses ──
const GridCrosses: React.FC<{ cols: number; rows: number; stepX: number; stepY: number; width: number; height: number; color: string }> = React.memo(
  ({ cols, rows, stepX, stepY, width, height, color }) => {
    const path = useMemo(() => {
      const a = CROSS_ARM;
      const parts: string[] = [];
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          const x = c * stepX;
          const y = r * stepY;
          parts.push(`M${x} ${y - a}v${a * 2}M${x - a} ${y}h${a * 2}`);
        }
      }
      for (let r = 0; r <= rows; r++) {
        const y = r * stepY;
        parts.push(`M${width} ${y - a}v${a * 2}`);
      }
      for (let c = 0; c <= cols; c++) {
        const x = c * stepX;
        parts.push(`M${x - a} ${height}h${a * 2}`);
      }
      parts.push(`M${width - a} ${height}h${a * 2}M${width} ${height - a}v${a * 2}`);
      return parts.join("");
    }, [cols, rows, stepX, stepY, width, height]);

    return (
      <svg
        style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }}
        width={width}
        height={height}
      >
        <path d={path} stroke={color} strokeWidth="0.8" fill="none" opacity="0.2" />
      </svg>
    );
  }
);

// ── Resize handle definitions ──
type HandleDef = { edges: ResizeEdges; cursor: string; style: React.CSSProperties };

const HANDLES: HandleDef[] = [
  { edges: { top: true, left: true },     cursor: "nwse-resize", style: { top: -HANDLE/2, left: -HANDLE/2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { top: true, right: true },    cursor: "nesw-resize", style: { top: -HANDLE/2, right: -HANDLE/2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { bottom: true, left: true },  cursor: "nesw-resize", style: { bottom: -HANDLE/2, left: -HANDLE/2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -HANDLE/2, right: -HANDLE/2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { top: true },    cursor: "ns-resize",  style: { top: -HANDLE/2, left: CORNER_SIZE, right: CORNER_SIZE, height: HANDLE, zIndex: 1 } },
  { edges: { bottom: true }, cursor: "ns-resize",  style: { bottom: -HANDLE/2, left: CORNER_SIZE, right: CORNER_SIZE, height: HANDLE, zIndex: 1 } },
  { edges: { left: true },   cursor: "ew-resize",  style: { left: -HANDLE/2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: HANDLE, zIndex: 1 } },
  { edges: { right: true },  cursor: "ew-resize",  style: { right: -HANDLE/2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: HANDLE, zIndex: 1 } },
];

// ── Widget card ──
interface WidgetCardProps {
  widget: Widget;
  stepX: number;
  stepY: number;
  isDragging: boolean;
  editMode: boolean;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, id: string) => void;
  onResizeStart: (e: React.MouseEvent | React.TouchEvent, id: string, edges: ResizeEdges) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onHeaderClick: (e: React.MouseEvent, id: string) => void;
  onOpenDetail: (id: string) => void;
}

const WidgetCard: React.FC<WidgetCardProps> = ({ widget, stepX, stepY, isDragging, editMode, onDragStart, onResizeStart, onContextMenu, onHeaderClick, onOpenDetail }) => {
  const { title, color, accent, w, h } = widget;
  const Content = CONTENT_MAP[widget.kind];

  return (
    <div
      style={{
        position: "absolute",
        left: widget.x * stepX,
        top: widget.y * stepY,
        width: w * stepX,
        height: h * stepY,
        background: color,
        borderRadius: 6,
        border: `1px solid ${accent}55`,
        boxShadow: isDragging ? "0 12px 30px rgba(0,0,0,0.2)" : "0 2px 8px rgba(0,0,0,0.08)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: editMode ? (isDragging ? "grabbing" : "grab") : "default",
        userSelect: "none",
        zIndex: isDragging ? 100 : 1,
        opacity: isDragging ? 0.92 : 1,
      }}
      onMouseDown={(e) => {
        if (!editMode || (e.target as HTMLElement).dataset.handle) return;
        onDragStart(e, widget.id);
      }}
      onTouchStart={(e) => {
        if (!editMode || (e.target as HTMLElement).dataset.handle) return;
        onDragStart(e, widget.id);
      }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, widget.id); }}
      onDoubleClick={() => { if (!editMode) onOpenDetail(widget.id); }}
    >
      <div
        style={{ padding: "10px 12px 4px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${accent}22`, cursor: !editMode ? "pointer" : "inherit" }}
        onClick={(e) => !editMode && onHeaderClick(e, widget.id)}
      >
        <span style={{ fontSize: 12, fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {title}
        </span>
        <span style={{
          fontSize: 11, fontWeight: 700, color: accent,
          background: `${accent}12`, border: `1px solid ${accent}28`,
          borderRadius: 6, padding: "2px 8px",
          letterSpacing: "0.03em", fontVariantNumeric: "tabular-nums",
        }}>
          {w}×{h}
        </span>
      </div>
      <div style={{ flex: 1, padding: "4px 14px 12px", overflow: "hidden" }}>
        {Content ? <Content accent={accent} /> : (
          <div style={{ height: "100%", display: "grid", placeItems: "center", opacity: 0.3 }}>
            <span style={{ fontSize: 13, color: accent }}>{widget.title}</span>
          </div>
        )}
      </div>
      {editMode && HANDLES.map((h, i) => (
        <div
          key={i}
          data-handle="true"
          onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, widget.id, h.edges); }}
          onTouchStart={(e) => { e.stopPropagation(); onResizeStart(e, widget.id, h.edges); }}
          style={{ position: "absolute", cursor: h.cursor, ...h.style }}
        />
      ))}
    </div>
  );
};

// ── Floating menu (shared by widget + canvas context menus) ──
const FloatingMenu: React.FC<{
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ x, y, onClose, children }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  // Clamp position so menu stays on-screen
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const nx = x + rect.width > window.innerWidth ? window.innerWidth - rect.width - 8 : x;
    const ny = y + rect.height > window.innerHeight ? window.innerHeight - rect.height - 8 : y;
    if (nx !== x || ny !== y) setPos({ x: nx, y: ny });
  }, [x, y]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => window.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(timer); window.removeEventListener("mousedown", handler); };
  }, [onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: "fixed", left: pos.x, top: pos.y,
        background: "#fff", border: "1px solid #e0e0e0",
        borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
        padding: "4px 0", zIndex: 1000, minWidth: 190,
      }}
    >
      {children}
    </div>
  );
};

// Menu button style helper
const menuBtnBase: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  width: "100%", padding: "9px 16px",
  fontSize: 13, fontWeight: 500,
  background: "none", border: "none",
  color: "#333", cursor: "pointer", textAlign: "left",
};
const hoverHandlers = {
  onMouseEnter: (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = "#f5f5f5"; },
  onMouseLeave: (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = "none"; },
};

const MenuDivider = () => <div style={{ height: 1, background: "#eee", margin: "3px 0" }} />;

// ── Icons ──
const IconDuplicate = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);
const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c62828" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
  </svg>
);
const IconEdit = ({ on }: { on: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={on ? "#1565C0" : "#555"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

// ── Main App ──
let widgetCounter = 0;
const createWidgetId = () => {
  widgetCounter++;
  return { id: `widget-${Date.now()}-${widgetCounter}`, counter: widgetCounter };
};

const App: React.FC = () => {
  const [widgets, setWidgets] = useState<Widget[]>(loadWidgets() || INITIAL_WIDGETS);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const initialSettingsRef = useRef(loadSettings());
  const [bgColor, setBgColor] = useState(() => initialSettingsRef.current.bgColor || "#f2f1ec");
  const [crossColor, setCrossColor] = useState(() => initialSettingsRef.current.crossColor || "#000000");
  const [viewSize, setViewSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  // Context menus
  const [widgetMenu, setWidgetMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number } | null>(null);
  const [typeMenu, setTypeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [focusTrail, setFocusTrail] = useState<string[]>([]);
  const [focusIndex, setFocusIndex] = useState(-1);

  const dragRef = useRef<DragState | null>(null);
  const focusedWidgetId = focusIndex >= 0 ? focusTrail[focusIndex] : null;

  useEffect(() => {
    const onResize = () => setViewSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Use floor so grid never exceeds viewport ──
  const canvasH = viewSize.h - HEADER_H;
  const gridCols = Math.max(1, Math.round(viewSize.w / CELL_SIZE));
  const gridRows = Math.max(1, Math.round(canvasH / CELL_SIZE));
  const stepX = viewSize.w / gridCols;
  const stepY = canvasH / gridRows;

  // Persist
  useEffect(() => { saveWidgets(widgets); }, [widgets]);
  useEffect(() => { saveSettings({ bgColor, crossColor }); }, [bgColor, crossColor]);

  // ── Widget CRUD ──
  const addWidget = useCallback((kind = "chart") => {
    const template = WIDGET_LIBRARY.find((item) => item.kind === kind);
    if (!template) return;
    const { id, counter } = createWidgetId();
    const palette = PALETTES[counter % PALETTES.length];
    setWidgets((prev) => [...prev, {
      id,
      kind,
      x: 1 + (counter % 4) * 2,
      y: 1 + (counter % 3) * 2,
      w: template.defaultW, h: template.defaultH,
      title: template.label,
      ...palette,
    }]);
  }, []);

  const deleteWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const setWidgetKind = useCallback((id: string, kind: string) => {
    const template = WIDGET_LIBRARY.find((item) => item.kind === kind);
    if (!template) return;
    setWidgets((prev) => prev.map((w) => (
      w.id === id ? { ...w, kind, title: template.label } : w
    )));
  }, []);

  const duplicateWidget = useCallback((id: string) => {
    setWidgets((prev) => {
      const src = prev.find((w) => w.id === id);
      if (!src) return prev;
      const next = createWidgetId();
      return [...prev, {
        ...src,
        id: next.id,
        kind: src.kind,
        x: clamp(src.x + 2, 0, gridCols - src.w),
        y: clamp(src.y + 2, 0, gridRows - src.h),
      }];
    });
  }, [gridCols, gridRows]);

  // ── Context menus ──
  const onWidgetContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setCanvasMenu(null);
    setTypeMenu(null);
    setWidgetMenu({ x: e.clientX, y: e.clientY, id });
  }, []);

  const onCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setWidgetMenu(null);
    setTypeMenu(null);
    setCanvasMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const onWidgetHeaderClick = useCallback((e: React.MouseEvent, id: string) => {
    if (focusedWidgetId) return;
    e.preventDefault();
    e.stopPropagation();
    setWidgetMenu(null);
    setCanvasMenu(null);
    setTypeMenu({ x: e.clientX, y: e.clientY, id });
  }, [focusedWidgetId]);

  const closeMenus = useCallback(() => {
    setWidgetMenu(null);
    setCanvasMenu(null);
    setTypeMenu(null);
  }, []);

  const openWidgetDetail = useCallback((id: string) => {
    setFocusTrail((prev) => [...prev.slice(0, focusIndex + 1), id]);
    setFocusIndex((idx) => idx + 1);
  }, [focusIndex]);

  const goBackDetail = useCallback(() => {
    setFocusIndex((idx) => Math.max(-1, idx - 1));
  }, []);

  const goForwardDetail = useCallback(() => {
    setFocusIndex((idx) => Math.min(focusTrail.length - 1, idx + 1));
  }, [focusTrail.length]);

  // ── Drag / Resize ──
  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent, id: string) => {
    if (!editMode) return;
    e.preventDefault();
    const { px, py } = getPointer(e);
    const widget = widgets.find((w) => w.id === id);
    if (!widget) return;
    dragRef.current = {
      id, mode: "drag", edges: {},
      startMouseX: px, startMouseY: py,
      origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h,
    };
    setDraggingId(id);
  }, [widgets, editMode]);

  const onResizeStart = useCallback((e: React.MouseEvent | React.TouchEvent, id: string, edges: ResizeEdges) => {
    if (!editMode) return;
    e.preventDefault();
    const { px, py } = getPointer(e);
    const widget = widgets.find((w) => w.id === id);
    if (!widget) return;
    dragRef.current = {
      id, mode: "resize", edges,
      startMouseX: px, startMouseY: py,
      origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h,
    };
    setDraggingId(id);
  }, [widgets, editMode]);

  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const { px, py } = getPointer(e);
      const dCols = Math.round((px - d.startMouseX) / stepX);
      const dRows = Math.round((py - d.startMouseY) / stepY);

      setWidgets((prev) =>
        prev.map((w) => {
          if (w.id !== d.id) return w;
          if (d.mode === "drag") {
            return {
              ...w,
              x: clamp(d.origX + dCols, 0, gridCols - w.w),
              y: clamp(d.origY + dRows, 0, gridRows - w.h),
            };
          }
          let x = d.origX, y = d.origY, nw = d.origW, nh = d.origH;
          if (d.edges.right)  nw = clamp(d.origW + dCols, MIN_W, gridCols - d.origX);
          if (d.edges.bottom) nh = clamp(d.origH + dRows, MIN_H, gridRows - d.origY);
          if (d.edges.left) {
            const shift = clamp(dCols, -d.origX, d.origW - MIN_W);
            x = d.origX + shift;
            nw = d.origW - shift;
          }
          if (d.edges.top) {
            const shift = clamp(dRows, -d.origY, d.origH - MIN_H);
            y = d.origY + shift;
            nh = d.origH - shift;
          }
          return { ...w, x, y, w: nw, h: nh };
        })
      );
    };
    const onEnd = () => { dragRef.current = null; setDraggingId(null); };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [gridCols, gridRows, stepX, stepY]);

  const handleReset = useCallback(() => {
    setWidgets(INITIAL_WIDGETS);
    localStorage.removeItem(WIDGET_KEY);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: bgColor || THEME.surface }}>
      {/* ── Header ── */}
      <header style={{
        height: HEADER_H, padding: "0 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: THEME.panel,
        backdropFilter: "blur(10px)",
        borderBottom: `1px solid ${THEME.line}`,
        zIndex: 200, position: "relative",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: THEME.text, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Dashboard
          </h1>
          {focusedWidgetId && (
            <>
              <button onClick={goBackDetail} style={{ border: "1px solid #ccc", background: "#fff", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                ←
              </button>
              <button onClick={goForwardDetail} style={{ border: "1px solid #ccc", background: "#fff", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                →
              </button>
            </>
          )}
          {editMode && (
            <span style={{
              fontSize: 11, fontWeight: 600, color: "#1565C0",
              background: "#E3F2FD", borderRadius: 5, padding: "3px 10px",
              letterSpacing: "0.03em",
            }}>
              EDIT MODE
            </span>
          )}
          <span style={{ fontSize: 12, color: THEME.subtext, letterSpacing: "0.03em" }}>
            {editMode ? "Drag to move · Edges to resize · Right-click for options" : `${gridCols}×${gridRows} grid`}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Add widget — always visible */}
          <button
            onClick={() => { addWidget(); setEditMode(true); setFocusIndex(-1); }}
            title="Add widget"
            style={{
              width: 32, height: 32,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#fff", border: `1px solid ${THEME.line}`,
              borderRadius: 8, cursor: "pointer", fontSize: 20, color: "#555",
              fontWeight: 300, lineHeight: 1,
            }}
          >
            +
          </button>

          {/* Edit-mode config */}
          {editMode && (
            <>
              <div style={{ width: 1, height: 20, background: "#ddd" }} />
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666", cursor: "pointer" }}>
                BG
                <div style={{ position: "relative", width: 22, height: 22, borderRadius: 6, border: "1px solid #ccc", overflow: "hidden" }}>
                  <div style={{ width: "100%", height: "100%", background: bgColor }} />
                  <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)}
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
                </div>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#666", cursor: "pointer" }}>
                Grid
                <div style={{ position: "relative", width: 22, height: 22, borderRadius: 6, border: "1px solid #ccc", overflow: "hidden" }}>
                  <div style={{ width: "100%", height: "100%", background: crossColor }} />
                  <input type="color" value={crossColor} onChange={(e) => setCrossColor(e.target.value)}
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
                </div>
              </label>
            </>
          )}
        </div>
      </header>

      {/* ── Canvas ── */}
      <div
        style={{ position: "relative", width: "100%", height: canvasH, overflow: "hidden" }}
        onContextMenu={onCanvasContextMenu}
      >
        <GridCrosses cols={gridCols} rows={gridRows} stepX={stepX} stepY={stepY} width={viewSize.w} height={canvasH} color={crossColor} />

        {(focusedWidgetId
          ? widgets.filter((w) => w.id === focusedWidgetId).map((w) => ({ ...w, x: 0, y: 0, w: gridCols, h: gridRows }))
          : widgets
        ).map((w) => (
          <WidgetCard
            key={w.id}
            widget={w}
            stepX={stepX}
            stepY={stepY}
            isDragging={draggingId === w.id}
            editMode={focusedWidgetId ? false : editMode}
            onDragStart={onDragStart}
            onResizeStart={onResizeStart}
            onContextMenu={onWidgetContextMenu}
            onHeaderClick={onWidgetHeaderClick}
            onOpenDetail={openWidgetDetail}
          />
        ))}
      </div>

      {typeMenu && (
        <FloatingMenu x={typeMenu.x} y={typeMenu.y} onClose={closeMenus}>
          <div style={{ padding: "8px 12px 4px", fontSize: 11, letterSpacing: "0.08em", color: "#666", textTransform: "uppercase" }}>
            Widget Type
          </div>
          {WIDGET_LIBRARY.map((item) => (
            <button
              key={item.kind}
              style={menuBtnBase}
              onClick={() => { setWidgetKind(typeMenu.id, item.kind); closeMenus(); }}
              {...hoverHandlers}
            >
              {item.label}
            </button>
          ))}
        </FloatingMenu>
      )}

      {/* ── Widget context menu ── */}
      {widgetMenu && (
        <FloatingMenu x={widgetMenu.x} y={widgetMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { duplicateWidget(widgetMenu.id); closeMenus(); }} {...hoverHandlers}>
            <IconDuplicate /> Duplicate
          </button>
          <MenuDivider />
          <button style={{ ...menuBtnBase, color: "#c62828" }} onClick={() => { deleteWidget(widgetMenu.id); closeMenus(); }} {...hoverHandlers}>
            <IconTrash /> Delete
          </button>
        </FloatingMenu>
      )}

      {/* ── Canvas context menu ── */}
      {canvasMenu && (
        <FloatingMenu x={canvasMenu.x} y={canvasMenu.y} onClose={closeMenus}>
          <button
            style={menuBtnBase}
            onClick={() => { setEditMode((v) => !v); closeMenus(); }}
            {...hoverHandlers}
          >
            <IconEdit on={editMode} />
            <span>Edit Mode: <strong style={{ color: editMode ? "#1565C0" : "#999" }}>{editMode ? "On" : "Off"}</strong></span>
          </button>
          {editMode && (
            <>
              <MenuDivider />
              <button style={menuBtnBase} onClick={() => { handleReset(); closeMenus(); }} {...hoverHandlers}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 105.64-12.36L1 10" />
                </svg>
                Reset Layout
              </button>
            </>
          )}
        </FloatingMenu>
      )}
    </div>
  );
};

export default App;
