import { apiFetchJSON, getAuthSessionCacheGeneration } from "../../auth/cognitoAuth.js";
import type { Account } from "../accounts/accountsApi.js";

export type ProjectManagementEntityType = "node" | "logic_gate";
export type ProjectHealth = "On Track" | "AT RISK" | "Off Track";

export type ProjectManagementTimelineRow = {
  company_id: string;
  item_id: string;
  user_id: string;
  resource_type: ProjectManagementEntityType;
  resource_id: string;
  logic_gate_id?: string | null;
  node_id?: string;
  display_title: string;
  status?: string | null;
  due_date?: string | null;
  priority?: number | null;
  accounts?: Account[];
  start_date: string;
  end_date: string;
  duration_days: number;
  position?: number;
  resource_created_timestamp?: string;
  created_timestamp?: string;
  updated_timestamp?: string;
  projection_updated_timestamp?: string;
};

export type ProjectManagementTimelineResponse = {
  company_id: string;
  user_id: string;
  rows: ProjectManagementTimelineRow[];
};

export type ProjectManagementTimelineMutationResponse = {
  item?: ProjectManagementTimelineRow;
  deleted_item_id?: string;
  user_id?: string;
};

export type ProjectRecord = {
  company_id: string;
  project_id: string;
  name: string;
  status: string;
  health?: ProjectHealth | string;
  default_access?: string;
  accounts?: Account[];
  teams?: ProjectTeam[];
  effective_access_level?: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProjectTeam = {
  company_id: string;
  group_id: string;
  parent_group_id?: string | null;
  name: string;
  position?: number;
  created_timestamp: string;
  updated_timestamp?: string;
};

export type ProjectInformation = {
  company_id: string;
  project_id: string;
  information_id: string;
  type: string;
  information: string;
  author_user_id?: string;
  created_timestamp: string;
};

export type ProjectProjection = {
  company_id: string;
  project_id: string;
  information_id: string;
  type: string;
  information: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProjectRelationshipProjection = {
  company_id: string;
  project_id: string;
  project_name?: string;
  relationship_id: string;
  resource_type: "logic_gate" | "node";
  resource_id: string;
  logic_gate_id?: string | null;
  node_id?: string | null;
  display_title: string;
  status?: string | null;
  created_from_email?: boolean;
  position: number;
  resource_created_timestamp: string;
  relationship_created_timestamp: string;
  relationship_updated_timestamp: string;
  projection_updated_timestamp: string;
};

export type ProjectCriticalPathStep = {
  company_id: string;
  project_id: string;
  step_id: string;
  name: string;
  relationship_id?: string | null;
  resource_type?: "logic_gate" | "node" | "";
  resource_id?: string;
  logic_gate_id?: string | null;
  node_id?: string | null;
  display_title?: string;
  status?: string | null;
  due_date?: string | null;
  owner_type?: "user" | "group" | "";
  owner_id?: string | null;
  owner_label?: string;
  position: number;
  is_current: boolean;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProjectView = {
  company_id: string;
  project_id: string;
  project: ProjectRecord;
  information: ProjectInformation[];
  projections: ProjectProjection[];
  relationships: ProjectRelationshipProjection[];
  critical_path?: ProjectCriticalPathStep[];
  information_count?: number;
  projection_count?: number;
  critical_path_count?: number;
  can_edit?: boolean;
};

export type ProjectMutationResponse = {
  project?: ProjectRecord;
  folder_item?: {
    folder_id: string;
    item_type: string;
    item_id: string;
  };
  deleted_id?: string;
};

export type ProjectRelationshipMutationResponse = {
  relationship?: ProjectRelationshipProjection;
  deleted_id?: string;
};

type ProjectRelationshipReadCacheEntry = {
  authGeneration: number;
  expiresAt: number;
  value?: ProjectRelationshipProjection[];
  inflight?: Promise<ProjectRelationshipProjection[]>;
};

const PROJECT_RELATIONSHIP_CACHE_TTL_MS = 30_000;
const projectRelationshipReadCache = new Map<string, ProjectRelationshipReadCacheEntry>();
const projectRelationshipReadGeneration = new Map<string, number>();

function readProjectRelationshipGeneration(cacheKey: string): number {
  return projectRelationshipReadGeneration.get(cacheKey) ?? 0;
}

function projectRelationshipReadKey(input: { companyID: string; resourceType: "logic_gate" | "node"; resourceID: string }): string {
  return `${input.companyID.trim()}\u0000${input.resourceType}\u0000${input.resourceID.trim()}`;
}

function cloneProjectRelationships(value: readonly ProjectRelationshipProjection[]): ProjectRelationshipProjection[] {
  return value.map((relationship) => ({ ...relationship }));
}

export function invalidateProjectRelationshipsForResource(input?: {
  companyID?: string;
  resourceType?: "logic_gate" | "node";
  resourceID?: string;
}): void {
  const companyID = input?.companyID?.trim() ?? "";
  const resourceType = input?.resourceType;
  const resourceID = input?.resourceID?.trim() ?? "";
  const keys = new Set([...projectRelationshipReadCache.keys(), ...projectRelationshipReadGeneration.keys()]);
  for (const key of keys) {
    const [cachedCompanyID, cachedResourceType, cachedResourceID] = key.split("\u0000");
    if (companyID && cachedCompanyID !== companyID) continue;
    if (resourceType && cachedResourceType !== resourceType) continue;
    if (resourceID && cachedResourceID !== resourceID) continue;
    projectRelationshipReadGeneration.set(key, readProjectRelationshipGeneration(key) + 1);
    projectRelationshipReadCache.delete(key);
  }
}

export async function fetchProjectManagementTimeline(companyID: string, userID: string, limit = 1000): Promise<ProjectManagementTimelineResponse> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  params.set("target_user_id", userID);
  params.set("limit", String(limit));
  return apiFetchJSON<ProjectManagementTimelineResponse>(`/v1/project-management/timeline?${params.toString()}`);
}

export async function createProjectManagementTimelineItem(input: {
  companyID: string;
  userID: string;
  entityType: ProjectManagementEntityType;
  entityID: string;
  startDate: string;
  durationDays: number;
  position: number;
}): Promise<ProjectManagementTimelineMutationResponse> {
  return apiFetchJSON<ProjectManagementTimelineMutationResponse>("/v1/project-management/timeline-items", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      target_user_id: input.userID,
      entity_type: input.entityType,
      entity_id: input.entityID,
      start_date: input.startDate,
      duration_days: input.durationDays,
      position: input.position,
    }),
  });
}

export async function updateProjectManagementTimelineItem(input: {
  companyID: string;
  itemID: string;
  startDate: string;
  durationDays: number;
  position: number;
}): Promise<ProjectManagementTimelineMutationResponse> {
  return apiFetchJSON<ProjectManagementTimelineMutationResponse>(`/v1/project-management/timeline-items/${encodeURIComponent(input.itemID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      start_date: input.startDate,
      duration_days: input.durationDays,
      position: input.position,
    }),
  });
}

export async function deleteProjectManagementTimelineItem(companyID: string, itemID: string): Promise<ProjectManagementTimelineMutationResponse> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<ProjectManagementTimelineMutationResponse>(`/v1/project-management/timeline-items/${encodeURIComponent(itemID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function listProjects(companyID: string): Promise<{ projects: ProjectRecord[] }> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<{ projects: ProjectRecord[] }>(`/v1/projects?${params.toString()}`);
}

export async function createProject(input: {
  companyID: string;
  name: string;
  status?: string;
  health?: ProjectHealth;
  accountIDs?: string[];
  teamIDs?: string[];
  skipCompanyExplorerDefaultPlacement?: boolean;
}): Promise<ProjectMutationResponse> {
  const body: Record<string, unknown> = {
    company_id: input.companyID,
    name: input.name,
    status: input.status ?? "Active",
    health: input.health ?? "On Track",
  };
  if (input.accountIDs !== undefined) body.account_ids = input.accountIDs;
  if (input.teamIDs !== undefined) body.team_ids = input.teamIDs;
  if (input.skipCompanyExplorerDefaultPlacement) body.skip_company_explorer_default_placement = true;
  return apiFetchJSON<ProjectMutationResponse>("/v1/projects", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateProject(input: {
  companyID: string;
  projectID: string;
  name: string;
  status: string;
  health?: ProjectHealth | string;
  accountIDs?: string[];
  teamIDs?: string[];
}): Promise<ProjectMutationResponse> {
  const body: Record<string, unknown> = {
    company_id: input.companyID,
    name: input.name,
    status: input.status,
    health: input.health ?? "On Track",
  };
  if (input.accountIDs !== undefined) body.account_ids = input.accountIDs;
  if (input.teamIDs !== undefined) body.team_ids = input.teamIDs;
  return apiFetchJSON<ProjectMutationResponse>(`/v1/projects/${encodeURIComponent(input.projectID)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteProject(companyID: string, projectID: string, confirmationDisplayName: string): Promise<ProjectMutationResponse & { deleted_project_id?: string }> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<ProjectMutationResponse & { deleted_project_id?: string }>(`/v1/projects/${encodeURIComponent(projectID)}?${params.toString()}`, {
    method: "DELETE",
    headers: { "X-Mango-Confirmation-Display-Name": confirmationDisplayName },
  });
}

export async function fetchProjectView(companyID: string, projectID: string): Promise<ProjectView> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<ProjectView>(`/v1/projects/${encodeURIComponent(projectID)}?${params.toString()}`);
}

export async function addProjectInformation(input: {
  companyID: string;
  projectID: string;
  informationID: string;
  type: string;
  information: string;
}): Promise<{ information: ProjectInformation; projection: ProjectProjection }> {
  return apiFetchJSON<{ information: ProjectInformation; projection: ProjectProjection }>(`/v1/projects/${encodeURIComponent(input.projectID)}/information`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      information_id: input.informationID,
      type: input.type,
      information: input.information,
    }),
  });
}

export async function deleteProjectProjection(input: {
  companyID: string;
  projectID: string;
  informationID: string;
}): Promise<{ status: string }> {
  const params = new URLSearchParams();
  params.set("company_id", input.companyID);
  return apiFetchJSON<{ status: string }>(`/v1/projects/${encodeURIComponent(input.projectID)}/projection/${encodeURIComponent(input.informationID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function upsertProjectCriticalPathStep(input: {
  companyID: string;
  projectID: string;
  stepID?: string;
  name: string;
  relationshipID?: string;
  dueDate?: string;
  ownerType?: "user" | "group" | "";
  ownerID?: string;
  position: number;
  isCurrent: boolean;
}): Promise<{ step: ProjectCriticalPathStep }> {
  return apiFetchJSON<{ step: ProjectCriticalPathStep }>(`/v1/projects/${encodeURIComponent(input.projectID)}/critical-path`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      step_id: input.stepID,
      name: input.name,
      relationship_id: input.relationshipID ?? "",
      due_date: input.dueDate ?? "",
      owner_type: input.ownerType ?? "",
      owner_id: input.ownerID ?? "",
      position: input.position,
      is_current: input.isCurrent,
    }),
  });
}

export async function deleteProjectCriticalPathStep(input: {
  companyID: string;
  projectID: string;
  stepID: string;
}): Promise<{ deleted_step_id: string }> {
  const params = new URLSearchParams();
  params.set("company_id", input.companyID);
  return apiFetchJSON<{ deleted_step_id: string }>(`/v1/projects/${encodeURIComponent(input.projectID)}/critical-path/${encodeURIComponent(input.stepID)}?${params.toString()}`, {
    method: "DELETE",
  });
}

export async function upsertProjectRelationship(input: {
  companyID: string;
  projectID: string;
  resourceType: "logic_gate" | "node";
  resourceID: string;
  relationshipID?: string;
  position?: number;
}): Promise<ProjectRelationshipMutationResponse> {
  const response = await apiFetchJSON<ProjectRelationshipMutationResponse>(`/v1/projects/${encodeURIComponent(input.projectID)}/relationships`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      relationship_id: input.relationshipID,
      resource_type: input.resourceType,
      resource_id: input.resourceID,
      position: input.position ?? 0,
    }),
  });
  invalidateProjectRelationshipsForResource(input);
  return response;
}

export async function createProjectNode(input: {
  companyID: string;
  projectID: string;
  title: string;
  position?: number;
  logicGateID?: string;
}): Promise<{ node?: unknown; relationship?: ProjectRelationshipProjection }> {
  const logicGateID = input.logicGateID?.trim() ?? "";
  return apiFetchJSON<{ node?: unknown; relationship?: ProjectRelationshipProjection }>(`/v1/projects/${encodeURIComponent(input.projectID)}/nodes`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      title: input.title,
      position: input.position ?? 0,
      initial_assignment: logicGateID ? { logic_gate_id: logicGateID, position: input.position ?? 0, priority: 3 } : undefined,
    }),
  });
}

export async function createProjectLogicGate(input: {
  companyID: string;
  projectID: string;
  header: string;
  position?: number;
}): Promise<{ logic_gate?: unknown; relationship?: ProjectRelationshipProjection }> {
  return apiFetchJSON<{ logic_gate?: unknown; relationship?: ProjectRelationshipProjection }>(`/v1/projects/${encodeURIComponent(input.projectID)}/logic-gates`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      header: input.header,
      position: input.position ?? 0,
    }),
  });
}

export async function deleteProjectRelationship(input: {
  companyID: string;
  projectID: string;
  relationshipID: string;
}): Promise<ProjectRelationshipMutationResponse> {
  const params = new URLSearchParams();
  params.set("company_id", input.companyID);
  const response = await apiFetchJSON<ProjectRelationshipMutationResponse>(`/v1/projects/${encodeURIComponent(input.projectID)}/relationships/${encodeURIComponent(input.relationshipID)}?${params.toString()}`, {
    method: "DELETE",
  });
  invalidateProjectRelationshipsForResource({ companyID: input.companyID });
  return response;
}

export async function listProjectRelationshipsForResource(input: {
  companyID: string;
  resourceType: "logic_gate" | "node";
  resourceID: string;
}): Promise<{ relationships: ProjectRelationshipProjection[] }> {
  const cacheKey = projectRelationshipReadKey(input);
  const authGeneration = getAuthSessionCacheGeneration();
  const invalidationGeneration = readProjectRelationshipGeneration(cacheKey);
  const cached = projectRelationshipReadCache.get(cacheKey);
  if (cached?.authGeneration === authGeneration && cached.value && cached.expiresAt > Date.now()) {
    return { relationships: cloneProjectRelationships(cached.value) };
  }
  if (cached?.authGeneration === authGeneration && cached.inflight) {
    const relationships = await cached.inflight;
    if (getAuthSessionCacheGeneration() !== authGeneration || readProjectRelationshipGeneration(cacheKey) !== invalidationGeneration) {
      throw new DOMException("The project relationship read became stale.", "AbortError");
    }
    return { relationships: cloneProjectRelationships(relationships) };
  }
  const params = new URLSearchParams();
  params.set("company_id", input.companyID);
  params.set("resource_type", input.resourceType);
  params.set("resource_id", input.resourceID);
  const inflight = apiFetchJSON<{ relationships: ProjectRelationshipProjection[] }>(`/v1/projects/relationships?${params.toString()}`)
    .then((payload) => payload.relationships ?? [])
    .then((relationships) => {
      if (getAuthSessionCacheGeneration() === authGeneration
        && readProjectRelationshipGeneration(cacheKey) === invalidationGeneration
        && projectRelationshipReadCache.get(cacheKey)?.inflight === inflight) {
        projectRelationshipReadCache.set(cacheKey, {
          authGeneration,
          expiresAt: Date.now() + PROJECT_RELATIONSHIP_CACHE_TTL_MS,
          value: cloneProjectRelationships(relationships),
        });
      }
      return relationships;
    })
    .catch((cause) => {
      if (projectRelationshipReadCache.get(cacheKey)?.inflight === inflight) projectRelationshipReadCache.delete(cacheKey);
      throw cause;
    });
  projectRelationshipReadCache.set(cacheKey, { authGeneration, expiresAt: 0, inflight });
  const relationships = await inflight;
  if (getAuthSessionCacheGeneration() !== authGeneration || readProjectRelationshipGeneration(cacheKey) !== invalidationGeneration) {
    throw new DOMException("The project relationship read became stale.", "AbortError");
  }
  return { relationships: cloneProjectRelationships(relationships) };
}

export async function deleteProjectManagementNode(companyID: string, nodeID: string, confirmationDisplayName: string): Promise<{ status: string }> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<{ status: string }>(`/v1/nodes/${encodeURIComponent(nodeID)}?${params.toString()}`, {
    method: "DELETE",
    headers: { "X-Mango-Confirmation-Display-Name": confirmationDisplayName },
  });
}

export async function deleteProjectManagementLogicGate(companyID: string, logicGateID: string, confirmationDisplayName: string): Promise<{ status: string }> {
  const params = new URLSearchParams();
  params.set("company_id", companyID);
  return apiFetchJSON<{ status: string }>(`/v1/logic-gates/${encodeURIComponent(logicGateID)}?${params.toString()}`, {
    method: "DELETE",
    headers: { "X-Mango-Confirmation-Display-Name": confirmationDisplayName },
  });
}
