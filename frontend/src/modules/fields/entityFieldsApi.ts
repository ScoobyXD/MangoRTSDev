import { apiFetchJSON } from "../../auth/cognitoAuth.js";

export type EntityField = {
  company_id: string;
  field_id: string;
  name: string;
  color: string;
  position: number;
  assignment_count?: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export async function listEntityFields(companyID: string): Promise<EntityField[]> {
  const params = new URLSearchParams({ company_id: companyID });
  const response = await apiFetchJSON<{ fields?: EntityField[] }>(`/v1/entity-fields?${params.toString()}`, { cache: "no-store" });
  return sortEntityFields(response.fields ?? []);
}

export async function createEntityField(input: {
  companyID: string;
  name: string;
  color: string;
}): Promise<EntityField> {
  const response = await apiFetchJSON<{ field: EntityField }>("/v1/entity-fields", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      name: input.name,
      color: input.color,
    }),
  });
  return response.field;
}

export async function updateEntityField(input: {
  companyID: string;
  fieldID: string;
  name: string;
  color: string;
  position?: number;
}): Promise<EntityField> {
  const response = await apiFetchJSON<{ field: EntityField }>(`/v1/entity-fields/${encodeURIComponent(input.fieldID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      name: input.name,
      color: input.color,
      ...(input.position === undefined ? {} : { position: input.position }),
    }),
  });
  return response.field;
}

export async function deleteEntityField(companyID: string, fieldID: string): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID });
  await apiFetchJSON(`/v1/entity-fields/${encodeURIComponent(fieldID)}?${params.toString()}`, { method: "DELETE" });
}

export async function setEntityFieldAssignments(input: {
  companyID: string;
  resourceType: "project" | "node" | "logic_gate";
  resourceID: string;
  fieldIDs: string[];
}): Promise<EntityField[]> {
  const response = await apiFetchJSON<{ fields?: EntityField[] }>("/v1/entity-fields/assignments", {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      resource_type: input.resourceType,
      resource_id: input.resourceID,
      field_ids: input.fieldIDs,
    }),
  });
  return sortEntityFields(response.fields ?? []);
}

export function sortEntityFields(fields: ReadonlyArray<EntityField>): EntityField[] {
  return [...fields].sort((left, right) => (
    (left.position ?? 0) - (right.position ?? 0)
    || left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true })
    || left.field_id.localeCompare(right.field_id)
  ));
}

export const ENTITY_FIELD_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#14b8a6",
  "#10b981",
  "#f59e0b",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
] as const;
