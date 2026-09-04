import React from "react";

export type CompanyUser = {
  user_id: string;
  email?: string;
  display_name?: string;
};

export type NodeEditorOverlayState = {
  nodeID: string;
  nodeTitle: string;
};

export type KanbanContentProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
  arenaMode?: boolean;
  forcedLogicGateID?: string;
  forcedHighlightedNodeID?: string;
  forcedOpenNodeID?: string;
  controlForcedOpenNode?: boolean;
  onNodeEditorOverlayOpen?: (nodeID: string) => void;
  onNodeEditorOverlayClose?: () => void;
  arenaBoardLeftResizeRequest?: ArenaBoardLeftResizeRequest | null;
  onNodeEditorOverlayLeftResizeStart?: () => boolean;
  onNodeEditorOverlayLeftResize?: (deltaX: number) => ArenaBoardLeftResizeResult | null;
  onNodeEditorOverlayLeftResizeEnd?: () => void;
};

export type OverlayResizeState = {
  edges: Partial<Record<"left" | "right" | "top" | "bottom", true>>;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
  boardWidth: number;
  boardHeight: number;
  minLeft: number;
  linkedLeftResize?: boolean;
};

export type NodeEditorOverlayRatio = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ArenaBoardLeftResizeRequest = {
  sessionID: number;
  appliedDeltaX: number;
  startKanbanWidthPx: number;
  kanbanWidthPx: number;
};

export type ArenaBoardLeftResizeResult = {
  appliedDeltaX: number;
  startKanbanWidthPx: number;
  kanbanWidthPx: number;
};

export const nodeEditorOverlayResizeHandles: Array<{
  key: string;
  edges: OverlayResizeState["edges"];
  cursor: string;
  style: React.CSSProperties;
}> = [
  { key: "top-left", edges: { top: true, left: true }, cursor: "nwse-resize", style: { top: -5, left: -5, width: 10, height: 10 } },
  { key: "top-right", edges: { top: true, right: true }, cursor: "nesw-resize", style: { top: -5, right: -5, width: 10, height: 10 } },
  { key: "bottom-left", edges: { bottom: true, left: true }, cursor: "nesw-resize", style: { bottom: -5, left: -5, width: 10, height: 10 } },
  { key: "bottom-right", edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -5, right: -5, width: 10, height: 10 } },
  { key: "top", edges: { top: true }, cursor: "ns-resize", style: { top: -4, left: 18, right: 18, height: 8 } },
  { key: "bottom", edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -4, left: 18, right: 18, height: 8 } },
  { key: "left", edges: { left: true }, cursor: "ew-resize", style: { left: -4, top: 18, bottom: 18, width: 8 } },
  { key: "right", edges: { right: true }, cursor: "ew-resize", style: { right: -4, top: 18, bottom: 18, width: 8 } },
];

export const DEFAULT_NODE_EDITOR_OVERLAY_RATIO: NodeEditorOverlayRatio = { left: 0.01, top: 0.01, width: 0.98, height: 0.98 };

export const KANBAN_NODE_EDITOR_OVERLAY_EDGE_GUTTER_PX = 8;

const NODE_EDITOR_OVERLAY_SIDEBAR_BUFFER_PX = 14;

type NodeEditorOverlayClampOptions = {
  allowHorizontalOverflow?: boolean;
  minLeft?: number;
};

export function nodeEditorOverlayRatioStorageKey(companyID: string, frameID: string): string {
  return `kanban-node-editor-overlay-ratio-v3:${companyID}:${frameID}`;
}

function finiteRatio(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampNodeEditorOverlayRatio(value: Partial<NodeEditorOverlayRatio>, options?: NodeEditorOverlayClampOptions): NodeEditorOverlayRatio {
  const allowHorizontalOverflow = options?.allowHorizontalOverflow === true;
  const optionMinLeft = finiteRatio(options?.minLeft, Number.NEGATIVE_INFINITY);
  const baseMinLeft = allowHorizontalOverflow ? Number.NEGATIVE_INFINITY : 0.01;
  const minLeft = Math.max(optionMinLeft, baseMinLeft);
  const maxWidth = allowHorizontalOverflow ? 2.4 : Math.max(0.42, Math.min(0.98, 0.99 - minLeft));
  const width = Math.max(0.42, Math.min(finiteRatio(value.width, DEFAULT_NODE_EDITOR_OVERLAY_RATIO.width), maxWidth));
  const height = Math.max(0.42, Math.min(finiteRatio(value.height, DEFAULT_NODE_EDITOR_OVERLAY_RATIO.height), 0.98));
  const defaultLeft = typeof value.width === "number" && Number.isFinite(value.width) ? (1 - width) / 2 : DEFAULT_NODE_EDITOR_OVERLAY_RATIO.left;
  const effectiveMinLeft = allowHorizontalOverflow ? Math.max(optionMinLeft, Math.min(0.01, 0.24 - width)) : minLeft;
  const maxLeft = Math.max(effectiveMinLeft, 0.99 - width);
  const minTop = 0.01;
  const maxTop = Math.max(minTop, 0.99 - height);
  return {
    left: Math.max(effectiveMinLeft, Math.min(finiteRatio(value.left, defaultLeft), maxLeft)),
    top: Math.max(minTop, Math.min(finiteRatio(value.top, DEFAULT_NODE_EDITOR_OVERLAY_RATIO.top), maxTop)),
    width,
    height,
  };
}

function appSidebarBoundaryPx(): number | null {
  if (typeof document === "undefined") return null;
  const selectors = [
    "[data-app-sidebar=\"primary\"]",
    "[data-app-sidebar-resize-handle=\"primary\"]",
  ];
  let boundary: number | null = null;
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    boundary = Math.max(boundary ?? 0, rect.right);
  }
  return boundary;
}

export function getNodeEditorOverlayMinLeftPx(boardRoot: HTMLElement | null, allowHorizontalOverflow: boolean): number {
  const boardBounds = boardRoot?.getBoundingClientRect();
  if (!boardBounds) return 0;
  const arenaBounds = allowHorizontalOverflow
    ? boardRoot?.parentElement?.parentElement?.getBoundingClientRect()
    : null;
  const arenaMinLeft = arenaBounds ? arenaBounds.left - boardBounds.left : 0;
  const sidebarBoundary = appSidebarBoundaryPx();
  const sidebarMinLeft = sidebarBoundary == null
    ? Number.NEGATIVE_INFINITY
    : Math.ceil(sidebarBoundary) + NODE_EDITOR_OVERLAY_SIDEBAR_BUFFER_PX - boardBounds.left;
  return Math.max(arenaMinLeft, sidebarMinLeft);
}

export function readNodeEditorOverlayRatio(companyID: string, frameID: string, options?: NodeEditorOverlayClampOptions): NodeEditorOverlayRatio {
  if (typeof localStorage === "undefined") return DEFAULT_NODE_EDITOR_OVERLAY_RATIO;
  try {
    const parsed = JSON.parse(localStorage.getItem(nodeEditorOverlayRatioStorageKey(companyID, frameID)) ?? "") as Partial<NodeEditorOverlayRatio>;
    return clampNodeEditorOverlayRatio({
      left: parsed.left,
      top: parsed.top,
      width: parsed.width,
      height: parsed.height,
    }, options);
  } catch {
    return DEFAULT_NODE_EDITOR_OVERLAY_RATIO;
  }
}

export function storeNodeEditorOverlayRatio(companyID: string, frameID: string, ratio: NodeEditorOverlayRatio, options?: NodeEditorOverlayClampOptions) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(nodeEditorOverlayRatioStorageKey(companyID, frameID), JSON.stringify(clampNodeEditorOverlayRatio(ratio, options)));
}

export const KANBAN_PANEL_BACKGROUND = "linear-gradient(180deg, #fbfbfd 0%, #eef4f8 54%, #f5f0fb 100%)";

export const KANBAN_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f6f7fb 100%)";

export const KANBAN_EDGE_FRAME = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";

export const KANBAN_SOFT_BORDER = "rgba(255, 255, 255, 0.76)";

export const KANBAN_SHADOW = "7px 7px 16px rgba(174, 174, 192, 0.26), -7px -7px 16px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.86)";

export const KANBAN_PANEL_SHADOW = "inset 0 0 0 1px rgba(255, 255, 255, 0.72), inset 5px 5px 16px rgba(174, 174, 192, 0.16), inset -5px -5px 16px rgba(255, 255, 255, 0.86), 0 12px 28px rgba(15, 23, 42, 0.14)";
