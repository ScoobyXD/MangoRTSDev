import assert from "node:assert/strict";
import {
  applyCompanyExplorerSearchTitleUpdate,
  companyExplorerBranchHasMaterializedRows,
  createCompanyExplorerStoreState,
  reduceCompanyExplorerStore,
  shouldLoadCompanyExplorerBranchChildren,
  shouldRefreshKanbanBoardsAfterUpdate,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerStore.js";
import {
  type CompanyExplorerEntityTitleUpdate,
  publishCompanyExplorerEntityTitleUpdate,
  subscribeCompanyExplorerEntityTitleUpdates,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerLocalEntityUpdates.js";

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
    type: "applyKanbanBoardsUpdated",
    companyID: "c",
    detail: { companyID: "c", deletedBoardID: "board-b" },
  });
  assert.deepEqual(state.kanbanBoards.map((item) => item.board_id), ["board-a", "board-c"]);
  assert.deepEqual(state.folderItems, []);
  assert.equal(shouldRefreshKanbanBoardsAfterUpdate({ companyID: "c", board: board("board-a", 1000) }, "c"), false);
  assert.equal(shouldRefreshKanbanBoardsAfterUpdate(undefined, "c"), true);
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

run("committed editor titles patch mounted explorer records and every materialized V2 placement", () => {
  let state = createCompanyExplorerStoreState();
  state = reduceCompanyExplorerStore(state, {
    type: "mergeSnapshot",
    snapshot: {
      nodes: [node("node-a", "Old node")],
      logic_gates: [logicGate("gate-a", "Old gate")],
      rows: [
        { ...v2Row({ entityID: "gate-entity", entityType: "logic_gate", resourceID: "gate-a", parentEntityID: "folder-a", edgeID: "edge-a" }), name: "Old gate" },
        { ...v2Row({ entityID: "gate-entity", entityType: "logic_gate", resourceID: "gate-a", parentEntityID: "folder-b", edgeID: "edge-b" }), name: "Old gate" },
      ],
    },
  });

  state = reduceCompanyExplorerStore(state, {
    type: "applyEntityTitleUpdate",
    update: { companyID: "c", entityType: "node", resourceID: "node-a", title: "Renamed node" },
  });
  state = reduceCompanyExplorerStore(state, {
    type: "applyEntityTitleUpdate",
    update: { companyID: "c", entityType: "logic_gate", resourceID: "gate-a", title: "Renamed gate" },
  });

  assert.equal(state.nodes[0]?.name, "Renamed node");
  assert.equal(state.logicGates[0]?.header, "Renamed gate");
  assert.equal(state.logicGates[0]?.title, "Renamed gate");
  assert.deepEqual(state.rows.map((row) => row.name), ["Renamed gate", "Renamed gate"]);
});

run("committed editor titles patch active explorer search labels and use a concrete local event", () => {
  const update = { companyID: "c", entityType: "logic_gate" as const, resourceID: "gate-a", title: "Renamed gate" };
  const results = applyCompanyExplorerSearchTitleUpdate([{
    company_id: "c",
    resource_type: "logic_gate",
    resource_id: "gate-a",
    entity_id: "gate-entity",
    display_name: "Old gate",
    match_reason: "name",
    location_path: [{ entity_type: "logic_gate", entity_id: "gate-entity", resource_id: "gate-a", name: "Old gate" }],
    created_timestamp: "1",
    updated_timestamp: "1",
  }], update);
  assert.equal(results[0]?.display_name, "Renamed gate");
  assert.equal(results[0]?.location_path[0]?.name, "Renamed gate");

  const target = new EventTarget();
  let received: CompanyExplorerEntityTitleUpdate | null = null;
  const unsubscribe = subscribeCompanyExplorerEntityTitleUpdates((detail) => { received = detail; }, target);
  publishCompanyExplorerEntityTitleUpdate(update, target);
  assert.deepEqual(received, update);
  unsubscribe();
  received = null;
  publishCompanyExplorerEntityTitleUpdate(update, target);
  assert.equal(received, null);
});
