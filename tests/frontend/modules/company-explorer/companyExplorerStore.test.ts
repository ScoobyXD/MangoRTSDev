import assert from "node:assert/strict";
import {
  createCompanyExplorerStoreState,
  reduceCompanyExplorerStore,
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
  title,
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
  folder_kind: "node" as const,
  name: id,
  position: 1000,
  created_timestamp: id,
  updated_timestamp: id,
});

const folderItem = (folderID: string, itemType: "node" | "logic_gate" | "kanban", itemID: string) => ({
  company_id: "c",
  folder_id: folderID,
  item_type: itemType,
  item_id: itemID,
  position: 1000,
  created_timestamp: itemID,
  updated_timestamp: itemID,
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
      folder_items: [folderItem("folder-a", "node", "node-a")],
    },
  });

  assert.equal(state.folderSnapshotLoaded, true);
  assert.deepEqual(state.nodes.map((item) => item.title), ["Alpha"]);
  assert.deepEqual(state.logicGates.map((item) => [item.logic_gate_id, item.node_id, item.title]), [["gate-a", "gate-a", "Gate A"]]);
  assert.deepEqual(state.folders.map((item) => item.folder_id), ["folder-a"]);
  assert.deepEqual(state.folderItems.map((item) => `${item.item_type}:${item.item_id}`), ["node:node-a"]);
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
    },
  });

  state = reduceCompanyExplorerStore(state, {
    type: "applyWorkspaceEnvelope",
    companyID: "c",
    envelope: { company_id: "c", type: "node_updated", data: { node: node("node-a", "New") } },
  });
  assert.equal(state.nodes[0]?.title, "New");

  state = reduceCompanyExplorerStore(state, {
    type: "applyWorkspaceEnvelope",
    companyID: "c",
    envelope: { company_id: "c", type: "node_deleted", data: { node_id: "node-a" } },
  });
  assert.deepEqual(state.nodes, []);
  assert.deepEqual(state.folderItems.map((item) => `${item.item_type}:${item.item_id}`), ["logic_gate:gate-a"]);

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

run("store event helpers preserve existing refresh contracts", () => {
  assert.equal(shouldRefreshCompanyExplorerSnapshotForGap({ companyID: "c", scopes: [{ kind: "company_explorer" }] }, "c"), true);
  assert.equal(shouldRefreshCompanyExplorerSnapshotForGap({ companyID: "c", scopes: [{ kind: "node_graph" }] }, "c"), false);
  assert.equal(shouldRefreshCompanyExplorerSnapshotForGap({ companyID: "other", scopes: [{ kind: "workspace" }] }, "c"), false);

  assert.equal(shouldRefreshKanbanBoardsAfterUpdate({ companyID: "c", board: board("board-a", 1000) }, "c"), false);
  assert.equal(shouldRefreshKanbanBoardsAfterUpdate(undefined, "c"), true);

  assert.equal(shouldInvalidateKanbanBoardListForExplorerEnvelope("c", { company_id: "c", type: "kanban_board_updated" }), true);
  assert.equal(shouldInvalidateKanbanBoardListForExplorerEnvelope("c", { company_id: "c", type: "node_updated" }), false);
});
