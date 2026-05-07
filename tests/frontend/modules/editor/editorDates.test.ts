import test from "node:test";
import assert from "node:assert/strict";
import { formatNodeDueDateForEditor, normalizeNodeDueDateDraft } from "../../../../frontend/src/modules/editor/editorDates.js";

test("normalizes flexible slash due-date input", () => {
  assert.equal(normalizeNodeDueDateDraft("5/7/26"), "2026-05-07");
  assert.equal(normalizeNodeDueDateDraft("05/7/2026"), "2026-05-07");
  assert.equal(normalizeNodeDueDateDraft("5 / 07 / 26"), "2026-05-07");
  assert.equal(normalizeNodeDueDateDraft("12/31/99"), "1999-12-31");
});

test("keeps ISO due dates and rejects impossible dates", () => {
  assert.equal(normalizeNodeDueDateDraft("2026-05-07"), "2026-05-07");
  assert.equal(normalizeNodeDueDateDraft("2/31/26"), null);
  assert.equal(normalizeNodeDueDateDraft(""), "");
});

test("formats stored ISO due dates for the editor", () => {
  assert.equal(formatNodeDueDateForEditor("2026-05-07"), "5/7/2026");
});
