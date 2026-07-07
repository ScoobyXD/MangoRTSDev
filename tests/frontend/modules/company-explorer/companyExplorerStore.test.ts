import assert from "node:assert/strict";
import {
  companyExplorerAffectedScopesFromEnvelope,
  companyExplorerRefreshPlanFromAffectedScopes,
  companyExplorerBranchHasMaterializedRows,
  createCompanyExplorerStoreState,
  reduceCompanyExplorerStore,
  shouldLoadCompanyExplorerBranchChildren,
  shouldInvalidateKanbanBoardListForExplorerEnvelope,
  shouldRefreshCompanyExplorerSnapshotForGap,
  shouldRefreshKanbanBoardsAfterUpdate,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerStore.js";

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const node = (id: string, title = id) => ({
  company_id: "c",
  node_id: id,
  name: title,
  created_timestamp: id,
});

const logicGate = (id: string, header = id) => ({
  company_id: "c",
  logic_gate_id: id,
  header,
  created_timestamp: id,
});

const board = (id: string, position: number, created = id) => ({
  company_id: "c",
  board_id: id,
  title: id,
  position,
  created_timestamp: created,
  updated_timestamp: created,
});

const folder = (id: string, parent = "") => ({
  company_id: "c",
  folder_id: id,
  parent_folder_id: parent,
  folder_kind: "logic_gate" as const,
  name: id,
  position: 1000,
  created_timestamp: id,
  updated_timestamp: id,
});

const folderItem = (folderID: string, itemType: "node" | "logic_gate" | "project" | "kanban", itemID: string) => ({
  company_id: "c",
  folder_id: folderID,
  item_type: itemType,
  item_id: itemID,
  position: 1000,
  created_timestamp: itemID,
  updated_timestamp: itemID,
});

const v2Row = (input: {
  entityID: string;
  entityType: "company" | "folder" | "project" | "logic_gate" | "node";
  resourceID?: string;
  parentEntityID?: string;
  edgeID?: string;
}) => ({
  company_id: "c",
  entity_id: input.entityID,
  entity_type: input.entityType,
  resource_id: input.resourceID ?? input.entityID,
  name: input.entityID,
  parent_entity_id: input.parentEntityID ?? "",
  edge_id: input.edgeID,
  position: 1000,
  has_children: false,
  created_timestamp: input.entityID,
  updated_timestamp: input.entityID,
});

run("snapshot reducer replaces explorer snapshot and preserves board list", () => {
  let state = createCompanyExplorerStoreState();
  state = reduceCompanyExplorerStore(state, { type: "setKanbanBoards", boards: [board("board-a", 1000)] });
  state = reduceCompanyExplorerStore(state, {
    type: "applySnapshot",
    snapshot: {
      nodes: [node("node-a", "Alpha")],
      logic_gates: [logicGate("gate-a", "Gate A")],
      folders: [folder("folder-a")],
      folder_items: [folderItem("folder-a", "node", "node-a"), folderItem("folder-a", "logic_gate", "gate-a")],
      rows: [v2Row({ entityID: "node-entity", entityType: "node", resourceID: "node-a", parentEntityID: "folder-a", edgeID: "edge-node-a" })],
    },
  });

  assert.equal(state.folderSnapshotLoaded, true);
  assert.deepEqual(state.nodes.map((item) => item.name), ["Alpha"]);
  assert.deepEqual(state.logicGates.map((item) => [item.logic_gate_id, item.node_id, item.title]), [["gate-a", "gate-a", "Gate A"]]);
  assert.deepEqual(state.folders.map((item) => item.folder_id), ["folder-a"]);
  assert.deepEqual(state.folderItems.map((item) => `${item.item_type}:${item.item_id}`), ["logic_gate:gate-a"]);
  assert.deepEqual(state.rows.map((row) => `${row.entity_type}:${row.resource_id}:${row.edge_id ?? ""}`), []);
  assert.deepEqual(state.kanbanBoards.map((item) => item.board_id), ["board-a"]);
});

run("workspace stream reducer upserts and removes explorer entities", () => {
  let state = reduceCompanyExplorerStore(createCompanyExplorerStoreState(), {
    type: "applySnapshot",
    snapshot: {
      nodes: [node("node-a", "Old")],
      logic_gates: [logicGate("gate-a", "Gate A")],
      folders: [folder("parent"), folder("child", "parent")],
      folder_items: [
        folderItem("child", "node", "node-a"),
        folderItem("child", "logic_gate", "gate-a"),
      ],
      rows: [v2Row({ entityID: "node-entity", entityType: "node", resourceID: "node-a", parentEntityID: "child", edgeID: "edge-node-a" })],
    },
  });

  state = reduceCompanyExplorerStore(state, {
    type: "applyWorkspaceEnvelope",
    companyID: "c",
    envelope: { company_id: "c", type: "node_updated", data: { node: node("node-a", "New") } },
  });
  assert.equal(state.nodes[0]?.name, "Old");
  assert.deepEqual(state.rows, []);

  state = reduceCompanyExplorerStore(state, {
    type: "applyWorkspaceEnvelope",
    companyID: "c",
    envelope: { company_id: "c", type: "node_deleted", data: { node_id: "node-a" } },
  });
  assert.deepEqual(state.nodes.map((item) => item.name), ["Old"]);
  assert.deepEqual(state.folderItems.map((item) => `${item.item_type}:${item.item_id}`), ["logic_gate:gate-a"]);
  assert.deepEqual(state.rows, []);

  state = reduceCompanyExplorerStore(state, {
    type: "applyWorkspaceEnvelope",
    companyID: "c",
    envelope: { company_id: "c", type: "company_explorer_folder_deleted", data: { folder_id: "parent" } },
  });
  assert.deepEqual(state.folders, []);
  assert.deepEqual(state.folderItems, []);
});

run("kanban board reducer keeps sorted boards and removes explorer placement", () => {
  let state = reduceCompanyExplorerStore(createCompanyExplorerStoreState(), {
    type: "setKanbanBoards",
    boards: [board("board-b", 2000), board("board-a", 1000)],
  });
  state = reduceCompanyExplorerStore(state, {
    type: "upsertFolderItems",
    folderItems: [folderItem("folder-a", "kanban", "board-b")],
  });
  state = reduceCompanyExplorerStore(state, {
    type: "applyKanbanBoardsUpdated",
    companyID: "c",
    detail: { companyID: "c", board: board("board-c", 1500) },
  });
  assert.deepEqual(state.kanbanBoards.map((item) => item.board_id), ["board-a", "board-c", "board-b"]);

  state = reduceCompanyExplorerStore(state, {
    type: "applyWorkspaceEnvelope",
    companyID: "c",
    envelope: { company_id: "c", type: "kanban_board_deleted", data: { board_id: "board-b" } },
  });
  assert.deepEqual(state.kanbanBoards.map((item) => item.board_id), ["board-a", "board-c"]);
  assert.deepEqual(state.folderItems, []);
});

run("v2 row reducer preserves manual and native parent contexts", () => {
  let state = createCompanyExplorerStoreState();
  state = reduceCompanyExplorerStore(state, {
    type: "upsertV2Rows",
    rows: [
      {
        company_id: "c",
        entity_id: "gate-entity",
        entity_type: "logic_gate",
        resource_id: "gate-a",
        name: "Gate A",
        parent_entity_id: "folder-entity",
        edge_id: "edge-gate-folder",
        position: 1000,
        has_children: false,
        created_timestamp: "1",
        updated_timestamp: "1",
      },
      {
        company_id: "c",
        entity_id: "gate-entity",
        entity_type: "logic_gate",
        resource_id: "gate-a",
        name: "Gate A",
        parent_entity_id: "project-entity",
        position: 1000,
        has_children: false,
        created_timestamp: "2",
        updated_timestamp: "2",
      },
    ],
  });

  assert.equal(state.rows.length, 2);
  assert.deepEqual(state.rows.map((row) => `${row.parent_entity_id}:${row.edge_id ?? ""}`), [
    "folder-entity:edge-gate-folder",
    "project-entity:",
  ]);

  state = reduceCompanyExplorerStore(state, {
    type: "upsertV2Rows",
    rows: [
      {
        company_id: "c",
        entity_id: "gate-entity",
        entity_type: "logic_gate",
        resource_id: "gate-a",
        name: "Gate A Updated",
        parent_entity_id: "folder-entity",
        edge_id: "edge-gate-folder",
        position: 500,
        has_children: false,
        created_timestamp: "1",
        updated_timestamp: "3",
      },
    ],
  });

  assert.equal(state.rows.length, 2);
  assert.equal(state.rows.find((row) => row.edge_id === "edge-gate-folder")?.name, "Gate A Updated");
  assert.equal(state.rows.find((row) => row.parent_entity_id === "project-entity")?.name, "Gate A");
});

run("v2 folder row reducer replaces the previous parent placement after a move", () => {
  let state = createCompanyExplorerStoreState();
  state = reduceCompanyExplorerStore(state, {
    type: "upsertV2Rows",
    rows: [
      v2Row({ entityID: "folder-child", entityType: "folder", parentEntityID: "folder-parent" }),
    ],
  });

  state = reduceCompanyExplorerStore(state, {
    type: "applyWorkspaceEnvelope",
    companyID: "c",
    envelope: {
      company_id: "c",
      type: "company_explorer_folder_updated",
      data: {
        parent_entity_id: "",
        entity: v2Row({ entityID: "folder-child", entityType: "folder", parentEntityID: "" }),
      },
    },
  });

  assert.equal(state.rows.length, 1);
  assert.deepEqual(state.rows.map((row) => `${row.parent_entity_id ?? ""}:${row.entity_id}`), [":folder-child"]);
});

run("affected scope helpers plan only matching Company Explorer branch refreshes", () => {
  const affectedScopes = companyExplorerAffectedScopesFromEnvelope({
    company_id: "c",
    type: "node_updated",
    data: {
      affected_scopes: [
        "updates:user:user-1",
        "company_explorer:root:c",
        "company_explorer:folder:folder-entity",
        "company_explorer:node:node-a",
        "company_explorer:node:node-a",
      ],
    },
  });
  assert.deepEqual(affectedScopes, [
    "updates:user:user-1",
    "company_explorer:root:c",
    "company_explorer:folder:folder-entity",
    "company_explorer:node:node-a",
  ]);

  const plan = companyExplorerRefreshPlanFromAffectedScopes({
    companyID: "c",
    affectedScopes,
    rows: [
      v2Row({ entityID: "root-entity", entityType: "company", resourceID: "c" }),
      v2Row({ entityID: "folder-entity", entityType: "folder", parentEntityID: "root-entity", edgeID: "edge-folder-root" }),
      v2Row({ entityID: "node-entity", entityType: "node", resourceID: "node-a", parentEntityID: "folder-entity", edgeID: "edge-node-folder" }),
      v2Row({ entityID: "node-entity", entityType: "node", resourceID: "node-a", parentEntityID: "project-entity" }),
    ],
  });

  assert.equal(plan.hasAffectedScopes, true);
  assert.equal(plan.hasCompanyExplorerScopes, true);
  assert.equal(plan.refreshRoot, true);
  assert.deepEqual(plan.parentEntityIDs.sort(), ["folder-entity", "root-entity"].sort());
});

run("affected scope helpers ignore non-Explorer semantic scopes", () => {
  const plan = companyExplorerRefreshPlanFromAffectedScopes({
    companyID: "c",
    affectedScopes: ["my_work:user:user-1", "updates:user:user-1"],
    rows: [v2Row({ entityID: "node-entity", entityType: "node", resourceID: "node-a", parentEntityID: "folder-entity" })],
  });

  assert.equal(plan.hasAffectedScopes, true);
  assert.equal(plan.hasCompanyExplorerScopes, false);
  assert.equal(plan.refreshRoot, false);
  assert.deepEqual(plan.parentEntityIDs, []);
});

run("loaded branch guard refetches when child rows are no longer materialized", () => {
  const rows = [
    v2Row({ entityID: "folder-entity", entityType: "folder", parentEntityID: "root-entity" }),
    v2Row({ entityID: "gate-entity", entityType: "logic_gate", resourceID: "gate-a", parentEntityID: "folder-entity", edgeID: "edge-gate-a" }),
  ];

  assert.equal(companyExplorerBranchHasMaterializedRows(rows, "folder-entity"), true);
  assert.equal(shouldLoadCompanyExplorerBranchChildren({
    parentEntityID: "folder-entity",
    rows,
    branchLoaded: true,
    branchStale: false,
    branchInflight: false,
  }), false);

  assert.equal(shouldLoadCompanyExplorerBranchChildren({
    parentEntityID: "folder-entity",
    rows: rows.filter((row) => row.parent_entity_id !== "folder-entity"),
    branchLoaded: true,
    branchStale: false,
    branchInflight: false,
  }), true);

  assert.equal(shouldLoadCompanyExplorerBranchChildren({
    parentEntityID: "folder-entity",
    rows,
    branchLoaded: true,
    branchStale: true,
    branchInflight: false,
  }), true);

  assert.equal(shouldLoadCompanyExplorerBranchChildren({
    parentEntityID: "folder-entity",
    rows: [],
    branchLoaded: true,
    branchStale: false,
    branchInflight: true,
  }), false);
});

run("store event helpers preserve existing refresh contracts", () => {
  assert.equal(shouldRefreshCompanyExplorerSnapshotForGap({ companyID: "c", scopes: [{ kind: "company_explorer" }] }, "c"), true);
  assert.equal(shouldRefreshCompanyExplorerSnapshotForGap({ companyID: "c", scopes: [{ kind: "node_graph" }] }, "c"), false);
  assert.equal(shouldRefreshCompanyExplorerSnapshotForGap({ companyID: "other", scopes: [{ kind: "workspace" }] }, "c"), false);

  assert.equal(shouldRefreshKanbanBoardsAfterUpdate({ companyID: "c", board: board("board-a", 1000) }, "c"), false);
  assert.equal(shouldRefreshKanbanBoardsAfterUpdate(undefined, "c"), true);

  assert.equal(shouldInvalidateKanbanBoardListForExplorerEnvelope("c", { company_id: "c", type: "kanban_board_updated" }), true);
  assert.equal(shouldInvalidateKanbanBoardListForExplorerEnvelope("c", { company_id: "c", type: "node_updated" }), false);
});
