import React from "react";

export const divider = { borderBottom: "1px solid currentColor", padding: "5px 0" };

export type NodeRecord = {
  company_id: string;
  node_id: string;
  header: string;
  created_timestamp: string;
};

export type NodeRelationship = {
  company_id: string;
  node_relationship_id: string;
  node_id_a: string;
  node_id_b: string;
  a_position: "Parent" | "Child" | "Peer";
  b_position: "Parent" | "Child" | "Peer";
  created_timestamp: string;
};

export type NodeInformation = {
  company_id: string;
  information_id: string;
  node_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type NodeDetails = {
  node: NodeRecord;
  information: NodeInformation[];
  relationships: NodeRelationship[];
};

export type NodeDirection = "left" | "right" | "top" | "bottom";
export type PanelEdge = "top" | "right" | "bottom" | "left";
export type NodePosition = { x: number; y: number };
export type RelationshipAnchor = { from: NodeDirection; to: NodeDirection };
export type NodeCanvasState = { zoom: number; pan: { x: number; y: number }; selectedNodeID: string; nodePositions: Record<string, NodePosition> };

export const INFO_TYPES = [
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

export const NODE_W = 148;
export const NODE_H = 96;
export const MINI_GRID = 12;
export const SESSION_NODE_CANVAS_STATE = new Map<string, NodeCanvasState>();
export const PANEL_MIN_WIDTH = 300;
export const PANEL_MIN_HEIGHT = 220;

export const panelResizeHandles: { key: string; edges: Partial<Record<PanelEdge, true>>; cursor: string; style: React.CSSProperties }[] = [
  { key: "top-left", edges: { top: true, left: true }, cursor: "nwse-resize", style: { top: -6, left: -6, width: 12, height: 12 } },
  { key: "top-right", edges: { top: true, right: true }, cursor: "nesw-resize", style: { top: -6, right: -6, width: 12, height: 12 } },
  { key: "bottom-left", edges: { bottom: true, left: true }, cursor: "nesw-resize", style: { bottom: -6, left: -6, width: 12, height: 12 } },
  { key: "bottom-right", edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -6, right: -6, width: 12, height: 12 } },
  { key: "top", edges: { top: true }, cursor: "ns-resize", style: { top: -4, left: 14, right: 14, height: 8 } },
  { key: "bottom", edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -4, left: 14, right: 14, height: 8 } },
  { key: "left", edges: { left: true }, cursor: "ew-resize", style: { left: -4, top: 14, bottom: 14, width: 8 } },
  { key: "right", edges: { right: true }, cursor: "ew-resize", style: { right: -4, top: 14, bottom: 14, width: 8 } },
];

export function trimOrEmpty(value: string): string {
  return value.trim();
}

export function clamp(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

export function snapToGrid(value: number): number {
  return Math.round(value / MINI_GRID) * MINI_GRID;
}

export function oppositeSide(direction: NodeDirection): NodeDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

export function relationFromDirection(direction: NodeDirection): { a: "Parent" | "Child" | "Peer"; b: "Parent" | "Child" | "Peer" } {
  if (direction === "left" || direction === "right") return { a: "Peer", b: "Peer" };
  if (direction === "top") return { a: "Child", b: "Parent" };
  return { a: "Parent", b: "Child" };
}

export type NodeDocBox = { local_id: string; x: number; y: number; w: number; h: number; information_id?: string; information: string };
export const NODE_DOC_LINKS_KEY = "node-doc-widget-links-v1";
export const EDITOR_LINKS_KEY = NODE_DOC_LINKS_KEY;
export const EXPLORER_CANVAS_LINKS_KEY = "company-explorer-widget-links-v1";
export const NODE_CANVAS_EXPLORER_CONTEXT_KEY_PREFIX = "node-canvas-explorer-context-v1";
export const NODE_DOC_MIN_W = 180;
export const NODE_DOC_MIN_H = 36;

export function parseDocBox(info: NodeInformation): NodeDocBox | null {
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
