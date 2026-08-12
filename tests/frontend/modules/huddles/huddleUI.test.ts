import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { DEFAULT_HUDDLE_COLUMN_LAYOUT, resizeHuddleColumns } from "../../../../frontend/src/modules/huddles/huddleColumnLayout.js";

test("Huddle column dividers resize only their neighboring columns and preserve the total", () => {
  const first = resizeHuddleColumns(DEFAULT_HUDDLE_COLUMN_LAYOUT, 0, 0.1);
  assert.ok(Math.abs(first[0] - 0.56) < 1e-9);
  assert.ok(Math.abs(first[1] - 0.14) < 1e-9);
  assert.equal(first[2], 0.3);
  assert.ok(Math.abs(first.reduce((total, value) => total + value, 0) - 1) < 1e-9);

  const second = resizeHuddleColumns(DEFAULT_HUDDLE_COLUMN_LAYOUT, 1, -0.5);
  assert.equal(second[0], 0.5);
  assert.ok(Math.abs(second[1] - 0.14) < 1e-9);
  assert.ok(Math.abs(second[2] - 0.36) < 1e-9);
  assert.ok(Math.abs(second.reduce((total, value) => total + value, 0) - 1) < 1e-9);
});

test("Huddle UI uses the routed page, shared Huddle relationship cards, picker, RACI controls, icon actions, and raised sidebar rows", () => {
  const page = readFileSync(resolve(process.cwd(), "frontend/src/modules/huddles/HuddleLogicGatePage.tsx"), "utf8");
  const surface = readFileSync(resolve(process.cwd(), "frontend/src/modules/huddles/HuddleResourceSurface.tsx"), "utf8");
  const cards = readFileSync(resolve(process.cwd(), "frontend/src/modules/huddles/HuddleLogicGateCards.tsx"), "utf8");
  const kpis = readFileSync(resolve(process.cwd(), "frontend/src/modules/huddles/LogicGateKPISection.tsx"), "utf8");
  const picker = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/UniversalEntityPicker.tsx"), "utf8");
  const explorer = readFileSync(resolve(process.cwd(), "frontend/src/modules/huddles/HuddleExplorerSection.tsx"), "utf8");
  const routes = readFileSync(resolve(process.cwd(), "frontend/src/app/deepLinkRoutes.ts"), "utf8");

  assert.match(routes, /\/huddle-logic-gates\/\$\{encodeSegment\(huddleLogicGateID\)\}/);
  assert.match(page, /data-huddle-logic-gate-page="true"/);
  assert.match(surface, /<RACIAssignmentBoard/);
  assert.match(surface, /<BareMangoEditorToolbar/);
  assert.match(surface, /visibleTabIDs=\{isGate \? \["editor", "permissions", "format", "outline-styles"\] : \["permissions"\]\}/);
  assert.match(surface, /<HuddleLogicGateCards\s+items=\{logicGateCards\}/);
  assert.match(surface, /initialMode="link"/);
  assert.match(surface, /initialCategory="logic_gate"/);
  assert.match(surface, /lockMode/);
  assert.match(surface, /linkTargetTypes=\{\["logic_gate"\]\}/);
  assert.match(surface, /data-huddle-node-snapshot="true"/);
  assert.match(cards, /data-huddle-logic-gate-card/);
  assert.match(cards, /data-huddle-kpi-card/);
  assert.match(cards, /onClick=\{\(\) => onOpenLogicGate\(item\)\}/);
  assert.match(cards, /onClick=\{\(\) => onOpenKPI\(item, kpi\)\}/);
  assert.match(surface, /openEditorEntityLink\(\{ entityType: "logic_gate"/);
  assert.match(surface, /<KPIEditorPopup/);
  assert.match(kpis, /data-kpi-editor-popup="centered-large"/);
  assert.match(kpis, /saveStateStorageKey=\{saveStateStorageKey\}/);
  assert.match(kpis, /aria-label="Close KPI"/);
  assert.match(picker, /props\.lockMode/);
  assert.match(picker, /setCategory\(props\.lockMode \? option\.type : active \? "all" : option\.type\)/);
  assert.match(surface, /data-huddle-column-layout=\{isGate \? "three-resizable-columns" : "two-resizable-columns"\}/);
  assert.match(surface, /role="separator"/);
  assert.match(surface, /<PinToSidebarIcon/);
  assert.match(surface, /<HeaderRecycleBinIcon/);
  assert.match(surface, /data-huddle-node-popup="almost-fullscreen"/);
  assert.doesNotMatch(surface, /Principal type: user or group|User UUID|Group UUID/);

  assert.match(explorer, /data-sidebar-huddles-surface="elevated"/);
  assert.match(explorer, /data-huddle-row-raised/);
  assert.match(explorer, /<HuddlePeopleIcon/);
  assert.match(explorer, /<HuddleResourceIcon type=\{item\.resource_type\}/);
  assert.match(explorer, /resource_type: "huddle_logic_gate"/);
  assert.doesNotMatch(explorer, /visibleItems/);
  assert.match(explorer, /onClick=\{\(\) => openItem\(item\)\}/);
  assert.doesNotMatch(explorer, /onDoubleClick=\{\(\) => openItem\(item\)\}/);
  assert.match(surface, /name: "New Huddle Node"/);
  assert.doesNotMatch(surface, /window\.prompt\("Huddle Node name"/);
  assert.match(surface, /onClick=\{\(\) => onOpenNode\(/);
  assert.doesNotMatch(surface, /onDoubleClick=\{\(\) => onOpenNode\(/);
});
