import test from "node:test";
import assert from "node:assert/strict";
import type { CommunicationsSharedInbox, EmailMessage } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";
import type { LogicGateRecord } from "../../../../frontend/src/modules/logic-gate-map/shared.js";
import type { NodeRecord } from "../../../../frontend/src/modules/node-map/shared.js";
import {
  buildMyLogicGateGroups,
  buildMyNodeGroups,
  buildGVICRoleInboxGroupsByCell,
  buildSharedInboxRows,
  communicationStreamEventIsArchiveConfirmation,
  communicationStreamEventIsStarConfirmation,
  condenseEmailThreadMessages,
  fitHomeColumnWidthsToAvailableWidth,
  getHomeColumnMinimumTrackWidth,
  getHomeGridTemplateColumns,
  getHomeViewLabel,
  inboxLogicGateLabel,
  isWorkspacePanelHomeViewID,
  localMailboxMutationEchoKeys,
  logicGateTitle,
  messageDocument,
  missingLogicGateRecordIDs,
  getInboxMatrixGridTemplateColumns,
  getInboxMatrixGridTemplateColumnsWithoutSidebar,
  mailboxCountsFromFolders,
  mailboxForHomeView,
  nodeDragItemsFromExplorerRows,
  nodeIDsFromExplorerPayload,
  GVICRoleCellKey,
  resizeHomeColumns,
  resizeHomeInboxMatrixColumnsWithoutSidebar,
  setNodeDragData,
  sharedInboxCanLoadMail,
  triageMessageIDsFromStreamMessageID,
  workspaceEventTouchesHomePanel,
} from "../../../../frontend/src/pages/home/homeUtils.js";
import { messageSelectDotStyle, triageMessageRowStyle } from "../../../../frontend/src/pages/home/homeStyles.js";
import { EXPLORER_DRAG_MIME } from "../../../../frontend/src/modules/company-explorer/companyExplorerDragDrop.js";
import { EXPLORER_ENTITY_DRAG_MIME } from "../../../../frontend/src/modules/kanban/shared.js";
import { GVIC_INBOX_SECTIONS } from "../../../../frontend/src/pages/home/homeConstants.js";

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
    name: title,
    created_timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function logicGate(id: string, roles: LogicGateRecord["gvic_assignments"]): LogicGateRecord {
  return {
    company_id: "company-1",
    logic_gate_id: id,
    header: id,
    gvic_assignments: roles,
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

function emailMessage(id: string, threadID: string, date: number, overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    thread_id: threadID,
    subject: "Subject",
    snippet: "Preview",
    unread: false,
    starred: false,
    date,
    ...overrides,
  };
}

test("Home view helpers map labels and mailboxes without changing backend mailbox names", () => {
  const shared = [sharedInbox("shared-a", "Team Triage", 1000)];

  assert.equal(getHomeViewLabel("my-triage", shared), "My Triage");
  assert.equal(getHomeViewLabel("shared:shared-a", shared), "Team Triage");
  assert.equal(getHomeViewLabel("shared:missing", shared), "Shared Triage");
  assert.equal(getHomeViewLabel("a-inbox", shared), "Verified Nodes");
  assert.equal(getHomeViewLabel("r-inbox", shared), "Generated Nodes");
  assert.equal(getHomeViewLabel("a-inbox", shared), "Verified Nodes");
  assert.equal(getHomeViewLabel("c-inbox", shared), "Consulted Nodes");
  assert.equal(getHomeViewLabel("i-inbox", shared), "Informed Nodes");
  assert.equal(getHomeViewLabel("o-inbox", shared), "Other Nodes");
  assert.equal(mailboxForHomeView("a-inbox"), "all");
  assert.equal(mailboxForHomeView("o-inbox"), "all");
  assert.equal(mailboxForHomeView("my-triage"), "primary");
  assert.equal(isWorkspacePanelHomeViewID("my-triage"), true);
  assert.equal(isWorkspacePanelHomeViewID("shared-root"), true);
  assert.equal(isWorkspacePanelHomeViewID("shared:shared-a"), true);
  assert.equal(isWorkspacePanelHomeViewID("a-inbox"), true);
  assert.equal(isWorkspacePanelHomeViewID("o-inbox"), true);
});

test("communications triage stream message ids are cleaned and deduped", () => {
  assert.deepEqual(triageMessageIDsFromStreamMessageID(" message-1,message-2, message-1 ,,message-3 "), ["message-1", "message-2", "message-3"]);
  assert.deepEqual(triageMessageIDsFromStreamMessageID(" , "), []);
});

test("shared inbox local mailbox mutation echoes include scoped and unscoped keys", () => {
  assert.deepEqual(localMailboxMutationEchoKeys(" company-1 ", undefined, " message-1 "), [
    "company-1\x1f\x1fmessage-1",
  ]);
  assert.deepEqual(localMailboxMutationEchoKeys("company-1", " shared-1 ", "message-2"), [
    "company-1\x1fshared-1\x1fmessage-2",
    "company-1\x1f\x1fmessage-2",
  ]);
  assert.deepEqual(localMailboxMutationEchoKeys("", "shared-1", "message-2"), []);
  assert.deepEqual(localMailboxMutationEchoKeys("company-1", "shared-1", " "), []);
});

test("message select dot only appears for the selected email while unread rows keep their outline", () => {
  const unreadInactiveDot = messageSelectDotStyle(false, true);
  assert.equal(unreadInactiveDot.visibility, "hidden");
  assert.equal(unreadInactiveDot.background, "transparent");
  assert.equal(unreadInactiveDot.boxShadow, "none");

  const activeDot = messageSelectDotStyle(true, false);
  assert.equal(activeDot.visibility, "visible");
  assert.notEqual(activeDot.background, "transparent");

  const unreadRow = triageMessageRowStyle(false, true, true);
  assert.equal(unreadRow.border, "1px solid transparent");
  assert.match(String(unreadRow.background), /border-box/);
});

test("triage email list condenses messages from the same Nylas thread into one visible row", () => {
  const messages = [
    emailMessage("latest-thread-message", "thread-1", 300, { unread: false }),
    emailMessage("solo-message", "", 200, { unread: false }),
    emailMessage("older-thread-message", "thread-1", 100, { unread: true, starred: true }),
  ];

  const condensed = condenseEmailThreadMessages(messages);

  assert.deepEqual(condensed.map((message) => message.id), ["latest-thread-message", "solo-message"]);
  assert.equal(condensed[0].thread_message_count, 2);
  assert.equal(condensed[0].thread_unread_count, 1);
  assert.equal(condensed[0].unread, true);
  assert.equal(condensed[0].starred, true);
  assert.equal(condensed[1].thread_message_count, 1);
});

test("message documents preserve Mango-authored email body structure", () => {
  const documentHTML = messageDocument('<div data-mango-email-body="true">hello<br>  structure</div>');

  assert.match(documentHTML, /data-mango-email-body="true"/);
  assert.match(documentHTML, /white-space:pre-wrap!important/);
  assert.match(documentHTML, /hello<br>  structure/);
});

test("communications archive stream events are identified without treating generic updates as archive confirmations", () => {
  assert.equal(communicationStreamEventIsArchiveConfirmation({ trigger: "message.archived" }), true);
  assert.equal(communicationStreamEventIsArchiveConfirmation({ trigger: "message.updated", action: " archive " }), true);
  assert.equal(communicationStreamEventIsArchiveConfirmation({ trigger: "message.updated" }), false);
  assert.equal(communicationStreamEventIsArchiveConfirmation({ trigger: "message.created", action: "reply" }), false);
});

test("communications star stream events are identified without treating generic updates as star confirmations", () => {
  assert.equal(communicationStreamEventIsStarConfirmation({ trigger: "message.starred" }), true);
  assert.equal(communicationStreamEventIsStarConfirmation({ trigger: "message.unstarred" }), true);
  assert.equal(communicationStreamEventIsStarConfirmation({ trigger: "message.updated", action: " star " }), true);
  assert.equal(communicationStreamEventIsStarConfirmation({ trigger: "message.updated", action: "unstar" }), true);
  assert.equal(communicationStreamEventIsStarConfirmation({ trigger: "message.updated" }), false);
  assert.equal(communicationStreamEventIsStarConfirmation({ trigger: "message.archived", action: "archive" }), false);
});

test("mailbox count helper keeps visible Inbox and Starred counts", () => {
  const counts = mailboxCountsFromFolders([
    { id: "CATEGORY_PERSONAL", name: "CATEGORY_PERSONAL", total_count: 12 },
    { id: "INBOX", name: "Inbox", attributes: ["\\Inbox"], total_count: 30 },
    { id: "STARRED", name: "STARRED", total_count: 4 },
    { id: "archive-folder", name: "Archive", attributes: ["\\Archive"], total_count: 9 },
  ]);

  assert.deepEqual(counts, { primary: 30, starred: 4 });
});

test("Home workspace panel ignores internal derived projection request events", () => {
  assert.equal(workspaceEventTouchesHomePanel("workspace_derived_projection_requested"), false);
  assert.equal(workspaceEventTouchesHomePanel("company_explorer_folder_item_assign_requested"), false);
  assert.equal(workspaceEventTouchesHomePanel("node_map_position_upsert_requested"), false);
  assert.equal(workspaceEventTouchesHomePanel("logic_gate_map_position_upsert_requested"), false);
  assert.equal(workspaceEventTouchesHomePanel("node_created"), true);
  assert.equal(workspaceEventTouchesHomePanel("relationship_created"), true);
  assert.equal(workspaceEventTouchesHomePanel("relationship_deleted"), true);
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

test("shared inbox mail loading only targets mailbox-capable entries with an account email", () => {
  assert.equal(sharedInboxCanLoadMail(undefined), false);
  assert.equal(sharedInboxCanLoadMail({ entry_type: "folder", account_email: "support@example.com" }), false);
  assert.equal(sharedInboxCanLoadMail({ entry_type: "shared_inbox", account_email: "" }), false);
  assert.equal(sharedInboxCanLoadMail({ entry_type: "shared_inbox", account_email: " support@example.com " }), true);
});

test("GVIC inbox group builder classifies work by role, status, and priority", () => {
  const currentUserID = "user-1";
  const gates = new Map([
    ["gate-a", logicGate("gate-a", [{ company_id: "company-1", logic_gate_id: "gate-a", role: "verified", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-r", logicGate("gate-r", [{ company_id: "company-1", logic_gate_id: "gate-r", role: "generated", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-all", logicGate("gate-all", [
      { company_id: "company-1", logic_gate_id: "gate-all", role: "generated", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "verified", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "consulted", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "informed", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
    ])],
    ["gate-no-r", logicGate("gate-no-r", [])],
    ["gate-other-user", logicGate("gate-other-user", [{ company_id: "company-1", logic_gate_id: "gate-other-user", role: "consulted", user_id: "user-2", created_timestamp: "2026-01-01T00:00:00Z" }])],
  ]);
  const nodes = [
    node("node-a", "Verified node", { logic_gate_ids: ["gate-a"], status: "pending", priority: 1 }),
    node("node-r", "Generated node", { logic_gate_ids: ["gate-r"], status: "in_progress", priority: 2 }),
    node("node-review", "Review node", { logic_gate_ids: ["gate-r"], status: "review", priority: 2 }),
    node("node-all", "All roles node", { logic_gate_ids: ["gate-all"], status: "pending", priority: 1 }),
    node("node-r-unassigned", "Generated no priority node", { logic_gate_ids: ["gate-r"], status: "pending" }),
    node("node-assigned-without-r", "No generated role node", { logic_gate_ids: ["gate-no-r"], status: "in_progress", priority: 2 }),
    node("node-assigned-other-GVIC", "Other GVIC node", { logic_gate_ids: ["gate-other-user"], status: "pending", priority: 3 }),
    node("node-other-no-gate", "Without Logic Gate", { status: "pending", priority: 4 }),
    node("node-other-user", "Other user node", { logic_gate_ids: ["gate-other-user"], priority: 3 }),
    node("node-done", "Done node", { logic_gate_ids: ["gate-r"], status: "Done", priority: 1 }),
  ];
  const nodeByID = new Map(nodes.map((item) => [item.node_id, item]));

  assert.deepEqual(GVIC_INBOX_SECTIONS.map((section) => [section.viewID, section.role]), [
    ["r-inbox", "generated"],
    ["a-inbox", "verified"],
    ["c-inbox", "consulted"],
    ["i-inbox", "informed"],
    ["o-inbox", "other"],
  ]);
  const generatedStatusGroups = buildGVICRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "generated");
  assert.deepEqual(generatedStatusGroups.get(GVICRoleCellKey("generated", "in_progress", 2))?.[0]?.nodeIDs, ["node-r"]);
  assert.deepEqual(generatedStatusGroups.get(GVICRoleCellKey("generated", "review", 2))?.[0]?.nodeIDs, ["node-review"]);
  assert.deepEqual((generatedStatusGroups.get(GVICRoleCellKey("generated", "pending", 1)) ?? []).flatMap((group) => group.nodeIDs), ["node-all"]);
  assert.deepEqual(generatedStatusGroups.get(GVICRoleCellKey("generated", "pending", 0))?.[0]?.nodeIDs, ["node-r-unassigned"]);
  assert.equal(generatedStatusGroups.get(GVICRoleCellKey("generated", "pending", 1))?.some((group) => group.nodeIDs.includes("node-a")), false);
  assert.equal(generatedStatusGroups.get(GVICRoleCellKey("generated", "in_progress", 2))?.some((group) => group.nodeIDs.includes("node-assigned-without-r")), false);
  assert.equal(generatedStatusGroups.has(GVICRoleCellKey("generated", "done", 1)), false);
  const verifiedStatusGroups = buildGVICRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "verified");
  assert.deepEqual((verifiedStatusGroups.get(GVICRoleCellKey("verified", "pending", 1)) ?? []).flatMap((group) => group.nodeIDs).sort(), ["node-a", "node-all"]);
  assert.equal(verifiedStatusGroups.has(GVICRoleCellKey("verified", "in_progress", 2)), false);
  const otherGroups = buildGVICRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "other");
  assert.deepEqual(otherGroups.get(GVICRoleCellKey("other", "pending", 3))?.[0]?.nodeIDs, ["node-assigned-other-GVIC"]);
  assert.deepEqual(otherGroups.get(GVICRoleCellKey("other", "pending", 4))?.[0], {
    logicGateID: "__mango_inbox_no_logic_gate__",
    label: "No Logic Gate",
    nodeIDs: ["node-other-no-gate"],
  });
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
    node("node-unfiled", "Unfiled", { priority: 1 }),
    node("node-growth", "Growth Node", { logic_gate_ids: ["gate-growth"], priority: 2 }),
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

test("my logic gate groups merge shortcuts with GVIC-assigned gates", () => {
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
  const duplicateAssignedGate = logicGate("gate-shortcut", [{ company_id: "company-1", logic_gate_id: "gate-shortcut", role: "generated", user_id: "user-1", created_timestamp: "2026-01-01T00:00:00Z" }]);
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
