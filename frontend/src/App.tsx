import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { CONTENT_MAP, WIDGET_LIBRARY } from "./widgets";
import type { Widget, DragState, ResizeEdges } from "./types";

const CELL_SIZE = 28;
const HEADER_H = 48;
const CROSS_ARM = 2;
const MIN_W = 3;
const MIN_H = 3;
const HANDLE = 6;
const CORNER_SIZE = 14;

const COLORWAYS = {
  teal: { color: "#6fe7ee", accent: "#0a6c78", text: "#062126", tagBg: "#062126", tagText: "#ffffff" },
  orange: { color: "#ff6a00", accent: "#5a2200", text: "#120900", tagBg: "#120900", tagText: "#ffffff" },
  white: { color: "#ffffff", accent: "#111111", text: "#111111", tagBg: "#111111", tagText: "#ffffff" },
  black: { color: "#0c0c0c", accent: "#ffffff", text: "#ffffff", tagBg: "#ffffff", tagText: "#050505" },
} as const;

type ColorwayKey = keyof typeof COLORWAYS;
const COLORWAY_ORDER: ColorwayKey[] = ["teal", "orange", "white", "black"];

const UI_THEME = {
  surface: "#f7fffe",
  panel: "#ff6a00",
  line: "rgba(12, 67, 74, 0.45)",
  text: "#041d22",
  subtext: "#0b5058",
};

const INITIAL_WIDGETS: Widget[] = [
  { id: "w-revenue", theme: "teal", kind: "revenue", x: 2, y: 1, w: 12, h: 9, title: "Revenue", color: COLORWAYS.teal.color, accent: COLORWAYS.teal.accent },
  { id: "w-users", theme: "orange", kind: "users", x: 14, y: 1, w: 14, h: 9, title: "Active Users", color: COLORWAYS.orange.color, accent: COLORWAYS.orange.accent },
  { id: "w-alerts", theme: "orange", kind: "alerts", x: 30, y: 1, w: 12, h: 14, title: "Alerts", color: COLORWAYS.orange.color, accent: COLORWAYS.orange.accent },
  { id: "w-tasks", theme: "teal", kind: "tasks", x: 2, y: 10, w: 10, h: 10, title: "Tasks", color: COLORWAYS.teal.color, accent: COLORWAYS.teal.accent },
  { id: "w-chart", theme: "white", kind: "chart", x: 12, y: 10, w: 16, h: 12, title: "Analytics", color: COLORWAYS.white.color, accent: COLORWAYS.white.accent },
  { id: "w-orders", theme: "orange", kind: "orders", x: 2, y: 20, w: 10, h: 10, title: "Recent Orders", color: COLORWAYS.orange.color, accent: COLORWAYS.orange.accent },
  { id: "w-notifications", theme: "orange", kind: "notifications", x: 12, y: 22, w: 12, h: 10, title: "Notifications", color: COLORWAYS.orange.color, accent: COLORWAYS.orange.accent },
  { id: "w-map", theme: "teal", kind: "map", x: 28, y: 15, w: 14, h: 17, title: "Map View", color: COLORWAYS.teal.color, accent: COLORWAYS.teal.accent },
  { id: "w-case-hub", theme: "white", kind: "case_hub", x: 24, y: 22, w: 18, h: 10, title: "Case Module", color: COLORWAYS.white.color, accent: COLORWAYS.white.accent },
];

interface ViewTab {
  id: string;
  name: string;
  widgets: Widget[];
}

function clamp(v: number, lo: number, hi: number) {
  if (lo > hi) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function widgetsOverlap(a: Widget, b: Widget) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isColorway(value: unknown): value is ColorwayKey {
  return typeof value === "string" && value in COLORWAYS;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9A-F]{6}$/i.test(value);
}

function coerceWidget(value: unknown): Widget | null {
  if (!isObject(value)) return null;
  const { id, kind, theme, x, y, w, h, title, color, accent } = value;
  if (
    typeof id !== "string" || typeof kind !== "string" || typeof x !== "number" || typeof y !== "number" ||
    typeof w !== "number" || typeof h !== "number" || typeof title !== "string" || typeof color !== "string" || typeof accent !== "string"
  ) return null;

  return {
    id,
    kind,
    theme: isColorway(theme) ? theme : "teal",
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    w: Math.max(MIN_W, Math.round(w)),
    h: Math.max(MIN_H, Math.round(h)),
    title,
    color,
    accent,
  };
}

function sanitizeWidgets(value: unknown): Widget[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const cleaned: Widget[] = [];
  for (const item of value) {
    const widget = coerceWidget(item);
    if (!widget || seen.has(widget.id)) continue;
    seen.add(widget.id);
    cleaned.push(widget);
  }
  return cleaned;
}

function getPointer(e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) {
  if ("touches" in e && e.touches.length > 0) return { px: e.touches[0].clientX, py: e.touches[0].clientY };
  if ("clientX" in e) return { px: e.clientX, py: e.clientY };
  return { px: 0, py: 0 };
}

const VIEWS_KEY = "grid-dashboard-views-v1";
const SETTINGS_KEY = "grid-dashboard-settings";

function loadViews(): { tabs: ViewTab[]; activeId: string } {
  const fallback = { tabs: [{ id: "view-default", name: "Main View", widgets: INITIAL_WIDGETS }], activeId: "view-default" };
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !Array.isArray(parsed.tabs) || typeof parsed.activeId !== "string") return fallback;

    const tabs = parsed.tabs
      .map((tab) => {
        if (!isObject(tab) || typeof tab.id !== "string" || typeof tab.name !== "string") return null;
        const widgets = sanitizeWidgets(tab.widgets);
        return { id: tab.id, name: tab.name, widgets } satisfies ViewTab;
      })
      .filter((tab): tab is ViewTab => !!tab);

    if (tabs.length === 0) return fallback;
    const activeId = tabs.some((tab) => tab.id === parsed.activeId) ? parsed.activeId : tabs[0].id;
    return { tabs, activeId };
  } catch {
    return fallback;
  }
}

function saveViews(tabs: ViewTab[], activeId: string) {
  try { localStorage.setItem(VIEWS_KEY, JSON.stringify({ tabs, activeId })); } catch {}
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
      for (let r = 0; r <= rows; r++) parts.push(`M${width} ${r * stepY - a}v${a * 2}`);
      for (let c = 0; c <= cols; c++) parts.push(`M${c * stepX - a} ${height}h${a * 2}`);
      parts.push(`M${width - a} ${height}h${a * 2}M${width} ${height - a}v${a * 2}`);
      return parts.join("");
    }, [cols, rows, stepX, stepY, width, height]);

    return <svg style={{ position: "absolute", top: 0, left: 0, overflow: "visible", pointerEvents: "none" }} width={width} height={height}><path d={path} stroke={color} strokeWidth="0.55" fill="none" opacity="0.28" /></svg>;
  }
);

const PlacementSplash: React.FC<{
  widget: Widget;
  widgets: Widget[];
  cols: number;
  rows: number;
  stepX: number;
  stepY: number;
}> = React.memo(({ widget, widgets, cols, rows, stepX, stepY }) => {
  const cells = useMemo(() => {
    let seed = widget.x * 73856093 + widget.y * 19349663;
    for (let i = 0; i < widget.id.length; i++) seed = (seed * 33 + widget.id.charCodeAt(i)) >>> 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const occupied = new Set<string>();
    for (const other of widgets) {
      if (other.id === widget.id) continue;
      for (let y = other.y; y < other.y + other.h; y++) {
        for (let x = other.x; x < other.x + other.w; x++) {
          occupied.add(`${x},${y}`);
        }
      }
    }

    const sizeFactor = Math.min(1.5, Math.log2(Math.max(widget.w, widget.h) + 1) / 4);
    const edgeSpan = () => (rand() < 0.72 - sizeFactor * 0.08 ? 2 : 3);
    const armSpan = () => 1 + Math.floor(rand() * 3) + (rand() < 0.18 + sizeFactor * 0.08 ? 2 : 0);
    const radii = {
      left: edgeSpan(),
      right: edgeSpan(),
      top: edgeSpan(),
      bottom: edgeSpan(),
    };
    const left = clamp(widget.x - radii.left, 0, Math.max(0, cols - 1));
    const right = clamp(widget.x + widget.w - 1 + radii.right, 0, Math.max(0, cols - 1));
    const top = clamp(widget.y - radii.top, 0, Math.max(0, rows - 1));
    const bottom = clamp(widget.y + widget.h - 1 + radii.bottom, 0, Math.max(0, rows - 1));

    const result: { x: number; y: number; distance: number }[] = [];
    const seen = new Set<string>();
    const centerX = widget.x + widget.w / 2;
    const centerY = widget.y + widget.h / 2;
    const extraCells = new Set<string>();
    const addArm = (startX: number, startY: number, dx: number, dy: number, len: number) => {
      for (let i = 1; i <= len; i++) {
        const x = startX + dx * i;
        const y = startY + dy * i;
        if (x < 0 || y < 0 || x >= cols || y >= rows) break;
        extraCells.add(`${x},${y}`);
      }
    };

    addArm(widget.x + Math.floor(rand() * widget.w), top, 0, -1, armSpan());
    addArm(widget.x + Math.floor(rand() * widget.w), bottom, 0, 1, armSpan());
    addArm(left, widget.y + Math.floor(rand() * widget.h), -1, 0, armSpan());
    addArm(right, widget.y + Math.floor(rand() * widget.h), 1, 0, armSpan());

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const insideWidget = x >= widget.x && x < widget.x + widget.w && y >= widget.y && y < widget.y + widget.h;
        const gapLeft = widget.x - (x + 1);
        const gapRight = x - (widget.x + widget.w) + 1;
        const gapTop = widget.y - (y + 1);
        const gapBottom = y - (widget.y + widget.h) + 1;
        const edgeDistance = Math.max(0, gapLeft, gapRight, gapTop, gapBottom);
        const coreThickness = Math.min(2.9, 1.75 + rand() * 0.7 + sizeFactor * 0.15);
        const withinCore = edgeDistance <= coreThickness;
        const splashNoise = rand() > 0.14;
        const inShape = withinCore && splashNoise;
        const isArm = extraCells.has(`${x},${y}`);
        if (insideWidget || occupied.has(`${x},${y}`) || (!inShape && !isArm)) continue;
        const dist = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ x, y, distance: dist });
      }
    }

    for (const cell of extraCells) {
      const [xRaw, yRaw] = cell.split(",");
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (occupied.has(cell)) continue;
      const insideWidget = x >= widget.x && x < widget.x + widget.w && y >= widget.y && y < widget.y + widget.h;
      if (insideWidget) continue;
      const dist = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (seen.has(cell)) continue;
      seen.add(cell);
      result.push({ x, y, distance: dist });
    }

    return result;
  }, [widget, widgets, cols, rows]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 50 }}>
      {cells.map((cell) => {
        const opacity = clamp(0.34 - cell.distance * 0.03, 0.08, 0.34);
        return (
          <div
            key={`${cell.x}-${cell.y}`}
            style={{
              position: "absolute",
              left: cell.x * stepX + 1.5,
              top: cell.y * stepY + 1.5,
              width: Math.max(2, stepX - 3),
              height: Math.max(2, stepY - 3),
              border: "1px solid rgba(7, 86, 94, 0.55)",
              background: `rgba(111, 231, 238, ${opacity})`,
              boxShadow: "0 0 0 1px rgba(255,255,255,0.18) inset",
            }}
          />
        );
      })}
    </div>
  );
});

type HandleDef = { edges: ResizeEdges; cursor: string; style: React.CSSProperties };
const HANDLES: HandleDef[] = [
  { edges: { top: true, left: true }, cursor: "nwse-resize", style: { top: -HANDLE / 2, left: -HANDLE / 2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { top: true, right: true }, cursor: "nesw-resize", style: { top: -HANDLE / 2, right: -HANDLE / 2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { bottom: true, left: true }, cursor: "nesw-resize", style: { bottom: -HANDLE / 2, left: -HANDLE / 2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -HANDLE / 2, right: -HANDLE / 2, width: CORNER_SIZE, height: CORNER_SIZE, zIndex: 2 } },
  { edges: { top: true }, cursor: "ns-resize", style: { top: -HANDLE / 2, left: CORNER_SIZE, right: CORNER_SIZE, height: HANDLE, zIndex: 1 } },
  { edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -HANDLE / 2, left: CORNER_SIZE, right: CORNER_SIZE, height: HANDLE, zIndex: 1 } },
  { edges: { left: true }, cursor: "ew-resize", style: { left: -HANDLE / 2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: HANDLE, zIndex: 1 } },
  { edges: { right: true }, cursor: "ew-resize", style: { right: -HANDLE / 2, top: CORNER_SIZE, bottom: CORNER_SIZE, width: HANDLE, zIndex: 1 } },
];

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
  onHeaderDoubleClick: (e: React.MouseEvent, id: string) => void;
}

const WidgetCard: React.FC<WidgetCardProps> = ({ widget, stepX, stepY, isDragging, editMode, onDragStart, onResizeStart, onContextMenu, onHeaderClick, onHeaderDoubleClick }) => {
  const Content = CONTENT_MAP[widget.kind];
  const theme = COLORWAYS[widget.theme ?? "teal"];
  return (
    <div
      style={{ position: "absolute", left: widget.x * stepX, top: widget.y * stepY, width: widget.w * stepX, height: widget.h * stepY, background: widget.color, border: `1px solid ${widget.accent}`, display: "flex", flexDirection: "column", overflow: "hidden", cursor: editMode ? (isDragging ? "grabbing" : "grab") : "default", userSelect: "none", zIndex: isDragging ? 100 : 1, color: theme.text }}
      onMouseDown={(e) => { if (!editMode || (e.target as HTMLElement).dataset.handle) return; onDragStart(e, widget.id); }}
      onTouchStart={(e) => { if (!editMode || (e.target as HTMLElement).dataset.handle) return; onDragStart(e, widget.id); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, widget.id); }}
    >
      <div
        style={{ padding: "6px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${widget.accent}`, cursor: !editMode ? "pointer" : "inherit", fontFamily: "'IBM Plex Mono', monospace" }}
        onClick={(e) => !editMode && onHeaderClick(e, widget.id)}
        onDoubleClick={(e) => {
          if (editMode) return;
          e.preventDefault();
          e.stopPropagation();
          onHeaderDoubleClick(e, widget.id);
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: theme.tagText, textTransform: "uppercase", letterSpacing: "0.1em", background: theme.tagBg, padding: "2px 6px" }}>{widget.title}</span>
      </div>
      <div style={{ flex: 1, padding: "8px 10px", overflow: "hidden", fontFamily: "'IBM Plex Mono', monospace" }}>
        {Content ? <Content accent={widget.accent} /> : <div style={{ height: "100%", display: "grid", placeItems: "center", opacity: 0.3 }}><span style={{ fontSize: 13, color: widget.accent }}>{widget.title}</span></div>}
      </div>
      {editMode && HANDLES.map((h, i) => <div key={i} data-handle="true" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, widget.id, h.edges); }} onTouchStart={(e) => { e.stopPropagation(); onResizeStart(e, widget.id, h.edges); }} style={{ position: "absolute", cursor: h.cursor, ...h.style }} />)}
    </div>
  );
};

const FloatingMenu: React.FC<{ x: number; y: number; onClose: () => void; children: React.ReactNode }> = ({ x, y, onClose, children }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - rect.width - 8), y: Math.min(y, window.innerHeight - rect.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose(); };
    const timer = setTimeout(() => window.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(timer); window.removeEventListener("mousedown", handler); };
  }, [onClose]);

  return <div ref={menuRef} style={{ position: "fixed", left: pos.x, top: pos.y, background: "#fff", border: "1px solid #e0e0e0", borderRadius: 10, boxShadow: "0 6px 24px rgba(0,0,0,0.12)", padding: "4px 0", zIndex: 1000, minWidth: 190 }}>{children}</div>;
};

const menuBtnBase: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", fontFamily: "'IBM Plex Mono', monospace", background: "none", border: "none", color: "#333", cursor: "pointer", textAlign: "left" };
const hoverHandlers = { onMouseEnter: (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = "#f5f5f5"; }, onMouseLeave: (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = "none"; } };

let widgetCounter = 0;
let tabCounter = 0;
const createWidgetId = () => `widget-${Date.now()}-${++widgetCounter}`;
const createTabId = () => `view-${Date.now()}-${++tabCounter}`;

const App: React.FC = () => {
  const loaded = useMemo(() => loadViews(), []);
  const [tabs, setTabs] = useState<ViewTab[]>(loaded.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(loaded.activeId);
  const [movingTabId, setMovingTabId] = useState<string | null>(null);
  const [isDraggingTab, setIsDraggingTab] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const initialSettingsRef = useRef(loadSettings());
  const [bgColor, setBgColor] = useState(() => initialSettingsRef.current.bgColor || "#f7fffe");
  const [crossColor, setCrossColor] = useState(() => initialSettingsRef.current.crossColor || "#00a8b8");
  const [viewSize, setViewSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [widgetMenu, setWidgetMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [moduleTypeMenu, setModuleTypeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const tabDragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);
  const widgets = activeTab?.widgets ?? [];

  const updateActiveWidgets = useCallback((updater: (prev: Widget[]) => Widget[]) => {
    setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, widgets: updater(tab.widgets) } : tab)));
  }, [activeTabId]);

  useEffect(() => {
    const onResize = () => setViewSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { saveViews(tabs, activeTabId); }, [tabs, activeTabId]);
  useEffect(() => { saveSettings({ bgColor, crossColor }); }, [bgColor, crossColor]);

  const canvasH = viewSize.h - HEADER_H;
  const gridCols = Math.max(1, Math.round(viewSize.w / CELL_SIZE));
  const gridRows = Math.max(1, Math.round(canvasH / CELL_SIZE));
  const stepX = viewSize.w / gridCols;
  const stepY = canvasH / gridRows;

  const applyColorway = useCallback((widget: Widget, theme: ColorwayKey): Widget => {
    const swatch = COLORWAYS[theme];
    return { ...widget, theme, color: swatch.color, accent: swatch.accent };
  }, []);

  const addWidget = useCallback((kind = "chart") => {
    const template = WIDGET_LIBRARY.find((item) => item.kind === kind);
    if (!template) return;
    const id = createWidgetId();
    const theme = COLORWAY_ORDER[(widgetCounter + 1) % COLORWAY_ORDER.length];
    updateActiveWidgets((prev) => [...prev, { id, kind, theme, x: 1, y: 1, w: template.defaultW, h: template.defaultH, title: template.label, color: COLORWAYS[theme].color, accent: COLORWAYS[theme].accent }]);
  }, [updateActiveWidgets]);

  const duplicateWidget = useCallback((id: string) => {
    updateActiveWidgets((prev) => {
      const src = prev.find((w) => w.id === id);
      if (!src) return prev;
      return [...prev, { ...src, id: createWidgetId(), x: clamp(src.x + 2, 0, gridCols - src.w), y: clamp(src.y + 2, 0, gridRows - src.h) }];
    });
  }, [gridCols, gridRows, updateActiveWidgets]);

  const closeMenus = useCallback(() => { setWidgetMenu(null); setModuleTypeMenu(null); setCanvasMenu(null); setTabMenu(null); }, []);

  const addTab = useCallback(() => {
    const id = createTabId();
    const newTab: ViewTab = { id, name: `View ${tabs.length + 1}`, widgets: [] };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(id);
    setEditMode(true);
  }, [tabs.length]);

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");

  const startRenamingTab = useCallback((id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    setRenamingTabId(id);
    setRenamingValue(tab.name);
  }, [tabs]);

  const commitRenameTab = useCallback(() => {
    if (!renamingTabId) return;
    const next = renamingValue.trim();
    if (next) {
      setTabs((prev) => prev.map((t) => (t.id === renamingTabId ? { ...t, name: next } : t)));
    }
    setRenamingTabId(null);
    setRenamingValue("");
  }, [renamingTabId, renamingValue]);

  const cancelRenameTab = useCallback(() => {
    setRenamingTabId(null);
    setRenamingValue("");
  }, []);

  const deleteTab = useCallback((id: string) => {
    if (tabs.length === 1) return;
    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== id);
      if (activeTabId === id && filtered[0]) setActiveTabId(filtered[0].id);
      return filtered;
    });
  }, [tabs.length, activeTabId]);



  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = tabDragRef.current;
      if (!drag || isDraggingTab) return;
      const moved = Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY);
      if (moved > 4) setIsDraggingTab(true);
    };
    const onUp = () => {
      tabDragRef.current = null;
      setMovingTabId(null);
      setIsDraggingTab(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDraggingTab]);
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      const { px, py } = getPointer(e);
      const dCols = Math.round((px - d.startMouseX) / stepX);
      const dRows = Math.round((py - d.startMouseY) / stepY);

      updateActiveWidgets((prev) => prev.map((w) => {
        if (w.id !== d.id) return w;
        if (d.mode === "drag") return { ...w, x: clamp(d.origX + dCols, 0, gridCols - w.w), y: clamp(d.origY + dRows, 0, gridRows - w.h) };
        let x = d.origX, y = d.origY, nw = d.origW, nh = d.origH;
        if (d.edges.right) nw = clamp(d.origW + dCols, MIN_W, gridCols - d.origX);
        if (d.edges.bottom) nh = clamp(d.origH + dRows, MIN_H, gridRows - d.origY);
        if (d.edges.left) { const shift = clamp(dCols, -d.origX, d.origW - MIN_W); x = d.origX + shift; nw = d.origW - shift; }
        if (d.edges.top) { const shift = clamp(dRows, -d.origY, d.origH - MIN_H); y = d.origY + shift; nh = d.origH - shift; }
        return { ...w, x, y, w: nw, h: nh };
      }));
    };
    const onEnd = () => {
      const d = dragRef.current;
      if (d) {
        updateActiveWidgets((prev) => prev.map((w) => {
          if (w.id !== d.id) return w;
          const overlaps = prev.some((candidate) => candidate.id !== w.id && widgetsOverlap(w, candidate));
          if (!overlaps) return w;
          return d.mode === "drag"
            ? { ...w, x: d.origX, y: d.origY }
            : { ...w, x: d.origX, y: d.origY, w: d.origW, h: d.origH };
        }));
      }
      dragRef.current = null;
      setDraggingId(null);
    };
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
  }, [gridCols, gridRows, stepX, stepY, updateActiveWidgets]);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: bgColor || UI_THEME.surface }}>
      <header style={{ height: HEADER_H, padding: "0 20px", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", background: UI_THEME.panel, borderBottom: `1px solid ${UI_THEME.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ fontWeight: 800, color: UI_THEME.text, letterSpacing: "0.04em", textTransform: "uppercase", margin: 0, lineHeight: 1 }}><span style={{ fontSize: 18 }}>Mango</span><span style={{ fontSize: 23, marginLeft: 2 }}>OS</span></h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, justifySelf: "center", maxWidth: "55vw", overflowX: "auto", padding: "2px 4px" }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).tagName === "INPUT") return;
                tabDragRef.current = { id: tab.id, startX: e.clientX, startY: e.clientY };
                setMovingTabId(tab.id);
                setActiveTabId(tab.id);
                setEditMode(false);
              }}
              onMouseEnter={() => {
                if (!isDraggingTab || !movingTabId || movingTabId === tab.id) return;
                setTabs((prev) => {
                  const list = [...prev];
                  const from = list.findIndex((t) => t.id === movingTabId);
                  const to = list.findIndex((t) => t.id === tab.id);
                  if (from < 0 || to < 0) return prev;
                  const [item] = list.splice(from, 1);
                  list.splice(to, 0, item);
                  return list;
                });
              }}
              onContextMenu={(e) => { e.preventDefault(); setTabMenu({ x: e.clientX, y: e.clientY, id: tab.id }); }}
              onDoubleClick={() => startRenamingTab(tab.id)}
              onClick={() => { if (isDraggingTab) return; setActiveTabId(tab.id); setEditMode(false); }}
              style={{ height: 30, padding: "0 12px", border: activeTabId === tab.id ? "1px solid #08343a" : "1px solid rgba(8,52,58,0.35)", background: activeTabId === tab.id ? "#ffffff" : "rgba(255,255,255,0.65)", borderRadius: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer", whiteSpace: "nowrap", transition: "transform 120ms ease, opacity 120ms ease", opacity: movingTabId === tab.id ? 0.8 : 1, transform: movingTabId === tab.id ? "translateY(-1px)" : "translateY(0px)" }}
            >
              {renamingTabId === tab.id ? (
                <input
                  autoFocus
                  value={renamingValue}
                  onChange={(e) => setRenamingValue(e.target.value)}
                  onBlur={commitRenameTab}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRenameTab();
                    if (e.key === "Escape") cancelRenameTab();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{ width: 92, border: "1px solid #0a6c78", background: "#fff", borderRadius: 4, padding: "2px 5px", fontSize: 11, fontWeight: 700 }}
                />
              ) : tab.name}
            </button>
          ))}
          <button onClick={addTab} title="New view tab" style={{ width: 30, height: 30, border: "1px solid rgba(8,52,58,0.35)", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>+</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
          <button onClick={() => setEditMode((v) => !v)} style={{ height: 32, padding: "0 10px", background: editMode ? "#9df8ff" : "#fff", border: `1px solid ${editMode ? "#0f7f8b" : UI_THEME.line}`, borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
            {editMode ? "EDIT: ON" : "EDIT: OFF"}
          </button>
          <button onClick={() => { addWidget(); setEditMode(true); }} style={{ width: 32, height: 32, background: "#fff", border: `1px solid ${UI_THEME.line}`, borderRadius: 8, cursor: "pointer", fontSize: 20 }}>+</button>
        </div>
      </header>

      <div style={{ position: "relative", width: "100%", height: canvasH, overflow: "hidden" }} onContextMenu={(e) => { e.preventDefault(); setCanvasMenu({ x: e.clientX, y: e.clientY }); setWidgetMenu(null); }}>
        <GridCrosses cols={gridCols} rows={gridRows} stepX={stepX} stepY={stepY} width={viewSize.w} height={canvasH} color={crossColor} />
        {editMode && draggingId && (() => {
          const activeWidget = widgets.find((w) => w.id === draggingId);
          if (!activeWidget) return null;
          return <PlacementSplash widget={activeWidget} widgets={widgets} cols={gridCols} rows={gridRows} stepX={stepX} stepY={stepY} />;
        })()}
        {widgets.map((w) => (
          <WidgetCard
            key={w.id}
            widget={w}
            stepX={stepX}
            stepY={stepY}
            isDragging={draggingId === w.id}
            editMode={editMode}
            onDragStart={(e, id) => {
              if (!editMode) return;
              e.preventDefault();
              const { px, py } = getPointer(e);
              const widget = widgets.find((ww) => ww.id === id);
              if (!widget) return;
              dragRef.current = { id, mode: "drag", edges: {}, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
              setDraggingId(id);
            }}
            onResizeStart={(e, id, edges) => {
              if (!editMode) return;
              e.preventDefault();
              const { px, py } = getPointer(e);
              const widget = widgets.find((ww) => ww.id === id);
              if (!widget) return;
              dragRef.current = { id, mode: "resize", edges, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
              setDraggingId(id);
            }}
            onContextMenu={(e, id) => { e.preventDefault(); setWidgetMenu({ x: e.clientX, y: e.clientY, id }); setModuleTypeMenu(null); setCanvasMenu(null); }}
            onHeaderClick={() => {}}
            onHeaderDoubleClick={(e, id) => {
              setWidgetMenu(null);
              setCanvasMenu(null);
              setModuleTypeMenu({ x: e.clientX, y: e.clientY, id });
            }}
          />
        ))}
      </div>

      {tabMenu && (
        <FloatingMenu x={tabMenu.x} y={tabMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { startRenamingTab(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Rename View</button>
          <button style={{ ...menuBtnBase, color: tabs.length > 1 ? "#c62828" : "#999" }} disabled={tabs.length === 1} onClick={() => { deleteTab(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Delete View</button>
        </FloatingMenu>
      )}

      {widgetMenu && (
        <FloatingMenu x={widgetMenu.x} y={widgetMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { duplicateWidget(widgetMenu.id); closeMenus(); }} {...hoverHandlers}>Duplicate</button>
          {COLORWAY_ORDER.map((theme) => (
            <button key={theme} style={menuBtnBase} onClick={() => {
              updateActiveWidgets((prev) => prev.map((w) => (w.id === widgetMenu.id ? applyColorway(w, theme) : w)));
              closeMenus();
            }} {...hoverHandlers}>
              <span style={{ width: 10, height: 10, border: "1px solid #333", background: COLORWAYS[theme].color, display: "inline-block" }} /> {theme.toUpperCase()}
            </button>
          ))}
          <button style={{ ...menuBtnBase, color: "#c62828" }} onClick={() => { updateActiveWidgets((prev) => prev.filter((w) => w.id !== widgetMenu.id)); closeMenus(); }} {...hoverHandlers}>Delete</button>
        </FloatingMenu>
      )}

      {moduleTypeMenu && (
        <FloatingMenu x={moduleTypeMenu.x} y={moduleTypeMenu.y} onClose={closeMenus}>
          {WIDGET_LIBRARY.map((item) => (
            <button
              key={item.kind}
              style={menuBtnBase}
              onClick={() => {
                updateActiveWidgets((prev) => prev.map((w) => (w.id === moduleTypeMenu.id ? { ...w, kind: item.kind, title: item.label } : w)));
                closeMenus();
              }}
              {...hoverHandlers}
            >
              {item.label}
            </button>
          ))}
        </FloatingMenu>
      )}

      {canvasMenu && (
        <FloatingMenu x={canvasMenu.x} y={canvasMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { setEditMode((v) => !v); closeMenus(); }} {...hoverHandlers}>Toggle Edit Mode</button>
        </FloatingMenu>
      )}
    </div>
  );
};

export default App;
