import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Frame from "./frame";
import FrameCanvas from "./framecanvas";
import FrameRightClickMenu from "./framerightclickmenu";
import ModulePickerMenu from "./menus/ModulePickerMenu";
import { MODULE_CONTENT_MAP as CONTENT_MAP, MODULE_LIBRARY as FRAME_MODULE_LIBRARY } from "../modules";
import type { FrameDataModel, DragState, ResizeEdges } from "../types";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";
import { emitDashboardEvent, EVENT_FRAME_LINK_GRAPH_UPDATED } from "../modules/node-map/eventbus";
import { FRAME_REGISTRY_KEY } from "../modules/linkingGraph";
import { buildLinkModulesLabel, buildLinkPool, computeLinkPlan, delinkForPool, FRAME_LINKS_KEY, mergeLinkPlan, sanitizeFrameLinks, type FrameLinkEdge } from "./frameLinking";
import { createDefaultNodeViewFrames } from "./DefaultViews";

const CELL_SIZE = 28;
const HEADER_H = 48;
const CROSS_ARM = 2;
const MIN_W = 3;
const MIN_H = 3;
const HANDLE = 6;
const CORNER_SIZE = 14;
const CHILD_GRID_DIVISOR = 2;
const CHILD_EDGE_GAP = 0.5;
const HALF_STEP = 0.5;

const DEFAULT_FRAME_KIND = FRAME_MODULE_LIBRARY[0]?.kind ?? "editor";

const COLORWAYS = {
  teal: { color: "#00e9ff", accent: "#006f85", text: "#042028", tagBg: "#042028", tagText: "#ffffff" },
  light: { color: "#ffffff", accent: "#111111", text: "#111111", tagBg: "rgb(0, 233, 255)", tagText: "#041d22" },
  dark: { color: "#101214", accent: "#ffffff", text: "#ffffff", tagBg: "#ffffff", tagText: "#050505" },
} as const;

type ColorwayKey = keyof typeof COLORWAYS;
const COLORWAY_ORDER: ColorwayKey[] = ["teal", "light", "dark"];

const UI_THEME = {
  surface: "#f7fffe",
  panel: "#00e9ff",
  line: "rgba(12, 67, 74, 0.45)",
  text: "#041d22",
  subtext: "#0b5058",
};




interface ViewTab {
  id: string;
  name: string;
  frames: FrameDataModel[];
}

interface DashboardSnapshot {
  tabs: ViewTab[];
  activeTabId: string;
  bgColor: string;
  crossColor: string;
  headerBgColor: string;
  headerTextColor: string;
  tabBgColor: string;
  tabTextColor: string;
}

// Numeric clamp helper used by drag/resize/pan boundary guards.
function clamp(v: number, lo: number, hi: number) {
  if (lo > hi) return lo;
  return Math.max(lo, Math.min(hi, v));
}

function snapToHalfStep(value: number) {
  return Math.round(value / HALF_STEP) * HALF_STEP;
}

function clampToRangeWithInset(value: number, min: number, max: number, inset: number) {
  const lo = min + inset;
  const hi = max - inset;
  if (lo > hi) return clamp(value, min, max);
  return clamp(value, lo, hi);
}

function framesOverlap(a: FrameDataModel, b: FrameDataModel) {
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

// Storage migration guard: sanitize persisted frame payloads from localStorage.
function coerceFrame(value: unknown): FrameDataModel | null {
  if (!isObject(value)) return null;
  const { id, kind, parentId, theme, x, y, w, h, title, color, accent } = value;
  if (
    typeof id !== "string" || typeof kind !== "string" || typeof x !== "number" || typeof y !== "number" ||
    typeof w !== "number" || typeof h !== "number" || typeof title !== "string" || typeof color !== "string" || typeof accent !== "string"
  ) return null;

  const normalizedKind = kind === "node-doc" ? "editor" : kind;

  return {
    id,
    kind: normalizedKind,
    parentId: typeof parentId === "string" && parentId.trim() ? parentId : undefined,
    theme: isColorway(theme) ? theme : theme === "white" ? "light" : theme === "black" ? "dark" : theme === "orange" ? "light" : "teal",
    x: Math.max(0, snapToHalfStep(x)),
    y: Math.max(0, snapToHalfStep(y)),
    w: Math.max(MIN_W, Math.round(w)),
    h: Math.max(MIN_H, Math.round(h)),
    title,
    color,
    accent,
  };
}

function sanitizeFrames(value: unknown): FrameDataModel[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const cleaned: FrameDataModel[] = [];
  for (const item of value) {
    const widget = coerceFrame(item);
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
function loadFrameLinks(): FrameLinkEdge[] {
  try {
    const raw = localStorage.getItem(FRAME_LINKS_KEY);
    if (!raw) return [];
    return sanitizeFrameLinks(JSON.parse(raw));
  } catch {
    return [];
  }
}
function persistFrameLinks(next: FrameLinkEdge[]) {
  try { localStorage.setItem(FRAME_LINKS_KEY, JSON.stringify(next)); } catch {}
}

// Load saved dashboard views/tabs with legacy widget compatibility fallback.
function loadViews(): { tabs: ViewTab[]; activeId: string } {
  const fallback = { tabs: [{ id: "view-default", name: "Default Node View", frames: createDefaultNodeViewFrames() }], activeId: "view-default" };
  try {
    const raw = localStorage.getItem(VIEWS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!isObject(parsed) || !Array.isArray(parsed.tabs) || typeof parsed.activeId !== "string") return fallback;

    const tabs = parsed.tabs
      .map((tab) => {
        if (!isObject(tab) || typeof tab.id !== "string" || typeof tab.name !== "string") return null;
        const frames = sanitizeFrames((tab as { frames?: unknown; widgets?: unknown }).frames ?? tab.widgets);
        return { id: tab.id, name: tab.name, frames } satisfies ViewTab;
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
  try {
    const serializedTabs = tabs.map((tab) => ({ ...tab, widgets: tab.frames }));
    localStorage.setItem(VIEWS_KEY, JSON.stringify({ tabs: serializedTabs, activeId }));
  } catch {}
}

// Load persisted theme settings for canvas/header/tab color customization.
function loadSettings(): { bgColor?: string; crossColor?: string; headerBgColor?: string; headerTextColor?: string; tabBgColor?: string; tabTextColor?: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return {};
    return {
      bgColor: isHexColor(parsed.bgColor) ? parsed.bgColor : undefined,
      crossColor: isHexColor(parsed.crossColor) ? parsed.crossColor : undefined,
      headerBgColor: isHexColor(parsed.headerBgColor) ? parsed.headerBgColor : undefined,
      headerTextColor: isHexColor(parsed.headerTextColor) ? parsed.headerTextColor : undefined,
      tabBgColor: isHexColor(parsed.tabBgColor) ? parsed.tabBgColor : undefined,
      tabTextColor: isHexColor(parsed.tabTextColor) ? parsed.tabTextColor : undefined,
    };
  } catch {
    return {};
  }
}

function saveSettings(s: { bgColor: string; crossColor: string; headerBgColor: string; headerTextColor: string; tabBgColor: string; tabTextColor: string }) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

function persistFrameRegistry(next: Record<string, { kind: string }>) {
  try { localStorage.setItem(FRAME_REGISTRY_KEY, JSON.stringify(next)); } catch {}
}

// SVG grid marker renderer (plus intersections) for visual snapping guidance.
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
  frame: FrameDataModel;
  frames: FrameDataModel[];
  cols: number;
  rows: number;
  stepX: number;
  stepY: number;
}> = React.memo(({ frame, frames, cols, rows, stepX, stepY }) => {
  const cells = useMemo(() => {
    let seed = frame.x * 73856093 + frame.y * 19349663;
    for (let i = 0; i < frame.id.length; i++) seed = (seed * 33 + frame.id.charCodeAt(i)) >>> 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const occupied = new Set<string>();
    for (const other of frames) {
      if (other.id === frame.id) continue;
      for (let y = other.y; y < other.y + other.h; y++) {
        for (let x = other.x; x < other.x + other.w; x++) {
          occupied.add(`${x},${y}`);
        }
      }
    }

    const sizeFactor = Math.min(1.5, Math.log2(Math.max(frame.w, frame.h) + 1) / 4);
    const edgeSpan = () => (rand() < 0.72 - sizeFactor * 0.08 ? 2 : 3);
    const armSpan = () => 1 + Math.floor(rand() * 3) + (rand() < 0.18 + sizeFactor * 0.08 ? 2 : 0);
    const radii = {
      left: edgeSpan(),
      right: edgeSpan(),
      top: edgeSpan(),
      bottom: edgeSpan(),
    };
    const left = clamp(frame.x - radii.left, 0, Math.max(0, cols - 1));
    const right = clamp(frame.x + frame.w - 1 + radii.right, 0, Math.max(0, cols - 1));
    const top = clamp(frame.y - radii.top, 0, Math.max(0, rows - 1));
    const bottom = clamp(frame.y + frame.h - 1 + radii.bottom, 0, Math.max(0, rows - 1));

    const result: { x: number; y: number; distance: number }[] = [];
    const seen = new Set<string>();
    const centerX = frame.x + frame.w / 2;
    const centerY = frame.y + frame.h / 2;
    const extraCells = new Set<string>();
    const addArm = (startX: number, startY: number, dx: number, dy: number, len: number) => {
      for (let i = 1; i <= len; i++) {
        const x = startX + dx * i;
        const y = startY + dy * i;
        if (x < 0 || y < 0 || x >= cols || y >= rows) break;
        extraCells.add(`${x},${y}`);
      }
    };

    addArm(frame.x + Math.floor(rand() * frame.w), top, 0, -1, armSpan());
    addArm(frame.x + Math.floor(rand() * frame.w), bottom, 0, 1, armSpan());
    addArm(left, frame.y + Math.floor(rand() * frame.h), -1, 0, armSpan());
    addArm(right, frame.y + Math.floor(rand() * frame.h), 1, 0, armSpan());

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const insideFrame = x >= frame.x && x < frame.x + frame.w && y >= frame.y && y < frame.y + frame.h;
        const gapLeft = frame.x - (x + 1);
        const gapRight = x - (frame.x + frame.w) + 1;
        const gapTop = frame.y - (y + 1);
        const gapBottom = y - (frame.y + frame.h) + 1;
        const edgeDistance = Math.max(0, gapLeft, gapRight, gapTop, gapBottom);
        const coreThickness = Math.min(2.9, 1.75 + rand() * 0.7 + sizeFactor * 0.15);
        const withinCore = edgeDistance <= coreThickness;
        const splashNoise = rand() > 0.14;
        const inShape = withinCore && splashNoise;
        const isArm = extraCells.has(`${x},${y}`);
        if (insideFrame || occupied.has(`${x},${y}`) || (!inShape && !isArm)) continue;
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
      const insideFrame = x >= frame.x && x < frame.x + frame.w && y >= frame.y && y < frame.y + frame.h;
      if (insideFrame) continue;
      const dist = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
      if (seen.has(cell)) continue;
      seen.add(cell);
      result.push({ x, y, distance: dist });
    }

    return result;
  }, [frame, frames, cols, rows]);

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
              border: "1px solid rgba(0, 233, 255, 0.72)",
              background: `rgba(0, 233, 255, ${opacity})`,
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

interface FrameCardProps {
  frame: FrameDataModel;
  stepX: number;
  stepY: number;
  isChild?: boolean;
  nestedChildren?: React.ReactNode;
  isDragging: boolean;
  isSelected: boolean;
  editMode: boolean;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, id: string) => void;
  onResizeStart: (e: React.MouseEvent | React.TouchEvent, id: string, edges: ResizeEdges) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onModuleNameClick: (e: React.MouseEvent, id: string) => void;
  onSelect: (event: React.MouseEvent | React.TouchEvent, id: string) => void;
  isLinked: boolean;
  edgeHit?: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

const FrameCard: React.FC<FrameCardProps> = ({ frame, stepX, stepY, isChild, nestedChildren, isDragging, isSelected, editMode, onDragStart, onResizeStart, onContextMenu, onModuleNameClick, onSelect, isLinked, edgeHit }) => {
  const Content = CONTENT_MAP[frame.kind];
  const theme = COLORWAYS[frame.theme ?? "teal"];
  const isNodesFrame = frame.kind === "nodes" || frame.kind === "nodes-map" || frame.kind === "logic-map" || frame.kind === "editor" || frame.kind === "node-doc";
  const isEdgeToEdgeContentFrame = isNodesFrame || frame.kind === "company-explorer" || frame.kind === "kanban";
  const left = frame.x * stepX;
  const top = frame.y * stepY;
  const nested = !!isChild;
  const shouldScaleContent = frame.w <= 7 || frame.h <= 7;
  const contentScale = shouldScaleContent ? clamp(Math.min((frame.w * stepX) / 320, (frame.h * stepY) / 220), 0.65, 1) : 1;
  const previousEdgeRef = useRef<{ left: boolean; right: boolean; top: boolean; bottom: boolean }>({ left: false, right: false, top: false, bottom: false });
  const timersRef = useRef<Partial<Record<"left" | "right" | "top" | "bottom", number>>>({});
  const [edgeBump, setEdgeBump] = useState<{ left: boolean; right: boolean; top: boolean; bottom: boolean }>({ left: false, right: false, top: false, bottom: false });

  useEffect(() => {
    if (nested || !edgeHit) return;
    const previous = previousEdgeRef.current;
    const sides: Array<"left" | "right" | "top" | "bottom"> = ["left", "right", "top", "bottom"];
    for (const side of sides) {
      if (!edgeHit[side] || previous[side]) continue;
      setEdgeBump((prev) => ({ ...prev, [side]: true }));
      if (timersRef.current[side]) window.clearTimeout(timersRef.current[side]);
      timersRef.current[side] = window.setTimeout(() => {
        setEdgeBump((prev) => ({ ...prev, [side]: false }));
      }, 220);
    }
    previousEdgeRef.current = { ...edgeHit };
  }, [nested, edgeHit]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(timersRef.current)) {
        if (timer) window.clearTimeout(timer);
      }
    };
  }, []);

  const edgeBumpBase = {
    position: "absolute",
    pointerEvents: "none",
    background: frame.accent,
    opacity: 0.7,
  } satisfies React.CSSProperties;

  return (
    <Frame
      data-child-frame={nested ? "true" : "false"}
      style={{
        position: "absolute",
        left,
        top,
        width: frame.w * stepX,
        height: frame.h * stepY,
        background: frame.color,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "default",
        userSelect: "none",
        zIndex: nested ? 200 : (isDragging ? 100 : 1),
        color: theme.text,
        boxShadow: isSelected
          ? `0 0 0 2px ${frame.accent}, 0 8px 20px rgba(2,22,46,0.24)`
          : nested
            ? "0 3px 16px rgba(0,0,0,0.18)"
            : undefined,
        border: "none",
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDownCapture={(e) => {
        const target = e.target as HTMLElement;
        if (!nested && target.closest('[data-child-frame="true"]')) return;
        if (e.button !== 0) return;
        onSelect(e, frame.id);
      }}
      onTouchStartCapture={(e) => {
        const target = e.target as HTMLElement;
        if (!nested && target.closest('[data-child-frame="true"]')) return;
        onSelect(e, frame.id);
      }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (!nested && target.closest('[data-child-frame="true"]')) return;
        if (target.dataset.handle) return;
        if (!editMode && !target.closest('[data-header-drag-handle="true"]')) return;
        onDragStart(e, frame.id);
      }}
      onTouchStart={(e) => {
        const target = e.target as HTMLElement;
        if (!nested && target.closest('[data-child-frame="true"]')) return;
        if (target.dataset.handle) return;
        if (!editMode && !target.closest('[data-header-drag-handle="true"]')) return;
        onDragStart(e, frame.id);
      }}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        if (!nested && target.closest('[data-child-frame="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e, frame.id);
      }}
    >
      <div
        data-header-drag-handle="true"
        style={{
          position: "absolute",
          // Pin the compact header plate to frame edges so the tag looks flush (no dead corner gaps).
          top: 0,
          left: 0,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 8px",
          borderRight: "none",
          borderBottom: "none",
          background: frame.color,
          cursor: isDragging ? "grabbing" : "grab",
          fontFamily: "'IBM Plex Mono', monospace",
        }}
      >
          <span
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onModuleNameClick(e, frame.id); }}
            style={{ fontSize: 12, fontWeight: 800, color: theme.tagText, textTransform: "uppercase", letterSpacing: "0.09em", background: theme.tagBg, padding: "3px 8px", cursor: "pointer", lineHeight: 1.1 }}
          >
            {frame.title}
          </span>
          {isLinked && (
            <svg aria-label="linked module" width="17" height="19" viewBox="0 0 17 19" style={{ display: "block" }}>
              <title>Linked</title>
              <polygon points="8.5,1.5 15.5,5.5 15.5,13.5 8.5,17.5 1.5,13.5 1.5,5.5" fill="none" stroke={frame.accent} strokeWidth="1.8" />
            </svg>
          )}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: isEdgeToEdgeContentFrame ? 0 : "8px 10px", overflow: frame.kind === "company-explorer" || frame.kind === "kanban" ? "hidden" : "auto", fontFamily: "'IBM Plex Mono', monospace" }}>
        <div style={{ width: `${100 / contentScale}%`, height: `${100 / contentScale}%`, transform: `scale(${contentScale})`, transformOrigin: "top left" }}>
          {Content ? <Content accent={frame.accent} widgetId={frame.id} hideTopControls={isNodesFrame} theme={frame.theme} /> : <div style={{ height: "100%", display: "grid", placeItems: "center", opacity: 0.3 }}><span style={{ fontSize: 13, color: frame.accent }}>{frame.title}</span></div>}
        </div>
      </div>
      {!nested && (
        <>
          {edgeBump.left && <div style={{ ...edgeBumpBase, left: 0, top: 0, bottom: 0, width: 10, animation: "frame-edge-bump-x 220ms ease-out forwards", transformOrigin: "left center" }} />}
          {edgeBump.right && <div style={{ ...edgeBumpBase, right: 0, top: 0, bottom: 0, width: 10, animation: "frame-edge-bump-x 220ms ease-out forwards", transformOrigin: "right center" }} />}
          {edgeBump.top && <div style={{ ...edgeBumpBase, top: 0, left: 0, right: 0, height: 10, animation: "frame-edge-bump-y 220ms ease-out forwards", transformOrigin: "center top" }} />}
          {edgeBump.bottom && <div style={{ ...edgeBumpBase, bottom: 0, left: 0, right: 0, height: 10, animation: "frame-edge-bump-y 220ms ease-out forwards", transformOrigin: "center bottom" }} />}
        </>
      )}
      {nestedChildren}
      {HANDLES.map((h, i) => <div key={i} data-handle="true" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, frame.id, h.edges); }} onTouchStart={(e) => { e.stopPropagation(); onResizeStart(e, frame.id, h.edges); }} style={{ position: "absolute", cursor: h.cursor, opacity: editMode ? 0.45 : 0.2, ...h.style }} />)}
    </Frame>
  );
};

const menuBtnBase: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 16px", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", fontFamily: "'IBM Plex Mono', monospace", background: "none", border: "none", color: "#333", cursor: "pointer", textAlign: "left" };
const hoverHandlers = { onMouseEnter: (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = "#f5f5f5"; }, onMouseLeave: (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = "none"; } };

let frameCounter = 0;
let tabCounter = 0;
const createFrameId = () => `frame-${Date.now()}-${++frameCounter}`;
const createTabId = () => `view-${Date.now()}-${++tabCounter}`;

const App: React.FC = () => {
  const loaded = useMemo(() => loadViews(), []);
  const [tabs, setTabs] = useState<ViewTab[]>(loaded.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(loaded.activeId);
  const [movingTabId, setMovingTabId] = useState<string | null>(null);
  const [isDraggingTab, setIsDraggingTab] = useState(false);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null);
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const initialSettingsRef = useRef(loadSettings());
  const [bgColor, setBgColor] = useState(() => initialSettingsRef.current.bgColor || "#f7fffe");
  const [crossColor, setCrossColor] = useState(() => initialSettingsRef.current.crossColor || "#00a8b8");
  const [headerBgColor, setHeaderBgColor] = useState(() => initialSettingsRef.current.headerBgColor || UI_THEME.panel);
  const [headerTextColor, setHeaderTextColor] = useState(() => initialSettingsRef.current.headerTextColor || UI_THEME.text);
  const [tabBgColor, setTabBgColor] = useState(() => initialSettingsRef.current.tabBgColor || "#ffffff");
  const [tabTextColor, setTabTextColor] = useState(() => initialSettingsRef.current.tabTextColor || "#08343a");
  const [frameLinks, setFrameLinks] = useState<FrameLinkEdge[]>(() => loadFrameLinks());
  const [viewSize, setViewSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  const [frameRightClickMenu, setFrameRightClickMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [frameDeleteConfirmation, setFrameDeleteConfirmation] = useState<{ frameIDs: string[] } | null>(null);
  const [moduleTypeMenu, setModuleTypeMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [canvasMenu, setCanvasMenu] = useState<{ x: number; y: number; gridX: number; gridY: number } | null>(null);
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const dragRef = useRef<DragState | null>(null);
  const tabDragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);
  const copiedFrameRef = useRef<FrameDataModel | null>(null);
  const undoStackRef = useRef<DashboardSnapshot[]>([]);
  const redoStackRef = useRef<DashboardSnapshot[]>([]);
  const lastSnapshotRef = useRef<DashboardSnapshot | null>(null);
  const restoringRef = useRef(false);
  const lastFrameRegistrySignatureRef = useRef("");
  const frameLinkRevisionRef = useRef(0);

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);
  const frames = activeTab?.frames ?? [];
  const rootFrames = useMemo(() => frames.filter((frame) => !frame.parentId), [frames]);
  const childrenByParent = useMemo(() => {
    const grouped = new Map<string, FrameDataModel[]>();
    for (const frame of frames) {
      if (!frame.parentId) continue;
      const current = grouped.get(frame.parentId) ?? [];
      current.push(frame);
      grouped.set(frame.parentId, current);
    }
    return grouped;
  }, [frames]);

  useEffect(() => {
    if (!selectedFrameId) return;
    if (!frames.some((w) => w.id === selectedFrameId)) setSelectedFrameId(null);
  }, [frames, selectedFrameId]);
  useEffect(() => {
    const ids = new Set(frames.map((widget) => widget.id));
    setSelectedFrameIds((prev) => new Set(Array.from(prev).filter((id) => ids.has(id))));
  }, [frames]);

  const updateActiveFrames = useCallback((updater: (prev: FrameDataModel[]) => FrameDataModel[]) => {
    setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, frames: updater(tab.frames) } : tab)));
  }, [activeTabId]);
  useEffect(() => {
    const frameIDs = new Set(frames.map((frame) => frame.id));
    if (!frames.some((frame) => frame.parentId && !frameIDs.has(frame.parentId))) return;
    updateActiveFrames((previous) => previous.map((frame) => (frame.parentId && !frameIDs.has(frame.parentId) ? { ...frame, parentId: undefined } : frame)));
  }, [frames, updateActiveFrames]);

  const buildSnapshot = useCallback((): DashboardSnapshot => ({
    tabs,
    activeTabId,
    bgColor,
    crossColor,
    headerBgColor,
    headerTextColor,
    tabBgColor,
    tabTextColor,
  }), [tabs, activeTabId, bgColor, crossColor, headerBgColor, headerTextColor, tabBgColor, tabTextColor]);

  const applySnapshot = useCallback((snapshot: DashboardSnapshot) => {
    restoringRef.current = true;
    setTabs(snapshot.tabs);
    setActiveTabId(snapshot.activeTabId);
    setBgColor(snapshot.bgColor);
    setCrossColor(snapshot.crossColor);
    setHeaderBgColor(snapshot.headerBgColor);
    setHeaderTextColor(snapshot.headerTextColor);
    setTabBgColor(snapshot.tabBgColor);
    setTabTextColor(snapshot.tabTextColor);
    lastSnapshotRef.current = snapshot;
    setTimeout(() => { restoringRef.current = false; }, 0);
  }, []);

  useEffect(() => {
    const onResize = () => setViewSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => { saveViews(tabs, activeTabId); }, [tabs, activeTabId]);
  useEffect(() => { saveSettings({ bgColor, crossColor, headerBgColor, headerTextColor, tabBgColor, tabTextColor }); }, [bgColor, crossColor, headerBgColor, headerTextColor, tabBgColor, tabTextColor]);
  useEffect(() => {
    const snapshot = buildSnapshot();
    if (restoringRef.current) {
      lastSnapshotRef.current = snapshot;
      return;
    }
    const last = lastSnapshotRef.current;
    if (!last) {
      lastSnapshotRef.current = snapshot;
      return;
    }
    if (JSON.stringify(last) === JSON.stringify(snapshot)) return;
    undoStackRef.current.push(last);
    if (undoStackRef.current.length > 120) undoStackRef.current.shift();
    redoStackRef.current = [];
    lastSnapshotRef.current = snapshot;
  }, [buildSnapshot]);

  const canvasH = viewSize.h - HEADER_H;
  const gridCols = Math.max(1, Math.round(viewSize.w / CELL_SIZE));
  const gridRows = Math.max(1, Math.round(canvasH / CELL_SIZE));
  const stepX = viewSize.w / gridCols;
  const stepY = canvasH / gridRows;

  useEffect(() => {
    updateActiveFrames((previous) => {
      let changed = false;
      const byId = new Map(previous.map((frame) => [frame.id, frame]));
      const normalized = previous.map((frame) => {
        if (!frame.parentId) {
          const maxRootX = Math.max(0, gridCols - frame.w);
          const maxRootY = Math.max(0, gridRows - frame.h);
          const nextX = clamp(frame.x, 0, maxRootX);
          const nextY = clamp(frame.y, 0, maxRootY);
          if (nextX !== frame.x || nextY !== frame.y) {
            changed = true;
            return { ...frame, x: nextX, y: nextY };
          }
          return frame;
        }
        const parent = byId.get(frame.parentId);
        if (!parent) return frame;
        const maxChildX = Math.max(0, parent.w - frame.w);
        const maxChildY = Math.max(0, parent.h - frame.h);
        const nextX = clampToRangeWithInset(frame.x, 0, maxChildX, CHILD_EDGE_GAP);
        const nextY = clampToRangeWithInset(frame.y, 0, maxChildY, CHILD_EDGE_GAP);
        if (nextX !== frame.x || nextY !== frame.y) {
          changed = true;
          return { ...frame, x: nextX, y: nextY };
        }
        return frame;
      });
      return changed ? normalized : previous;
    });
  }, [gridCols, gridRows, updateActiveFrames]);

  const applyColorway = useCallback((frame: FrameDataModel, theme: ColorwayKey): FrameDataModel => {
    const swatch = COLORWAYS[theme];
    return { ...frame, theme, color: swatch.color, accent: swatch.accent };
  }, []);

  const addFrame = useCallback((kind = DEFAULT_FRAME_KIND, preferred?: { x: number; y: number }) => {
    const template = FRAME_MODULE_LIBRARY.find((item) => item.kind === kind) ?? FRAME_MODULE_LIBRARY[0];
    if (!template) return;
    const id = createFrameId();
    const theme = COLORWAY_ORDER[(frameCounter + 1) % COLORWAY_ORDER.length];
    const nextX = preferred ? clamp(preferred.x, 0, Math.max(0, gridCols - template.defaultW)) : 1;
    const nextY = preferred ? clamp(preferred.y, 0, Math.max(0, gridRows - template.defaultH)) : 1;
    updateActiveFrames((prev) => [...prev, { id, kind, theme, x: nextX, y: nextY, w: template.defaultW, h: template.defaultH, title: template.label, color: COLORWAYS[theme].color, accent: COLORWAYS[theme].accent }]);
  }, [gridCols, gridRows, updateActiveFrames]);

  const duplicateFrame = useCallback((id: string) => {
    updateActiveFrames((prev) => {
      const src = prev.find((w) => w.id === id);
      if (!src) return prev;
      return [...prev, { ...src, id: createFrameId(), x: clamp(src.x + 2, 0, gridCols - src.w), y: clamp(src.y + 2, 0, gridRows - src.h) }];
    });
  }, [gridCols, gridRows, updateActiveFrames]);

  const closeMenus = useCallback(() => { setFrameRightClickMenu(null); setModuleTypeMenu(null); setCanvasMenu(null); setHeaderMenu(null); setTabMenu(null); }, []);

  const linkPool = useMemo(() => buildLinkPool({
    frames,
    selectedFrameIds,
    selectedFrameId,
    contextFrameId: frameRightClickMenu?.id ?? null,
  }), [frames, selectedFrameIds, selectedFrameId, frameRightClickMenu]);
  const linkPlan = useMemo(() => {
    return computeLinkPlan(linkPool);
  }, [linkPool]);

  const linkSelectedNodeModules = useCallback(() => {
    if (!linkPlan) return;
    setFrameLinks((previous) => mergeLinkPlan(previous, linkPlan));
  }, [linkPlan]);
  const delinkSelectedNodeModules = useCallback(() => {
    const result = delinkForPool(linkPool, frameLinks);
    if (!result.changed) return;
    setFrameLinks(result.nextEdges);
  }, [linkPool, frameLinks]);
  const linkModulesLabel = useMemo(() => {
    return buildLinkModulesLabel(linkPool, linkPlan);
  }, [linkPool, linkPlan]);
  const canDelinkModules = useMemo(() => delinkForPool(linkPool, frameLinks).changed, [linkPool, frameLinks]);
  const linkedFrameIDs = useMemo(() => {
    const ids = new Set<string>();
    const frameIDs = new Set(frames.map((frame) => frame.id));
    for (const edge of frameLinks) {
      if (!frameIDs.has(edge.a) || !frameIDs.has(edge.b)) continue;
      ids.add(edge.a);
      ids.add(edge.b);
    }
    return ids;
  }, [frameLinks, frames]);
  const frameInContextMenu = useMemo(() => {
    if (!frameRightClickMenu) return null;
    return frames.find((frame) => frame.id === frameRightClickMenu.id) ?? null;
  }, [frameRightClickMenu, frames]);

  useEffect(() => {
    const frameIDs = new Set(tabs.flatMap((tab) => tab.frames.map((frame) => frame.id)));
    setFrameLinks((previous) => previous.filter((edge) => frameIDs.has(edge.a) && frameIDs.has(edge.b)));
  }, [tabs]);
  useEffect(() => {
    const groups: FrameDataModel[][] = [];
    for (const parent of frames.filter((frame) => !frame.parentId)) {
      const children = frames.filter((frame) => frame.parentId === parent.id);
      if (children.length === 0) continue;
      groups.push([parent, ...children]);
    }

    if (groups.length === 0) return;

    let nextLinks = frameLinks;
    let changed = false;

    for (const group of groups) {
      const merged = mergeLinkPlan(nextLinks, computeLinkPlan(group));
      if (merged.length !== nextLinks.length) changed = true;
      nextLinks = merged;
    }

    if (changed) setFrameLinks(nextLinks);
  }, [frames, frameLinks]);

  useEffect(() => {
    persistFrameLinks(frameLinks);
    frameLinkRevisionRef.current += 1;
    emitDashboardEvent(EVENT_FRAME_LINK_GRAPH_UPDATED, {
      revision: frameLinkRevisionRef.current,
      changedAt: Date.now(),
    });
  }, [frameLinks]);

  useEffect(() => {
    const registry = Object.fromEntries(frames.map((frame) => [frame.id, { kind: frame.kind }]));
    const signature = Object.entries(registry)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, item]) => `${id}:${item.kind}`)
      .join("|");
    if (signature === lastFrameRegistrySignatureRef.current) return;
    lastFrameRegistrySignatureRef.current = signature;
    persistFrameRegistry(registry);
  }, [frames]);

  const confirmDeleteFrameSelection = useCallback((frameIDs: string[]) => {
    if (frameIDs.length === 0) return;
    // Keep IDs unique so the confirmation copy and delete result stay deterministic.
    const uniqueFrameIDs = Array.from(new Set(frameIDs));
    setFrameDeleteConfirmation({ frameIDs: uniqueFrameIDs });
  }, []);

  const deleteSelectedFrame = useCallback(() => {
    const ids = selectedFrameIds.size > 0 ? selectedFrameIds : (selectedFrameId ? new Set([selectedFrameId]) : new Set<string>());
    if (ids.size === 0) return;
    confirmDeleteFrameSelection(Array.from(ids));
  }, [confirmDeleteFrameSelection, selectedFrameId, selectedFrameIds]);

  const applyConfirmedFrameDelete = useCallback((frameIDs: string[]) => {
    if (frameIDs.length === 0) return;
    const frameIDSet = new Set(frameIDs);
    updateActiveFrames((prev) => prev.filter((frame) => !frameIDSet.has(frame.id)));
    setSelectedFrameId(null);
    setSelectedFrameIds(new Set());
  }, [updateActiveFrames]);

  const copySelectedFrame = useCallback(() => {
    if (!selectedFrameId) return;
    const target = frames.find((w) => w.id === selectedFrameId);
    if (!target) return;
    copiedFrameRef.current = { ...target };
  }, [selectedFrameId, frames]);

  const pasteFrame = useCallback(() => {
    const copied = copiedFrameRef.current;
    if (!copied) return;
    const id = createFrameId();
    const pasted: FrameDataModel = {
      ...copied,
      id,
      x: clamp(copied.x + 2, 0, gridCols - copied.w),
      y: clamp(copied.y + 2, 0, gridRows - copied.h),
    };
    updateActiveFrames((prev) => [...prev, pasted]);
    setSelectedFrameId(id);
    setSelectedFrameIds(new Set([id]));
  }, [gridCols, gridRows, updateActiveFrames]);

  const undo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const current = buildSnapshot();
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push(current);
    applySnapshot(previous);
  }, [applySnapshot, buildSnapshot]);

  const redo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const current = buildSnapshot();
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(current);
    applySnapshot(next);
  }, [applySnapshot, buildSnapshot]);

  useKeyboardShortcuts({
    deleteSelection: deleteSelectedFrame,
    copySelection: copySelectedFrame,
    pasteSelection: pasteFrame,
    undo,
    redo,
  });

  const addTab = useCallback(() => {
    const id = createTabId();
    const newTab: ViewTab = { id, name: `View ${tabs.length + 1}`, frames: [] };
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


  const openDefaultNodeView = useCallback((tabID: string) => {
    const framesForView = createDefaultNodeViewFrames();
    setTabs((previous) => previous.map((tab) => (tab.id === tabID ? { ...tab, name: "Default Node View", frames: framesForView } : tab)));
    setFrameLinks((previous) => mergeLinkPlan(previous, computeLinkPlan(framesForView)));
    setActiveTabId(tabID);
    setEditMode(true);
  }, []);

  const saveCurrentAsTemplate = useCallback((tabID: string) => {
    const source = tabs.find((tab) => tab.id === tabID);
    if (!source) return;
    const id = createTabId();
    const templateTab: ViewTab = {
      id,
      name: `${source.name} Template`,
      frames: source.frames.map((frame) => ({ ...frame, id: createFrameId() })),
    };
    setTabs((previous) => [...previous, templateTab]);
    setActiveTabId(id);
  }, [tabs]);



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
      const stepFactor = d.parentId ? CHILD_GRID_DIVISOR : 1;
      const dCols = Math.round((px - d.startMouseX) / (stepX / stepFactor)) / stepFactor;
      const dRows = Math.round((py - d.startMouseY) / (stepY / stepFactor)) / stepFactor;

      updateActiveFrames((prev) => prev.map((w) => {
        if (w.id !== d.id) return w;
        const parent = d.parentId ? prev.find((candidate) => candidate.id === d.parentId) : null;
        const maxCols = parent ? parent.w : gridCols;
        const maxRows = parent ? parent.h : gridRows;
        const edgeInset = parent ? CHILD_EDGE_GAP : 0;
        if (d.mode === "drag") {
          const maxX = Math.max(0, maxCols - w.w);
          const maxY = Math.max(0, maxRows - w.h);
          return {
            ...w,
            x: clampToRangeWithInset(d.origX + dCols, 0, maxX, edgeInset),
            y: clampToRangeWithInset(d.origY + dRows, 0, maxY, edgeInset),
          };
        }
        let x = d.origX, y = d.origY, nw = d.origW, nh = d.origH;
        if (d.edges.right) nw = clamp(d.origW + dCols, MIN_W, maxCols - d.origX - edgeInset);
        if (d.edges.bottom) nh = clamp(d.origH + dRows, MIN_H, maxRows - d.origY - edgeInset);
        if (d.edges.left) {
          const shift = clamp(dCols, -(d.origX - edgeInset), d.origW - MIN_W);
          x = d.origX + shift;
          nw = d.origW - shift;
        }
        if (d.edges.top) {
          const shift = clamp(dRows, -(d.origY - edgeInset), d.origH - MIN_H);
          y = d.origY + shift;
          nh = d.origH - shift;
        }
        x = clampToRangeWithInset(x, 0, Math.max(0, maxCols - nw), edgeInset);
        y = clampToRangeWithInset(y, 0, Math.max(0, maxRows - nh), edgeInset);
        return { ...w, x, y, w: nw, h: nh };
      }));
    };
    const onEnd = () => {
      const d = dragRef.current;
      if (d) {
        updateActiveFrames((prev) => {
          const target = prev.find((frame) => frame.id === d.id);
          if (!target) return prev;

          let next = prev.map((w) => {
            if (w.id !== d.id) return w;
            if (d.mode === "drag" && !d.parentId) return w;
            const siblingOverlaps = prev.some((candidate) => {
              if (candidate.id === w.id) return false;
              const sameParent = (candidate.parentId ?? "") === (w.parentId ?? "");
              return sameParent && framesOverlap(w, candidate);
            });
            if (!siblingOverlaps) return w;
            return d.mode === "drag"
              ? { ...w, x: d.origX, y: d.origY }
              : { ...w, x: d.origX, y: d.origY, w: d.origW, h: d.origH };
          });

          if (d.mode !== "drag" || d.parentId) return next;
          const moved = next.find((frame) => frame.id === d.id);
          if (!moved) return next;
          const host = next
            .filter((frame) => !frame.parentId && frame.id !== moved.id)
            .find((frame) => framesOverlap(frame, moved));
          if (!host) return next;
          const childX = clampToRangeWithInset(moved.x - host.x, 0, Math.max(0, host.w - moved.w), CHILD_EDGE_GAP);
          const childY = clampToRangeWithInset(moved.y - host.y, 0, Math.max(0, host.h - moved.h), CHILD_EDGE_GAP);
          next = next.map((frame) => (frame.id === moved.id ? { ...frame, parentId: host.id, x: childX, y: childY } : frame));
          return next;
        });
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
  }, [gridCols, gridRows, stepX, stepY, updateActiveFrames]);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: bgColor || UI_THEME.surface }}>
      <style>{`
        @keyframes frame-edge-bump-x {
          0% { opacity: 0.75; transform: scaleX(1); }
          100% { opacity: 0; transform: scaleX(0.18); }
        }
        @keyframes frame-edge-bump-y {
          0% { opacity: 0.75; transform: scaleY(1); }
          100% { opacity: 0; transform: scaleY(0.18); }
        }
      `}</style>
      <header
        style={{ height: HEADER_H, padding: "0 20px", display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", background: headerBgColor, borderBottom: `1px solid ${UI_THEME.line}` }}
        onContextMenu={(e) => { e.preventDefault(); setHeaderMenu({ x: e.clientX, y: e.clientY }); setCanvasMenu(null); setFrameRightClickMenu(null); setModuleTypeMenu(null); }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1 style={{ fontWeight: 800, color: headerTextColor, letterSpacing: "0.04em", textTransform: "uppercase", margin: 0, lineHeight: 1 }}><span style={{ fontSize: 18 }}>Mango</span><span style={{ fontSize: 23, marginLeft: 2 }}>RTS</span></h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, justifySelf: "center", maxWidth: "55vw", overflowX: "auto", padding: "2px 4px" }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
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
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setTabMenu({ x: e.clientX, y: e.clientY, id: tab.id }); }}
              onDoubleClick={() => startRenamingTab(tab.id)}
              onClick={(e) => { if (e.button !== 0 || isDraggingTab) return; setActiveTabId(tab.id); setEditMode(false); }}
              style={{ height: 30, padding: "0 12px", border: activeTabId === tab.id ? `1px solid ${tabTextColor}` : "1px solid rgba(8,52,58,0.35)", background: activeTabId === tab.id ? tabBgColor : `${tabBgColor}B3`, color: tabTextColor, borderRadius: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", cursor: "pointer", whiteSpace: "nowrap", transition: "transform 120ms ease, opacity 120ms ease", opacity: movingTabId === tab.id ? 0.8 : 1, transform: movingTabId === tab.id ? "translateY(-1px)" : "translateY(0px)" }}
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
          <button onClick={addTab} title="New view tab" style={{ width: 30, height: 30, border: "1px solid rgba(8,52,58,0.35)", borderRadius: 8, background: tabBgColor, color: tabTextColor, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>+</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
          <button onClick={() => setEditMode((v) => !v)} style={{ height: 32, padding: "0 10px", background: editMode ? "#9df8ff" : tabBgColor, color: tabTextColor, border: `1px solid ${editMode ? "#0f7f8b" : UI_THEME.line}`, borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
            {editMode ? "EDIT: ON" : "EDIT: OFF"}
          </button>
          <button onClick={() => { addFrame(); setEditMode(true); }} style={{ width: 32, height: 32, background: tabBgColor, color: tabTextColor, border: `1px solid ${UI_THEME.line}`, borderRadius: 8, cursor: "pointer", fontSize: 20 }}>+</button>
        </div>
      </header>

      <FrameCanvas style={{ position: "relative", width: "100%", height: canvasH, overflow: "hidden" }} onClick={() => { setSelectedFrameId(null); setSelectedFrameIds(new Set()); }} onContextMenu={(e) => { e.preventDefault(); setCanvasMenu({ x: e.clientX, y: e.clientY, gridX: Math.floor(e.clientX / stepX), gridY: Math.floor((e.clientY - HEADER_H) / stepY) }); setHeaderMenu(null); setFrameRightClickMenu(null); setModuleTypeMenu(null); }}>
        <GridCrosses cols={gridCols} rows={gridRows} stepX={stepX} stepY={stepY} width={viewSize.w} height={canvasH} color={crossColor} />
        {editMode && draggingId && (() => {
          const activeFrame = frames.find((w) => w.id === draggingId);
          if (!activeFrame || activeFrame.parentId) return null;
          return <PlacementSplash frame={activeFrame} frames={frames} cols={gridCols} rows={gridRows} stepX={stepX} stepY={stepY} />;
        })()}
        {rootFrames.map((w) => (
          <React.Fragment key={w.id}>
            <FrameCard
              frame={w}
              stepX={stepX}
              stepY={stepY}
              isDragging={draggingId === w.id}
              isSelected={selectedFrameIds.has(w.id)}
              isLinked={linkedFrameIDs.has(w.id) || !!childrenByParent.get(w.id)?.length}
              edgeHit={{ left: w.x <= 0, right: w.x + w.w >= gridCols, top: w.y <= 0, bottom: w.y + w.h >= gridRows }}
              editMode={editMode}
              onDragStart={(e, id) => {
                e.preventDefault();
                const { px, py } = getPointer(e);
                const widget = frames.find((ww) => ww.id === id);
                if (!widget) return;
                dragRef.current = { id, parentId: widget.parentId, mode: "drag", edges: {}, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
                setDraggingId(id);
              }}
              onResizeStart={(e, id, edges) => {
                e.preventDefault();
                const { px, py } = getPointer(e);
                const widget = frames.find((ww) => ww.id === id);
                if (!widget) return;
                dragRef.current = { id, parentId: widget.parentId, mode: "resize", edges, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
                setDraggingId(id);
              }}
              onContextMenu={(e, id) => {
                e.preventDefault();
                if (!selectedFrameIds.has(id)) {
                  setSelectedFrameIds(new Set([id]));
                  setSelectedFrameId(id);
                }
                setFrameRightClickMenu({ x: e.clientX, y: e.clientY, id });
                setModuleTypeMenu(null);
                setCanvasMenu(null);
              }}
              onModuleNameClick={(e, id) => {
                setFrameRightClickMenu(null);
                setHeaderMenu(null);
                setCanvasMenu(null);
                setSelectedFrameId(id);
                setSelectedFrameIds(new Set([id]));
                setModuleTypeMenu({ x: e.clientX, y: e.clientY, id });
              }}
              onSelect={(event, id) => {
                const additiveSelect = "ctrlKey" in event ? (!!event.ctrlKey || !!event.shiftKey) : false;
                if (!additiveSelect) {
                  setSelectedFrameId(id);
                  setSelectedFrameIds(new Set([id]));
                  return;
                }
                setSelectedFrameId(id);
                setSelectedFrameIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  if (next.size === 0) next.add(id);
                  return next;
                });
              }}
              nestedChildren={(childrenByParent.get(w.id) ?? []).map((child) => (
                <FrameCard
                  key={child.id}
                  frame={child}
                  isChild={true}
                  stepX={stepX}
                  stepY={stepY}
                  isDragging={draggingId === child.id}
                  isSelected={selectedFrameIds.has(child.id)}
                  isLinked={true}
                  editMode={editMode}
                  onDragStart={(e, id) => {
                    e.preventDefault();
                    const { px, py } = getPointer(e);
                    const widget = frames.find((ww) => ww.id === id);
                    if (!widget) return;
                    dragRef.current = { id, parentId: widget.parentId, mode: "drag", edges: {}, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
                    setDraggingId(id);
                  }}
                  onResizeStart={(e, id, edges) => {
                    e.preventDefault();
                    const { px, py } = getPointer(e);
                    const widget = frames.find((ww) => ww.id === id);
                    if (!widget) return;
                    dragRef.current = { id, parentId: widget.parentId, mode: "resize", edges, startMouseX: px, startMouseY: py, origX: widget.x, origY: widget.y, origW: widget.w, origH: widget.h };
                    setDraggingId(id);
                  }}
                  onContextMenu={(e, id) => {
                    e.preventDefault();
                    if (!selectedFrameIds.has(id)) {
                      setSelectedFrameIds(new Set([id]));
                      setSelectedFrameId(id);
                    }
                    setFrameRightClickMenu({ x: e.clientX, y: e.clientY, id });
                    setModuleTypeMenu(null);
                    setCanvasMenu(null);
                      }}
                  onModuleNameClick={(e, id) => {
                    setFrameRightClickMenu(null);
                    setHeaderMenu(null);
                    setCanvasMenu(null);
                        setSelectedFrameId(id);
                    setSelectedFrameIds(new Set([id]));
                    setModuleTypeMenu({ x: e.clientX, y: e.clientY, id });
                  }}
                  onSelect={(event, id) => {
                    const additiveSelect = "ctrlKey" in event ? (!!event.ctrlKey || !!event.shiftKey) : false;
                    if (!additiveSelect) {
                      setSelectedFrameId(id);
                      setSelectedFrameIds(new Set([id]));
                      return;
                    }
                    setSelectedFrameId(id);
                    setSelectedFrameIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      if (next.size === 0) next.add(id);
                      return next;
                    });
                  }}
                />
              ))}
            />
          </React.Fragment>
        ))}
      </FrameCanvas>

      {tabMenu && (
        <FrameRightClickMenu x={tabMenu.x} y={tabMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { startRenamingTab(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Rename View</button>
          <button style={{ ...menuBtnBase, color: tabs.length > 1 ? "#c62828" : "#999" }} disabled={tabs.length === 1} onClick={() => { deleteTab(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Delete View</button>
          <button style={menuBtnBase} onClick={() => { openDefaultNodeView(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Default Node View</button>
          <button style={menuBtnBase} onClick={() => { saveCurrentAsTemplate(tabMenu.id); closeMenus(); }} {...hoverHandlers}>Save Current as Template</button>
        </FrameRightClickMenu>
      )}

      {frameRightClickMenu && (
        <FrameRightClickMenu x={frameRightClickMenu.x} y={frameRightClickMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { duplicateFrame(frameRightClickMenu.id); closeMenus(); }} {...hoverHandlers}>Duplicate</button>
          {frameInContextMenu?.parentId && (
            <button
              style={menuBtnBase}
              onClick={() => {
                const parent = frames.find((frame) => frame.id === frameInContextMenu.parentId);
                updateActiveFrames((previous) => previous.map((frame) => {
                  if (frame.id !== frameInContextMenu.id || !parent) return frame;
                  return { ...frame, parentId: undefined, x: parent.x + frame.x, y: parent.y + frame.y };
                }));
                closeMenus();
              }}
              {...hoverHandlers}
            >
              Detach Child Frame
            </button>
          )}
          <button
            style={{ ...menuBtnBase, color: linkPlan ? "#111" : "#999" }}
            disabled={!linkPlan}
            onClick={() => { linkSelectedNodeModules(); closeMenus(); }}
            {...hoverHandlers}
          >
            Link modules: {linkModulesLabel}
          </button>
          <button
            style={{ ...menuBtnBase, color: canDelinkModules ? "#111" : "#999" }}
            disabled={!canDelinkModules}
            onClick={() => { delinkSelectedNodeModules(); closeMenus(); }}
            {...hoverHandlers}
          >
            Delink modules
          </button>
          {COLORWAY_ORDER.map((theme) => (
            <button key={theme} style={menuBtnBase} onClick={() => {
              updateActiveFrames((prev) => prev.map((w) => (w.id === frameRightClickMenu.id ? applyColorway(w, theme) : w)));
              closeMenus();
            }} {...hoverHandlers}>
              <span style={{ width: 10, height: 10, border: "1px solid #333", background: COLORWAYS[theme].color, display: "inline-block" }} /> {theme === "light" ? "LIGHT" : theme.toUpperCase()}
            </button>
          ))}
          <button style={{ ...menuBtnBase, color: "#c62828" }} onClick={() => { confirmDeleteFrameSelection([frameRightClickMenu.id]); closeMenus(); }} {...hoverHandlers}>Delete</button>
        </FrameRightClickMenu>
      )}

      {frameDeleteConfirmation && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
          <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(0,233,255,0.45)", background: "rgba(255,255,255,0.95)", padding: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>
              Are you sure you want to delete {frameDeleteConfirmation.frameIDs.length} frame{frameDeleteConfirmation.frameIDs.length === 1 ? "" : "s"}?
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.35, color: "#2e2e2e" }}>
              This removes the selected frame from the active view immediately. Use Undo (Ctrl/Cmd + Z) if this was accidental.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={() => { applyConfirmedFrameDelete(frameDeleteConfirmation.frameIDs); setFrameDeleteConfirmation(null); }} style={{ border: "1px solid rgba(0,233,255,0.45)", background: "#fff", cursor: "pointer", fontWeight: 700 }}>Yes</button>
              <button onClick={() => setFrameDeleteConfirmation(null)} style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: "#8b123f", background: "#fff", cursor: "pointer", fontWeight: 700 }}>No</button>
            </div>
          </div>
        </div>
      )}

      {moduleTypeMenu && (
        <ModulePickerMenu
          x={moduleTypeMenu.x}
          y={moduleTypeMenu.y}
          moduleTypeMenuId={moduleTypeMenu.id}
          moduleLibrary={FRAME_MODULE_LIBRARY}
          menuBtnBase={menuBtnBase}
          hoverHandlers={hoverHandlers}
          onClose={closeMenus}
          onChangeModuleKind={(id, kind, label) => {
            updateActiveFrames((prev) => prev.map((w) => (w.id === id ? { ...w, kind, title: label } : w)));
          }}
        />
      )}

      {canvasMenu && (
        <FrameRightClickMenu x={canvasMenu.x} y={canvasMenu.y} onClose={closeMenus}>
          <button style={menuBtnBase} onClick={() => { addFrame(DEFAULT_FRAME_KIND, { x: canvasMenu.gridX, y: canvasMenu.gridY }); setEditMode(true); closeMenus(); }} {...hoverHandlers}>
            Create new frame
          </button>
          <button style={menuBtnBase} onClick={() => { setEditMode((v) => !v); closeMenus(); }} {...hoverHandlers}>
            Toggle Edit Mode (Now: {editMode ? "ON" : "OFF"})
          </button>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Canvas Color
            <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} />
          </label>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Plus Color
            <input type="color" value={crossColor} onChange={(e) => setCrossColor(e.target.value)} />
          </label>
        </FrameRightClickMenu>
      )}

      {headerMenu && (
        <FrameRightClickMenu x={headerMenu.x} y={headerMenu.y} onClose={closeMenus}>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Header Bar
            <input type="color" value={headerBgColor} onChange={(e) => setHeaderBgColor(e.target.value)} />
          </label>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Header Text
            <input type="color" value={headerTextColor} onChange={(e) => setHeaderTextColor(e.target.value)} />
          </label>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Tab Box
            <input type="color" value={tabBgColor} onChange={(e) => setTabBgColor(e.target.value)} />
          </label>
          <label style={{ ...menuBtnBase, cursor: "default", justifyContent: "space-between" }}>
            Tab Text
            <input type="color" value={tabTextColor} onChange={(e) => setTabTextColor(e.target.value)} />
          </label>
        </FrameRightClickMenu>
      )}
    </div>
  );
};

export default App;
