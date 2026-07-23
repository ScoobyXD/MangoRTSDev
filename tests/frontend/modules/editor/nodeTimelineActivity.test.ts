import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("node timeline plus offers text box and verification stamp without direct creation", () => {
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  assert.match(nodeSurface, /title="Add timeline entry"[\s\S]*aria-haspopup="menu"[\s\S]*setTimelineCreateMenuOpen/);
  assert.match(nodeSurface, /createTextBlock\(\)[\s\S]*New text box/);
  assert.match(nodeSurface, /createVerificationRequest\(\)[\s\S]*Verification stamp/);
  assert.doesNotMatch(nodeSurface, /title="Add text box"\s*onClick=\{createTextBlock\}/);
});

test("compact timeline rows expose immutable transfer copy and recipient-only verification controls", () => {
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  assert.match(nodeSurface, /data-node-timeline-activity="true"/);
  assert.match(nodeSurface, /data-node-timeline-event-id=\{item\.event_id\}/);
  assert.match(nodeSurface, /width: "min\(680px, calc\(100% - 16px\)\)"/);
  assert.match(nodeSurface, /moved this node from[\s\S]*from_logic_gate_name[\s\S]*to_logic_gate_name/);
  assert.match(nodeSurface, /recipient\.user_id === author\.userID/);
  assert.match(nodeSurface, /disabled=\{!isCurrentUser \|\| completed \|\| pending\}/);
  assert.match(nodeSurface, /verification-requests\/\$\{encodeURIComponent\(cleanEventID\)\}\/complete/);
  assert.match(nodeSurface, /data-node-timeline-event-id="\$\{cleanInformationID\}"/);
});

test("verified supports multiple explicit people and Updates gets verification copy", () => {
  const gvicPanel = source("frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx");
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  const updates = source("frontend/src/pages/home/UpdatesView.tsx");
  assert.match(gvicPanel, /primaryUserRole[\s\S]*role === "generated" \|\| role === "verified"/);
  assert.match(gvicPanel, /singleUserOnly = primaryUserRole && role === "generated"/);
  assert.match(editor, /const singleUserRole = role === "generated";[\s\S]*role === "verified" && principalType !== "user"/);
  assert.match(updates, /node\.verification_requested/);
  assert.match(updates, /requested verification from you on/);
  assert.match(updates, /verification: \{ color: "#4338ca"/);
});
