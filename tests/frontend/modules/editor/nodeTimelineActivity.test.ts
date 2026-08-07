import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { groupNodeTimelineEventsByTextBlock } from "../../../../frontend/src/modules/editor/nodeTimelineOrdering.js";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("node timeline plus offers text box and verify stamp without direct creation", () => {
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  const styles = source("frontend/src/index.css");
  assert.match(nodeSurface, /title="Add timeline entry"[\s\S]*aria-haspopup="menu"[\s\S]*setTimelineCreateMenuOpen/);
  assert.match(nodeSurface, /createTextBlock\(\)[\s\S]*New text box/);
  assert.match(nodeSurface, /createVerificationRequest\(\)[\s\S]*Verify stamp/);
  assert.equal(nodeSurface.match(/className="mango-timeline-create-menu-item"/g)?.length, 2);
  assert.match(styles, /\.mango-timeline-create-menu-item:not\(:disabled\):hover,[\s\S]*\.mango-timeline-create-menu-item:not\(:disabled\):focus-visible/);
  assert.match(nodeSurface, /Verify stamp[\s\S]*Request everyone assigned to Accountable/);
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
  assert.match(nodeSurface, /data-node-timeline-gate-icon="header"/);
  assert.match(nodeSurface, /data-node-timeline-gate-icon=\{position\}/);
  assert.match(nodeSurface, /position="from"[\s\S]*position="to"/);
  assert.match(nodeSurface, /alignItems: "stretch", alignContent: "start"/);
  assert.match(nodeSurface, /data-node-timeline-logic-gate-link=\{position\}/);
  assert.match(nodeSurface, /openEditorEntityLink\(\{ entityType: "logic_gate", entityID: cleanLogicGateID, label: logicGateName \}\)/);
  assert.doesNotMatch(nodeSurface, /background: isVerification \? "#6366f1" : "#0ea5e9"/);
  assert.match(nodeSurface, /recipient\.user_id === author\.userID/);
  assert.match(nodeSurface, /disabled=\{!isCurrentUser \|\| completed \|\| pending\}/);
  assert.match(nodeSurface, /verification-requests\/\$\{encodeURIComponent\(cleanEventID\)\}\/complete/);
  assert.match(nodeSurface, /Could not reach the server\. Check your connection and try again\./);
  const focusHelper = source("frontend/src/modules/editor/transientInformationFocus.ts");
  assert.match(nodeSurface, /scheduleTransientInformationFocus\(\{ root: \(\) => root/);
  assert.match(focusHelper, /"data-node-timeline-event-id"/);
});

test("every RACI role supports multiple people and groups while Updates keeps verification copy", () => {
  const gvicPanel = source("frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx");
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  const updates = source("frontend/src/pages/home/UpdatesView.tsx");
  assert.match(gvicPanel, /inputPlaceholder = disabledReason \? "Inherited" : "Add user or team"/);
  assert.match(gvicPanel, /assignments\.map\(RACIAssignmentLabel\)\.filter\(Boolean\)\.join\(", "\)/);
  assert.match(gvicPanel, /principalType: "group"[\s\S]*selectable: state\.selectable/);
  assert.doesNotMatch(gvicPanel, /primaryUserRole|singleUserOnly|People \(/);
  assert.doesNotMatch(editor, /singleUserRole|role === "accountable" && principalType !== "user"/);
  assert.match(updates, /node\.verification_requested/);
  assert.match(updates, /requested verification from you on/);
  assert.match(updates, /verification: \{ color: "#4338ca"/);
  assert.ok(
    updates.indexOf('if (item.type === NOTIFICATION_TYPE_NODE_VERIFICATION_REQUESTED) return "verification"')
      < updates.indexOf('/node added|new node|brand new node/.test(text)'),
    "an explicit verification notification must win over a node title such as 'new node'",
  );
});

test("node timeline interleaves text boxes, transfers, and verify stamps newest first", () => {
  const blocks = [
    { id: "new-text-box", createdTimestamp: "2026-07-23T20:03:00.000Z" },
    { id: "old-text-box", createdTimestamp: "2026-07-23T20:01:00.000Z" },
  ];
  const events = [
    { event_id: "transfer", created_timestamp: "2026-07-23T20:02:00.000Z" },
    { event_id: "verify-stamp", created_timestamp: "2026-07-23T20:04:00.000Z" },
  ];

  const slots = groupNodeTimelineEventsByTextBlock(blocks, events);
  const orderedIDs = [
    ...slots[0].map((event) => event.event_id),
    blocks[0].id,
    ...slots[1].map((event) => event.event_id),
    blocks[1].id,
    ...slots[2].map((event) => event.event_id),
  ];

  assert.deepEqual(orderedIDs, ["verify-stamp", "new-text-box", "transfer", "old-text-box"]);
});
