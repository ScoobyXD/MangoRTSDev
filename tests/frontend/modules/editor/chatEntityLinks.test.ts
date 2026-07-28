import assert from "node:assert/strict";
import test from "node:test";

import {
  editorChatEntityLinkPayloads,
  parseEditorChatEntityLinks,
  remapEditorChatEntityLinks,
  replaceEditorChatEntityDraft,
  splitEditorChatTextByEntityLinks,
  trimEditorChatDraft,
  type EditorChatEntityLink,
} from "../../../../frontend/src/modules/editor/chatEntityLinks.js";

const project = { entityType: "project" as const, entityID: "project-1", label: "Project One" };

test("chat entity replacement keeps exact identity while inserting readable text", () => {
  const replacement = replaceEditorChatEntityDraft("See #Proj today", [], {
    start: 4,
    end: 9,
    query: "Proj",
    trigger: "#",
  }, project);

  assert.equal(replacement.message, "See #Project One today");
  assert.equal(replacement.caret, 16);
  assert.deepEqual(replacement.entityLinks, [{
    start: 4,
    end: 16,
    entityType: "project",
    entityID: "project-1",
    label: "Project One",
  }]);
  assert.deepEqual(splitEditorChatTextByEntityLinks(replacement.message, replacement.entityLinks), [
    { text: "See " },
    { text: "#Project One", entity: replacement.entityLinks[0] },
    { text: " today" },
  ]);
});

test("chat entity offsets move with outside edits and are discarded by edits inside the label", () => {
  const link: EditorChatEntityLink = {
    start: 4,
    end: 16,
    entityType: "project",
    entityID: "project-1",
    label: "Project One",
  };
  assert.deepEqual(remapEditorChatEntityLinks("See #Project One", "Please See #Project One", [link]), [{ ...link, start: 11, end: 23 }]);
  assert.deepEqual(remapEditorChatEntityLinks("See #Project One", "See #Project 1", [link]), []);
});

test("chat entity payloads trim safely and reject stale or unsupported records", () => {
  const trimmed = trimEditorChatDraft("  #Project One  ", [{
    start: 2,
    end: 14,
    entityType: "project",
    entityID: "project-1",
    label: "Project One",
  }]);
  assert.equal(trimmed.message, "#Project One");
  assert.deepEqual(editorChatEntityLinkPayloads(trimmed.message, trimmed.entityLinks), [{
    start: 0,
    end: 12,
    entity_type: "project",
    entity_id: "project-1",
    label: "Project One",
  }]);
  assert.deepEqual(parseEditorChatEntityLinks([
    { start: 0, end: 12, entity_type: "project", entity_id: "project-1", label: "Project One" },
    { start: 0, end: 12, entity_type: "folder", entity_id: "folder-1", label: "Project One" },
    { start: 0, end: 4, entity_type: "node", entity_id: "node-1", label: "Stale" },
  ], trimmed.message), trimmed.entityLinks);
});
