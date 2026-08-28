import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildEntityTreeRows,
  entityFolderDescendantIDs,
} from "../../../../frontend/src/modules/entities/entitiesPageModel.js";
import type { EntityFolder, EntitySummary } from "../../../../frontend/src/modules/entities/entitiesApi.js";

function folder(entityFolderID: string, parentEntityFolderID: string | null, position: number): EntityFolder {
  return {
    company_id: "company-1",
    entity_folder_id: entityFolderID,
    entity_type_id: "type-1",
    parent_entity_folder_id: parentEntityFolderID,
    name: entityFolderID,
    position,
    created_timestamp: "2026-08-27T00:00:00Z",
    updated_timestamp: "2026-08-27T00:00:00Z",
  };
}

function entity(entityID: string, entityFolderID: string | null, position: number): EntitySummary {
  return {
    company_id: "company-1",
    entity_id: entityID,
    entity_type_id: "type-1",
    entity_type_name: "Delivery",
    entity_folder_id: entityFolderID,
    name: entityID,
    position,
    revision: 1,
    created_timestamp: "2026-08-27T00:00:00Z",
    updated_timestamp: "2026-08-27T00:00:00Z",
  };
}

test("Entities page tree places nested folders and entities at their exact locations", () => {
  const folders = [folder("west", null, 2), folder("urgent", "west", 0), folder("east", null, 1)];
  const entities = [entity("root-entity", null, 0), entity("west-entity", "west", 0), entity("urgent-entity", "urgent", 0)];

  const rows = buildEntityTreeRows(folders, entities);

  assert.deepEqual(rows.map((row) => [row.kind, row.id, row.depth]), [
    ["folder", "east", 0],
    ["folder", "west", 0],
    ["folder", "urgent", 1],
    ["entity", "urgent-entity", 2],
    ["entity", "west-entity", 1],
    ["entity", "root-entity", 0],
  ]);
});

test("Entities page excludes every descendant from a folder's move targets", () => {
  const folders = [
    folder("parent", null, 0),
    folder("child", "parent", 0),
    folder("grandchild", "child", 0),
    folder("other", null, 1),
  ];

  assert.deepEqual([...entityFolderDescendantIDs(folders, "parent")], ["child", "grandchild"]);
});

test("Entities is directly below Process Map and the retired Fields surface is gone", () => {
  const sidebarSource = readFileSync(resolve(process.cwd(), "frontend/src/app/AppSidebarChrome.tsx"), "utf8");
  const authSource = readFileSync(resolve(process.cwd(), "frontend/src/auth/AuthGate.tsx"), "utf8");
  const entitiesSource = readFileSync(resolve(process.cwd(), "frontend/src/modules/entities/EntitiesContent.tsx"), "utf8");

  assert.match(sidebarSource, /label="Process Map"[\s\S]*label="Entities"/);
  assert.match(authSource, /normalizedPath === "\/entities"/);
  assert.doesNotMatch(authSource, /\/fields/);
  assert.match(entitiesSource, /listAllEntitiesForType/);
  assert.match(entitiesSource, /title="Default fields"/);
  assert.match(entitiesSource, /title="Entity fields"/);
  assert.match(entitiesSource, /catalogRequestRef\.current !== requestID/);
  assert.match(entitiesSource, /detailError[\s\S]*>Retry</);
  assert.match(entitiesSource, /Default field position/);
  assert.match(entitiesSource, /Entity field position/);
  assert.match(entitiesSource, /parentPath \? `\$\{parentPath\} \/ \$\{row\.folder\.name\}`/);
  assert.equal(existsSync(resolve(process.cwd(), "frontend/src/modules/fields/entityFieldsApi.ts")), false);
  assert.equal(existsSync(resolve(process.cwd(), "frontend/src/pages/fields/index.tsx")), false);
});
