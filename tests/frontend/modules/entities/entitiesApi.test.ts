import test from "node:test";
import assert from "node:assert/strict";
import type { BoundRequestJSON } from "../../../../frontend/src/modules/api/requestJSON.js";
import {
  getEntityDetail,
  listAllEntitiesForType,
  listEntities,
  searchEntities,
  type Entity,
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
      value: "2026-09-01",
      position: 0,
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
