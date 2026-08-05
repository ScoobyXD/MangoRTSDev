import type { ResourceAccessFields } from "../nodes/types.js";
import { trimOrEmpty } from "../nodes/types.js";

export type LogicGateRecord = ResourceAccessFields & {
  company_id: string;
  logic_gate_id: string;
  header: string;
  gvic_assignments?: LogicGateGVICAssignment[];
  created_timestamp: string;
};

export type LogicGateGVICRole = "generated" | "verified" | "consulted" | "informed";
export type LogicGateGVICPrincipalType = "user" | "group";

export type LogicGateGVICAssignment = {
  company_id: string;
  logic_gate_id?: string;
  resource_id?: string;
  role: LogicGateGVICRole;
  principal_type?: LogicGateGVICPrincipalType;
  principal_id?: string;
  principal_name?: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
  source_resource_type?: string;
  source_resource_id?: string;
  inheritance_type?: string;
  inherited?: boolean;
  read_only?: boolean;
  created_timestamp: string;
  updated_timestamp?: string;
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

export type LogicGateInformation = {
  company_id: string;
  information_id: string;
  logic_gate_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type LogicGateDetails = ResourceAccessFields & {
  logic_gate: LogicGateRecord;
  information: LogicGateInformation[];
  relationships: LogicGateRelationship[];
  information_count?: number;
  relationships_count?: number;
};

export type LogicGateViewRecord = LogicGateRecord & {
  node_id: string;
  title: string;
};

export type LogicGateViewRelationship = LogicGateRelationship & {
  node_relationship_id: string;
  node_id_a: string;
  node_id_b: string;
};

export type LogicGateViewInformation = LogicGateInformation & {
  node_id: string;
};

export type LogicGateViewDetails = ResourceAccessFields & {
  logic_gate: LogicGateRecord;
  node: LogicGateViewRecord;
  information: LogicGateViewInformation[];
  relationships: LogicGateViewRelationship[];
  information_count?: number;
  relationships_count?: number;
};

export function toLogicGateViewRecord(record: LogicGateRecord): LogicGateViewRecord {
  return { ...record, node_id: record.logic_gate_id, title: record.header };
}

export function toLogicGateViewRelationship(record: LogicGateRelationship): LogicGateViewRelationship {
  return {
    ...record,
    node_relationship_id: record.logic_gate_relationship_id,
    node_id_a: record.logic_gate_id_a,
    node_id_b: record.logic_gate_id_b,
  };
}

export function toLogicGateViewInformation(record: LogicGateInformation): LogicGateViewInformation {
  return { ...record, node_id: record.logic_gate_id };
}

export function toLogicGateViewDetails(details: LogicGateDetails): LogicGateViewDetails {
  return {
    logic_gate: details.logic_gate,
    node: toLogicGateViewRecord(details.logic_gate),
    information: (details.information ?? []).map(toLogicGateViewInformation),
    relationships: (details.relationships ?? []).map(toLogicGateViewRelationship),
    information_count: details.information_count ?? details.information?.length ?? 0,
    relationships_count: details.relationships_count ?? details.relationships?.length ?? 0,
  };
}

export function getLogicGateTitle(record: Pick<LogicGateViewRecord, "header" | "title">): string {
  return trimOrEmpty(record.header || record.title || "");
}
