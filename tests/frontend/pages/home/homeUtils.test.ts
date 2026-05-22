import test from "node:test";
import assert from "node:assert/strict";
import type { CommunicationsSharedInbox } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";
import type { LogicGateRecord } from "../../../../frontend/src/modules/logic-gate-map/shared.js";
import type { NodeRecord } from "../../../../frontend/src/modules/node-map/shared.js";
import {
  buildAciInboxGroupsByCell,
  buildMyLogicGateGroups,
  buildMyNodeGroups,
  buildResponsibleInboxGroupsByCell,
  buildSharedInboxRows,
  fitHomeColumnWidthsToAvailableWidth,
  getHomeColumnMinimumTrackWidth,
  getHomeGridTemplateColumns,
  getHomeViewLabel,
  inboxLogicGateLabel,
  logicGateTitle,
  missingLogicGateRecordIDs,
  getInboxMatrixGridTemplateColumns,
  getInboxMatrixGridTemplateColumnsWithoutSidebar,
  mailboxCountsFromFolders,
  mailboxForHomeView,
  nodeDragItemsFromExplorerRows,
  nodeIDsFromExplorerPayload,
  resizeHomeColumns,
  resizeHomeInboxMatrixColumnsWithoutSidebar,
  setNodeDragData,
} from "../../../../frontend/src/pages/home/homeUtils.js";
import { EXPLORER_DRAG_MIME } from "../../../../frontend/src/modules/company-explorer/companyExplorerDragDrop.js";
import { EXPLORER_ENTITY_DRAG_MIME } from "../../../../frontend/src/modules/kanban/shared.js";
import { ACI_COLUMNS, RESPONSIBLE_STATUS_COLUMNS } from "../../../../frontend/src/pages/home/homeConstants.js";

function sharedInbox(id: string, name: string, position: number, parentID?: string): CommunicationsSharedInbox {
  return {
    company_id: "company-1",
    folder_id: id,
    parent_folder_id: parentID,
    folder_kind: "communications",
    name,
    position,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
}

function node(id: string, title: string, overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    company_id: "company-1",
    node_id: id,
    title,
    created_timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function logicGate(id: string, roles: LogicGateRecord["raci_assignments"]): LogicGateRecord {
  return {
    company_id: "company-1",
    logic_gate_id: id,
    header: id,
    raci_assignments: roles,
    created_timestamp: "2026-01-01T00:00:00Z",
  };
}

function explorerFolder(id: string, name: string, parentFolderID?: string): CompanyExplorerFolder {
  return {
    company_id: "company-1",
    folder_id: id,
    parent_folder_id: parentFolderID,
    folder_kind: "logic_gate",
    name,
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
}

function explorerFolderItem(folderID: string, itemID: string, itemType: "node" | "logic_gate"): CompanyExplorerFolderItem {
  return {
    company_id: "company-1",
    folder_id: folderID,
    item_type: itemType,
    item_id: itemID,
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
}

test("Home view helpers map labels and mailboxes without changing backend mailbox names", () => {
  const shared = [sharedInbox("shared-a", "Team Triage", 1000)];

  assert.equal(getHomeViewLabel("my-triage", shared), "My Triage");
  assert.equal(getHomeViewLabel("shared:shared-a", shared), "Team Triage");
  assert.equal(getHomeViewLabel("shared:missing", shared), "Shared Triage");
  assert.equal(getHomeViewLabel("aci-inbox", shared), "ACIO Nodes");
  assert.equal(getHomeViewLabel("r-inbox", shared), "R Nodes");
  assert.equal(mailboxForHomeView("aci-inbox"), "all");
  assert.equal(mailboxForHomeView("my-triage"), "primary");
});

test("mailbox count helper reads provider folder totals for triage tabs", () => {
  const counts = mailboxCountsFromFolders([
    { id: "CATEGORY_PERSONAL", name: "CATEGORY_PERSONAL", total_count: 12 },
    { id: "INBOX", name: "Inbox", attributes: ["\\Inbox"], total_count: 30 },
    { id: "STARRED", name: "STARRED", total_count: 4 },
    { id: "archive-folder", name: "Archive", attributes: ["\\Archive"], total_count: 9 },
  ]);

  assert.deepEqual(counts, { primary: 12, starred: 4, archive: 9 });
});

test("shared inbox rows are stable, sorted, and nested by parent", () => {
  const rows = buildSharedInboxRows([
    sharedInbox("child-b", "Child B", 2000, "root"),
    sharedInbox("root", "Root", 1000),
    sharedInbox("child-a", "Child A", 1000, "root"),
  ]);

  assert.deepEqual(rows.map((row) => [row.folder.folder_id, row.depth]), [
    ["root", 0],
    ["child-a", 1],
    ["child-b", 1],
  ]);
});

test("inbox group builders classify ACI and responsible work by role, status, and priority", () => {
  const currentUserID = "user-1";
  const gates = new Map([
    ["gate-a", logicGate("gate-a", [{ company_id: "company-1", logic_gate_id: "gate-a", role: "accountable", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-r", logicGate("gate-r", [{ company_id: "company-1", logic_gate_id: "gate-r", role: "responsible", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-all", logicGate("gate-all", [
      { company_id: "company-1", logic_gate_id: "gate-all", role: "responsible", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "accountable", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "consulted", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "informed", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
    ])],
    ["gate-no-r", logicGate("gate-no-r", [])],
    ["gate-other-user", logicGate("gate-other-user", [{ company_id: "company-1", logic_gate_id: "gate-other-user", role: "consulted", user_id: "user-2", created_timestamp: "2026-01-01T00:00:00Z" }])],
  ]);
  const nodes = [
    node("node-a", "ACI node", { logic_gate_ids: ["gate-a"], priority: 1 }),
    node("node-r", "Responsible node", { logic_gate_ids: ["gate-r"], status: "in_progress", priority: 2, assignee_user_id: currentUserID }),
    node("node-all", "All roles node", { logic_gate_ids: ["gate-all"], status: "pending", priority: 1 }),
    node("node-r-unassigned", "Responsible unassigned node", { logic_gate_ids: ["gate-r"], status: "pending" }),
    node("node-assigned-without-r", "Assigned without R node", { logic_gate_ids: ["gate-no-r"], status: "in_progress", priority: 2, assignee_user_id: currentUserID }),
    node("node-assigned-other-raci", "Assigned other RACI node", { logic_gate_ids: ["gate-other-user"], priority: 3, assignee_user_id: currentUserID }),
    node("node-other-user", "Other user node", { logic_gate_ids: ["gate-other-user"], priority: 3 }),
    node("node-done", "Done node", { logic_gate_ids: ["gate-r"], status: "Done", priority: 1 }),
  ];
  const nodeByID = new Map(nodes.map((item) => [item.node_id, item]));

  const aciGroups = buildAciInboxGroupsByCell(nodes, nodeByID, gates, currentUserID);
  assert.deepEqual(ACI_COLUMNS.map((column) => column.role), ["accountable", "consulted", "informed"]);
  assert.deepEqual((aciGroups.get("accountable:1") ?? []).flatMap((group) => group.nodeIDs).sort(), ["node-a", "node-all"]);
  assert.deepEqual(aciGroups.get("consulted:1")?.[0]?.nodeIDs, ["node-all"]);
  assert.deepEqual(aciGroups.get("informed:1")?.[0]?.nodeIDs, ["node-all"]);
  assert.equal(aciGroups.has("other:2"), false);
  assert.equal(aciGroups.has("other:3"), false);
  const responsibleGroups = buildResponsibleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID);
  assert.deepEqual(responsibleGroups.get("in_progress:2")?.[0]?.nodeIDs, ["node-r"]);
  assert.deepEqual((responsibleGroups.get("pending:1") ?? []).flatMap((group) => group.nodeIDs), ["node-all"]);
  assert.deepEqual(responsibleGroups.get("pending:0")?.[0]?.nodeIDs, ["node-r-unassigned"]);
  assert.equal(responsibleGroups.get("pending:1")?.some((group) => group.nodeIDs.includes("node-a")), false);
  assert.equal(responsibleGroups.get("in_progress:2")?.some((group) => group.nodeIDs.includes("node-assigned-without-r")), false);
  assert.equal(responsibleGroups.has("done:1"), false);
  assert.deepEqual(RESPONSIBLE_STATUS_COLUMNS.map((column) => column.status), ["pending", "in_progress"]);
  const opaqueID = "019e3de8-c507-7a03-a7ab-fbea8f4e1d22";
  assert.equal(inboxLogicGateLabel(opaqueID, new Map()), "Logic Gate");
  assert.equal(logicGateTitle({ logic_gate_id: opaqueID, header: opaqueID }), "Logic Gate");
  assert.deepEqual(missingLogicGateRecordIDs([
    node("node-missing-a", "Missing A", { logic_gate_ids: [opaqueID, "gate-r"] }),
    node("node-missing-b", "Missing B", { logic_gate_ids: [opaqueID, "gate-new"] }),
  ], gates), [opaqueID, "gate-new"]);
});

test("my node groups follow logic gate folders and node drag payloads resolve folder drops", () => {
  const folders = [
    explorerFolder("folder-product", "Product"),
    explorerFolder("folder-growth", "Growth", "folder-product"),
  ];
  const logicGateFolderItems = [
    explorerFolderItem("folder-growth", "gate-growth", "logic_gate"),
  ];
  const nodes = [
    node("node-unfiled", "Unfiled", { assignee_user_id: "user-1", priority: 1 }),
    node("node-growth", "Growth Node", { assignee_user_id: "user-1", logic_gate_ids: ["gate-growth"], priority: 2 }),
  ];

  const groups = buildMyNodeGroups({ nodes, logicGateFolders: folders, logicGateFolderItems });

  assert.deepEqual(groups.map((group) => [group.label, group.nodes.map((item) => item.node_id)]), [
    ["Product / Growth", ["node-growth"]],
    ["Unfiled Nodes", ["node-unfiled"]],
  ]);
  assert.deepEqual(nodeIDsFromExplorerPayload(
    { kind: "folder", folderID: "folder-product", folderKind: "node" },
    [
      { ...folders[0], folder_kind: "node" },
      { ...folders[1], folder_kind: "node" },
    ],
    [
      explorerFolderItem("folder-product", "node-root", "node"),
      explorerFolderItem("folder-growth", "node-child", "node"),
      explorerFolderItem("folder-growth", "gate-growth", "logic_gate"),
    ],
  ), ["node-root", "node-child"]);
});

test("home node drags include the Logic Gate Arena node payload", () => {
  const nodeByID = new Map([
    ["node-a", node("node-a", "Alpha")],
    ["node-b", node("node-b", "Beta")],
  ]);
  const data = new Map<string, string>();
  const transfer = {
    effectAllowed: "",
    setData(type: string, value: string) {
      data.set(type, value);
    },
  } as unknown as DataTransfer;

  setNodeDragData(transfer, ["node-a", "node-b"], nodeByID);

  assert.equal(JSON.parse(data.get(EXPLORER_DRAG_MIME) ?? "{}").kind, "batch");
  assert.deepEqual(JSON.parse(data.get(EXPLORER_ENTITY_DRAG_MIME) ?? "{}"), {
    itemType: "node_batch",
    nodes: [
      { nodeID: "node-a", label: "Alpha" },
      { nodeID: "node-b", label: "Beta" },
    ],
  });
});

test("home explorer rows expose selected nodes as Logic Gate Arena drag items", () => {
  const nodeByID = new Map([
    ["node-a", node("node-a", "Alpha")],
    ["node-b", node("node-b", "Beta")],
  ]);
  const rows = [
    { id: "folder-root", label: "Root", depth: 0, kind: "folder" as const, folderID: "folder-root", folderKind: "node" as const, scopeLevel: 0, position: 1000, createdTimestamp: "" },
    { id: "node-node-a", label: "Alpha", depth: 1, kind: "node" as const, nodeID: "node-a", folderID: "folder-root", folderKind: "node" as const, scopeLevel: 1, position: 1000, createdTimestamp: "" },
    { id: "node-node-b", label: "Beta", depth: 1, kind: "node" as const, nodeID: "node-b", folderID: "folder-root", folderKind: "node" as const, scopeLevel: 1, position: 2000, createdTimestamp: "" },
  ];

  assert.deepEqual(nodeDragItemsFromExplorerRows({ kind: "folder", folderID: "folder-root", folderKind: "node" }, rows, nodeByID), [
    { nodeID: "node-a", label: "Alpha" },
    { nodeID: "node-b", label: "Beta" },
  ]);
});

test("my logic gate groups merge shortcuts with RACI-assigned gates", () => {
  const folders = [
    explorerFolder("folder-product", "Product"),
    explorerFolder("folder-growth", "Growth", "folder-product"),
  ];
  const folderItems = [
    explorerFolderItem("folder-growth", "gate-shortcut", "logic_gate"),
    explorerFolderItem("folder-growth", "gate-assigned", "logic_gate"),
  ];
  const shortcut = {
    user_id: "user-1",
    company_id: "company-1",
    logic_gate_id: "gate-shortcut",
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
  const shortcutGate = logicGate("gate-shortcut", []);
  const assignedGate = logicGate("gate-assigned", [{ company_id: "company-1", logic_gate_id: "gate-assigned", role: "consulted", user_id: "user-1", created_timestamp: "2026-01-01T00:00:00Z" }]);
  const duplicateAssignedGate = logicGate("gate-shortcut", [{ company_id: "company-1", logic_gate_id: "gate-shortcut", role: "responsible", user_id: "user-1", created_timestamp: "2026-01-01T00:00:00Z" }]);
  const logicGateByID = new Map([
    [shortcutGate.logic_gate_id, shortcutGate],
    [assignedGate.logic_gate_id, assignedGate],
  ]);

  const groups = buildMyLogicGateGroups({
    shortcuts: [shortcut],
    assignedLogicGates: [assignedGate, duplicateAssignedGate],
    logicGateByID,
    folders,
    folderItems,
  });

  assert.deepEqual(groups.map((group) => [group.label, group.logicGates.map((item) => item.logic_gate_id)]), [
    ["Product / Growth", ["gate-shortcut", "gate-assigned"]],
  ]);
});

test("home column sizing keeps generated grid tracks stable", () => {
  const widths = resizeHomeColumns([200, 320, 360, 380], 1, 80, 1400);

  assert.deepEqual(widths, [200, 400, 390, 380]);
  assert.equal(getHomeGridTemplateColumns(widths), "200px 10px 400px 10px minmax(390px, 1fr) 10px 380px");
  assert.equal(getInboxMatrixGridTemplateColumns(widths), "200px minmax(320px, 1fr) 380px");
  assert.equal(getInboxMatrixGridTemplateColumnsWithoutSidebar(widths), "minmax(320px, 1fr) 10px 380px");
  assert.deepEqual(resizeHomeInboxMatrixColumnsWithoutSidebar(widths, 2, -160, 780), [200, 400, 320, 450]);
});

test("home column sizing fits first-load widths into the available My Triage workspace", () => {
  const fitted = fitHomeColumnWidthsToAvailableWidth([220, 350, 360, 340], 1120, true);

  assert.deepEqual(fitted, [220, 310, 220, 340]);
  assert.equal(fitted.reduce((sum, width) => sum + width, 0) + 30, 1120);
  assert.equal(getHomeColumnMinimumTrackWidth(true), 980);
  assert.equal(getHomeColumnMinimumTrackWidth(false), 800);
});
