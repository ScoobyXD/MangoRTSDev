import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkspaceEntityBatchCommand,
  type WorkspaceEntityCommandRequest,
} from "../../../../frontend/src/modules/workspace/workspaceEntityCommands.js";

test("createWorkspaceEntityBatchCommand posts one workspace entity batch request", async () => {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const requestJSON: WorkspaceEntityCommandRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return { ok: true } as T;
  };

  const result = await createWorkspaceEntityBatchCommand<{ ok: boolean }>({
    companyID: "company-1",
    entityKind: "logic_gate",
    folderID: "folder-1",
    creatorLogicGateGVICRole: "generated",
    items: [{ client_id: "gate-a", title: "Gate A", x: 120, y: 240 }],
    relationships: [{ entity_id_a: "source", client_id_b: "gate-a", a_position: "Input", b_position: "Output" }],
    requestJSON,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{
    path: "/v1/workspace/entity-batches",
    method: "POST",
    body: {
      company_id: "company-1",
      entity_kind: "logic_gate",
      folder_id: "folder-1",
      creator_logic_gate_gvic_role: "generated",
      items: [{ client_id: "gate-a", title: "Gate A", x: 120, y: 240 }],
      relationships: [{ entity_id_a: "source", client_id_b: "gate-a", a_position: "Input", b_position: "Output" }],
    },
  }]);
});
