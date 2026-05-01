import type { NodeDirection, NodePosition, RelationshipAnchor } from "../node-map/shared.js";
import {
  INFO_TYPES,
  MINI_GRID,
  NODE_DOC_MIN_H,
  NODE_DOC_MIN_W,
  NODE_H,
  NODE_W,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  clamp,
  divider,
  oppositeSide,
  panelResizeHandles,
  shouldIgnoreCanvasKeydownTarget,
  snapToGrid,
  trimOrEmpty,
} from "../node-map/shared.js";

export {
  INFO_TYPES,
  MINI_GRID,
  NODE_DOC_MIN_H,
  NODE_DOC_MIN_W,
  NODE_H,
  NODE_W,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  clamp,
  divider,
  oppositeSide,
  panelResizeHandles,
  shouldIgnoreCanvasKeydownTarget,
  snapToGrid,
  trimOrEmpty,
};

export type { NodeDirection, NodePosition, RelationshipAnchor };

export const LOGIC_GATE_MAP_STATE_KEY_PREFIX = "logic-gate-map-state-v1";
export const LOGIC_GATE_MAP_EXPLORER_CONTEXT_KEY_PREFIX = "logic-gate-map-explorer-context-v1";

// Logic Gate Map intentionally reuses the node-map canvas controls. The `node_*`
// fields below are render-model aliases only; API calls still use logic_gate_* fields.
export type NodeRecord = {
  company_id: string;
  logic_gate_id: string;
  header: string;
  created_timestamp: string;
  node_id: string;
  title: string;
};

export type LogicGateRecord = {
  company_id: string;
  logic_gate_id: string;
  header: string;
  created_timestamp: string;
};

export type NodeRelationship = {
  company_id: string;
  logic_gate_relationship_id: string;
  logic_gate_id_a: string;
  logic_gate_id_b: string;
  node_relationship_id: string;
  node_id_a: string;
  node_id_b: string;
  a_position: "Input" | "Output";
  b_position: "Input" | "Output";
  created_timestamp: string;
};

export type LogicGateRelationship = {
  company_id: string;
  logic_gate_relationship_id: string;
  logic_gate_id_a: string;
  logic_gate_id_b: string;
  a_position: "Input" | "Output";
  b_position: "Input" | "Output";
  created_timestamp: string;
};

export type NodeInformation = {
  company_id: string;
  information_id: string;
  logic_gate_id: string;
  node_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type LogicGateInformation = {
  company_id: string;
  information_id: string;
  logic_gate_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type NodeDetails = {
  logic_gate: LogicGateRecord;
  node: NodeRecord;
  information: NodeInformation[];
  relationships: NodeRelationship[];
};

export type LogicGateDetails = {
  logic_gate: LogicGateRecord;
  information: LogicGateInformation[];
  relationships: LogicGateRelationship[];
};

export type NodeMapState = {
  zoom: number;
  pan: { x: number; y: number };
  selectedNodeID: string;
  nodePositions: Record<string, NodePosition>;
  relationshipColorsEnabled?: boolean;
  relationshipRoleColors?: { input: string; output: string };
};

export const SESSION_LOGIC_GATE_MAP_STATE = new Map<string, NodeMapState>();
export const SESSION_NODE_MAP_STATE = SESSION_LOGIC_GATE_MAP_STATE;

export function toLogicGateCanvasRecord(record: LogicGateRecord): NodeRecord {
  return {
    ...record,
    node_id: record.logic_gate_id,
    title: record.header,
  };
}

export function toLogicGateCanvasRelationship(record: LogicGateRelationship): NodeRelationship {
  return {
    ...record,
    node_relationship_id: record.logic_gate_relationship_id,
    node_id_a: record.logic_gate_id_a,
    node_id_b: record.logic_gate_id_b,
  };
}

export function toLogicGateCanvasInformation(record: LogicGateInformation): NodeInformation {
  return {
    ...record,
    node_id: record.logic_gate_id,
  };
}

export function toLogicGateDetails(details: LogicGateDetails): NodeDetails {
  return {
    logic_gate: details.logic_gate,
    node: toLogicGateCanvasRecord(details.logic_gate),
    information: (details.information ?? []).map(toLogicGateCanvasInformation),
    relationships: (details.relationships ?? []).map(toLogicGateCanvasRelationship),
  };
}

export function getNodeTitle(node: Pick<NodeRecord, "header" | "title">): string {
  return trimOrEmpty(node.header || node.title || "");
}
