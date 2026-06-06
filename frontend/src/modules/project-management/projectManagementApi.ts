import { apiFetchJSON } from "../../auth/cognitoAuth.js";

export type ProjectManagementEntityType = "node" | "logic_gate";

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
  status_color?: string | null;
  due_date?: string | null;
  priority?: number | null;
  assignee_user_id?: string | null;
  assignee_display_name?: string | null;
  assignee_email?: string | null;
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
  projection: "project_management_timeline";
  projection_scope?: string;
  realtime_scope?: string;
  projection_sequence?: number;
  rows: ProjectManagementTimelineRow[];
};

export type ProjectManagementTimelineMutationResponse = {
  item?: ProjectManagementTimelineRow;
  deleted_item_id?: string;
  user_id?: string;
};

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
