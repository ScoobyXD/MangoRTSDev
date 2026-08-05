import type { Account } from "../accounts/accountsApi.js";

export type ResourceAccessLevel = "no_access" | "edit";

export type ResourceAccessFields = {
  effective_access_level?: ResourceAccessLevel | string | null;
  can_edit?: boolean;
};

export type NodeRecord = ResourceAccessFields & {
  company_id: string;
  node_id: string;
  name: string;
  status?: string | null;
  due_date?: string | null;
  priority?: number | null;
  logic_gate_ids?: string[];
  accounts?: Account[];
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

export type NodeDetails = ResourceAccessFields & {
  node: NodeRecord;
  information: NodeInformation[];
  relationships: NodeRelationship[];
  information_count?: number;
  relationships_count?: number;
};

export function trimOrEmpty(value: string): string {
  return value.trim();
}

export function getNodeTitle(node: { name?: string }): string {
  return trimOrEmpty(node.name || "");
}

export function accessLevelRank(accessLevel: string | null | undefined): number {
  switch ((accessLevel ?? "").trim()) {
    case "edit":
      return 1;
    case "no_access":
      return 0;
    default:
      return -1;
  }
}

export function canEditResourceAccess(resource: ResourceAccessFields | null | undefined): boolean {
  if (!resource) return true;
  if (typeof resource.can_edit === "boolean") return resource.can_edit;
  if (resource.effective_access_level !== undefined && resource.effective_access_level !== null) {
    return accessLevelRank(resource.effective_access_level) >= accessLevelRank("edit");
  }
  return true;
}
