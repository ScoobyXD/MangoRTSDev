import type React from "react";
import type { FrameDataModel } from "../types.js";
import {
  MANGO_ACCENT,
  MANGO_ACCENT_HEX,
  MANGO_GRADIENT,
  MANGO_SURFACE,
  MANGO_TEXT,
  TEAL_COLORWAY,
} from "../theme.js";

export const CELL_SIZE = 28;
export const HEADER_H = 48;
export const FRAME_HEADER_SECTION_HEIGHT = 38;
export const FRAME_SELECTION_COLOR = MANGO_ACCENT;
export const CROSS_ARM = 2;
export const MIN_W = 3;
export const MIN_H = 3;
export const HANDLE = 6;
export const CORNER_SIZE = 14;
export const CHILD_GRID_DIVISOR = 2;
export const CHILD_EDGE_GAP = 0.5;
export const HALF_STEP = 0.5;

export const COLORWAYS = {
  mango: { color: MANGO_GRADIENT, accent: MANGO_ACCENT_HEX, text: MANGO_TEXT, tagBg: MANGO_GRADIENT, tagText: "#ffffff" },
  teal: TEAL_COLORWAY,
  light: { color: MANGO_SURFACE, accent: MANGO_ACCENT_HEX, text: "#111111", tagBg: MANGO_GRADIENT, tagText: "#ffffff" },
  dark: { color: "#101214", accent: "#ffffff", text: "#ffffff", tagBg: "#ffffff", tagText: "#050505" },
} as const;

export type ColorwayKey = keyof typeof COLORWAYS;
export const DEFAULT_COLORWAY: ColorwayKey = "mango";
export const COLORWAY_ORDER: ColorwayKey[] = ["mango", "light", "teal", "dark"];

export const UI_THEME = {
  surface: MANGO_SURFACE,
  panel: MANGO_ACCENT_HEX,
  line: "rgba(100, 116, 139, 0.45)",
  text: MANGO_TEXT,
  subtext: "#64748b",
};

export interface ViewTab {
  id: string;
  name: string;
  page?: "logic-gate-arena" | "home" | "communications";
  frames: FrameDataModel[];
}

export interface DashboardSnapshot {
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
export function clamp(v: number, lo: number, hi: number) {
  if (lo > hi) return lo;
  return Math.max(lo, Math.min(hi, v));
}

export function snapToHalfStep(value: number) {
  return Math.round(value / HALF_STEP) * HALF_STEP;
}

export function clampToRangeWithInset(value: number, min: number, max: number, inset: number) {
  const lo = min + inset;
  const hi = max - inset;
  if (lo > hi) return clamp(value, min, max);
  return clamp(value, lo, hi);
}

export function framesOverlap(a: FrameDataModel, b: FrameDataModel) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function getPointer(e: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent) {
  if ("touches" in e && e.touches.length > 0) return { px: e.touches[0].clientX, py: e.touches[0].clientY };
  if ("clientX" in e) return { px: e.clientX, py: e.clientY };
  return { px: 0, py: 0 };
}

export function isFrameHeaderSectionPointer(e: React.MouseEvent | React.TouchEvent, element: HTMLElement) {
  const { py } = getPointer(e);
  const bounds = element.getBoundingClientRect();
  const headerBottom = bounds.top + Math.min(FRAME_HEADER_SECTION_HEIGHT, bounds.height);
  return py >= bounds.top && py <= headerBottom;
}

export const menuBtnBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "calc(100% - 10px)",
  margin: "2px 5px",
  padding: "9px 11px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0,
  fontFamily: "var(--mango-font-family)",
  background: "none",
  border: "1px solid transparent",
  borderRadius: 10,
  color: "#333",
  cursor: "pointer",
  textAlign: "left",
  transition: "background 150ms ease, border-color 150ms ease, box-shadow 170ms ease, transform 170ms ease",
  boxSizing: "border-box",
};

export const hoverHandlers = {
  onMouseEnter: (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.background = "radial-gradient(circle at 18% 18%, rgba(255,255,255,0.96), rgba(255,255,255,0.34) 38%, transparent 72%), linear-gradient(135deg, rgba(255,255,255,0.72), rgba(203, 245, 255, 0.34) 48%, rgba(224, 207, 255, 0.38))";
    target.style.borderColor = "rgba(255, 255, 255, 0.72)";
    target.style.boxShadow = "0 9px 24px rgba(15, 23, 42, 0.16), inset 1px 1px 0 rgba(255,255,255,0.86), inset -1px -1px 0 rgba(148,163,184,0.14)";
    target.style.backdropFilter = "blur(14px) saturate(1.28)";
    target.style.transform = "translateY(-1px)";
  },
  onMouseLeave: (e: React.MouseEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.style.background = "none";
    target.style.borderColor = "transparent";
    target.style.boxShadow = "none";
    target.style.backdropFilter = "none";
    target.style.transform = "translateY(0)";
  },
};

let frameCounter = 0;
let tabCounter = 0;

export const createFrameId = () => `frame-${Date.now()}-${++frameCounter}`;
export const createTabId = () => `view-${Date.now()}-${++tabCounter}`;
export const getFrameCreationCounter = () => frameCounter;
