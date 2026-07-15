import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  clearEditorProjectionDraft,
  editorProjectionDraftKey,
  getEditorProjectionDraftTabID,
  listEditorProjectionDrafts,
  parseEditorProjectionConflict,
  readEditorProjectionDraft,
  retainEditorProjectionDraft,
  runEditorWriteWithBoundedRetry,
} from "../../../../frontend/src/modules/editor/editorProjectionSync.js";
import { createTextBlockProjectionSaveController } from "../../../../frontend/src/modules/editor/nodeTextBlockProjectionSaves.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const baseScope = { userID: "user-a", companyID: "company-a", entityKind: "logic_gate" as const, entityID: "gate-a", tabID: "tab-a", informationID: "info-a" };

test("retained drafts restore after refresh and remain scoped by authenticated user and company", () => {
  const storage = new MemoryStorage();
  retainEditorProjectionDraft(storage, baseScope, { text: "local draft", baseRevision: 7, updatedAt: "2026-07-14T00:00:00Z" });
  assert.deepEqual(readEditorProjectionDraft(storage, baseScope), { text: "local draft", baseRevision: 7, updatedAt: "2026-07-14T00:00:00Z" });
  assert.equal(readEditorProjectionDraft(storage, { ...baseScope, userID: "user-b" }), null);
  assert.equal(readEditorProjectionDraft(storage, { ...baseScope, companyID: "company-b" }), null);
  assert.deepEqual(listEditorProjectionDrafts(storage, { userID: "user-a", companyID: "company-a", entityKind: "logic_gate", entityID: "gate-a", tabID: "tab-a" }).map((entry) => entry.informationID), ["info-a"]);
  assert.notEqual(editorProjectionDraftKey(baseScope), editorProjectionDraftKey({ ...baseScope, companyID: "company-b" }));
});

test("same-document tabs retain and clear independent drafts in shared local storage", () => {
  const sharedLocalStorage = new MemoryStorage();
  const firstTabSessionStorage = new MemoryStorage();
  const firstTabID = getEditorProjectionDraftTabID(firstTabSessionStorage);
  const secondTabID = getEditorProjectionDraftTabID(new MemoryStorage());
  const firstTabScope = { ...baseScope, tabID: firstTabID };
  const secondTabScope = { ...baseScope, tabID: secondTabID };

  assert.notEqual(firstTabID, secondTabID);
  assert.equal(getEditorProjectionDraftTabID(firstTabSessionStorage), firstTabID);
  retainEditorProjectionDraft(sharedLocalStorage, firstTabScope, { text: "first tab draft", baseRevision: 7, updatedAt: "2026-07-14T00:00:00Z" });
  retainEditorProjectionDraft(sharedLocalStorage, secondTabScope, { text: "second tab draft", baseRevision: 7, updatedAt: "2026-07-14T00:00:01Z" });

  assert.equal(readEditorProjectionDraft(sharedLocalStorage, firstTabScope)?.text, "first tab draft");
  assert.equal(readEditorProjectionDraft(sharedLocalStorage, secondTabScope)?.text, "second tab draft");
  assert.deepEqual(listEditorProjectionDrafts(sharedLocalStorage, { userID: "user-a", companyID: "company-a", entityKind: "logic_gate", entityID: "gate-a", tabID: firstTabID }).map((entry) => entry.draft.text), ["first tab draft"]);
  clearEditorProjectionDraft(sharedLocalStorage, firstTabScope);
  assert.equal(readEditorProjectionDraft(sharedLocalStorage, firstTabScope), null);
  assert.equal(readEditorProjectionDraft(sharedLocalStorage, secondTabScope)?.text, "second tab draft");
});

test("bounded write retry retries delivery failures but never retries a confirmed revision conflict", async () => {
  let attempts = 0;
  const result = await runEditorWriteWithBoundedRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new TypeError("network down");
    return "ack";
  }, { delaysMs: [0, 0], sleep: async () => undefined });
  assert.equal(result, "ack");
  assert.equal(attempts, 3);

  const conflict = { status: 409, bodyText: JSON.stringify({ error: "projection_revision_conflict", current: { information_id: "info-a", type: "Text box", information: "server", revision: 9 } }) };
  attempts = 0;
  await assert.rejects(() => runEditorWriteWithBoundedRetry(async () => { attempts += 1; throw conflict; }, { delaysMs: [0, 0], sleep: async () => undefined }));
  assert.equal(attempts, 1);
  assert.equal(parseEditorProjectionConflict(conflict)?.current?.revision, 9);
});

test("two tabs from one base revision allow one ACK and preserve the stale tab without overwriting", async () => {
  let server = { text: "base", revision: 1 };
  const makeController = () => {
    const controller = createTextBlockProjectionSaveController<string>();
    controller.configure({
      saveBlock: async (request) => {
        if (request.baseRevision !== server.revision) throw { status: 409, bodyText: JSON.stringify({ error: "projection_revision_conflict", current: { information_id: "doc", type: "Text box", information: server.text, revision: server.revision } }) };
        server = { text: request.content, revision: server.revision + 1 };
        return { revision: server.revision };
      },
    });
    controller.replaceBlocksAsHasNotChanged([{ blockID: "doc", content: "base", revision: 1 }]);
    return controller;
  };
  const firstTab = makeController();
  const staleTab = makeController();
  firstTab.markHasChanged("doc", "first tab");
  await firstTab.saveLatestContent("doc");
  staleTab.markHasChanged("doc", "stale local draft");
  await assert.rejects(() => staleTab.saveLatestContent("doc"));
  assert.deepEqual(server, { text: "first tab", revision: 2 });
  assert.equal(staleTab.getSnapshot("doc")?.latestContent, "stale local draft");
  assert.equal(staleTab.getSnapshot("doc")?.hasChanged, true);
  assert.equal(staleTab.getSnapshot("doc")?.baseRevision, 1);
});

test("editor surfaces stay non-editable until identity, permission, and initial projection load complete", () => {
  const sourcePath = [
    resolve(process.cwd(), "frontend/src/modules/editor/EditorContent.tsx"),
    resolve(process.cwd(), "src/modules/editor/EditorContent.tsx"),
  ].find(existsSync);
  if (!sourcePath) throw new Error("EditorContent.tsx must be resolvable from the repo or frontend test cwd");
  const source = readFileSync(sourcePath, "utf8");
  assert.match(source, /useState\(false\).*linkedEntityCanEdit|linkedEntityCanEdit, setLinkedEntityCanEdit\] = useState\(false\)/s);
  assert.match(source, /editorWriteEnabled = linkedEntityCanEdit && linkedEditorLoaded && currentUserLoaded/);
  assert.match(source, /editable=\{editorWriteEnabled\}/);
  assert.match(source, /canEdit=\{editorWriteEnabled\}/);
});
