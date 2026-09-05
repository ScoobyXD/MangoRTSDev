import type { BoundRequestJSON } from "../api/requestJSON.js";
import type { LogicGateRACIPrincipalType, LogicGateRACIRole } from "../logic-gates/types.js";
import type { LogicGateResourceRACIPayload } from "../logic-gates/raciPresentation.js";
import { invalidateResourcePolicyDependentCaches } from "../permissions/resourcePolicyCaches.js";

export type EditorRACIAssignmentInput = {
  role: LogicGateRACIRole;
  principal_type?: LogicGateRACIPrincipalType;
  principal_id?: string;
  user_id?: string;
};

export function toResourceRACIAssignmentInput(assignment: EditorRACIAssignmentInput) {
  const principalType: LogicGateRACIPrincipalType = assignment.principal_type?.trim() === "group" ? "group" : "user";
  return {
    role: assignment.role,
    principal_type: principalType,
    principal_id: (assignment.principal_id ?? assignment.user_id ?? "").trim(),
  };
}

export async function saveEditorResourceRACI({ apiBase, companyID, resourceType, resourceID, assignments, assignmentMode, revision, descendantAction = "inherited_only", requestJSON }: {
  apiBase: string;
  companyID: string;
  resourceType: "node" | "logic_gate";
  resourceID: string;
  assignments: EditorRACIAssignmentInput[] | undefined;
  assignmentMode: "inherited" | "customized";
  revision: string;
  descendantAction?: "inherited_only" | "including_customized";
  requestJSON: BoundRequestJSON;
}): Promise<LogicGateResourceRACIPayload> {
  const policy = await requestJSON<LogicGateResourceRACIPayload>(`/v1/resources/${resourceType}/${encodeURIComponent(resourceID.trim())}/gvic`, {
    method: "PUT",
    headers: revision ? { "If-Match": revision } : undefined,
    body: JSON.stringify({
      company_id: companyID,
      assignment_mode: assignmentMode,
      ...(assignmentMode === "customized" && assignments !== undefined
        ? { gvic_assignments: assignments.map(toResourceRACIAssignmentInput) }
        : {}),
      descendant_action: descendantAction,
    }),
  });
  invalidateResourcePolicyDependentCaches(apiBase, companyID);
  return policy;
}
