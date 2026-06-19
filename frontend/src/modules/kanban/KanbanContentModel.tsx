import React from "react";
import { readFrameLinksFromStorage, readFrameRegistryFromStorage, resolveConnectedFrameTargets } from "../linkingGraph";
import { NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX } from "../node-map/shared";
import { publishLiveSelection } from "../selectionCoordinator";
import type { KanbanCardDropPlacement } from "./shared";
export type HighlightedEntity = { nodeID: string } | null;

export type CompanyUser = {
  user_id: string;
  email?: string;
  display_name?: string;
};

export type WorkspaceStreamEnvelope = {
  company_id: string;
  type: string;
  data?: Record<string, unknown>;
};

export type ColumnResizeState = {
  axis: "width" | "height";
  columnID: string;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  currentWidth: number;
  currentHeight: number;
  minHeight?: number;
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
  forcedLogicGateLabel?: string;
  forcedHighlightedNodeID?: string;
  forcedOpenNodeID?: string;
  controlForcedOpenNode?: boolean;
  suppressLegacyWorkspaceStream?: boolean;
  onCollapseArenaToTab?: () => void;
  onNodeEditorOverlayOpen?: (nodeID: string) => void;
  onNodeEditorOverlayClose?: () => void;
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
};

export type NodeEditorOverlayRatio = {
  left: number;
  top: number;
  width: number;
  height: number;
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

export const DEFAULT_NODE_EDITOR_OVERLAY_RATIO: NodeEditorOverlayRatio = { left: 0.11, top: 0.06, width: 0.78, height: 0.82 };
const NODE_EDITOR_OVERLAY_SIDEBAR_BUFFER_PX = 14;

type NodeEditorOverlayClampOptions = {
  allowHorizontalOverflow?: boolean;
  minLeft?: number;
};

export function nodeEditorOverlayRatioStorageKey(companyID: string, frameID: string): string {
  return `kanban-node-editor-overlay-ratio-v1:${companyID}:${frameID}`;
}

function finiteRatio(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampNodeEditorOverlayRatio(value: Partial<NodeEditorOverlayRatio>, options?: NodeEditorOverlayClampOptions): NodeEditorOverlayRatio {
  const allowHorizontalOverflow = options?.allowHorizontalOverflow === true;
  const optionMinLeft = finiteRatio(options?.minLeft, Number.NEGATIVE_INFINITY);
  const baseMinLeft = allowHorizontalOverflow ? Number.NEGATIVE_INFINITY : 0.02;
  const minLeft = Math.max(optionMinLeft, baseMinLeft);
  const maxWidth = allowHorizontalOverflow ? 2.4 : Math.max(0.42, Math.min(0.96, 0.98 - minLeft));
  const width = Math.max(0.42, Math.min(finiteRatio(value.width, DEFAULT_NODE_EDITOR_OVERLAY_RATIO.width), maxWidth));
  const height = Math.max(0.42, Math.min(finiteRatio(value.height, DEFAULT_NODE_EDITOR_OVERLAY_RATIO.height), 0.94));
  const defaultLeft = (1 - width) / 2;
  const effectiveMinLeft = allowHorizontalOverflow ? Math.max(optionMinLeft, Math.min(0.02, 0.24 - width)) : minLeft;
  const maxLeft = Math.max(effectiveMinLeft, 0.98 - width);
  const minTop = 0.02;
  const maxTop = Math.max(minTop, 0.98 - height);
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

export const contextMenuButtonStyle: React.CSSProperties = {
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

export const contextMenuDividerStyle: React.CSSProperties = {
  height: 1,
  margin: "4px 8px",
  background: "rgba(148, 163, 184, 0.28)",
};

export const contextMenuHoverHandlers = {
  onMouseEnter: (event: React.MouseEvent) => {
    const target = event.currentTarget as HTMLElement;
    target.style.background = "linear-gradient(135deg, rgba(255,255,255,0.88), rgba(230,252,255,0.58) 46%, rgba(247,239,255,0.66)) padding-box, linear-gradient(135deg, rgba(92,238,255,0.92), rgba(128,216,255,0.82) 34%, rgba(183,124,255,0.88) 72%, rgba(255,255,255,0.86)) border-box";
    target.style.borderColor = "transparent";
    target.style.boxShadow = "0 9px 24px rgba(15, 23, 42, 0.14), 0 0 16px rgba(183, 124, 255, 0.22), inset 1px 1px 0 rgba(255,255,255,0.86)";
    target.style.backdropFilter = "blur(14px) saturate(1.28)";
    target.style.transform = "translateY(-1px)";
  },
  onMouseLeave: (event: React.MouseEvent) => {
    const target = event.currentTarget as HTMLElement;
    target.style.background = "none";
    target.style.borderColor = "transparent";
    target.style.boxShadow = "none";
    target.style.backdropFilter = "none";
    target.style.transform = "translateY(0)";
  },
};

export const KANBAN_PANEL_BACKGROUND = "linear-gradient(180deg, #fbfbfd 0%, #eef4f8 54%, #f5f0fb 100%)";
export const KANBAN_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f6f7fb 100%)";
export const KANBAN_ACTIVE_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f5f6fa 100%)";
export const KANBAN_EDGE_FRAME = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
export const KANBAN_SOFT_BORDER = "rgba(255, 255, 255, 0.76)";
export const KANBAN_SHADOW = "7px 7px 16px rgba(174, 174, 192, 0.26), -7px -7px 16px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.86)";
export const KANBAN_PANEL_SHADOW = "inset 0 0 0 1px rgba(255, 255, 255, 0.72), inset 5px 5px 16px rgba(174, 174, 192, 0.16), inset -5px -5px 16px rgba(255, 255, 255, 0.86), 0 12px 28px rgba(15, 23, 42, 0.14)";

export const ARENA_GROUP_COLUMN_WIDTH_PX = 300;
export const ARENA_GROUP_ROW_LABEL_WIDTH_PX = 104;
export const ARENA_GROUP_MIN_CELL_HEIGHT_PX = 86;
export const ARENA_GROUP_FRAME_BACKGROUND = KANBAN_SURFACE;
export const ARENA_GROUP_GLASS_BORDER_LIGHT = "rgba(255, 255, 255, 0.76)";
export const ARENA_GROUP_GLASS_BORDER_DARK = "rgba(255,255,255,0.18)";
export const ARENA_GROUP_FRAME_SHADOW = "4px 4px 12px rgba(174, 174, 192, 0.18), -4px -4px 12px rgba(255, 255, 255, 0.78), inset 1px 1px 0 rgba(255,255,255,0.82)";

export const KanbanDisclosureIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ display: "block" }}>
    <path d="M3.25 4.55 6 7.3l2.75-2.75" fill="none" stroke={color} strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const KanbanCheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" style={{ display: "block" }}>
    <path d="m3.1 6.55 2.05 2.05 4.75-4.75" fill="none" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function readLinkedExplorerSelection(companyID: string, scope: string): HighlightedEntity {
  try {
    const nodeRaw = localStorage.getItem(`${NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX}:${companyID}:${scope}`);
    if (nodeRaw) {
      const parsed = JSON.parse(nodeRaw) as { selectedNodeID?: unknown };
      if (typeof parsed.selectedNodeID === "string" && parsed.selectedNodeID.trim()) {
        return { nodeID: parsed.selectedNodeID.trim() };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function publishKanbanSelectionToLinkedFrames(companyID: string, sourceFrameID: string, nodeID: string, nodeTitle: string, selectedNodeIDs: string[] = [nodeID]): void {
  if (!nodeID) return;
  try {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    const targetFrameIDs = resolveConnectedFrameTargets({ sourceFrameID, edges, registry });
    publishLiveSelection({
      companyID,
      entityKind: "node",
      entityID: nodeID,
      label: nodeTitle,
      sourceFrameID,
      sourceModule: "kanban",
      targetFrameIDs,
      selectedTreeID: `node-${nodeID}`,
      selectedTreeIDs: selectedNodeIDs.map((id) => `node-${id}`),
      selectedEntityIDs: selectedNodeIDs,
    });
  } catch {
    // Selection handoff is a UI convenience; card selection must still work if the link graph is unavailable.
  }
}

export function publishKanbanBoardSelectionToLinkedFrames(companyID: string, sourceFrameID: string, boardID: string, boardTitle: string): void {
  if (!boardID) return;
  try {
    const edges = readFrameLinksFromStorage();
    const registry = readFrameRegistryFromStorage();
    const targetFrameIDs = resolveConnectedFrameTargets({ sourceFrameID, edges, registry });
    publishLiveSelection({
      companyID,
      entityKind: "kanban",
      entityID: boardID,
      label: boardTitle,
      sourceFrameID,
      sourceModule: "kanban",
      targetFrameIDs,
      selectedTreeID: `kanban-${boardID}`,
      selectedTreeIDs: [`kanban-${boardID}`],
      selectedEntityIDs: [boardID],
    });
  } catch {
    // Board selection should not depend on link graph storage.
  }
}

export function dataTransferIncludes(event: React.DragEvent, mime: string): boolean {
  return Array.from(event.dataTransfer.types).includes(mime);
}

export function cardDropPlacement(event: React.DragEvent<HTMLElement>): KanbanCardDropPlacement {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
}

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select";
}

export function formatKanbanLoadError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  return fallback;
}
