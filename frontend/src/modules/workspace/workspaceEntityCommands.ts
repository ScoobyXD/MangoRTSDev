export type WorkspaceEntityCommandRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type WorkspaceEntityBatchKind = "node" | "logic_gate";
export type WorkspaceEntityBatchCreatorLogicGateGVICRole = "responsible" | "consulted" | "verifier" | "informed";
export type WorkspaceEntityBatchMutationOrigin = "company_explorer" | "matrix" | "kanban" | "editor";

export type WorkspaceEntityBatchItem = {
  client_id: string;
  name?: string;
  title?: string;
  position?: number;
};

export type WorkspaceEntityBatchRelationship = {
  entity_id_a?: string;
  entity_id_b?: string;
  client_id_a?: string;
  client_id_b?: string;
  a_position: string;
  b_position: string;
};

export function createWorkspaceEntityBatchClientID(prefix: string, index = 0): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${index}-${random}`;
}

export async function createWorkspaceEntityBatchCommand<TResponse>(args: {
  companyID: string;
  entityKind: WorkspaceEntityBatchKind;
  folderID?: string;
  mutationOrigin?: WorkspaceEntityBatchMutationOrigin;
  creatorLogicGateGVICRole?: WorkspaceEntityBatchCreatorLogicGateGVICRole;
  items: WorkspaceEntityBatchItem[];
  relationships?: WorkspaceEntityBatchRelationship[];
  requestJSON: WorkspaceEntityCommandRequest;
}): Promise<TResponse> {
  const body: {
    company_id: string;
    entity_kind: WorkspaceEntityBatchKind;
    folder_id: string;
    mutation_origin?: WorkspaceEntityBatchMutationOrigin;
    creator_logic_gate_gvic_role?: WorkspaceEntityBatchCreatorLogicGateGVICRole;
    items: WorkspaceEntityBatchItem[];
    relationships: WorkspaceEntityBatchRelationship[];
  } = {
    company_id: args.companyID,
    entity_kind: args.entityKind,
    folder_id: args.folderID ?? "",
    items: args.items,
    relationships: args.relationships ?? [],
  };
  if (args.entityKind === "logic_gate" && args.creatorLogicGateGVICRole) body.creator_logic_gate_gvic_role = args.creatorLogicGateGVICRole;
  if (args.mutationOrigin) body.mutation_origin = args.mutationOrigin;
  return args.requestJSON<TResponse>("/v1/workspace/entity-batches", { method: "POST", body: JSON.stringify(body) });
}
