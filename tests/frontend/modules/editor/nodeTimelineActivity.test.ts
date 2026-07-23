import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("node timeline plus offers text box and verification stamp without direct creation", () => {
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  const styles = source("frontend/src/index.css");
  assert.match(nodeSurface, /title="Add timeline entry"[\s\S]*aria-haspopup="menu"[\s\S]*setTimelineCreateMenuOpen/);
  assert.match(nodeSurface, /createTextBlock\(\)[\s\S]*New text box/);
  assert.match(nodeSurface, /createVerificationRequest\(\)[\s\S]*Verification stamp/);
  assert.equal(nodeSurface.match(/className="mango-timeline-create-menu-item"/g)?.length, 2);
  assert.match(styles, /\.mango-timeline-create-menu-item:not\(:disabled\):hover,[\s\S]*\.mango-timeline-create-menu-item:not\(:disabled\):focus-visible/);
  assert.match(nodeSurface, /Verification stamp[\s\S]*Request everyone assigned to Verified/);
  assert.doesNotMatch(nodeSurface, /role="menuitem"[\s\S]{0,300}verificationRequestPending[\s\S]{0,300}background: "rgba\(99,102,241,0\.08\)"/);
  assert.doesNotMatch(nodeSurface, /title="Add text box"\s*onClick=\{createTextBlock\}/);
});

test("compact timeline rows expose immutable transfer copy and recipient-only verification controls", () => {
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  assert.match(nodeSurface, /data-node-timeline-activity="true"/);
  assert.match(nodeSurface, /data-node-timeline-event-id=\{item\.event_id\}/);
  assert.match(nodeSurface, /width: "min\(680px, calc\(100% - 16px\)\)"/);
  assert.match(nodeSurface, /fromLogicGateName = item\.from_logic_gate_name[\s\S]*toLogicGateName = item\.to_logic_gate_name/);
  assert.match(nodeSurface, /moved this node from[\s\S]*fromLogicGateName[\s\S]*toLogicGateName/);
  assert.match(nodeSurface, /<TimelineCell accent=\{accent\} muted=\{false\} isLast=\{false\} minHeight=/);
  assert.match(nodeSurface, /<time[\s\S]*<TimelineClockIcon[\s\S]*Logic Gate transfer/);
  assert.match(nodeSurface, /data-node-timeline-gate-icon="header"[\s\S]*data-node-timeline-gate-icon="from"[\s\S]*data-node-timeline-gate-icon="to"/);
  assert.doesNotMatch(nodeSurface, /background: isVerification \? "#6366f1" : "#0ea5e9"/);
  assert.match(nodeSurface, /recipient\.user_id === author\.userID/);
  assert.match(nodeSurface, /disabled=\{!isCurrentUser \|\| completed \|\| pending\}/);
  assert.match(nodeSurface, /verification-requests\/\$\{encodeURIComponent\(cleanEventID\)\}\/complete/);
  assert.match(nodeSurface, /Could not reach the server\. Check your connection and try again\./);
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
