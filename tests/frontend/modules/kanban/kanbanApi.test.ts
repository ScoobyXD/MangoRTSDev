import assert from "node:assert/strict";
import test from "node:test";
import { changeProcessNodeState, createProcessNode, createProcessStep, createProcessStepRelationship, deleteProcessStep, moveLogicGateAssignment } from "../../../../frontend/src/modules/kanban/kanbanApi.js";

test("step moves preserve status while Start work sends step and status atomically", async () => {
  const original = globalThis.fetch; const calls: Array<{ path: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => { calls.push({ path: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null }); return new Response(JSON.stringify({ node: { node_id: "node-a" }, assignment: { logic_gate_id: "process-a" } }), { headers: { "Content-Type": "application/json" } }); };
  try {
    await changeProcessNodeState("https://work.test", "company-a", "process-a", "node-a", { process_step_id: "step-b", position: 1500 });
    await changeProcessNodeState("https://work.test", "company-a", "process-a", "node-a", { process_step_id: "step-b", status: "In Progress" });
    await changeProcessNodeState("https://work.test", "company-a", "process-a", "node-a", { status: "Done" });
    await changeProcessNodeState("https://work.test", "company-a", "process-a", "node-a", { process_step_id: null });
    assert.deepEqual(calls.map((call) => call.body), [
      { company_id: "company-a", process_step_id: "step-b", position: 1500, mutation_origin: "kanban" },
      { company_id: "company-a", process_step_id: "step-b", status: "In Progress", mutation_origin: "kanban" },
      { company_id: "company-a", status: "Done", mutation_origin: "kanban" },
      { company_id: "company-a", process_step_id: null, mutation_origin: "kanban" },
    ]);
    assert.ok(calls.every((call) => call.method === "PUT" && call.path === "https://work.test/v2/logic-gates/process-a/nodes/node-a/state"));
  } finally { globalThis.fetch = original; }
});

test("step creation, add-next, typed branch, and deletion use exact Process identities", async () => {
  const original = globalThis.fetch; const calls: Array<{ path: string; method: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => { calls.push({ path: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null }); return new Response("{}", { headers: { "Content-Type": "application/json" } }); };
  try {
    await createProcessStep("https://steps.test", "company-a", "process-a", "Review", "step-a");
    await createProcessStepRelationship("https://steps.test", "company-a", "process-a", "step-a", "step-b");
    await deleteProcessStep("https://steps.test", "company-a", "process-a", "step-a");
    await createProcessNode("https://steps.test", "company-a", "process-a", "New work", { status: "Pending", process_step_id: null });
    assert.deepEqual(calls[0], { path: "https://steps.test/v2/logic-gates/process-a/steps", method: "POST", body: { company_id: "company-a", name: "Review", after_process_step_id: "step-a" } });
    assert.deepEqual(calls[1].body, { company_id: "company-a", source: { resource_type: "process_step", resource_id: "step-a" }, target: { resource_type: "process_step", resource_id: "step-b" } });
    assert.deepEqual(calls[2], { path: "https://steps.test/v2/logic-gates/process-a/steps/step-a?company_id=company-a", method: "DELETE", body: null });
    assert.deepEqual(calls[3].body, { company_id: "company-a", create_node_title: "New work", status: "Pending", process_step_id: null, mutation_origin: "kanban" });
  } finally { globalThis.fetch = original; }
});

test("cross-Process assignment returns the real assignment and no synthetic card", async () => {
  const original = globalThis.fetch; let body: unknown;
  globalThis.fetch = async (_input, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ assignment: { assignment_id: "assignment-a", logic_gate_id: "process-b", node_id: "node-a", process_step_id: null }, node: { node_id: "node-a" } }), { headers: { "Content-Type": "application/json" } }); };
  try {
    const result = await moveLogicGateAssignment({ apiBase: "https://move.test", companyID: "company-a", fromLogicGateID: " process-a ", logicGateID: " process-b ", nodeID: "node-a", status: "Pending" });
    assert.deepEqual(body, { company_id: "company-a", to_logic_gate_id: "process-b", from_logic_gate_id: "process-a", status: "Pending", mutation_origin: "matrix" });
    assert.equal(result.assignment.assignment_id, "assignment-a"); assert.deepEqual(result.gvic_projection_rows, []); assert.equal("card" in result, false);
  } finally { globalThis.fetch = original; }
});
