import test from "node:test";
import assert from "node:assert/strict";
import type { CompanyUser, CommunicationsSharedInbox, CommunicationsSharedInboxRaciAssignment, CommunicationsSharedInboxRaciRole, EmailMessage, SendEmailInput, UserLogicGateShortcut } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";
import type { LogicGateAssignmentCommandResult, RacioMatrixProjectionRow } from "../../../../frontend/src/modules/kanban/kanbanApi.js";
import type { KanbanBoard, KanbanCard } from "../../../../frontend/src/modules/kanban/shared.js";
import type { NodeRecord } from "../../../../frontend/src/modules/node-map/shared.js";
import { INBOX_NO_LOGIC_GATE_ID } from "../../../../frontend/src/pages/home/homeConstants.js";
import { addMyLogicGateShortcutsCommand, addSharedInboxRaciSubjectCommand, applyBulkNodePatchCommand, archiveHomeMailMessagesCommand, convertMessagesToLogicGateCommand, createHomeLogicGateCommand, createHomeRacioMatrixNodeCommand, createSharedInboxCommand, deleteHomeMailMessagesCommand, deleteSharedInboxCommand, dropNodesIntoInboxLogicGateCommand, moveSharedInboxCommand, removeMyLogicGateShortcutCommand, removeSharedInboxRaciSubjectCommand, renameSharedInboxCommand, sendHomeMailComposeCommand, unarchiveHomeMailMessagesCommand, updateHomeMailMessageCommand, updateSharedInboxAccountEmailCommand, type HomeAddMyLogicGateShortcuts, type HomeArchiveEmailMessage, type HomeArchiveEmailMessagesBatch, type HomeBulkMoveLogicGateAssignment, type HomeBulkNodePatch, type HomeBulkUpdateNode, type HomeConvertTriageMessagesToLogicGate, type HomeCreateRacioMatrixNode, type HomeCreateSharedInbox, type HomeDeleteEmailMessage, type HomeDeleteSharedInbox, type HomeDropAssignNodeToLogicGateStatus, type HomeRemoveMyLogicGateShortcut, type HomeSendEmail, type HomeUnarchiveEmailMessage, type HomeUpdateEmailMessage, type HomeUpdateSharedInbox, type HomeUpdateSharedInboxRaciAssignments } from "../../../../frontend/src/pages/home/homeCommands.js";

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

function projectionRow(resourceID: string, overrides: Partial<RacioMatrixProjectionRow> = {}): RacioMatrixProjectionRow {
  return {
    company_id: "company-1",
    user_id: "user-1",
    resource_type: "node",
    resource_id: resourceID,
    display_title: `Node ${resourceID}`,
    resource_created_timestamp: timestamp,
    updated_timestamp: timestamp,
    ...overrides,
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

function emailMessage(id: string, overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    subject: `Subject ${id}`,
    unread: true,
    starred: false,
    ...overrides,
  };
}

function sharedInbox(id: string, overrides: Partial<CommunicationsSharedInbox> = {}): CommunicationsSharedInbox {
  return {
    company_id: "company-1",
    folder_id: id,
    folder_kind: "communications",
    name: id,
    position: 1000,
    created_timestamp: timestamp,
    updated_timestamp: timestamp,
    ...overrides,
  };
}

function sharedRaci(folderID: string, role: CommunicationsSharedInboxRaciRole, userID: string): CommunicationsSharedInboxRaciAssignment {
  return {
    company_id: "company-1",
    folder_id: folderID,
    role,
    user_id: userID,
    created_timestamp: timestamp,
  };
}

function companyUser(userID: string): CompanyUser {
  return {
    company_id: "company-1",
    user_id: userID,
    email: `${userID}@example.test`,
    display_name: `User ${userID}`,
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
    return { card: card({ nodeID: input.nodeID }), node: updatedNode, gvic_projection_rows: [projectionRow(input.nodeID)] } satisfies LogicGateAssignmentCommandResult;
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
  assert.deepEqual(updated.nodes.map((item) => [item.node_id, item.status, item.priority]), [["node-1", "In Progress", 2]]);
  assert.deepEqual(updated.gvic_projection_rows.map((row) => row.resource_id), ["node-1"]);
  assert.deepEqual(invalidatedBoards, ["logic-gate:gate-1"]);
});

test("Home matrix node drop moves into a different Logic Gate with the move command", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { title: "Cross gate node", status: "pending", logic_gate_ids: ["source-gate"] })],
  ]);
  const assignCalls: Array<Parameters<HomeDropAssignNodeToLogicGateStatus>[0]> = [];
  const moveCalls: Array<Parameters<HomeBulkMoveLogicGateAssignment>[0]> = [];
  const invalidatedBoards: string[] = [];
  const assignNodeToLogicGateStatus: HomeDropAssignNodeToLogicGateStatus = async (input) => {
    assignCalls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return {
      card: card({ nodeID: input.nodeID, boardID: "logic-gate:target-gate", columnID: "column-done" }),
      node: { ...sourceNode, status: "Done", priority: input.priority, logic_gate_ids: [input.logicGateID] } as NodeRecord,
      gvic_projection_rows: [projectionRow(input.nodeID)],
    } satisfies LogicGateAssignmentCommandResult;
  };
  const moveLogicGateAssignment: HomeBulkMoveLogicGateAssignment = async (input) => {
    moveCalls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return {
      card: card({ nodeID: input.nodeID, boardID: "logic-gate:target-gate", columnID: "column-done" }),
      node: { ...sourceNode, status: "Done", priority: input.priority, logic_gate_ids: [input.logicGateID] } as NodeRecord,
      gvic_projection_rows: [projectionRow(input.nodeID, { logic_gate_id: input.logicGateID })],
    } satisfies LogicGateAssignmentCommandResult;
  };

  const updated = await dropNodesIntoInboxLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "target-gate",
    fromLogicGateID: "source-gate",
    nodeIDs: ["node-1"],
    priority: 4,
    status: "done",
    nodeByID: nodes,
    assignNodeToLogicGateStatus,
    moveLogicGateAssignment,
    invalidateKanbanBoardContents: (_apiBase, _companyID, boardID) => invalidatedBoards.push(boardID),
  });

  assert.equal(assignCalls.length, 0);
  assert.equal(moveCalls.length, 1);
  assert.deepEqual(moveCalls[0], {
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "target-gate",
    fromLogicGateID: "source-gate",
    nodeID: "node-1",
    status: "done",
    priority: 4,
    position: 0,
  });
  assert.deepEqual(updated.nodes.map((item) => [item.node_id, item.status, item.priority, item.logic_gate_ids]), [["node-1", "Done", 4, ["target-gate"]]]);
  assert.deepEqual(updated.gvic_projection_rows.map((row) => [row.resource_id, row.logic_gate_id]), [["node-1", "target-gate"]]);
  assert.deepEqual(invalidatedBoards, ["logic-gate:target-gate", "logic-gate:source-gate"]);
});

test("Home matrix node drop from the no-Logic-Gate group assigns instead of moving", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { title: "Unplaced node", status: "pending", logic_gate_ids: [] })],
  ]);
  const assignCalls: Array<Parameters<HomeDropAssignNodeToLogicGateStatus>[0]> = [];
  const moveCalls: Array<Parameters<HomeBulkMoveLogicGateAssignment>[0]> = [];
  const assignNodeToLogicGateStatus: HomeDropAssignNodeToLogicGateStatus = async (input) => {
    assignCalls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return {
      card: card({ nodeID: input.nodeID, boardID: "logic-gate:target-gate", columnID: "column-pending" }),
      node: { ...sourceNode, status: "Pending", priority: input.priority, logic_gate_ids: [input.logicGateID] } as NodeRecord,
      gvic_projection_rows: [projectionRow(input.nodeID, { logic_gate_id: input.logicGateID })],
    } satisfies LogicGateAssignmentCommandResult;
  };
  const moveLogicGateAssignment: HomeBulkMoveLogicGateAssignment = async (input) => {
    moveCalls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return { card: card({ nodeID: input.nodeID }), node: sourceNode, gvic_projection_rows: [] } satisfies LogicGateAssignmentCommandResult;
  };

  const updated = await dropNodesIntoInboxLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "target-gate",
    fromLogicGateID: INBOX_NO_LOGIC_GATE_ID,
    nodeIDs: ["node-1"],
    priority: 3,
    status: "pending",
    nodeByID: nodes,
    assignNodeToLogicGateStatus,
    moveLogicGateAssignment,
  });

  assert.equal(moveCalls.length, 0);
  assert.equal(assignCalls.length, 1);
  assert.equal(assignCalls[0].logicGateID, "target-gate");
  assert.deepEqual(updated.nodes.map((item) => item.logic_gate_ids), [["target-gate"]]);
});

test("Home matrix node drop keeps same Logic Gate status moves on the move endpoint", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { title: "Same gate node", status: "pending", logic_gate_ids: ["gate-1"] })],
  ]);
  const assignCalls: Array<Parameters<HomeDropAssignNodeToLogicGateStatus>[0]> = [];
  const moveCalls: Array<Parameters<HomeBulkMoveLogicGateAssignment>[0]> = [];
  const moveLogicGateAssignment: HomeBulkMoveLogicGateAssignment = async (input) => {
    moveCalls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return {
      card: card({ nodeID: input.nodeID, boardID: "logic-gate:gate-1", columnID: "column-review" }),
      node: { ...sourceNode, status: "Review", priority: input.priority } as NodeRecord,
      gvic_projection_rows: [projectionRow(input.nodeID)],
    } satisfies LogicGateAssignmentCommandResult;
  };
  const assignNodeToLogicGateStatus: HomeDropAssignNodeToLogicGateStatus = async (input) => {
    assignCalls.push(input);
    const sourceNode = nodes.get(input.nodeID) ?? node(input.nodeID);
    return { card: card({ nodeID: input.nodeID }), node: sourceNode, gvic_projection_rows: [] } satisfies LogicGateAssignmentCommandResult;
  };

  await dropNodesIntoInboxLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "gate-1",
    fromLogicGateID: "gate-1",
    nodeIDs: ["node-1"],
    priority: 1,
    status: "review",
    nodeByID: nodes,
    assignNodeToLogicGateStatus,
    moveLogicGateAssignment,
  });

  assert.equal(assignCalls.length, 0);
  assert.equal(moveCalls.length, 1);
  assert.deepEqual(moveCalls[0], {
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "gate-1",
    fromLogicGateID: "gate-1",
    nodeID: "node-1",
    status: "review",
    priority: 1,
    position: 0,
  });
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
    return { card: card({ nodeID: input.nodeID }), node: { ...sourceNode, status: input.status } as NodeRecord, gvic_projection_rows: [projectionRow(input.nodeID)] };
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

  assert.deepEqual(updated.nodes.map((item) => item.node_id), ["node-1", "node-2"]);
  assert.deepEqual(updated.gvic_projection_rows.map((row) => row.resource_id), ["node-1", "node-2"]);
  assert.deepEqual(statuses, ["done", "pending"]);
  assert.deepEqual(priorities, [null, null]);
});

test("Home logic gate creation sends creator GVIC role through batch create", async () => {
  const calls: Array<{ apiBase: string; path: string; body: Record<string, unknown> }> = [];
  const result = await createHomeLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    creatorRaciRole: "generated",
    requestJSON: async <T>(_apiBase: string, path: string, init?: RequestInit): Promise<T> => {
      calls.push({
        apiBase: _apiBase,
        path,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return {
        logic_gates: [{
          company_id: "company-1",
          logic_gate_id: "gate-1",
          header: "new logic gate",
          gvic_assignments: [{ company_id: "company-1", logic_gate_id: "gate-1", role: "generated", user_id: "user-1", created_timestamp: timestamp }],
          created_timestamp: timestamp,
        }],
        folder_items: [],
      } as T;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/v1/workspace/entity-batches");
  assert.equal(calls[0].body.creator_logic_gate_gvic_role, "generated");
  assert.equal(result.logicGate.gvic_assignments?.[0]?.role, "generated");
});

test("Home GVIC matrix node create preserves projection rows", async () => {
  const rows = [projectionRow("node-1", { logic_gate_id: "gate-1" })];
  const createRacioMatrixNode: HomeCreateRacioMatrixNode = async () => ({
    node: node("node-1", { logic_gate_ids: ["gate-1"] }),
    folder_items: [explorerFolderItem("folder-1", "node-1", "node")],
    gvic_projection_rows: rows,
  });

  const result = await createHomeRacioMatrixNodeCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    priority: 3,
    status: "pending",
    createRacioMatrixNode,
  });

  assert.deepEqual(result.gvic_projection_rows, rows);
  assert.deepEqual(result.folderItems.map((item) => item.item_id), ["node-1"]);
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
      gvic_projection_rows: [],
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
      gvic_projection_rows: [],
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
    priority: 2,
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

  assert.deepEqual(convertCalls, [{ companyID: "company-1", logicGateID: "gate-1", messageIDs: ["message-1", "message-2"], priority: 2 }]);
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

test("Home mail message commands normalize ids and pass shared inbox context", async () => {
  const calls: Array<{ action: string; companyID: string; messageID: string; sharedInboxID?: string; update?: unknown }> = [];
  const archiveEmailMessage: HomeArchiveEmailMessage = async (messageID, sharedInboxID, companyID) => {
    calls.push({ action: "archive", companyID: companyID ?? "", messageID, sharedInboxID });
    return emailMessage(messageID, { folders: ["archive"] });
  };
  const unarchiveEmailMessage: HomeUnarchiveEmailMessage = async (messageID, sharedInboxID, companyID) => {
    calls.push({ action: "unarchive", companyID: companyID ?? "", messageID, sharedInboxID });
    return emailMessage(messageID, { folders: ["inbox"] });
  };
  const deleteEmailMessage: HomeDeleteEmailMessage = async (messageID, sharedInboxID, companyID) => {
    calls.push({ action: "delete", companyID: companyID ?? "", messageID, sharedInboxID });
  };
  const updateEmailMessage: HomeUpdateEmailMessage = async (messageID, update, sharedInboxID, companyID) => {
    calls.push({ action: "update", companyID: companyID ?? "", messageID, sharedInboxID, update });
    return emailMessage(messageID, { unread: update.unread ?? true, starred: update.starred ?? false });
  };

  await archiveHomeMailMessagesCommand({ companyID: "company-1", sharedInboxID: " shared-1 ", messageIDs: [" message-1 ", "message-2", "message-1"], archiveEmailMessage });
  await unarchiveHomeMailMessagesCommand({ companyID: "company-1", sharedInboxID: "shared-1", messageIDs: ["message-3"], unarchiveEmailMessage });
  await deleteHomeMailMessagesCommand({ companyID: "company-1", sharedInboxID: "shared-1", messageIDs: ["message-4"], deleteEmailMessage });
  const updated = await updateHomeMailMessageCommand({ companyID: "company-1", sharedInboxID: "shared-1", messageID: " message-5 ", update: { unread: false }, updateEmailMessage });

  assert.deepEqual(calls, [
    { action: "archive", companyID: "company-1", messageID: "message-1", sharedInboxID: "shared-1" },
    { action: "archive", companyID: "company-1", messageID: "message-2", sharedInboxID: "shared-1" },
    { action: "unarchive", companyID: "company-1", messageID: "message-3", sharedInboxID: "shared-1" },
    { action: "delete", companyID: "company-1", messageID: "message-4", sharedInboxID: "shared-1" },
    { action: "update", companyID: "company-1", messageID: "message-5", sharedInboxID: "shared-1", update: { unread: false } },
  ]);
  assert.equal(updated?.message.id, "message-5");
  assert.equal(updated?.message.unread, false);
});

test("Home archive command uses five-message batch chunks by default", async () => {
  const calls: Array<{ messageIDs: string[]; sharedInboxID?: string; companyID?: string }> = [];
  const archiveEmailMessagesBatch: HomeArchiveEmailMessagesBatch = async (messageIDs, sharedInboxID, companyID) => {
    calls.push({ messageIDs, sharedInboxID, companyID });
    return {
      archived_ids: messageIDs.filter((messageID) => messageID !== "message-6"),
      failed: messageIDs.includes("message-6") ? [{ message_id: "message-6", error: "nylas_rate_limited" }] : [],
    };
  };

  const result = await archiveHomeMailMessagesCommand({
    companyID: "company-1",
    sharedInboxID: " shared-1 ",
    messageIDs: ["message-1", "message-2", "message-3", "message-4", "message-5", "message-6"],
    archiveEmailMessagesBatch,
  });

  assert.deepEqual(calls, [
    { companyID: "company-1", sharedInboxID: "shared-1", messageIDs: ["message-1", "message-2", "message-3", "message-4", "message-5"] },
    { companyID: "company-1", sharedInboxID: "shared-1", messageIDs: ["message-6"] },
  ]);
  assert.deepEqual(result?.messageIDs, ["message-1", "message-2", "message-3", "message-4", "message-5"]);
  assert.deepEqual(result?.failed, [{ message_id: "message-6", error: "nylas_rate_limited" }]);
});

test("Home compose command validates and normalizes send payloads", async () => {
  const sentInputs: SendEmailInput[] = [];
  const sendEmail: HomeSendEmail = async (input) => {
    sentInputs.push(input);
    return emailMessage("sent-1", { to: input.to, subject: input.subject, body: input.body });
  };

  const result = await sendHomeMailComposeCommand({
    compose: {
      to: "Owner <owner@example.test>",
      cc: "",
      bcc: " teammate@example.test ",
      subject: " Subject ",
      body: " Body ",
      attachments: [],
      replyToMessageID: "message-1",
    },
    connectedAccountEmail: "owner@example.test",
    sendEmail,
  });

  assert.equal(result.sentToConnectedAccount, true);
  assert.equal(result.sentMessage.id, "sent-1");
  assert.deepEqual(sentInputs, [{
    to: [{ name: "Owner", email: "owner@example.test" }],
    cc: [],
    bcc: [{ email: "teammate@example.test" }],
    subject: "Subject",
    body: '<div style="font:14px/1.5 Arial,sans-serif;color:#111827;">Body</div>',
    attachments: [],
    reply_to_message_id: "message-1",
  }]);
  await sendHomeMailComposeCommand({
    companyID: " company-1 ",
    sharedInboxID: " shared-1 ",
    compose: {
      to: "customer@example.test",
      cc: "",
      bcc: "",
      subject: " Shared ",
      body: " Reply ",
      attachments: [],
      replyToMessageID: "",
    },
    connectedAccountEmail: "support@example.test",
    sendEmail,
  });
  assert.deepEqual(sentInputs[1], {
    to: [{ email: "customer@example.test" }],
    cc: [],
    bcc: [],
    subject: "Shared",
    body: '<div style="font:14px/1.5 Arial,sans-serif;color:#111827;">Reply</div>',
    attachments: [],
    reply_to_message_id: undefined,
    company_id: "company-1",
    shared_inbox_id: "shared-1",
  });
  await assert.rejects(
    () => sendHomeMailComposeCommand({ compose: { to: "", cc: "", bcc: "", subject: "", body: "Body", attachments: [], replyToMessageID: "" }, sendEmail }),
    /Add at least one recipient\./,
  );
});

test("Home shared inbox commands normalize folder operations", async () => {
  const updatedCalls: Array<Parameters<HomeUpdateSharedInbox>[0]> = [];
  const deletedCalls: Array<{ companyID: string; folderID: string }> = [];
  const createSharedInbox: HomeCreateSharedInbox = async (input) => sharedInbox("child-1", {
    name: input.name,
    parent_folder_id: input.parentFolderID,
    account_email: input.accountEmail,
  });
  const updateSharedInbox: HomeUpdateSharedInbox = async (input) => {
    updatedCalls.push(input);
    return sharedInbox(input.folderID, {
      name: input.name ?? "Updated",
      parent_folder_id: input.parentFolderID,
      account_email: input.accountEmail,
      position: input.position ?? 1000,
    });
  };
  const deleteSharedInbox: HomeDeleteSharedInbox = async (companyID, folderID) => {
    deletedCalls.push({ companyID, folderID });
  };

  const created = await createSharedInboxCommand({ companyID: "company-1", parentFolderID: "parent-1", rawName: " Team ", accountEmail: "team@example.test", createSharedInbox });
  const attached = await updateSharedInboxAccountEmailCommand({ companyID: "company-1", folderID: " child-1 ", accountEmail: "team@example.test", updateSharedInbox });
  await renameSharedInboxCommand({ companyID: "company-1", folderID: "child-1", name: " Renamed ", updateSharedInbox });
  await moveSharedInboxCommand({ companyID: "company-1", folderID: "child-1", parentFolderID: "parent-2", position: 2000, updateSharedInbox });
  const deleted = await deleteSharedInboxCommand({
    companyID: "company-1",
    folderID: "parent-1",
    sharedInboxes: [sharedInbox("parent-1"), sharedInbox("child-1", { parent_folder_id: "parent-1" })],
    deleteSharedInbox,
  });

  assert.equal(created?.viewID, "shared:child-1");
  assert.equal(created?.folder.name, "Team");
  assert.equal(attached?.notice, "Attached team@example.test.");
  assert.deepEqual(updatedCalls.map((call) => ({ folderID: call.folderID, name: call.name, parentFolderID: call.parentFolderID, position: call.position, accountEmail: call.accountEmail })), [
    { folderID: "child-1", name: undefined, parentFolderID: undefined, position: undefined, accountEmail: "team@example.test" },
    { folderID: "child-1", name: "Renamed", parentFolderID: undefined, position: undefined, accountEmail: undefined },
    { folderID: "child-1", name: undefined, parentFolderID: "parent-2", position: 2000, accountEmail: undefined },
  ]);
  assert.deepEqual(deletedCalls, [{ companyID: "company-1", folderID: "parent-1" }]);
  assert.deepEqual(deleted?.deletedFolderIDs.sort(), ["child-1", "parent-1"]);
});

test("Home shared inbox GVIC commands build direct replacement payloads", async () => {
  type SharedInboxRaciUpdatePayload = Parameters<HomeUpdateSharedInboxRaciAssignments>[2][number];
  const updateCalls: Array<{ companyID: string; folderID: string; assignments: SharedInboxRaciUpdatePayload[] }> = [];
  const updateSharedInboxRaciAssignments: HomeUpdateSharedInboxRaciAssignments = async (companyID, folderID, assignments) => {
    updateCalls.push({ companyID, folderID, assignments });
    return assignments.map((assignment): CommunicationsSharedInboxRaciAssignment => ({
      ...sharedRaci(folderID, assignment.role, assignment.user_id ?? assignment.subject_id ?? ""),
      subject_type: assignment.subject_type,
      subject_id: assignment.subject_id,
    }));
  };
  const existing = sharedRaci("inbox-1", "generated", "user-1");
  const inboxes = [sharedInbox("inbox-1", { gvic_assignments: [existing] })];

  const added = await addSharedInboxRaciSubjectCommand({
    companyID: "company-1",
    folderID: " inbox-1 ",
    role: "verified",
    subjectType: "user",
    subjectID: " user-2 ",
    sharedInboxes: inboxes,
    companyUsers: [companyUser("user-2")],
    now: () => timestamp,
    updateSharedInboxRaciAssignments,
  });
  const removed = await removeSharedInboxRaciSubjectCommand({
    companyID: "company-1",
    folderID: "inbox-1",
    role: "generated",
    subjectType: "user",
    subjectID: "user-1",
    sharedInboxes: inboxes,
    updateSharedInboxRaciAssignments,
  });

  assert.deepEqual(updateCalls, [
    {
      companyID: "company-1",
      folderID: "inbox-1",
      assignments: [
        { role: "generated", subject_type: "user", subject_id: "user-1", user_id: "user-1" },
        { role: "verified", subject_type: "user", subject_id: "user-2", user_id: "user-2" },
      ],
    },
    { companyID: "company-1", folderID: "inbox-1", assignments: [] },
  ]);
  assert.deepEqual(added?.assignments.map((assignment) => [assignment.role, assignment.subject_type, assignment.subject_id, assignment.user_id]), [["generated", "user", "user-1", "user-1"], ["verified", "user", "user-2", "user-2"]]);
  assert.deepEqual(removed?.assignments, []);
});
