import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { CompanyUser, CommunicationsArchiveJob, CommunicationsSharedInbox, CommunicationsSharedInboxRACIAssignment, CommunicationsSharedInboxRACIRole, EmailMessage, SendEmailInput, UserLogicGateShortcut } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { CompanyExplorerFolderItem } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";
import type { LogicGateAssignmentCommandResult, RACIMatrixProjectionRow } from "../../../../frontend/src/modules/kanban/kanbanApi.js";
import type { KanbanBoard, KanbanCard } from "../../../../frontend/src/modules/kanban/shared.js";
import type { NodeRecord } from "../../../../frontend/src/modules/nodes/types.js";
import { EDITOR_RICH_TEXT_PREFIX } from "../../../../frontend/src/modules/editor/richTextEditing.js";
import { INBOX_NO_LOGIC_GATE_ID } from "../../../../frontend/src/pages/home/homeConstants.js";
import { addMyLogicGateShortcutsCommand, addSharedInboxRACIPrincipalCommand, applyBulkNodePatchCommand, archiveHomeMailMessagesCommand, convertMessagesToLogicGateCommand, createHomeLogicGateCommand, createHomeRACIMatrixNodeCommand, deleteHomeMailMessagesCommand, dropNodesIntoInboxLogicGateCommand, removeMyLogicGateShortcutCommand, removeSharedInboxRACIPrincipalCommand, sendHomeMailComposeCommand, unarchiveHomeMailMessagesCommand, updateHomeMailMessageCommand, type HomeAddMyLogicGateShortcuts, type HomeArchiveEmailMessagesBatch, type HomeBulkMoveLogicGateAssignment, type HomeBulkNodePatch, type HomeBulkUpdateNode, type HomeConvertTriageMessagesToLogicGate, type HomeCreateRACIMatrixNode, type HomeDeleteEmailMessage, type HomeDropAssignNodeToLogicGateStatus, type HomeRemoveMyLogicGateShortcut, type HomeSendEmail, type HomeUnarchiveEmailMessage, type HomeUpdateEmailMessage, type HomeUpdateSharedInboxRACIAssignments } from "../../../../frontend/src/pages/home/homeCommands.js";
import { appendHomeMailPlainText, applyHomeMailSignature, composeHasDraftContent, homeMailBodyHasSignature, homeMailDraftToMessage, homeMailSignatureScopeKey, loadHomeMailSignature, readHomeMailSignature, saveHomeMailSignatureRemote } from "../../../../frontend/src/pages/home/homeMailDrafts.js";
import { emptyCompose } from "../../../../frontend/src/pages/home/homeTypes.js";

test("new compose and reply bodies receive one idempotent rich-editor signature", () => {
  const signature = "Best,\nMango Team";
  const initialBody = applyHomeMailSignature("", signature);

  assert.equal(initialBody.startsWith(EDITOR_RICH_TEXT_PREFIX), true);
  assert.match(initialBody, /Best,<br>Mango Team/);
  assert.equal(homeMailBodyHasSignature(initialBody, signature), true);
  assert.equal(applyHomeMailSignature(initialBody, signature), initialBody);
  assert.equal(composeHasDraftContent({ ...emptyCompose, open: true, body: initialBody }, signature), false);

  const forwardedBody = appendHomeMailPlainText(initialBody, "---------- Forwarded message ---------\nOriginal body");
  assert.equal(forwardedBody.split(EDITOR_RICH_TEXT_PREFIX).length - 1, 1);
  assert.match(forwardedBody, /Best,<br>Mango Team[\s\S]*Forwarded message[\s\S]*Original body/);

  const repliedBody = applyHomeMailSignature(`${EDITOR_RICH_TEXT_PREFIX}<div>Thanks for the update.</div>`, signature);
  assert.match(repliedBody, /Thanks for the update[\s\S]*Best,<br>Mango Team/);
  assert.equal(applyHomeMailSignature(repliedBody, signature), repliedBody);
  assert.equal(composeHasDraftContent({ ...emptyCompose, open: true, body: repliedBody }, signature), true);
});

test("image-only mail drafts are retained and draft snippets never expose editor markup", () => {
  const inlineImageBody = EDITOR_RICH_TEXT_PREFIX
    + "<span data-mango-editor-image=\"true\" data-mango-editor-attachment-id=\"attachment-1\"><img src=\"mango-attachment:attachment-1\" alt=\"\"></span>";
  const signature = "Best,\nMango Team";

  assert.equal(composeHasDraftContent({ ...emptyCompose, open: true, body: inlineImageBody }, ""), true);
  assert.equal(
    composeHasDraftContent({ ...emptyCompose, open: true, body: applyHomeMailSignature(inlineImageBody, signature) }, signature),
    true,
  );
  const logoSignature = EDITOR_RICH_TEXT_PREFIX
    + "<div>Mango Team</div><span data-mango-editor-image=\"true\" data-mango-editor-attachment-id=\"logo-1\"><img src=\"mango-attachment:logo-1\" alt=\"\"></span>";
  assert.equal(
    composeHasDraftContent({ ...emptyCompose, open: true, body: applyHomeMailSignature("", logoSignature) }, logoSignature),
    false,
  );

  const draft = {
    id: "draft-1",
    kind: "compose" as const,
    userID: "user-1",
    companyID: "company-1",
    sharedInboxID: "",
    accountEmail: "sender@example.test",
    sourceMessageID: "",
    replyToMessageID: "",
    replyToMessage: null,
    to: "",
    cc: "",
    bcc: "",
    subject: "",
    body: EDITOR_RICH_TEXT_PREFIX + "<div><strong>Hello</strong> &amp; welcome</div>",
    attachments: [],
    scheduledAt: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  assert.equal(homeMailDraftToMessage(draft).snippet, "Hello & welcome");
  assert.equal(homeMailDraftToMessage({ ...draft, body: inlineImageBody }).snippet, "Inline image");
});

test("rich signatures retain formatting and signature storage keys stay mailbox scoped", () => {
  const richSignature = `${EDITOR_RICH_TEXT_PREFIX}<div><strong>Mango Team</strong></div>`;
  const body = applyHomeMailSignature("", richSignature);

  assert.match(body, /<strong>Mango Team<\/strong>/);
  assert.equal(homeMailBodyHasSignature(body, richSignature), true);
  assert.notEqual(
    homeMailSignatureScopeKey("company-1", "user-1", "", "one@example.test"),
    homeMailSignatureScopeKey("company-1", "user-1", "", "two@example.test"),
  );
  assert.notEqual(
    homeMailSignatureScopeKey("company-1", "user-1", "shared-1", "shared@example.test"),
    homeMailSignatureScopeKey("company-1", "user-1", "shared-2", "shared@example.test"),
  );
});

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
  };
}

function installMemoryStorage(t: { after: (callback: () => void) => void }): Storage {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const storage = memoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  t.after(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  return storage;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function signatureResponse(body: string | null): Response {
  return new Response(JSON.stringify({
    signature: body === null ? null : {
      company_id: "company-signature-race",
      signature_id: "signature-race",
      scope_type: "personal",
      personal_user_id: "user-signature-race",
      personal_account_email: "signature@example.test",
      name: "Default",
      body_editor_html: body,
      is_default: true,
      created_timestamp: timestamp,
      updated_timestamp: timestamp,
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function signatureBodyFromRequest(init?: RequestInit): string {
  if (typeof init?.body !== "string") return "";
  const body = JSON.parse(init.body) as { body_editor_html?: string };
  return body.body_editor_html ?? "";
}

function installSignatureFetch(
  t: { after: (callback: () => void) => void },
  handler: (init?: RequestInit) => Promise<Response>,
): void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => handler(init)) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

test("a pending signature retry never overwrites a newer save", async (t: { after: (callback: () => void) => void }) => {
  installMemoryStorage(t);
  const companyID = "company-signature-pending-race";
  const userID = "user-signature-pending-race";
  const accountEmail = "pending-race@example.test";
  let phase: "seed-failure" | "race" = "seed-failure";
  const retryResponse = deferred<Response>();
  const newerResponse = deferred<Response>();
  const retryStarted = deferred<void>();
  const newerStarted = deferred<void>();
  const racePutBodies: string[] = [];
  installSignatureFetch(t, async (init) => {
    if (phase === "seed-failure") throw new Error("offline");
    const body = signatureBodyFromRequest(init);
    racePutBodies.push(body);
    if (racePutBodies.length === 1) {
      retryStarted.resolve();
      return retryResponse.promise;
    }
    newerStarted.resolve();
    return newerResponse.promise;
  });

  await assert.rejects(saveHomeMailSignatureRemote(companyID, userID, "pending body", "", accountEmail));
  phase = "race";
  const loadPromise = loadHomeMailSignature(companyID, userID, "", accountEmail);
  await retryStarted.promise;
  const newerSave = saveHomeMailSignatureRemote(companyID, userID, "newer body", "", accountEmail);
  retryResponse.resolve(signatureResponse("pending body"));

  assert.equal(await loadPromise, "newer body");
  assert.equal(readHomeMailSignature(companyID, userID, "", accountEmail), "newer body");
  await newerStarted.promise;
  newerResponse.resolve(signatureResponse("newer body"));
  await newerSave;
  assert.deepEqual(racePutBodies, ["pending body", "newer body"]);
});

test("a stale signature GET cannot overwrite a completed same-body save", async (t: { after: (callback: () => void) => void }) => {
  const storage = installMemoryStorage(t);
  const companyID = "company-signature-get-race";
  const userID = "user-signature-get-race";
  const accountEmail = "get-race@example.test";
  const body = "locally authoritative body";
  storage.setItem(homeMailSignatureScopeKey(companyID, userID, "", accountEmail), body);
  const getResponse = deferred<Response>();
  installSignatureFetch(t, async (init) => {
    if (!init?.method || init.method === "GET") return getResponse.promise;
    return signatureResponse(signatureBodyFromRequest(init));
  });

  const loadPromise = loadHomeMailSignature(companyID, userID, "", accountEmail);
  await saveHomeMailSignatureRemote(companyID, userID, body, "", accountEmail);
  getResponse.resolve(signatureResponse("stale remote body"));

  assert.equal(await loadPromise, body);
  assert.equal(readHomeMailSignature(companyID, userID, "", accountEmail), body);
});

test("signature persistence downgrades Entity chips and preserves other references", async (t: { after: (callback: () => void) => void }) => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  t.after(() => {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    dom.window.close();
  });
  installMemoryStorage(t);
  const companyID = "company-signature-entity-reference";
  const userID = "user-signature-entity-reference";
  const accountEmail = "entity-reference@example.test";
  const signature = "<!-- mango-editor-html-v1 --><div><span data-mango-entity-link=\"true\" data-mango-entity-type=\"entity\" data-mango-entity-id=\"entity-1\" data-mango-entity-label=\"Thailand delivery\">Thailand delivery</span> <span data-mango-entity-link=\"true\" data-mango-entity-type=\"project\" data-mango-entity-id=\"project-1\" data-mango-entity-label=\"Costco order\">Costco order</span></div>";
  let outboundBody = "";
  installSignatureFetch(t, async (init) => {
    outboundBody = signatureBodyFromRequest(init);
    return signatureResponse(outboundBody);
  });

  await saveHomeMailSignatureRemote(companyID, userID, signature, "", accountEmail);

  assert.match(outboundBody, /Thailand delivery/);
  assert.doesNotMatch(outboundBody, /data-mango-entity-type="entity"|data-mango-entity-id="entity-1"/);
  assert.match(outboundBody, /data-mango-entity-type="project"/);
  assert.match(outboundBody, /data-mango-entity-id="project-1"/);
  assert.equal(readHomeMailSignature(companyID, userID, "", accountEmail), outboundBody);
});

test("legacy signature backfill stays ordered ahead of a newer save", async (t: { after: (callback: () => void) => void }) => {
  const storage = installMemoryStorage(t);
  const companyID = "company-signature-backfill-race";
  const userID = "user-signature-backfill-race";
  const accountEmail = "backfill-race@example.test";
  storage.setItem(homeMailSignatureScopeKey(companyID, userID, "", accountEmail), "legacy body");
  const backfillResponse = deferred<Response>();
  const newerResponse = deferred<Response>();
  const backfillStarted = deferred<void>();
  const newerStarted = deferred<void>();
  const putBodies: string[] = [];
  installSignatureFetch(t, async (init) => {
    if (!init?.method || init.method === "GET") return signatureResponse(null);
    const body = signatureBodyFromRequest(init);
    putBodies.push(body);
    if (putBodies.length === 1) {
      backfillStarted.resolve();
      return backfillResponse.promise;
    }
    newerStarted.resolve();
    return newerResponse.promise;
  });

  const loadPromise = loadHomeMailSignature(companyID, userID, "", accountEmail);
  await backfillStarted.promise;
  const newerSave = saveHomeMailSignatureRemote(companyID, userID, "newer body", "", accountEmail);
  await Promise.resolve();
  assert.deepEqual(putBodies, ["legacy body"]);
  backfillResponse.resolve(signatureResponse("legacy body"));
  await newerStarted.promise;
  assert.deepEqual(putBodies, ["legacy body", "newer body"]);
  newerResponse.resolve(signatureResponse("newer body"));

  assert.equal(await loadPromise, "newer body");
  await newerSave;
  assert.equal(readHomeMailSignature(companyID, userID, "", accountEmail), "newer body");
});

const timestamp = "2026-01-01T00:00:00Z";

function node(id: string, overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    company_id: "company-1",
    node_id: id,
    name: `Node ${id}`,
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

function projectionRow(resourceID: string, overrides: Partial<RACIMatrixProjectionRow> = {}): RACIMatrixProjectionRow {
  const logicGateID = overrides.logic_gate_id ?? "none";
  return {
    company_id: "company-1",
    projection_row_id: `raci_matrix_node_leaf:company-1:user-1:responsible:none:node:${resourceID}:project:none:logic_gate:${logicGateID}`,
    user_id: "user-1",
    node_name: `Node ${resourceID}`,
    gvic_assignment: "responsible",
    node_id: resourceID,
    created_timestamp: timestamp,
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

function archiveJob(messageIDs: string[]): CommunicationsArchiveJob {
	const ids = Array.from(new Set(messageIDs));
	return {
		job_id: "archive-job-1",
		status: "pending",
		requested_count: ids.length,
		accepted_message_ids: ids,
		items: ids.map((messageID, index) => ({
			job_item_id: `archive-job-item-${index + 1}`,
			job_id: "archive-job-1",
			message_id: messageID,
			status: "pending",
			provider_attempt_count: 0,
		})),
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

function sharedRACI(folderID: string, role: CommunicationsSharedInboxRACIRole, userID: string): CommunicationsSharedInboxRACIAssignment {
  return {
    company_id: "company-1",
    folder_id: folderID,
    role,
    principal_type: "user",
    principal_id: userID,
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
    ["node-1", node("node-1", { name: "Launch checklist", status: "pending" })],
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
  assert.deepEqual(updated.gvic_projection_rows.map((row) => row.node_id), ["node-1"]);
  assert.deepEqual(invalidatedBoards, ["logic-gate:gate-1"]);
});

test("Home matrix node drop moves into a different Logic Gate with the move command", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { name: "Cross gate node", status: "pending", logic_gate_ids: ["source-gate"] })],
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
  assert.deepEqual(updated.gvic_projection_rows.map((row) => [row.node_id, row.logic_gate_id]), [["node-1", "target-gate"]]);
  assert.deepEqual(invalidatedBoards, ["logic-gate:target-gate", "logic-gate:source-gate"]);
});

test("Home matrix node drop from the no-Logic-Gate group assigns instead of moving", async () => {
  const nodes = new Map([
    ["node-1", node("node-1", { name: "Unplaced node", status: "pending", logic_gate_ids: [] })],
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
    ["node-1", node("node-1", { name: "Same gate node", status: "pending", logic_gate_ids: ["gate-1"] })],
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
  assert.deepEqual(updated.gvic_projection_rows.map((row) => row.node_id), ["node-1", "node-2"]);
  assert.deepEqual(statuses, ["done", "pending"]);
  assert.deepEqual(priorities, [null, null]);
});

test("Home logic gate creation sends creator RACI role through batch create", async () => {
  const calls: Array<{ apiBase: string; path: string; body: Record<string, unknown> }> = [];
  const result = await createHomeLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    creatorRACIRole: "responsible",
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
          header: "new process",
          gvic_assignments: [{ company_id: "company-1", logic_gate_id: "gate-1", role: "responsible", user_id: "user-1", created_timestamp: timestamp }],
          created_timestamp: timestamp,
        }],
        folder_items: [],
      } as T;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/v1/workspace/entity-batches");
  assert.equal(calls[0].body.creator_logic_gate_gvic_role, "responsible");
  assert.equal((calls[0].body.items as Array<{ title?: string }>)[0]?.title, "new process");
  assert.equal(result.logicGate.gvic_assignments?.[0]?.role, "responsible");
});

test("Home RACI matrix node create preserves projection rows", async () => {
  const rows = [projectionRow("node-1", { logic_gate_id: "gate-1" })];
  const createRACIMatrixNode: HomeCreateRACIMatrixNode = async () => ({
    node: node("node-1", { logic_gate_ids: ["gate-1"] }),
    folder_items: [explorerFolderItem("folder-1", "node-1", "node")],
    gvic_projection_rows: rows,
  });

  const result = await createHomeRACIMatrixNodeCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    priority: 3,
    status: "pending",
    createRACIMatrixNode,
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
test("Home My Logic Gate shortcut add saves the resolved Logic Gate IDs", async () => {
  const calls: Array<{ companyID: string; logicGateIDs: string[] }> = [];
  const addMyLogicGateShortcuts: HomeAddMyLogicGateShortcuts = async (companyID, logicGateIDs) => {
    calls.push({ companyID, logicGateIDs });
    return logicGateIDs.map((logicGateID, index) => shortcut(logicGateID, (index + 1) * 1000));
  };

  const result = await addMyLogicGateShortcutsCommand({
    companyID: "company-1",
    logicGateIDs: ["gate-a", "gate-b", "gate-a"],
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
      unstarred_message_ids: ["message-1"],
    };
  };
  const invalidatedBoardLists: string[] = [];
  const invalidatedBoardContents: string[] = [];
  const invalidatedArenaViews: string[] = [];
  const boardEvents: unknown[] = [];
  const boardContentEvents: unknown[] = [];
  const invalidatedNodes: string[] = [];
  const upsertedNodes: string[] = [];

  const result = await convertMessagesToLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    accountEmail: " OWNER@Example.TEST ",
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
  });

  assert.deepEqual(convertCalls, [{ companyID: "company-1", accountEmail: "owner@example.test", logicGateID: "gate-1", messageIDs: ["message-1", "message-2"], priority: 2 }]);
  assert.equal(result?.boardID, "logic-gate:gate-1");
  assert.equal(result?.logicGateID, "gate-1");
  assert.deepEqual(result?.convertedMessageIDs, ["message-1"]);
  assert.deepEqual(result?.unstarredMessageIDs, ["message-1"]);
  assert.deepEqual(invalidatedBoardLists, ["company-1"]);
  assert.deepEqual(invalidatedBoardContents, ["logic-gate:gate-1"]);
  assert.deepEqual(invalidatedArenaViews, ["gate-1"]);
  assert.deepEqual([...boardEvents], [{ companyID: "company-1", board: board("logic-gate:gate-1", "gate-1") }]);
  assert.deepEqual([...boardContentEvents], [{ companyID: "company-1", boardID: "logic-gate:gate-1", logicGateID: "gate-1" }]);
  assert.deepEqual(invalidatedNodes, ["node-1"]);
  assert.deepEqual(upsertedNodes, ["node-1"]);

  await convertMessagesToLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    sharedInboxID: " shared-1 ",
    accountEmail: "ignored@example.test",
    logicGateID: "gate-1",
    messageIDs: ["message-3"],
    priority: 4,
    convertTriageMessagesToLogicGate,
    invalidateKanbanBoardList: (_apiBase, companyID) => invalidatedBoardLists.push(companyID),
    invalidateKanbanBoardContents: (_apiBase, _companyID, boardID) => invalidatedBoardContents.push(boardID),
    invalidateLogicGateArenaView: (_apiBase, _companyID, logicGateID) => invalidatedArenaViews.push(logicGateID ?? ""),
    dispatchKanbanBoardsUpdated: (detail) => boardEvents.push(detail),
    dispatchKanbanBoardContentsUpdated: (detail) => boardContentEvents.push(detail),
    invalidateNodeRecord: (_apiBase, _companyID, nodeID) => invalidatedNodes.push(nodeID),
    upsertNodeRelationshipGraphNode: (_apiBase, _companyID, node) => upsertedNodes.push(node.node_id),
  });
  assert.deepEqual(convertCalls[1], {
    companyID: "company-1",
    sharedInboxID: "shared-1",
    logicGateID: "gate-1",
    messageIDs: ["message-3"],
    priority: 4,
  });
  await convertMessagesToLogicGateCommand({
    apiBase: "https://api.example.test",
    companyID: "company-1",
    logicGateID: "gate-1",
    messageIDs: ["message-4"],
    convertTriageMessagesToLogicGate,
  });
  assert.deepEqual(convertCalls[2], {
    companyID: "company-1",
    logicGateID: "gate-1",
    messageIDs: ["message-4"],
    priority: undefined,
  });
});

test("Home mail message commands normalize ids and preserve one exact personal or shared mailbox", async () => {
	const calls: Array<{ action: string; companyID: string; messageID: string; sharedInboxID?: string; accountEmail?: string; update?: unknown }> = [];
	const archiveEmailMessagesBatch: HomeArchiveEmailMessagesBatch = async (messageIDs, sharedInboxID, companyID, options) => {
		for (const messageID of messageIDs) calls.push({ action: "archive", companyID: companyID ?? "", messageID, sharedInboxID, accountEmail: options?.accountEmail });
		return archiveJob(messageIDs);
  };
  const unarchiveEmailMessage: HomeUnarchiveEmailMessage = async (messageID, sharedInboxID, companyID, accountEmail) => {
    calls.push({ action: "unarchive", companyID: companyID ?? "", messageID, sharedInboxID, accountEmail });
    return emailMessage(messageID, { folders: ["inbox"] });
  };
  const deleteEmailMessage: HomeDeleteEmailMessage = async (messageID, sharedInboxID, companyID, accountEmail) => {
    calls.push({ action: "delete", companyID: companyID ?? "", messageID, sharedInboxID, accountEmail });
  };
  const updateEmailMessage: HomeUpdateEmailMessage = async (messageID, update, sharedInboxID, companyID, accountEmail) => {
    calls.push({ action: "update", companyID: companyID ?? "", messageID, sharedInboxID, accountEmail, update });
    return emailMessage(messageID, { unread: update.unread ?? true, starred: update.starred ?? false });
  };

	await archiveHomeMailMessagesCommand({ companyID: "company-1", sharedInboxID: " shared-1 ", accountEmail: "ignored@example.test", messageIDs: [" message-1 ", "message-2", "message-1"], archiveEmailMessagesBatch });
  await unarchiveHomeMailMessagesCommand({ companyID: "company-1", sharedInboxID: "shared-1", accountEmail: "ignored@example.test", messageIDs: ["message-3"], unarchiveEmailMessage });
  await deleteHomeMailMessagesCommand({ companyID: "company-1", sharedInboxID: "shared-1", accountEmail: "ignored@example.test", messageIDs: ["message-4"], deleteEmailMessage });
  const updated = await updateHomeMailMessageCommand({ companyID: "company-1", sharedInboxID: "shared-1", accountEmail: "ignored@example.test", messageID: " message-5 ", update: { unread: false }, updateEmailMessage });
	await archiveHomeMailMessagesCommand({ companyID: "company-1", accountEmail: " OWNER@Example.TEST ", messageIDs: ["message-6"], archiveEmailMessagesBatch });
  await unarchiveHomeMailMessagesCommand({ companyID: "company-1", accountEmail: " OWNER@Example.TEST ", messageIDs: ["message-7"], unarchiveEmailMessage });
  await deleteHomeMailMessagesCommand({ companyID: "company-1", accountEmail: " OWNER@Example.TEST ", messageIDs: ["message-8"], deleteEmailMessage });
  await updateHomeMailMessageCommand({ companyID: "company-1", accountEmail: " OWNER@Example.TEST ", messageID: "message-9", update: { starred: true }, updateEmailMessage });

  assert.deepEqual(calls, [
    { action: "archive", companyID: "company-1", messageID: "message-1", sharedInboxID: "shared-1", accountEmail: undefined },
    { action: "archive", companyID: "company-1", messageID: "message-2", sharedInboxID: "shared-1", accountEmail: undefined },
    { action: "unarchive", companyID: "company-1", messageID: "message-3", sharedInboxID: "shared-1", accountEmail: undefined },
    { action: "delete", companyID: "company-1", messageID: "message-4", sharedInboxID: "shared-1", accountEmail: undefined },
    { action: "update", companyID: "company-1", messageID: "message-5", sharedInboxID: "shared-1", accountEmail: undefined, update: { unread: false } },
    { action: "archive", companyID: "company-1", messageID: "message-6", sharedInboxID: undefined, accountEmail: "owner@example.test" },
    { action: "unarchive", companyID: "company-1", messageID: "message-7", sharedInboxID: undefined, accountEmail: "owner@example.test" },
    { action: "delete", companyID: "company-1", messageID: "message-8", sharedInboxID: undefined, accountEmail: "owner@example.test" },
    { action: "update", companyID: "company-1", messageID: "message-9", sharedInboxID: undefined, accountEmail: "owner@example.test", update: { starred: true } },
  ]);
  assert.equal(updated?.message.id, "message-5");
  assert.equal(updated?.message.unread, false);
});

test("Home archive command sends message IDs in one exact mailbox batch and returns its job identity", async () => {
	const calls: Array<{ messageIDs: string[]; sharedInboxID?: string; companyID?: string; accountEmail?: string }> = [];
	const archiveEmailMessagesBatch: HomeArchiveEmailMessagesBatch = async (messageIDs, sharedInboxID, companyID, options) => {
		calls.push({ messageIDs, sharedInboxID, companyID, accountEmail: options?.accountEmail });
		return archiveJob(messageIDs);
  };

  const result = await archiveHomeMailMessagesCommand({
    companyID: "company-1",
    sharedInboxID: " shared-1 ",
    accountEmail: "ignored@example.test",
    messageIDs: ["message-1", "message-2", "message-3", "message-4", "message-5", "message-6"],
    archiveEmailMessagesBatch,
  });

	assert.deepEqual(calls, [
		{ companyID: "company-1", sharedInboxID: "shared-1", accountEmail: undefined, messageIDs: ["message-1", "message-2", "message-3", "message-4", "message-5", "message-6"] },
	]);
	assert.deepEqual(result?.messageIDs, ["message-1", "message-2", "message-3", "message-4", "message-5", "message-6"]);
	assert.equal(result?.archiveJob.job_id, "archive-job-1");

  await archiveHomeMailMessagesCommand({
    companyID: "company-1",
    accountEmail: " SECOND@Example.TEST ",
    messageIDs: ["message-7"],
    archiveEmailMessagesBatch,
  });
	assert.deepEqual(calls[1], {
    companyID: "company-1",
    sharedInboxID: undefined,
    accountEmail: "second@example.test",
    messageIDs: ["message-7"],
	});
});

test("Home compose command validates send payloads and preserves body spacing", async () => {
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
    body: '<div data-mango-email-body="true" style="font:14px/1.5 Arial,sans-serif;color:#111827;white-space:pre-wrap;overflow-wrap:anywhere;"> Body </div>',
    attachments: [],
    reply_to_message_id: "message-1",
    account_email: "owner@example.test",
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
    body: '<div data-mango-email-body="true" style="font:14px/1.5 Arial,sans-serif;color:#111827;white-space:pre-wrap;overflow-wrap:anywhere;"> Reply </div>',
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

test("Home compose command sends rich editor HTML without plain-text escaping", async () => {
  const sentInputs: SendEmailInput[] = [];
  const sendEmail: HomeSendEmail = async (input) => {
    sentInputs.push(input);
    return emailMessage("sent-rich", { to: input.to, subject: input.subject, body: input.body });
  };

  await sendHomeMailComposeCommand({
    compose: {
      to: "reader@example.test",
      cc: "",
      bcc: "",
      subject: "Rich",
      body: `${EDITOR_RICH_TEXT_PREFIX}<b>Bold</b>\n  <a href="https://example.test" target="_blank" rel="noopener noreferrer">link</a>`,
      attachments: [],
      replyToMessageID: "",
    },
    sendEmail,
  });

  assert.match(sentInputs[0]?.body ?? "", /<b>Bold<\/b>/);
  assert.match(sentInputs[0]?.body ?? "", /<br>  <a href="https:\/\/example\.test\/?"/);
  assert.match(sentInputs[0]?.body ?? "", /href="https:\/\/example\.test\/?"/);
  assert.doesNotMatch(sentInputs[0]?.body ?? "", /&lt;b&gt;/);
});

test("Home compose command sends forwards as new messages with preserved original HTML", async () => {
  const sentInputs: SendEmailInput[] = [];
  const sendEmail: HomeSendEmail = async (input) => {
    sentInputs.push(input);
    return emailMessage("sent-forward", { to: input.to, subject: input.subject, body: input.body });
  };
  const source: EmailMessage = {
    id: "source-message",
    subject: "Original",
    unread: false,
    starred: false,
    from: [{ email: "source@example.test" }],
    to: [{ email: "owner@example.test" }],
    body: "<style>.original-card{color:#123456}</style><div class=\"original-card\"><strong>Original layout</strong></div>",
  };

  await sendHomeMailComposeCommand({
    compose: {
      kind: "forward",
      to: "reader@example.test",
      cc: "",
      bcc: "",
      subject: "Fwd: Original",
      body: `${EDITOR_RICH_TEXT_PREFIX}<div>FYI</div>`,
      attachments: [{
        id: "attachment-1",
        attachmentID: "attachment-1",
        filename: "brief.pdf",
        contentType: "application/pdf",
        size: 123,
      }],
      replyToMessageID: source.id,
      replyToMessage: source,
    },
    sendEmail,
  });

  assert.equal(sentInputs[0]?.reply_to_message_id, undefined);
  assert.match(sentInputs[0]?.body ?? "", /FYI/);
  assert.match(sentInputs[0]?.body ?? "", /data-mango-forwarded-message="true"/);
  assert.match(sentInputs[0]?.body ?? "", /\.original-card/);
  assert.match(sentInputs[0]?.body ?? "", /Original layout/);
  assert.equal(sentInputs[0]?.attachments?.[0]?.attachment_id, "attachment-1");
});


test("Home compose command sends an image-only rich body as a durable Mango reference", async () => {
  const sentInputs: SendEmailInput[] = [];
  const sendEmail: HomeSendEmail = async (input) => {
    sentInputs.push(input);
    return emailMessage("sent-screenshot", { to: input.to, subject: input.subject, body: input.body });
  };

  await sendHomeMailComposeCommand({
    companyID: "company-1",
    compose: {
      to: "reader@example.test",
      cc: "",
      bcc: "",
      subject: "Screenshot",
      body: `${EDITOR_RICH_TEXT_PREFIX}<span data-mango-editor-image="true" data-mango-editor-attachment-id="attachment-1"><img src="mango-attachment:attachment-1" alt=""></span>`,
      attachments: [],
      replyToMessageID: "",
    },
    sendEmail,
  });

  assert.match(sentInputs[0]?.body ?? "", /src="mango-attachment:attachment-1"/);
  assert.doesNotMatch(sentInputs[0]?.body ?? "", /data:image\//);
  assert.deepEqual(sentInputs[0]?.attachments, []);
});

test("Home compose command sends Mango attachment references without durable content", async () => {
  const sentInputs: SendEmailInput[] = [];
  const sendEmail: HomeSendEmail = async (input) => {
    sentInputs.push(input);
    return emailMessage("sent-attachment", { to: input.to, subject: input.subject, body: input.body });
  };

  await sendHomeMailComposeCommand({
    companyID: " company-1 ",
    compose: {
      to: "reader@example.test",
      cc: "",
      bcc: "",
      subject: "Attachment",
      body: "See attached.",
      attachments: [{
        id: "local-attachment-row",
        attachmentID: " mango-attachment-1 ",
        filename: "brief.pdf",
        contentType: "application/pdf",
        size: 1234,
      }],
      replyToMessageID: "",
    },
    sendEmail,
  });

  assert.deepEqual(sentInputs[0]?.attachments, [{
    id: "mango-attachment-1",
    attachment_id: "mango-attachment-1",
    filename: "brief.pdf",
    content_type: "application/pdf",
    size: 1234,
  }]);
  assert.equal(sentInputs[0]?.company_id, "company-1");
  assert.equal(sentInputs[0]?.shared_inbox_id, undefined);
  assert.equal("content" in (sentInputs[0]?.attachments?.[0] as Record<string, unknown>), false);
});

test("Home shared inbox RACI commands build direct replacement payloads", async () => {
  type SharedInboxRACIUpdatePayload = Parameters<HomeUpdateSharedInboxRACIAssignments>[2][number];
  const updateCalls: Array<{ companyID: string; folderID: string; assignments: SharedInboxRACIUpdatePayload[] }> = [];
  const updateSharedInboxRACIAssignments: HomeUpdateSharedInboxRACIAssignments = async (companyID, folderID, assignments) => {
    updateCalls.push({ companyID, folderID, assignments });
    return assignments.map((assignment): CommunicationsSharedInboxRACIAssignment => ({
      ...sharedRACI(folderID, assignment.role, assignment.user_id ?? assignment.principal_id ?? ""),
      principal_type: assignment.principal_type,
      principal_id: assignment.principal_id,
    }));
  };
  const existing = sharedRACI("inbox-1", "responsible", "user-1");
  const inboxes = [sharedInbox("inbox-1", { gvic_assignments: [existing] })];

  const added = await addSharedInboxRACIPrincipalCommand({
    companyID: "company-1",
    folderID: " inbox-1 ",
    role: "accountable",
    principalType: "user",
    principalID: " user-2 ",
    sharedInboxes: inboxes,
    companyUsers: [companyUser("user-2")],
    now: () => timestamp,
    updateSharedInboxRACIAssignments,
  });
  const removed = await removeSharedInboxRACIPrincipalCommand({
    companyID: "company-1",
    folderID: "inbox-1",
    role: "responsible",
    principalType: "user",
    principalID: "user-1",
    sharedInboxes: inboxes,
    updateSharedInboxRACIAssignments,
  });

  assert.deepEqual(updateCalls, [
    {
      companyID: "company-1",
      folderID: "inbox-1",
      assignments: [
        { role: "responsible", principal_type: "user", principal_id: "user-1", user_id: "user-1" },
        { role: "accountable", principal_type: "user", principal_id: "user-2", user_id: "user-2" },
      ],
    },
    { companyID: "company-1", folderID: "inbox-1", assignments: [] },
  ]);
  assert.deepEqual(added?.assignments.map((assignment) => [assignment.role, assignment.principal_type, assignment.principal_id, assignment.user_id]), [["responsible", "user", "user-1", "user-1"], ["accountable", "user", "user-2", "user-2"]]);
  assert.deepEqual(removed?.assignments, []);
});
