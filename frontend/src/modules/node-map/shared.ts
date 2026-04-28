import React from "react";

// Reusable line-divider style for panel sections in node-map side UI.
export const divider = { borderBottom: "1px solid currentColor", padding: "5px 0" };

// Core node row payload returned by backend APIs and workspace snapshot cache.
export type NodeRecord = {
  company_id: string;
  node_id: string;
  header: string;
  created_timestamp: string;
};

// UI naming adapter: backend keeps `header`, but frontend product copy now prefers "Title".
// Keeping this helper centralized avoids repeated trim/fallback work across hot-path modules.
export function getNodeTitleFromRecord(node: Pick<NodeRecord, "header" | "node_id">): string {
  const normalizedHeader = trimOrEmpty(node.header);
  return normalizedHeader || node.node_id;
}

// Relationship row payload (a/b sides preserve directional parent/child semantics).
export type NodeRelationship = {
  company_id: string;
  node_relationship_id: string;
  node_id_a: string;
  node_id_b: string;
  a_position: "Parent" | "Child" | "Peer";
  b_position: "Parent" | "Child" | "Peer";
  created_timestamp: string;
};

// Node information row payload; editor module stores text-box document data here.
export type NodeInformation = {
  company_id: string;
  information_id: string;
  node_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

// Combined node details payload consumed by Node Map + Editor + Explorer details panes.
export type NodeDetails = {
  node: NodeRecord;
  information: NodeInformation[];
  relationships: NodeRelationship[];
};

export type NodeDirection = "left" | "right" | "top" | "bottom";
export type PanelEdge = "top" | "right" | "bottom" | "left";
export type NodePosition = { x: number; y: number };
export type RelationshipAnchor = { from: NodeDirection; to: NodeDirection };

// Persisted node-map viewport + selection state (used for cross-module linking).
export type NodeMapState = {
  zoom: number;
  pan: { x: number; y: number };
  selectedNodeID: string;
  nodePositions: Record<string, NodePosition>;
  relationshipColorsEnabled?: boolean;
  relationshipRoleColors?: { parent: string; peer: string; child: string };
};

// Canonical node information type options mapped to backend enum contract.
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

// Shared geometry constants for node cards and mini-grid snapping behavior.
export const NODE_W = 148;
export const NODE_H = 96;
export const MINI_GRID = 12;
export const SESSION_NODE_MAP_STATE = new Map<string, NodeMapState>();
export const PANEL_MIN_WIDTH = 300;
export const PANEL_MIN_HEIGHT = 220;

// Drag handles for the node details panel move/resize feature.
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

// Input sanitizer helpers used by forms and pointer math throughout node-map modules.
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

// Relationship anchor helper for opposite-side calculations.
export function oppositeSide(direction: NodeDirection): NodeDirection {
  if (direction === "left") return "right";
  if (direction === "right") return "left";
  if (direction === "top") return "bottom";
  return "top";
}

// Editor box model used in module-local render state.
export type NodeDocBox = { local_id: string; x: number; y: number; w: number; h: number; information_id?: string; information: string };
export const NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX = "node-map-explorer-context-v1";
export const NODE_DOC_MIN_W = 180;
export const NODE_DOC_MIN_H = 36;
