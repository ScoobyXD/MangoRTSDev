import test from "node:test";
import assert from "node:assert/strict";
import type { CommunicationsSharedInbox } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { LogicGateRecord } from "../../../../frontend/src/modules/logic-gate-map/shared.js";
import type { NodeRecord } from "../../../../frontend/src/modules/node-map/shared.js";
import {
  buildAciInboxGroupsByCell,
  buildResponsibleInboxGroupsByCell,
  buildSharedInboxRows,
  getHomeViewLabel,
  getInboxMatrixGridTemplateColumns,
  mailboxForHomeView,
  resizeHomeColumns,
} from "../../../../frontend/src/pages/home/homeUtils.js";

function sharedInbox(id: string, name: string, position: number, parentID?: string): CommunicationsSharedInbox {
  return {
    company_id: "company-1",
    folder_id: id,
    parent_folder_id: parentID,
    folder_kind: "communications",
    name,
    position,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
}

function node(id: string, title: string, overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    company_id: "company-1",
    node_id: id,
    title,
    created_timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function logicGate(id: string, roles: LogicGateRecord["raci_assignments"]): LogicGateRecord {
  return {
    company_id: "company-1",
    logic_gate_id: id,
    header: id,
    raci_assignments: roles,
    created_timestamp: "2026-01-01T00:00:00Z",
  };
}

test("Home view helpers map labels and mailboxes without changing backend mailbox names", () => {
  const shared = [sharedInbox("shared-a", "Team Triage", 1000)];

  assert.equal(getHomeViewLabel("my-triage", shared), "My Triage");
  assert.equal(getHomeViewLabel("shared:shared-a", shared), "Team Triage");
  assert.equal(getHomeViewLabel("shared:missing", shared), "Shared Triage");
  assert.equal(mailboxForHomeView("aci-inbox"), "all");
  assert.equal(mailboxForHomeView("my-triage"), "primary");
});

test("shared inbox rows are stable, sorted, and nested by parent", () => {
  const rows = buildSharedInboxRows([
    sharedInbox("child-b", "Child B", 2000, "root"),
    sharedInbox("root", "Root", 1000),
    sharedInbox("child-a", "Child A", 1000, "root"),
  ]);

  assert.deepEqual(rows.map((row) => [row.folder.folder_id, row.depth]), [
    ["root", 0],
    ["child-a", 1],
    ["child-b", 1],
  ]);
});

test("inbox group builders classify ACI and responsible work by role, status, and priority", () => {
  const currentUserID = "user-1";
  const gates = new Map([
    ["gate-a", logicGate("gate-a", [{ company_id: "company-1", logic_gate_id: "gate-a", role: "accountable", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-r", logicGate("gate-r", [{ company_id: "company-1", logic_gate_id: "gate-r", role: "responsible", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
  ]);
  const nodes = [
    node("node-a", "ACI node", { logic_gate_ids: ["gate-a"], priority: 1 }),
    node("node-r", "Responsible node", { logic_gate_ids: ["gate-r"], status: "in_progress", priority: 2 }),
  ];
  const nodeByID = new Map(nodes.map((item) => [item.node_id, item]));

  assert.deepEqual(buildAciInboxGroupsByCell(nodes, nodeByID, gates, currentUserID).get("accountable:1")?.[0]?.nodeIDs, ["node-a"]);
  assert.deepEqual(buildResponsibleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID).get("in_progress:2")?.[0]?.nodeIDs, ["node-r"]);
});

test("home column sizing keeps generated grid tracks stable", () => {
  const widths = resizeHomeColumns([200, 320, 360, 380], 1, 80, 1400);

  assert.deepEqual(widths, [200, 400, 390, 380]);
  assert.equal(getInboxMatrixGridTemplateColumns(widths), "200px minmax(760px, 1fr) 380px");
});
