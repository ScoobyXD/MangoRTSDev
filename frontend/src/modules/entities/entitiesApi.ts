import { apiFetchJSON } from "../../auth/cognitoAuth.js";
import type { BoundRequestJSON } from "../api/requestJSON.js";

export const ENTITY_FIELD_TYPES = ["text", "number", "date", "boolean", "choice", "color", "person", "resource"] as const;

export const ACTION_ITEM_SOURCE_RESOURCE_TYPES = [
  "node",
  "logic_gate",
  "project",
  "huddle_node",
  "huddle_logic_gate",
  "kpi",
] as const;
export type ActionItemSourceResourceType = (typeof ACTION_ITEM_SOURCE_RESOURCE_TYPES)[number];
export type EntityResourceFieldValue = {
  resource_type: ActionItemSourceResourceType;
  resource_id: string;
};

export type EntityFieldDataType = (typeof ENTITY_FIELD_TYPES)[number];
export type EntityFieldValue = string | number | boolean | EntityResourceFieldValue | null;

export type EntityFieldTypeConfigOption = {
  key: string;
  label: string;
  color?: string;
};

export type EntityFieldTypeConfig = {
  default?: string | null;
  options?: EntityFieldTypeConfigOption[];
};

export type EntityType = {
  company_id: string;
  entity_type_id: string;
  system_key?: string;
  name: string;
  created_timestamp: string;
  updated_timestamp: string;
};

export type EntityFolder = {
  company_id: string;
  entity_folder_id: string;
  entity_type_id: string;
  parent_entity_folder_id?: string | null;
  name: string;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type EntityFieldType = {
  company_id: string;
  entity_field_type_id: string;
  entity_type_id: string;
  entity_folder_id?: string | null;
  system_key?: string;
  name: string;
  field_type: EntityFieldDataType;
  config: EntityFieldTypeConfig;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type EntitySummary = {
  company_id: string;
  entity_id: string;
  entity_type_id: string;
  entity_type_name?: string;
  created_by_user_id?: string | null;
  entity_folder_id?: string | null;
  name: string;
  position: number;
  revision: number;
  created_timestamp: string;
  updated_timestamp?: string;
};

export type EntityField = {
  company_id: string;
  entity_field_id: string;
  entity_id: string;
  entity_field_type_id?: string | null;
  system_key?: string;
  name: string;
  field_type: EntityFieldDataType;
  config: EntityFieldTypeConfig;
  value: EntityFieldValue;
  position: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type Entity = EntitySummary & {
  entity_type_name: string;
  body_json?: unknown;
  entity_fields: EntityField[];
};

export type ActionItemColor = "yellow" | "red";
export type ActionItemSource = {
  resource_type: ActionItemSourceResourceType;
  resource_id: string;
  name: string;
  parent_resource_id?: string;
};

export type EntitySearchInput = {
  companyID: string;
  query?: string;
  limit?: number;
  signal?: AbortSignal;
};

function boundedSearchLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(50, Math.max(1, Math.floor(value ?? 50)));
}

export async function searchEntities(requestJSON: BoundRequestJSON, input: EntitySearchInput): Promise<EntitySummary[]> {
  const params = new URLSearchParams({
    company_id: input.companyID,
    q: input.query?.trim() ?? "",
    limit: String(boundedSearchLimit(input.limit)),
  });
  const response = await requestJSON<{ entities?: EntitySummary[] }>(`/v1/entities?${params.toString()}`, {
    cache: "no-store",
    signal: input.signal,
  });
  return response.entities ?? [];
}

export async function getEntityDetail(
  requestJSON: BoundRequestJSON,
  input: { companyID: string; entityID: string; signal?: AbortSignal },
): Promise<Entity> {
  const params = new URLSearchParams({ company_id: input.companyID });
  const response = await requestJSON<{ entity: Entity }>(
    `/v1/entities/${encodeURIComponent(input.entityID)}?${params.toString()}`,
    { cache: "no-store", signal: input.signal },
  );
  return response.entity;
}

export async function createActionItem(
  requestJSON: BoundRequestJSON,
  input: {
    companyID: string;
    bodyText: string;
    name?: string;
    color: ActionItemColor | null;
    source?: {
      resourceType: ActionItemSourceResourceType;
      resourceID: string;
    };
  },
): Promise<Entity> {
  const response = await requestJSON<{ action_item: Entity }>("/v1/action-items", {
    method: "POST",
    json: {
      company_id: input.companyID,
      body_text: input.bodyText,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      color: input.color,
      ...(input.source ? {
        source: {
          resource_type: input.source.resourceType,
          resource_id: input.source.resourceID.trim(),
        },
      } : {}),
    },
  });
  return response.action_item;
}

export async function getActionItemSource(
  requestJSON: BoundRequestJSON,
  input: { companyID: string; entityID: string; signal?: AbortSignal },
): Promise<ActionItemSource | null> {
  const params = new URLSearchParams({ company_id: input.companyID.trim() });
  const response = await requestJSON<{ source?: ActionItemSource | null }>(
    `/v1/action-items/${encodeURIComponent(input.entityID.trim())}/source?${params.toString()}`,
    { cache: "no-store", signal: input.signal },
  );
  return response.source ?? null;
}

export async function listEntityTypes(companyID: string): Promise<EntityType[]> {
  const params = new URLSearchParams({ company_id: companyID });
  const response = await apiFetchJSON<{ entity_types?: EntityType[] }>(`/v1/entity-types?${params.toString()}`, { cache: "no-store" });
  return response.entity_types ?? [];
}

export async function createEntityType(input: { companyID: string; name: string }): Promise<EntityType> {
  const response = await apiFetchJSON<{ entity_type: EntityType }>("/v1/entity-types", {
    method: "POST",
    body: JSON.stringify({ company_id: input.companyID, name: input.name }),
  });
  return response.entity_type;
}

export async function updateEntityType(input: { companyID: string; entityTypeID: string; name: string }): Promise<EntityType> {
  const response = await apiFetchJSON<{ entity_type: EntityType }>(`/v1/entity-types/${encodeURIComponent(input.entityTypeID)}`, {
    method: "PUT",
    body: JSON.stringify({ company_id: input.companyID, name: input.name }),
  });
  return response.entity_type;
}

export async function deleteEntityType(companyID: string, entityTypeID: string): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID });
  await apiFetchJSON(`/v1/entity-types/${encodeURIComponent(entityTypeID)}?${params.toString()}`, { method: "DELETE" });
}

export async function listEntityFolders(companyID: string, entityTypeID: string): Promise<EntityFolder[]> {
  const params = new URLSearchParams({ company_id: companyID, entity_type_id: entityTypeID });
  const response = await apiFetchJSON<{ entity_folders?: EntityFolder[] }>(`/v1/entity-folders?${params.toString()}`, { cache: "no-store" });
  return response.entity_folders ?? [];
}

export async function createEntityFolder(input: {
  companyID: string;
  entityTypeID: string;
  parentEntityFolderID?: string | null;
  name: string;
  position?: number;
}): Promise<EntityFolder> {
  const response = await apiFetchJSON<{ entity_folder: EntityFolder }>("/v1/entity-folders", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      entity_type_id: input.entityTypeID,
      parent_entity_folder_id: input.parentEntityFolderID ?? null,
      name: input.name,
      position: input.position,
    }),
  });
  return response.entity_folder;
}

export async function updateEntityFolder(input: {
  companyID: string;
  entityFolderID: string;
  name?: string;
  parentEntityFolderID?: string | null;
  position?: number;
}): Promise<EntityFolder> {
  const response = await apiFetchJSON<{ entity_folder: EntityFolder }>(`/v1/entity-folders/${encodeURIComponent(input.entityFolderID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      name: input.name,
      parent_entity_folder_id: input.parentEntityFolderID,
      position: input.position,
    }),
  });
  return response.entity_folder;
}

export async function deleteEntityFolder(companyID: string, entityFolderID: string): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID });
  await apiFetchJSON(`/v1/entity-folders/${encodeURIComponent(entityFolderID)}?${params.toString()}`, { method: "DELETE" });
}

export async function listEntityFieldTypes(companyID: string, entityTypeID: string): Promise<EntityFieldType[]> {
  const params = new URLSearchParams({ company_id: companyID, entity_type_id: entityTypeID });
  const response = await apiFetchJSON<{ entity_field_types?: EntityFieldType[] }>(`/v1/entity-field-types?${params.toString()}`, { cache: "no-store" });
  return response.entity_field_types ?? [];
}

export async function createEntityFieldType(input: {
  companyID: string;
  entityTypeID: string;
  entityFolderID?: string | null;
  name: string;
  fieldType: EntityFieldDataType;
  config?: EntityFieldTypeConfig;
  position?: number;
}, requestJSON: BoundRequestJSON = apiFetchJSON): Promise<EntityFieldType> {
  const response = await requestJSON<{ entity_field_type: EntityFieldType }>("/v1/entity-field-types", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      entity_type_id: input.entityTypeID,
      entity_folder_id: input.entityFolderID ?? null,
      name: input.name,
      field_type: input.fieldType,
      config: input.config,
      position: input.position,
    }),
  });
  return response.entity_field_type;
}

export async function updateEntityFieldType(input: {
  companyID: string;
  entityFieldTypeID: string;
  entityFolderID?: string | null;
  name?: string;
  fieldType?: EntityFieldDataType;
  config?: EntityFieldTypeConfig;
  position?: number;
}, requestJSON: BoundRequestJSON = apiFetchJSON): Promise<EntityFieldType> {
  const response = await requestJSON<{ entity_field_type: EntityFieldType }>(`/v1/entity-field-types/${encodeURIComponent(input.entityFieldTypeID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      entity_folder_id: input.entityFolderID,
      name: input.name,
      field_type: input.fieldType,
      config: input.config,
      position: input.position,
    }),
  });
  return response.entity_field_type;
}

export async function deleteEntityFieldType(companyID: string, entityFieldTypeID: string): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID });
  await apiFetchJSON(`/v1/entity-field-types/${encodeURIComponent(entityFieldTypeID)}?${params.toString()}`, { method: "DELETE" });
}

type EntityListInput = {
  companyID: string;
  entityTypeID?: string;
  entityFolderID?: string | null;
  query?: string;
  limit?: number;
  offset?: number;
  allForType?: boolean;
};

async function requestEntityList(requestJSON: BoundRequestJSON, input: EntityListInput): Promise<EntitySummary[]> {
  const params = new URLSearchParams({
    company_id: input.companyID,
    q: input.query?.trim() ?? "",
    limit: String(boundedSearchLimit(input.limit)),
  });
  if (input.entityTypeID) params.set("entity_type_id", input.entityTypeID);
  if (input.entityFolderID !== undefined) params.set("entity_folder_id", input.entityFolderID?.trim() ?? "");
  if (input.offset && input.offset > 0) params.set("offset", String(Math.floor(input.offset)));
  if (input.allForType) {
    params.delete("limit");
    params.set("all_for_type", "true");
  }
  const response = await requestJSON<{ entities?: EntitySummary[] }>(`/v1/entities?${params.toString()}`, { cache: "no-store" });
  return response.entities ?? [];
}

export async function listEntities(
  input: EntityListInput,
  requestJSON: BoundRequestJSON = apiFetchJSON,
): Promise<EntitySummary[]> {
  return requestEntityList(requestJSON, input);
}

export async function listAllEntitiesForType(
  companyID: string,
  entityTypeID: string,
  requestJSON: BoundRequestJSON = apiFetchJSON,
): Promise<EntitySummary[]> {
  return requestEntityList(requestJSON, { companyID, entityTypeID, allForType: true });
}

export async function getEntity(companyID: string, entityID: string, signal?: AbortSignal): Promise<Entity> {
  return getEntityDetail(apiFetchJSON, { companyID, entityID, signal });
}

export async function createEntity(input: {
  companyID: string;
  entityTypeID: string;
  entityFolderID?: string | null;
  name: string;
  position?: number;
  bodyJSON?: unknown;
}): Promise<Entity> {
  const response = await apiFetchJSON<{ entity: Entity }>("/v1/entities", {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      entity_type_id: input.entityTypeID,
      entity_folder_id: input.entityFolderID ?? null,
      name: input.name,
      position: input.position,
      body_json: input.bodyJSON,
    }),
  });
  return response.entity;
}

export async function updateEntity(input: {
  companyID: string;
  entityID: string;
  name?: string;
  entityFolderID?: string | null;
  position?: number;
  bodyJSON?: unknown;
  baseRevision?: number;
}, requestJSON: BoundRequestJSON = apiFetchJSON): Promise<Entity> {
  const response = await requestJSON<{ entity: Entity }>(`/v1/entities/${encodeURIComponent(input.entityID)}`, {
    method: "PUT",
    body: JSON.stringify({
      company_id: input.companyID,
      name: input.name,
      entity_folder_id: input.entityFolderID,
      position: input.position,
      body_json: input.bodyJSON,
      base_revision: input.baseRevision,
    }),
  });
  return response.entity;
}

export async function deleteEntity(companyID: string, entityID: string): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID });
  await apiFetchJSON(`/v1/entities/${encodeURIComponent(entityID)}?${params.toString()}`, { method: "DELETE" });
}

export async function createEntityField(input: {
  companyID: string;
  entityID: string;
  name: string;
  fieldType: EntityFieldDataType;
  value?: EntityFieldValue;
  position?: number;
}): Promise<EntityField> {
  const response = await apiFetchJSON<{ entity_field: EntityField }>(`/v1/entities/${encodeURIComponent(input.entityID)}/fields`, {
    method: "POST",
    body: JSON.stringify({
      company_id: input.companyID,
      name: input.name,
      field_type: input.fieldType,
      value: input.value,
      position: input.position,
    }),
  });
  return response.entity_field;
}

export async function updateEntityField(input: {
  companyID: string;
  entityID: string;
  entityFieldID: string;
  name?: string;
  fieldType?: EntityFieldDataType;
  value?: EntityFieldValue;
  position?: number;
}, requestJSON: BoundRequestJSON = apiFetchJSON): Promise<EntityField> {
  const response = await requestJSON<{ entity_field: EntityField }>(
    `/v1/entities/${encodeURIComponent(input.entityID)}/fields/${encodeURIComponent(input.entityFieldID)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        company_id: input.companyID,
        name: input.name,
        field_type: input.fieldType,
        value: input.value,
        position: input.position,
      }),
    },
  );
  return response.entity_field;
}

export async function deleteEntityField(companyID: string, entityID: string, entityFieldID: string): Promise<void> {
  const params = new URLSearchParams({ company_id: companyID });
  await apiFetchJSON(
    `/v1/entities/${encodeURIComponent(entityID)}/fields/${encodeURIComponent(entityFieldID)}?${params.toString()}`,
    { method: "DELETE" },
  );
}
