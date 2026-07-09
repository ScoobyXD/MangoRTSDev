import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE,
  UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS,
} from "../../../../frontend/src/modules/editor/unifiedRichEditorContract.js";

test("unified rich editor contract lists every Phase 1 target surface", () => {
  assert.equal(UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE, "useEditorDocumentSurfaceHandlers");
  assert.deepEqual(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.map((surface) => surface.id), [
    "logic-gate-editor",
    "node-text-block",
    "project-text-block",
    "my-triage-compose",
    "shared-triage-compose",
    "attached-email-reply",
  ]);
  assert.ok(UNIFIED_RICH_EDITOR_SURFACE_CONTRACTS.every((surface) => surface.chatSurface === false));
});

test("mail compose and attached-email reply mount unified rich editor adapters", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");

  assert.match(homeParts, /UnifiedRichEditorSurface/);
  assert.match(homeParts, /composeEditorSurfaceID/);
  assert.match(homeParts, /"my-triage-compose"/);
  assert.match(homeParts, /"shared-triage-compose"/);
  assert.doesNotMatch(homeParts, /document\.execCommand/);

  assert.match(nodeWorkspaceParts, /UnifiedRichEditorSurface/);
  assert.match(nodeWorkspaceParts, /surfaceID="attached-email-reply"/);
  assert.match(nodeWorkspaceParts, /unifiedRichEditorBodyToEmailHTML/);
});

test("EmailPickerModal remains attach-only and cannot compose or send mail", () => {
  const nodeWorkspaceParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const start = nodeWorkspaceParts.indexOf("export const EmailPickerModal");
  const end = nodeWorkspaceParts.indexOf("function messageDocument", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const emailPickerModal = nodeWorkspaceParts.slice(start, end);

  assert.match(emailPickerModal, /onAttach/);
  assert.doesNotMatch(emailPickerModal, /composeOpen|composeDraft|submitCompose/);
  assert.doesNotMatch(emailPickerModal, /sendEmail\s*\(/);
  assert.doesNotMatch(emailPickerModal, /<textarea|Schedule send|Save draft|Save to|Write a reply|Send message/);
});
