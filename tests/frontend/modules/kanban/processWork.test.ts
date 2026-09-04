import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { mergeCreatedProcessStep, processNodeMovePlan, processWorkCounts, processWorkView, type ProcessStep, type ProcessWorkNode } from "../../../../frontend/src/modules/kanban/processWork.js";

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

test("a new Process step appears immediately to the right of its source", () => {
  const steps: ProcessStep[] = [
    { process_step_id: "a", logic_gate_id: "process", name: "A", position: 1000 },
    { process_step_id: "b", logic_gate_id: "process", name: "B", position: 1001 },
  ];
  const inserted = mergeCreatedProcessStep(steps, { process_step_id: "new", logic_gate_id: "process", name: "New", position: 2000 }, { b: 3000 });
  assert.deepEqual(inserted.map((step) => [step.process_step_id, step.position]), [["a", 1000], ["new", 2000], ["b", 3000]]);
  assert.deepEqual(steps.map((step) => [step.process_step_id, step.position]), [["a", 1000], ["b", 1001]], "optimistic ordering must not mutate the snapshot");

  const repeated = mergeCreatedProcessStep(inserted, { process_step_id: "newest", logic_gate_id: "process", name: "Newest", position: 1500 });
  assert.deepEqual(repeated.map((step) => step.process_step_id), ["a", "newest", "new", "b"], "the newest Add next step remains the immediate right neighbor");

  const sparse = mergeCreatedProcessStep([
    { ...steps[0], position: 1000 },
    { ...steps[1], position: 2000 },
  ], { process_step_id: "midpoint", logic_gate_id: "process", name: "Midpoint", position: 1500 });
  assert.deepEqual(sparse.map((step) => [step.process_step_id, step.position]), [["a", 1000], ["midpoint", 1500], ["b", 2000]], "sparse server positions remain authoritative");
});

test("Process cards reuse the canonical Node icon and status and urgency labels", () => {
  const card = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/ProcessNodeCard.tsx"), "utf8");
  const styles = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/processWork.css"), "utf8");
  assert.match(card, /ExplorerEntityIcon kind="node" className="mango-editor-entity-icon"/);
  assert.match(card, /<ExplorerEntityIcon kind="node" className="mango-editor-entity-icon" \/>\s*<span className="mango-editor-entity-label">/);
  assert.match(card, /process-work__node-title mango-editor-entity-link mango-editor-entity-link--node/);
  assert.match(card, /process-work__status-label/);
  assert.match(card, /KANBAN_NODE_PRIORITY_STYLE_OPTIONS\.find/);
  assert.match(card, /background: priorityStyle\.surface/);
  assert.match(styles, /\.process-work \.process-work__node-title[^\n]*align-items:flex-start[^\n]*border:0[^\n]*background:none[^\n]*font-size:14px/);
  const titleRules = styles.match(/\.process-work[^\n{]*\.process-work__node-title[^\n]*\{[^\n]*\}/g) ?? [];
  assert.ok(titleRules.length >= 3);
  for (const rule of titleRules) assert.doesNotMatch(rule, /var\(--status-color\)/);
  assert.match(styles, /\.process-work__status-label[^\n]*color:#334155[^\n]*font-size:11\.5px/);
  assert.match(styles, /\.process-work--dark \.process-work__status-label[^\n]*color:#f8fafc/);
});

test("Process step creation is immediate and step naming stays inline", () => {
  const board = readFileSync(resolve(process.cwd(), "frontend/src/modules/kanban/KanbanContent.tsx"), "utf8");
  assert.match(board, /createProcessStep\(apiBase, companyID, processID, "New step", afterID\)/);
  assert.match(board, /onClick=\{\(\) => addStep\(id!\)\}>Add next step<\/button>/);
  assert.match(board, /onClick=\{\(\) => addStep\(steps\[steps\.length - 1\]\?\.process_step_id\)\}>\+ Add/);
  assert.match(board, /className="process-work__step-title-input"/);
  assert.match(board, /<h3 className="process-work__step-heading">/);
  assert.match(board, /className="process-work__step-title" title="Rename step" disabled=\{busy\}/);
  assert.match(board, /processRef\.current !== processID/);
  assert.match(board, /await updateProcessStep[\s\S]*setSnapshot/);
  assert.doesNotMatch(board, /kind: "step"/);
  assert.doesNotMatch(board, /process-work__toolbar/);
  assert.doesNotMatch(board, /Minimize Process/);
  assert.match(board, /--view-start-color/);
  assert.match(board, /NODE_ICON_GRADIENT_START/);
});
