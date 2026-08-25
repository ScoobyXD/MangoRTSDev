import type { ResourceAccessFields } from "../nodes/types.js";
import { trimOrEmpty } from "../nodes/types.js";

export type LogicGateRecord = ResourceAccessFields & {
  company_id: string;
  logic_gate_id: string;
  header: string;
  gvic_assignments?: LogicGateRACIAssignment[];
  created_timestamp: string;
};

export type LogicGateRACIRole = "responsible" | "accountable" | "consulted" | "informed";
export type LogicGateRACIPrincipalType = "user" | "group";

export type LogicGateRACIAssignment = {
  company_id: string;
  logic_gate_id?: string;
  resource_id?: string;
  role: LogicGateRACIRole;
  principal_type?: LogicGateRACIPrincipalType;
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
  information_count?: number;
};

export type LogicGateViewRecord = LogicGateRecord & {
  node_id: string;
  title: string;
};

export function toLogicGateViewRecord(record: LogicGateRecord): LogicGateViewRecord {
  return { ...record, node_id: record.logic_gate_id, title: record.header };
}

export function getLogicGateTitle(record: Pick<LogicGateViewRecord, "header" | "title">): string {
  return trimOrEmpty(record.header || record.title || "");
}
