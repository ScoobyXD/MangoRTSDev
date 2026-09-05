import assert from "node:assert/strict";
import test from "node:test";
import { compareStatusKanbanNodes, STATUS_KANBAN_COLUMNS, statusKanbanNodeMatchesFilter, statusKanbanNodeMovePlan } from "../../../../frontend/src/modules/kanban/statusKanban.js";
import type { ProcessWorkNode } from "../../../../frontend/src/modules/kanban/processWork.js";

const node = (node_id: string, status = "In Progress", position = 1000, process_step_id: string | null = "step-a"): ProcessWorkNode => ({ node_id, node_title: node_id, status, position, process_step_id, is_issue: false, created_timestamp: "2026-09-03T00:00:00Z" });

test("status lanes keep the deployed colors, main columns, and lower Requested/Backlogs lanes", () => {
  assert.deepEqual(STATUS_KANBAN_COLUMNS.map(({ status, color, width, height, lane }) => [status, color, width, height, lane]), [
    ["Requested", "#facc15", 260, 280, "bottom"], ["Backlogs", "#8b5cf6", 260, 280, "bottom"],
    ["Pending", "#6f7b8a", 260, 720, "main"], ["In Progress", "#f08a24", 260, 720, "main"],
    ["Review", "#19a8ff", 260, 720, "main"], ["Done", "#19c879", 260, 720, "main"],
  ]);
});

test("status drag ranks within the target status and never changes step or Issue", () => {
  const nodes = [{ ...node("moving", "Review", 750, "step-a"), is_issue: true }, node("first", "Pending", 1000, "step-b"), node("last", "Pending", 3000), node("other", "Done", 9000)];
  const original = structuredClone(nodes);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["moving"], "Pending", "last"), [{ node_id: "moving", status: "Pending", position: 2000 }]);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["moving"], "Pending"), [{ node_id: "moving", status: "Pending", position: 4000 }]);
  assert.deepEqual(nodes, original);
  assert.deepEqual(statusKanbanNodeMovePlan([node("new", "Pending", 3000, null)], ["new"], "In Progress"), [{ node_id: "new", status: "In Progress", position: 1000 }]);
});

test("batch drag preserves supplied selection order, deduplicates IDs, and only reindexes the target status", () => {
  const nodes = [node("a", "Review", 10), node("b", "Done", 20), node("first", "Pending", 1000), node("last", "Pending", 1001), node("other", "In Progress", 1001)];
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["b", "a", "b", "missing"], "Pending", "last", { priority: 2 }), [
    { node_id: "b", status: "Pending", priority: 2, position: 2000 },
    { node_id: "a", status: "Pending", priority: 2, position: 3000 },
    { node_id: "last", position: 4000 },
  ]);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, [], "Pending", "last"), []);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["missing"], "Pending", "last"), []);
});

test("Date Added sorting changes status and numeric priority without writing rank", () => {
  const nodes = [{ ...node("moving", "Review", 4120), priority: 4 }];
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["moving"], "Pending", undefined, { dateAddedSort: true, priority: 2 }), [{ node_id: "moving", status: "Pending", priority: 2 }]);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["moving"], "Review", undefined, { dateAddedSort: true }), []);
  for (const priority of [0, 6, 1.5, NaN, "2" as unknown as number]) {
    assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["moving"], "Review", undefined, { dateAddedSort: true, priority }), []);
  }
});

test("manual drop on selection, a missing target, or the same order avoids changes", () => {
  const nodes = [node("a", "Pending", 1000), node("b", "Pending", 3000)];
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["a"], "Pending", "a"), []);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["a"], "Pending", "missing"), []);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["a"], "Pending", "b"), []);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["b"], "Pending"), []);
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["b"], "Pending", undefined, { priority: 3 }), [{ node_id: "b", priority: 3 }]);
});

test("manual append compacts only its lane before PostgreSQL rank overflow", () => {
  const nodes = [node("a", "Pending", 2147483600), node("moving", "Review", 2000), node("other", "Done", 1000)];
  assert.deepEqual(statusKanbanNodeMovePlan(nodes, ["moving"], "Pending"), [{ node_id: "a", position: 1000 }, { node_id: "moving", status: "Pending" }]);
});

test("lane ordering uses exact Node IDs for ties and dates only when enabled", () => {
  const nodes = [node("b"), node("a"), { ...node("new", "Pending", 500), created_timestamp: "2026-09-04T00:00:00Z" }];
  assert.deepEqual([...nodes].sort(compareStatusKanbanNodes).map((item) => item.node_id), ["new", "a", "b"]);
  assert.deepEqual([...nodes].sort((a, b) => compareStatusKanbanNodes(a, b, { dateAddedSort: true, dateAddedDirection: "asc" })).map((item) => item.node_id), ["a", "b", "new"]);
  assert.deepEqual([...nodes].sort((a, b) => compareStatusKanbanNodes(a, b, { dateAddedSort: true })).map((item) => item.node_id), ["new", "a", "b"]);
});

test("search finds Node metadata and combines with exact account filtering", () => {
  const item: ProcessWorkNode = { ...node("node-42", "In Progress"), node_title: "Prepare invoice", is_issue: true, due_date: "2026-09-08", priority: 3, accounts: [{ company_id: "company", account_id: "account-7", name: "Acme", created_timestamp: "2026-09-01T00:00:00Z" }] };
  for (const query of [" invoice ", "NODE-42", "in_progress", "In Progress", "issue", "2026-09-08", "3", "acme", "account-7"]) assert.equal(statusKanbanNodeMatchesFilter(item, query), true, query);
  assert.equal(statusKanbanNodeMatchesFilter(item, "invoice", ["account-7"]), true);
  assert.equal(statusKanbanNodeMatchesFilter(item, "invoice", ["account-70"]), false);
  assert.equal(statusKanbanNodeMatchesFilter(item, "missing", ["account-7"]), false);
  assert.equal(statusKanbanNodeMatchesFilter(node("empty"), "", ["account-7"]), false);
});
