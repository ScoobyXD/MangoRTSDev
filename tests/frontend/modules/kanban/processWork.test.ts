import assert from "node:assert/strict";
import test from "node:test";
import { processNodeMovePlan, processWorkCounts, processWorkView, type ProcessWorkNode } from "../../../../frontend/src/modules/kanban/processWork.js";

const node = (node_id: string, status = "In Progress", process_step_id: string | null = "step-a", position = 1000): ProcessWorkNode => ({ node_id, node_title: node_id, status, process_step_id, position, is_issue: false, created_timestamp: "2026-09-03T00:00:00Z" });

test("status selects exactly one view and Issue never overrides it", () => {
  const nodes = ["Requested", "Pending", "Backlogs", "In Progress", "Review", "Done"].map((status, i) => ({ ...node(String(i), status), is_issue: true }));
  assert.deepEqual(nodes.map(processWorkView), ["Requested", "Pending", "Backlog", "Steps", "Steps", "Done"]);
  assert.deepEqual(processWorkCounts(nodes), { Steps: 2, Requested: 1, Pending: 1, Backlog: 1, Done: 1 });
  assert.equal(processWorkView(node("invalid", "Issue")), null);
  assert.equal(processWorkView(node("unassigned", "Review", null)), "Steps");
});

test("moving one active Node writes only its step and sparse position", () => {
  const nodes = [node("move", "Review", "step-a"), node("before", "In Progress", "step-b", 1000), node("after", "In Progress", "step-b", 3000), node("done", "Done", "step-b", 2000)];
  const original = structuredClone(nodes);
  assert.deepEqual(processNodeMovePlan(nodes, ["move"], "step-b", "after"), [{ node_id: "move", process_step_id: "step-b", position: 2000 }]);
  assert.deepEqual(nodes, original, "planning must preserve all existing Node fields");
  assert.equal(nodes[3].process_step_id, "step-b", "completed records retain their previous step");
});

test("multi-Node moves preserve order and only rebalance an exhausted gap", () => {
  const nodes = [node("a", "In Progress", null, 1000), node("b", "Review", null, 2000), node("before", "In Progress", "step-b", 1000), node("after", "In Progress", "step-b", 1001)];
  assert.deepEqual(processNodeMovePlan(nodes, ["b", "a"], "step-b", "after"), [
    { node_id: "a", process_step_id: "step-b", position: 2000 },
    { node_id: "b", process_step_id: "step-b", position: 3000 },
    { node_id: "after", process_step_id: "step-b", position: 4000 },
  ]);
  assert.deepEqual(processNodeMovePlan(nodes, ["a"], null), [{ node_id: "a", process_step_id: null, position: 3000 }]);
});

test("Date Added sorting moves steps without changing stored rank", () => {
  const nodes = [node("moving", "Review", "step-a", 4210), node("target", "In Progress", "step-b", 5000)];
  assert.deepEqual(processNodeMovePlan(nodes, ["moving"], "step-b", "target", {dateAddedSort:true}), [{node_id:"moving",process_step_id:"step-b"}]);
  assert.deepEqual(processNodeMovePlan(nodes, ["moving"], "step-a", undefined, {dateAddedSort:true}), []);
});

test("priority headings accept levels one through five and never clear priority", () => {
  const nodes = [{...node("moving", "Review", "step-a", 4210), priority:4}];
  assert.deepEqual(processNodeMovePlan(nodes, ["moving"], "step-a", undefined, {dateAddedSort:true,priority:2}), [{node_id:"moving",process_step_id:"step-a",priority:2}]);
  assert.deepEqual(processNodeMovePlan(nodes, ["moving"], "step-a", undefined, {dateAddedSort:true,priority:0}), []);
  assert.deepEqual(processNodeMovePlan(nodes, ["moving"], "step-b", undefined, {dateAddedSort:true,priority:0}), [{node_id:"moving",process_step_id:"step-b"}]);
});
