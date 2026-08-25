import assert from "node:assert/strict";
import test from "node:test";

import {
  decideProcessMapExplorerDrop,
  isValidProcessMapConnection,
  processMapFolderDrillTarget,
  processMapResourceNodeID,
  processMapTrayCandidates,
  shouldApplyProcessMapCommit,
  shouldApplyProcessMapMutationAck,
} from "../../../../frontend/src/modules/process-map/processMapInteraction.js";

const explorerRows = [
  {
    company_id: "company-1",
    entity_id: "folder-1",
    entity_type: "folder" as const,
    name: "Logic Gates",
    position: 1000,
    created_timestamp: "created",
    updated_timestamp: "created",
  },
  {
    company_id: "company-1",
    entity_id: "folder-2",
    entity_type: "folder" as const,
    name: "Finance",
    position: 2000,
    created_timestamp: "created",
    updated_timestamp: "created",
  },
  {
    company_id: "company-1",
    entity_id: "edge-gate-1",
    entity_type: "logic_gate" as const,
    resource_id: "gate-1",
    name: "Review",
    position: 3000,
    created_timestamp: "created",
    updated_timestamp: "created",
  },
  {
    company_id: "company-1",
    entity_id: "edge-project-1",
    entity_type: "project" as const,
    resource_id: "project-1",
    name: "Ignored project",
    position: 4000,
    created_timestamp: "created",
    updated_timestamp: "created",
  },
];

test("Process Map tray reuses only the exact current Explorer branch and existing drag payload", () => {
  assert.deepEqual(
    processMapTrayCandidates(explorerRows, undefined, new Set()),
    [
      {
        resource: { resource_type: "company_explorer_folder", resource_id: "folder-1" },
        label: "Processes",
        dragPayload: { kind: "folder", label: "Processes", folderID: "folder-1", folderKind: "logic_gate" },
      },
      {
        resource: { resource_type: "company_explorer_folder", resource_id: "folder-2" },
        label: "Finance",
        dragPayload: { kind: "folder", label: "Finance", folderID: "folder-2", folderKind: "logic_gate" },
      },
    ],
    "the root tray includes root Folders only and keeps the established Process label",
  );

  const unavailable = new Set([
    processMapResourceNodeID({ resource_type: "company_explorer_folder", resource_id: "folder-2" }),
  ]);
  assert.deepEqual(
    processMapTrayCandidates([...explorerRows, explorerRows[2]], "parent-folder", unavailable),
    [
      {
        resource: { resource_type: "company_explorer_folder", resource_id: "folder-1" },
        label: "Processes",
        dragPayload: { kind: "folder", label: "Processes", folderID: "folder-1", folderKind: "logic_gate" },
      },
      {
        resource: { resource_type: "logic_gate", resource_id: "gate-1" },
        label: "Review",
        dragPayload: { kind: "logic_gate", label: "Review", itemID: "gate-1", itemType: "logic_gate" },
      },
    ],
    "a Folder tray includes immediate Folders and Processes once, excluding current placements and unsupported rows",
  );
});

test("Process Map accepts only exact manual Explorer resources in valid layers", () => {
  assert.deepEqual(
    decideProcessMapExplorerDrop({ kind: "folder", label: " Finance ", folderID: " folder-1 ", folderKind: "logic_gate" }),
    {
      kind: "place",
      resource: { resource_type: "company_explorer_folder", resource_id: "folder-1" },
      label: "Finance",
      mapParentFolderID: null,
    },
  );
  assert.deepEqual(
    decideProcessMapExplorerDrop({ kind: "logic_gate", label: " Review ", itemID: " gate-1 ", itemType: "logic_gate" }, "folder-1"),
    {
      kind: "place",
      resource: { resource_type: "logic_gate", resource_id: "gate-1" },
      label: "Review",
      mapParentFolderID: "folder-1",
    },
  );
  assert.equal(
    decideProcessMapExplorerDrop({ kind: "logic_gate", label: "Review", itemID: "gate-1", itemType: "logic_gate" }).kind,
    "reject",
  );
  assert.equal(
    decideProcessMapExplorerDrop({ kind: "folder", label: "Finance", folderID: "folder-1", folderKind: "logic_gate" }, "folder-1").kind,
    "reject",
  );
  assert.deepEqual(
    decideProcessMapExplorerDrop({ kind: "project", itemID: "project-1", itemType: "project" }, "folder-1"),
    { kind: "ignore" },
  );
  assert.deepEqual(
    decideProcessMapExplorerDrop({ kind: "batch", items: [{ itemID: "gate-1", itemType: "logic_gate" }] }, "folder-1"),
    { kind: "ignore" },
  );
});

test("single-click selection excludes restricted cards and double-click drill-in is Folder-only", () => {
  assert.equal(
    processMapFolderDrillTarget({ resource_type: "company_explorer_folder", resource_id: "folder-1" }),
    "folder-1",
  );
  assert.equal(processMapFolderDrillTarget({ resource_type: "logic_gate", resource_id: "gate-1" }), null);
  assert.equal(processMapFolderDrillTarget(null), null);
});

test("connections require distinct cards and the fixed output-to-input direction", () => {
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "gate-1", sourceHandle: "output", targetHandle: "input" }), true);
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "folder-1", sourceHandle: "output", targetHandle: "input" }), false);
  assert.equal(isValidProcessMapConnection({ source: "folder-1", target: "gate-1", sourceHandle: "input", targetHandle: "output" }), false);
  assert.equal(isValidProcessMapConnection({ source: null, target: "gate-1", sourceHandle: "output", targetHandle: "input" }), false);
});

test("optimistic saves apply committed revisions in order and only the latest failed save rolls back", () => {
  assert.equal(shouldApplyProcessMapCommit(3, 4), true);
  assert.equal(shouldApplyProcessMapCommit(4, 4), true);
  assert.equal(shouldApplyProcessMapCommit(4, 3), false);
  assert.equal(shouldApplyProcessMapMutationAck(4, 4, 3, 3), true);
  assert.equal(shouldApplyProcessMapMutationAck(4, 5, 3, 3), false, "a canonical refresh supersedes a delayed ACK even if its row revision resets");
  assert.equal(shouldApplyProcessMapMutationAck(4, 4, 2, 3), false, "a newer mixed operation supersedes an older ACK for the same resource");
});
