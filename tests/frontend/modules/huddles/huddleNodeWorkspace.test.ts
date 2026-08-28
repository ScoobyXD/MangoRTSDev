import assert from "node:assert/strict";
import test from "node:test";
import {
  createHuddleNodeChat,
  createHuddleNodeTextBox,
  deleteHuddleNodeChat,
  deleteHuddleNodeTextBox,
  getHuddleNodeWorkspace,
  updateHuddleNodeChat,
  updateHuddleNodeTextBoxTitle,
  type HuddleNodeWorkspaceRequest,
} from "../../../../frontend/src/modules/huddles/huddleNodeWorkspaceApi.js";

test("Huddle Node workspace API uses one scoped workspace and text-box contract", async () => {
  const calls: Array<{ path: string; init?: RequestInit & { json?: unknown } }> = [];
  const request: HuddleNodeWorkspaceRequest = async <T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    calls.push({ path, init });
    if (path.endsWith("/workspace?company_id=company-1")) {
      return {
        textboxes: [{ textbox_id: "box-1", title: "Decisions", revision: 3, created_timestamp: "created", updated_timestamp: "updated" }],
        chats: [{ chat_id: "chat-1", textbox_id: "box-1", selection_quote: "Ask", selection_start: 0, selection_end: 3, message: "Ask #Costco", author_id: "user-1", author_display_name: "Ada", entity_links: [{ start: 4, end: 11, entity_type: "entity", entity_id: "entity-1", label: "Costco" }], mentioned_user_ids: ["user-2"], revision: 4, created_timestamp: "created", updated_timestamp: "created" }],
      } as T;
    }
    if (path.endsWith("/textboxes")) return { textbox: { textbox_id: "box-2", title: "New text box", revision: 1, created_timestamp: "created", updated_timestamp: "created" } } as T;
    if (path.includes("/documents/box-2")) return { projection_revision: 2 } as T;
    if (path.endsWith("/chats") || path.includes("/chats/chat-2")) return { chat: { chat_id: "chat-2", textbox_id: "box-2", selection_quote: "Delay", selection_start: 2, selection_end: 7, message: "Follow up", author_id: "user-1", author_display_name: "Ada", entity_links: [], mentioned_user_ids: [], mentioned_group_ids: [], revision: 6, created_timestamp: "created", updated_timestamp: "created" } } as T;
    return {} as T;
  };

  const workspace = await getHuddleNodeWorkspace(request, { companyID: "company-1", huddleNodeID: "node-1" });
  assert.equal(workspace.textboxes[0]?.textbox_id, "box-1");
  assert.equal(workspace.chats[0]?.entity_links[0]?.entityID, "entity-1");
  assert.equal(workspace.chats[0]?.selection_start, 0);
  assert.equal(workspace.chats[0]?.revision, 4);

  await createHuddleNodeTextBox(request, { companyID: "company-1", huddleNodeID: "node-1", title: "New text box" });
  await updateHuddleNodeTextBoxTitle(request, { companyID: "company-1", huddleNodeID: "node-1", textBoxID: "box-2", title: "Owners" });
  await createHuddleNodeChat(request, {
    companyID: "company-1",
    huddleNodeID: "node-1",
    textBoxID: "box-2",
    message: "Follow up",
    selectionQuote: "Delay",
    selectionStart: 2,
    selectionEnd: 7,
  });
  await updateHuddleNodeChat(request, {
    companyID: "company-1",
    huddleNodeID: "node-1",
    textBoxID: "box-2",
    chatID: "chat-2",
    revision: 6,
    parentChatID: "chat-1",
    message: "Resolved",
    selectionQuote: "Delay",
    selectionStart: 2,
    selectionEnd: 7,
  });
  await deleteHuddleNodeChat(request, { companyID: "company-1", huddleNodeID: "node-1", chatID: "chat-2", revision: 7 });
  await deleteHuddleNodeTextBox(request, { companyID: "company-1", huddleNodeID: "node-1", textBoxID: "box-2", revision: 8 });

  assert.equal(calls[0]?.path, "/v1/huddle-nodes/node-1/workspace?company_id=company-1");
  assert.deepEqual(calls[1]?.init?.json, { company_id: "company-1", title: "New text box" });
  assert.equal(calls[2]?.path, "/v1/editor-json/huddle_node/node-1/documents/box-2?company_id=company-1");
  assert.deepEqual(calls[2]?.init?.json, { title: "Owners" });
  assert.deepEqual(calls[3]?.init?.json, {
    company_id: "company-1",
    textbox_id: "box-2",
    parent_chat_id: undefined,
    selection_quote: "Delay",
    selection_start: 2,
    selection_end: 7,
    message: "Follow up",
    entity_links: [],
    mentioned_user_ids: [],
    mentioned_group_ids: [],
  });
  assert.deepEqual(calls[4]?.init?.json, {
    company_id: "company-1",
    textbox_id: "box-2",
    parent_chat_id: "chat-1",
    selection_quote: "Delay",
    selection_start: 2,
    selection_end: 7,
    message: "Resolved",
    entity_links: [],
    mentioned_user_ids: [],
    mentioned_group_ids: [],
    base_revision: 6,
  });
  assert.equal(calls[5]?.path, "/v1/huddle-nodes/node-1/chats/chat-2?company_id=company-1&revision=7");
  assert.equal(calls[6]?.path, "/v1/editor-json/huddle_node/node-1/documents/box-2?company_id=company-1");
  const deleteBody = calls[6]?.init?.json as Record<string, unknown>;
  assert.equal(deleteBody.base_revision, 8);
  assert.match(String(deleteBody.operation_id), /^[0-9a-f-]{36}$/i);
  assert.match(String(deleteBody.client_id), /^[0-9a-f-]{36}$/i);
});
