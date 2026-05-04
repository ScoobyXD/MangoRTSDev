import type React from "react";
import type { FrameDataModel } from "../types";

export const CELL_SIZE = 28;
export const HEADER_H = 48;
export const FRAME_HEADER_SECTION_HEIGHT = 38;
export const FRAME_SELECTION_COLOR = "rgb(0, 233, 255)";
export const CROSS_ARM = 2;
export const MIN_W = 3;
export const MIN_H = 3;
export const HANDLE = 6;
export const CORNER_SIZE = 14;
export const CHILD_GRID_DIVISOR = 2;
export const CHILD_EDGE_GAP = 0.5;
export const HALF_STEP = 0.5;

export const COLORWAYS = {
  teal: { color: "#00e9ff", accent: "#006f85", text: "#042028", tagBg: "#042028", tagText: "#ffffff" },
  light: { color: "#ffffff", accent: "#111111", text: "#111111", tagBg: "rgb(0, 233, 255)", tagText: "#041d22" },
  dark: { color: "#101214", accent: "#ffffff", text: "#ffffff", tagBg: "#ffffff", tagText: "#050505" },
} as const;

export type ColorwayKey = keyof typeof COLORWAYS;
export const COLORWAY_ORDER: ColorwayKey[] = ["teal", "light", "dark"];

export const UI_THEME = {
  surface: "#f7fffe",
  panel: "#00e9ff",
  line: "rgba(12, 67, 74, 0.45)",
  text: "#041d22",
  subtext: "#0b5058",
};

export interface ViewTab {
  id: string;
  name: string;
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
  width: "100%",
  padding: "9px 16px",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  fontFamily: "'IBM Plex Mono', monospace",
  background: "none",
  border: "none",
  color: "#333",
  cursor: "pointer",
  textAlign: "left",
};

export const hoverHandlers = {
  onMouseEnter: (e: React.MouseEvent) => {
    (e.currentTarget as HTMLElement).style.background = "#f5f5f5";
  },
  onMouseLeave: (e: React.MouseEvent) => {
    (e.currentTarget as HTMLElement).style.background = "none";
  },
};

let frameCounter = 0;
let tabCounter = 0;

export const createFrameId = () => `frame-${Date.now()}-${++frameCounter}`;
export const createTabId = () => `view-${Date.now()}-${++tabCounter}`;
export const getFrameCreationCounter = () => frameCounter;
