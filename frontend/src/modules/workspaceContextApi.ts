import type { ContextMutationEnvelope } from "./contextSyncContract";

type WorkspaceContextProjection = {
  last_sequence: number;
  last_payload_json?: Record<string, unknown>;
};

type WorkspaceContextEvent = ContextMutationEnvelope & {
  company_id: string;
  workspace_id: string;
  payload: Record<string, unknown>;
};

export async function postWorkspaceContextEvent(apiBase: string, event: WorkspaceContextEvent): Promise<WorkspaceContextProjection> {
  const response = await fetch(`${apiBase}/v1/workspace/context-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(await response.text() || `context_event_write_failed_${response.status}`);
  return response.json() as Promise<WorkspaceContextProjection>;
}

export async function getWorkspaceContextProjection(
  apiBase: string,
  companyID: string,
  workspaceID: string,
  contextID: string,
): Promise<WorkspaceContextProjection | null> {
  const url = new URL(`${apiBase}/v1/workspace/context-projections`);
  url.searchParams.set("company_id", companyID);
  url.searchParams.set("workspace_id", workspaceID);
  url.searchParams.set("context_id", contextID);
  const response = await fetch(url.toString());
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(await response.text() || `context_projection_read_failed_${response.status}`);
  return response.json() as Promise<WorkspaceContextProjection>;
}

export function readSelectedNodeIDFromProjection(projection: WorkspaceContextProjection | null): string {
  if (!projection?.last_payload_json) return "";
  const value = projection.last_payload_json.selected_node_id;
  return typeof value === "string" ? value : "";
}
