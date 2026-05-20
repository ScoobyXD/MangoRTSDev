import test from "node:test";
import assert from "node:assert/strict";
import type { UserLogicGateShortcut } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";
import type { LogicGateAssignmentCommandResult } from "../../../../frontend/src/modules/kanban/kanbanApi.js";
import type { KanbanBoard, KanbanCard } from "../../../../frontend/src/modules/kanban/shared.js";
import type { NodeRecord } from "../../../../frontend/src/modules/node-map/shared.js";
import { addMyLogicGateShortcutsCommand, applyBulkNodePatchCommand, convertMessagesToLogicGateCommand, dropNodesIntoInboxLogicGateCommand, removeMyLogicGateShortcutCommand, type HomeAddMyLogicGateShortcuts, type HomeBulkMoveLogicGateAssignment, type HomeBulkNodePatch, type HomeBulkUpdateNode, type HomeConvertTriageMessagesToLogicGate, type HomeDropAssignNodeToLogicGateStatus, type HomeRemoveMyLogicGateShortcut } from "../../../../frontend/src/pages/home/homeCommands.js";

const timestamp = "2026-01-01T00:00:00Z";

function node(id: string, overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    company_id: "company-1",
    node_id: id,
    title: `Node ${id}`,
    created_timestamp: timestamp,
    ...overrides,
  };
}

function card(input: { nodeID: string; boardID?: string; columnID?: string }): KanbanCard {
  return {
    company_id: "company-1",
    board_id: input.boardID ?? "logic-gate:gate-1",
    card_id: `card-${input.nodeID}`,
    column_id: input.columnID ?? "column-in-progress",
    node_id: input.nodeID,
    node_title: `Node ${input.nodeID}`,
    description_snapshot: "",
    is_issue: false,
    position: 1000,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
  };
}

function board(id = "logic-gate:gate-1", logicGateID = "gate-1"): KanbanBoard {
  return {
    company_id: "company-1",
    board_id: id,
    logic_gate_id: logicGateID,
    title: "Gate 1",
    position: 1000,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
  };
}

function shortcut(logicGateID: string, position = 1000): UserLogicGateShortcut {
  return {
    user_id: "user-1",
    company_id: "company-1",
    logic_gate_id: logicGateID,
    position,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
  };
}

function explorerFolder(id: string, parentFolderID?: string): CompanyExplorerFolder {
  return {
    company_id: "company-1",
    folder_id: id,
    parent_folder_id: parentFolderID,
    folder_kind: "logic_gate",
    name: id,
    position: 1000,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
  };
}

function explorerFolderItem(folderID: string, itemID: string, itemType: "node" | "logic_gate" = "logic_gate"): CompanyExplorerFolderItem {
  return {
    company_id: "company-1",
    folder_id: folderID,
    item_type: itemType,
    item_id: itemID,
    position: 1000,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
  };
}
test("Home node drop uses one work-item assignment command for status and priority placement", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { title: "Launch checklist", status: "pending" })],
  ]);
  const calls: Array<Parameters<HomeDropAssignNodeToLogicGateStatus>[0]> = [];
  const invalidatedBoards: string[] = [];
  const assignNodeToLogicGateStatus: HomeDropAssignNodeToLogicGateStatus = async (input) => {
    calls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    const updatedNode = { ...sourceNode, status: "In Progress", priority: input.priority } as NodeRecord;
    return { card: card({ nodeID: input.nodeID }), node: updatedNode } satisfies LogicGateAssignmentCommandResult;
  };

  const updated = await dropNodesIntoInboxLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: " gate-1 ",
    nodeIDs: ["node-1"],
    priority: 2,
    status: "in_progress",
    nodeByID: nodes,
    assignNodeToLogicGateStatus,
    invalidateKanbanBoardContents: (_apiBase, _companyID, boardID) => invalidatedBoards.push(boardID),
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "gate-1",
    nodeID: "node-1",
    status: "in_progress",
    priority: 2,
    nodeTitle: "Launch checklist",
    position: 0,
  });
  assert.deepEqual(updated.map((item) => [item.node_id, item.status, item.priority]), [["node-1", "In Progress", 2]]);
  assert.deepEqual(invalidatedBoards, ["logic-gate:gate-1"]);
});

test("Home node drop dedupes selected nodes and falls back to each node status", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { status: "Done" })],
    ["node-2", node("node-2", { status: null })],
  ]);
  const statuses: string[] = [];
  const priorities: Array<number | null | undefined> = [];
  const assignNodeToLogicGateStatus: HomeDropAssignNodeToLogicGateStatus = async (input) => {
    statuses.push(input.status ?? "");
    priorities.push(input.priority);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return { card: card({ nodeID: input.nodeID }), node: { ...sourceNode, status: input.status } as NodeRecord };
  };

  const updated = await dropNodesIntoInboxLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "gate-1",
    nodeIDs: ["node-1", "missing", "node-1", "node-2"],
    priority: 0,
    nodeByID: nodes,
    assignNodeToLogicGateStatus,
  });

  assert.deepEqual(updated.map((item) => item.node_id), ["node-1", "node-2"]);
  assert.deepEqual(statuses, ["done", "pending"]);
  assert.deepEqual(priorities, [null, null]);
});
test("Home bulk node priority placement uses the work-item move command", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { status: "Pending", priority: 5, logic_gate_ids: ["gate-1"] })],
  ]);
  const moveCalls: Array<Parameters<HomeBulkMoveLogicGateAssignment>[0]> = [];
  const updateCalls: Array<{ companyID: string; nodeID: string; patch: HomeBulkNodePatch }> = [];
  const invalidatedBoards: string[] = [];
  const moveLogicGateAssignment: HomeBulkMoveLogicGateAssignment = async (input) => {
    moveCalls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return {
      card: card({ nodeID: input.nodeID, boardID: "logic-gate:gate-1", columnID: "pending-column" }),
      node: { ...sourceNode, priority: input.priority ?? null } as NodeRecord,
    } satisfies LogicGateAssignmentCommandResult;
  };
  const updateNode: HomeBulkUpdateNode = async (companyID, nodeID, patch) => {
    updateCalls.push({ companyID, nodeID, patch });
    return { ...(nodes.get(nodeID) ?? node(nodeID)), ...patch } as NodeRecord;
  };

  const updated = await applyBulkNodePatchCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    nodeIDs: ["node-1"],
    patch: { priority: 2 },
    nodeByID: nodes,
    moveLogicGateAssignment,
    updateNode,
    invalidateKanbanBoardContents: (_apiBase, _companyID, boardID) => invalidatedBoards.push(boardID),
  });

  assert.equal(moveCalls.length, 1);
  assert.deepEqual(moveCalls[0], {
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "gate-1",
    nodeID: "node-1",
    status: undefined,
    position: 0,
    priority: 2,
  });
  assert.deepEqual(updateCalls, []);
  assert.deepEqual(updated.map((item) => [item.node_id, item.priority]), [["node-1", 2]]);
  assert.deepEqual(invalidatedBoards, ["logic-gate:gate-1"]);
});

test("Home bulk node patch keeps non-placement fields on the node update endpoint", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { status: "Pending", priority: 5, logic_gate_ids: ["gate-1"] })],
  ]);
  const moveCalls: Array<Parameters<HomeBulkMoveLogicGateAssignment>[0]> = [];
  const updateCalls: Array<{ companyID: string; nodeID: string; patch: HomeBulkNodePatch }> = [];
  const moveLogicGateAssignment: HomeBulkMoveLogicGateAssignment = async (input) => {
    moveCalls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return {
      card: card({ nodeID: input.nodeID, boardID: "logic-gate:gate-1", columnID: "done-column" }),
      node: { ...sourceNode, status: "Done", priority: input.priority ?? sourceNode.priority } as NodeRecord,
    } satisfies LogicGateAssignmentCommandResult;
  };
  const updateNode: HomeBulkUpdateNode = async (companyID, nodeID, patch) => {
    updateCalls.push({ companyID, nodeID, patch });
    return { ...(nodes.get(nodeID) ?? node(nodeID)), ...patch } as NodeRecord;
  };

  await applyBulkNodePatchCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    nodeIDs: ["node-1"],
    patch: { status: "done", priority: null, due_date: "2026-05-20" },
    nodeByID: nodes,
    moveLogicGateAssignment,
    updateNode,
  });

  assert.equal(moveCalls.length, 1);
  assert.equal(moveCalls[0]?.status, "done");
  assert.equal(moveCalls[0]?.priority, null);
  assert.deepEqual(updateCalls, [{ companyID: "company-1", nodeID: "node-1", patch: { due_date: "2026-05-20" } }]);
});
test("Home My Logic Gate shortcut add resolves explorer payloads before saving", async () => {
  const calls: Array<{ companyID: string; logicGateIDs: string[] }> = [];
  const addMyLogicGateShortcuts: HomeAddMyLogicGateShortcuts = async (companyID, logicGateIDs) => {
    calls.push({ companyID, logicGateIDs });
    return logicGateIDs.map((logicGateID, index) => shortcut(logicGateID, (index + 1) * 1000));
  };

  const result = await addMyLogicGateShortcutsCommand({
    companyID: "company-1",
    payload: { kind: "folder", folderKind: "logic_gate", folderID: "folder-root" },
    folders: [explorerFolder("folder-root"), explorerFolder("folder-child", "folder-root")],
    folderItems: [
      explorerFolderItem("folder-root", "gate-a"),
      explorerFolderItem("folder-child", "gate-b"),
      explorerFolderItem("folder-child", "node-ignored", "node"),
    ],
    addMyLogicGateShortcuts,
  });

  assert.deepEqual(calls, [{ companyID: "company-1", logicGateIDs: ["gate-a", "gate-b"] }]);
  assert.deepEqual(result?.logicGateIDs, ["gate-a", "gate-b"]);
  assert.deepEqual(result?.shortcuts.map((item) => [item.logic_gate_id, item.position]), [["gate-a", 1000], ["gate-b", 2000]]);
});

test("Home My Logic Gate shortcut remove trims ids and skips empty input", async () => {
  const calls: Array<{ companyID: string; logicGateID: string }> = [];
  const removeMyLogicGateShortcut: HomeRemoveMyLogicGateShortcut = async (companyID, logicGateID) => {
    calls.push({ companyID, logicGateID });
  };

  assert.equal(await removeMyLogicGateShortcutCommand({ companyID: "company-1", logicGateID: "   ", removeMyLogicGateShortcut }), "");
  assert.equal(await removeMyLogicGateShortcutCommand({ companyID: "company-1", logicGateID: " gate-a ", removeMyLogicGateShortcut }), "gate-a");
  assert.deepEqual(calls, [{ companyID: "company-1", logicGateID: "gate-a" }]);
});

test("Home triage conversion command owns cache, event, and graph side effects", async () => {
  const convertCalls: Array<Parameters<HomeConvertTriageMessagesToLogicGate>[0]> = [];
  const folderItem = explorerFolderItem("folder-nodes", "node-1", "node");
  const convertedNode = node("node-1", { logic_gate_ids: ["gate-1"] });
  const convertTriageMessagesToLogicGate: HomeConvertTriageMessagesToLogicGate = async (input) => {
    convertCalls.push(input);
    return {
      board: board("logic-gate:gate-1", "gate-1"),
      cards: [card({ nodeID: "node-1" })],
      nodes: [convertedNode],
      folder_items: [folderItem],
      deleted_message_ids: ["message-1"],
    };
  };
  const invalidatedBoardLists: string[] = [];
  const invalidatedBoardContents: string[] = [];
  const invalidatedArenaViews: string[] = [];
  const boardEvents: unknown[] = [];
  const boardContentEvents: unknown[] = [];
  const invalidatedNodes: string[] = [];
  const upsertedNodes: string[] = [];
  const nodeFolderItems: string[] = [];
  const logicGateFolderItems: string[] = [];
  const communicationScopes: unknown[] = [];

  const result = await convertMessagesToLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: " gate-1 ",
    messageIDs: [" message-1 ", "message-2", "message-1"],
    convertTriageMessagesToLogicGate,
    invalidateKanbanBoardList: (_apiBase, companyID) => invalidatedBoardLists.push(companyID),
    invalidateKanbanBoardContents: (_apiBase, _companyID, boardID) => invalidatedBoardContents.push(boardID),
    invalidateLogicGateArenaView: (_apiBase, _companyID, logicGateID) => invalidatedArenaViews.push(logicGateID ?? ""),
    dispatchKanbanBoardsUpdated: (detail) => boardEvents.push(detail),
    dispatchKanbanBoardContentsUpdated: (detail) => boardContentEvents.push(detail),
    invalidateNodeRecord: (_apiBase, _companyID, nodeID) => invalidatedNodes.push(nodeID),
    upsertNodeRelationshipGraphNode: (_apiBase, _companyID, node) => upsertedNodes.push(node.node_id),
    upsertNodeFolderItemInRelationshipGraph: (_apiBase, _companyID, item) => nodeFolderItems.push(item.item_id),
    upsertLogicGateFolderItemInRelationshipGraph: (_apiBase, _companyID, item) => logicGateFolderItems.push(item.item_id),
    invalidateCommunications: (scope) => communicationScopes.push(scope),
  });

  assert.deepEqual(convertCalls, [{ companyID: "company-1", logicGateID: "gate-1", messageIDs: ["message-1", "message-2"] }]);
  assert.equal(result?.boardID, "logic-gate:gate-1");
  assert.equal(result?.logicGateID, "gate-1");
  assert.deepEqual(result?.convertedMessageIDs, ["message-1"]);
  assert.deepEqual(invalidatedBoardLists, ["company-1"]);
  assert.deepEqual(invalidatedBoardContents, ["logic-gate:gate-1"]);
  assert.deepEqual(invalidatedArenaViews, ["gate-1"]);
  assert.deepEqual(boardEvents, [{ companyID: "company-1", board: board("logic-gate:gate-1", "gate-1") }]);
  assert.deepEqual(boardContentEvents, [{ companyID: "company-1", boardID: "logic-gate:gate-1", logicGateID: "gate-1" }]);
  assert.deepEqual(invalidatedNodes, ["node-1"]);
  assert.deepEqual(upsertedNodes, ["node-1"]);
  assert.deepEqual(nodeFolderItems, ["node-1"]);
  assert.deepEqual(logicGateFolderItems, ["node-1"]);
  assert.deepEqual(communicationScopes, [{ messagePages: true, messages: true }]);
});
