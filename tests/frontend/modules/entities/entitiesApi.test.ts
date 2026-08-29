import test from "node:test";
import assert from "node:assert/strict";
import type { BoundRequestJSON } from "../../../../frontend/src/modules/api/requestJSON.js";
import {
  createActionItem,
  createEntityFieldType,
  getEntityDetail,
  getActionItemSource,
  listAllEntitiesForType,
  listEntities,
  listHuddleNodeActionItems,
  searchEntities,
  updateEntity,
  updateEntityField,
  updateEntityFieldType,
  type Entity,
  type EntityResourceFieldValue,
  type EntitySummary,
} from "../../../../frontend/src/modules/entities/entitiesApi.js";

function entitySummary(entityID: string): EntitySummary {
  return {
    company_id: "company-1",
    entity_id: entityID,
    entity_type_id: "type-1",
    entity_type_name: "Delivery",
    entity_folder_id: null,
    name: `Entity ${entityID}`,
    position: 0,
    revision: 1,
    created_timestamp: "2026-08-27T00:00:00Z",
    updated_timestamp: "2026-08-27T00:00:00Z",
  };
}

test("searchEntities uses the bounded cancellable picker contract", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const signal = new AbortController().signal;
  const requestJSON: BoundRequestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return { entities: [entitySummary("entity-1")] } as T;
  };

  const entities = await searchEntities(requestJSON, {
    companyID: "company-1",
    query: "  mango delivery  ",
    limit: 500,
    signal,
  });

  assert.equal(calls[0]?.path, "/v1/entities?company_id=company-1&q=mango+delivery&limit=50");
  assert.equal(calls[0]?.init?.signal, signal);
  assert.equal(entities[0]?.entity_id, "entity-1");
});

test("getEntityDetail reads one exact company-scoped entity and its fields", async () => {
  const detail: Entity = {
    ...entitySummary("entity-7"),
    entity_type_name: "Delivery",
    entity_fields: [{
      company_id: "company-1",
      entity_field_id: "field-1",
      entity_id: "entity-7",
      name: "Due date",
      field_type: "date",
      config: {},
      value: "2026-09-01",
      position: 0,
      created_timestamp: "2026-08-27T00:00:00Z",
      updated_timestamp: "2026-08-27T00:00:00Z",
    }, {
      company_id: "company-1",
      entity_field_id: "field-source",
      entity_id: "entity-7",
      system_key: "source",
      name: "Source",
      field_type: "resource",
      config: {},
      value: { resource_type: "node", resource_id: "11111111-1111-4111-8111-111111111111" } satisfies EntityResourceFieldValue,
      position: 1,
      created_timestamp: "2026-08-27T00:00:00Z",
      updated_timestamp: "2026-08-27T00:00:00Z",
    }],
  };
  let requestedPath = "";
  const requestJSON: BoundRequestJSON = async <T,>(path: string): Promise<T> => {
    requestedPath = path;
    return { entity: detail } as T;
  };

  const loaded = await getEntityDetail(requestJSON, { companyID: "company-1", entityID: "entity-7" });

  assert.equal(requestedPath, "/v1/entities/entity-7?company_id=company-1");
  assert.equal(loaded.entity_fields[0]?.name, "Due date");
  assert.deepEqual(loaded.entity_fields[1]?.value, {
    resource_type: "node",
    resource_id: "11111111-1111-4111-8111-111111111111",
  });
});

test("Action Item creation writes one exact typed source and source reads stay permission-safe", async () => {
  const calls: Array<{ path: string; init?: RequestInit & { json?: unknown } }> = [];
  const signal = new AbortController().signal;
  const actionItem = { ...entitySummary("action-item-1"), entity_type_name: "Action Item", entity_fields: [] };
  const requestJSON: BoundRequestJSON = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    calls.push({ path, init });
    if (init?.method === "POST") return { action_item: actionItem } as T;
    return { source: { resource_type: "kpi", resource_id: "kpi-1", name: "Current KPI name", parent_resource_id: "process-1" } } as T;
  };

  await createActionItem(requestJSON, {
    companyID: "company-1",
    bodyText: "Fix the shipment",
    name: "Fix the shipment",
    color: "red",
    source: { resourceType: "huddle_logic_gate", resourceID: "huddle-process-1" },
  });
  const source = await getActionItemSource(requestJSON, {
    companyID: " company-1 ",
    entityID: "action/item-1",
    signal,
  });

  assert.deepEqual(calls[0]?.init?.json, {
    company_id: "company-1",
    body_text: "Fix the shipment",
    name: "Fix the shipment",
    color: "red",
    source: { resource_type: "huddle_logic_gate", resource_id: "huddle-process-1" },
  });
  assert.equal(calls[1]?.path, "/v1/action-items/action%2Fitem-1/source?company_id=company-1");
  assert.equal(calls[1]?.init?.signal, signal);
  assert.equal(calls[1]?.init?.cache, "no-store");
  assert.equal(source?.name, "Current KPI name");
  assert.equal(source?.parent_resource_id, "process-1");
});

test("listAllEntitiesForType loads the exact type manager list in one request", async () => {
  const requestedPaths: string[] = [];
  const allEntities = Array.from({ length: 101 }, (_, index) => entitySummary(`entity-${index + 1}`));
  const requestJSON: BoundRequestJSON = async <T,>(path: string): Promise<T> => {
    requestedPaths.push(path);
    return { entities: allEntities } as T;
  };

  const loaded = await listAllEntitiesForType("company-1", "type-1", requestJSON);

  assert.equal(loaded.length, 101);
  assert.equal(requestedPaths.length, 1);
  const params = new URL(requestedPaths[0]!, "http://mangorts.test").searchParams;
  assert.equal(params.get("entity_type_id"), "type-1");
  assert.equal(params.get("all_for_type"), "true");
  assert.equal(params.get("entity_folder_id"), null);
  assert.equal(params.get("limit"), null);
  assert.equal(params.get("offset"), null);
});

test("listEntities can request only entities at the type root", async () => {
  let requestedPath = "";
  const requestJSON: BoundRequestJSON = async <T,>(path: string): Promise<T> => {
    requestedPath = path;
    return { entities: [] } as T;
  };

  await listEntities({
    companyID: "company-1",
    entityTypeID: "type-1",
    entityFolderID: "",
  }, requestJSON);

  const params = new URL(requestedPath, "http://mangorts.test").searchParams;
  assert.equal(params.has("entity_folder_id"), true);
  assert.equal(params.get("entity_folder_id"), "");
});

test("listHuddleNodeActionItems reads the exact company and Huddle Node scope", async () => {
  let requestedPath = "";
  let requestedSignal: AbortSignal | null | undefined;
  const signal = new AbortController().signal;
  const requestJSON: BoundRequestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    requestedPath = path;
    requestedSignal = init?.signal;
    return { action_items: [{ ...entitySummary("action-item-1"), entity_type_name: "Action Item", entity_fields: [] }] } as T;
  };

  const loaded = await listHuddleNodeActionItems(requestJSON, {
    companyID: "company-1",
    huddleNodeID: "huddle-node-1",
    signal,
  });

  assert.equal(requestedPath, "/v1/action-items?company_id=company-1&huddle_node_id=huddle-node-1");
  assert.equal(requestedSignal, signal);
  assert.equal(loaded[0]?.entity_id, "action-item-1");
});

test("field-type create and update serialize choice/color config without changing its option keys", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const requestJSON: BoundRequestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return { entity_field_type: {} } as T;
  };
  const config = {
    default: null,
    options: [
      { key: "yellow", label: "Yellow", color: "#facc15" },
      { key: "red", label: "Red", color: "#ef4444" },
    ],
  };

  await createEntityFieldType({
    companyID: "company-1",
    entityTypeID: "action-item-type",
    name: "Color",
    fieldType: "color",
    config,
  }, requestJSON);
  await updateEntityFieldType({
    companyID: "company-1",
    entityFieldTypeID: "color-field-type",
    config,
  }, requestJSON);

  assert.equal(calls[0]?.path, "/v1/entity-field-types");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    company_id: "company-1",
    entity_type_id: "action-item-type",
    entity_folder_id: null,
    name: "Color",
    field_type: "color",
    config,
  });
  assert.equal(calls[1]?.path, "/v1/entity-field-types/color-field-type");
  assert.equal(calls[1]?.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    company_id: "company-1",
    config,
  });
});

test("inline Entity editing uses the injected request boundary for revisioned body and assigned-field writes", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const entity: Entity = {
    ...entitySummary("action-item-1"),
    entity_type_name: "Action Item",
    body_json: {
      format: "mango-tiptap-json",
      schema_version: 1,
      document: { type: "doc", content: [{ type: "paragraph" }] },
      annotations: [],
    },
    entity_fields: [],
  };
  const field = {
    company_id: "company-1",
    entity_field_id: "color-field",
    entity_id: "action-item-1",
    system_key: "color",
    name: "Color",
    field_type: "color" as const,
    config: { options: [{ key: "yellow", label: "Yellow" }, { key: "red", label: "Red" }] },
    value: "red",
    position: 0,
    created_timestamp: "2026-08-27T00:00:00Z",
    updated_timestamp: "2026-08-28T00:00:00Z",
  };
  const requestJSON: BoundRequestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return (path.includes("/fields/") ? { entity_field: field } : { entity }) as T;
  };

  const bodyJSON = {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Escalate today" }] }] },
    annotations: [],
  };
  await updateEntity({
    companyID: "company-1",
    entityID: "action-item/1",
    name: "Escalate delivery",
    bodyJSON,
    baseRevision: 7,
  }, requestJSON);
  await updateEntityField({
    companyID: "company-1",
    entityID: "action-item/1",
    entityFieldID: "color/field",
    value: "red",
  }, requestJSON);

  assert.equal(calls[0]?.path, "/v1/entities/action-item%2F1");
  assert.equal(calls[0]?.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    company_id: "company-1",
    name: "Escalate delivery",
    body_json: bodyJSON,
    base_revision: 7,
  });
  assert.equal(calls[1]?.path, "/v1/entities/action-item%2F1/fields/color%2Ffield");
  assert.equal(calls[1]?.init?.method, "PUT");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    company_id: "company-1",
    value: "red",
  });
});
