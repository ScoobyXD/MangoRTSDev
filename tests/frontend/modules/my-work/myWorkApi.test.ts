import assert from "node:assert/strict";
import test from "node:test";
import type { BoundRequestJSON } from "../../../../frontend/src/modules/api/requestJSON.js";
import {
  fetchMyWork,
  fetchMyWorkActionItemSavedView,
  saveMyWorkActionItemSavedView,
} from "../../../../frontend/src/modules/my-work/myWorkApi.js";

test("My Work initial read derives its subject from auth and requests all typed sections", async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const signal = new AbortController().signal;
  const requestJSON: BoundRequestJSON = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return {
      company_id: "company-1",
      user_id: "viewer-1",
      action_items: { perspective: "mine", items: [], has_more: false },
      nodes: { role: "responsible", items: [], has_more: false },
      processes: { role: "responsible", items: [], has_more: false },
      projects: { items: [], has_more: false },
    } as T;
  };

  await fetchMyWork(requestJSON, {
    companyID: " company-1 ",
    limit: 500,
    signal,
  });

  const url = new URL(calls[0]?.path ?? "", "https://mango.test");
  assert.equal(url.pathname, "/v1/my-work");
  assert.equal(url.searchParams.get("company_id"), "company-1");
  assert.equal(url.searchParams.has("role"), false, "the all-section read uses the canonical server defaults");
  assert.equal(url.searchParams.has("perspective"), false);
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.has("section"), false);
  assert.equal(url.searchParams.has("subject_user_id"), false, "self reads keep the established current-user request");
  assert.equal(url.searchParams.has("user_id"), false);
  assert.equal(url.searchParams.has("target_user_id"), false);
  assert.equal(calls[0]?.init?.signal, signal);
  assert.equal(calls[0]?.init?.cache, "no-store");
});

test("My Work sends the selected subject only through the narrow subject contract", async () => {
  let requestedPath = "";
  const requestJSON: BoundRequestJSON = async <T>(path: string): Promise<T> => {
    requestedPath = path;
    return { company_id: "company-1", user_id: "person-2", projects: { items: [], has_more: false } } as T;
  };

  await fetchMyWork(requestJSON, {
    companyID: "company-1",
    subjectUserID: " person-2 ",
    section: "projects",
  });

  const url = new URL(requestedPath, "https://mango.test");
  assert.equal(url.searchParams.get("subject_user_id"), "person-2");
  assert.equal(url.searchParams.has("user_id"), false);
  assert.equal(url.searchParams.has("target_user_id"), false);
});

test("My Work follow-ups request only the affected section and its opaque cursor", async () => {
  const paths: string[] = [];
  const requestJSON: BoundRequestJSON = async <T>(path: string): Promise<T> => {
    paths.push(path);
    return { company_id: "company-1", user_id: "viewer-1", nodes: { items: [], has_more: false } } as T;
  };

  await fetchMyWork(requestJSON, {
    companyID: "company-1",
    section: "nodes",
    role: "accountable",
    grouping: [
      { field: "due_date", direction: "desc" },
      { field: "priority", direction: "asc" },
    ],
    cursor: "node/cursor + 2",
    limit: 40,
  });

  const url = new URL(paths[0] ?? "", "https://mango.test");
  assert.equal(url.searchParams.get("section"), "nodes");
  assert.equal(url.searchParams.get("cursor"), "node/cursor + 2");
  assert.equal(url.searchParams.get("grouping"), "due_date:desc,priority:asc");
  assert.equal(url.searchParams.get("limit"), "40");
  assert.equal(url.searchParams.get("role"), "accountable", "Node reads carry their independent RACI role");
});

test("My Work sends the sole explicit empty grouping form without inventing a default", async () => {
  let requestedPath = "";
  const requestJSON: BoundRequestJSON = async <T>(path: string): Promise<T> => {
    requestedPath = path;
    return { company_id: "company-1", user_id: "viewer-1", action_items: { items: [], has_more: false } } as T;
  };

  await fetchMyWork(requestJSON, { companyID: "company-1", section: "action_items", grouping: [] });
  const url = new URL(requestedPath, "https://mango.test");
  assert.equal(url.searchParams.get("grouping"), "none");
});

test("My Work History is section-scoped and never carries grouping", async () => {
  let requestedPath = "";
  const requestJSON: BoundRequestJSON = async <T>(path: string): Promise<T> => {
    requestedPath = path;
    return { company_id: "company-1", user_id: "viewer-1", action_items: { items: [], has_more: false } } as T;
  };

  await fetchMyWork(requestJSON, { companyID: "company-1", section: "action_items", history: true, cursor: "history-cursor" });
  const url = new URL(requestedPath, "https://mango.test");
  assert.equal(url.searchParams.get("section"), "action_items");
  assert.equal(url.searchParams.get("history"), "true");
  assert.equal(url.searchParams.get("cursor"), "history-cursor");
  assert.equal(url.searchParams.has("grouping"), false);
  await assert.rejects(
    fetchMyWork(requestJSON, { companyID: "company-1", section: "action_items", history: true, grouping: [] }),
    /cannot be grouped/,
  );
  await assert.rejects(
    fetchMyWork(requestJSON, { companyID: "company-1", section: "projects", history: true }),
    /valid only for Action Items or Nodes/,
  );
});

test("My Work refuses grouping on ungroupable section and all-section reads", async () => {
  const requestJSON: BoundRequestJSON = async <T>(): Promise<T> => ({} as T);
  await assert.rejects(
    fetchMyWork(requestJSON, { companyID: "company-1", section: "projects", grouping: [] }),
    /valid only for Action Items or Nodes/,
  );
  await assert.rejects(
    fetchMyWork(requestJSON, { companyID: "company-1", grouping: [{ field: "color", direction: "asc" }] }),
    /valid only for Action Items or Nodes/,
  );
});

test("Process follow-ups carry exactly the selected RACI role", async () => {
  let requestedPath = "";
  const requestJSON: BoundRequestJSON = async <T>(path: string): Promise<T> => {
    requestedPath = path;
    return {
      company_id: "company-1",
      user_id: "viewer-1",
      processes: { role: "consulted", items: [], has_more: false },
    } as T;
  };

  await fetchMyWork(requestJSON, { companyID: "company-1", section: "processes", role: "consulted" });
  const url = new URL(requestedPath, "https://mango.test");
  assert.equal(url.searchParams.get("section"), "processes");
  assert.equal(url.searchParams.get("role"), "consulted");
});

test("Action Item follow-ups carry exactly the selected Mine or Delegated perspective", async () => {
  let requestedPath = "";
  const requestJSON: BoundRequestJSON = async <T>(path: string): Promise<T> => {
    requestedPath = path;
    return {
      company_id: "company-1",
      user_id: "viewer-1",
      action_items: { perspective: "delegated", items: [], has_more: false },
    } as T;
  };

  await fetchMyWork(requestJSON, {
    companyID: "company-1",
    section: "action_items",
    perspective: "delegated",
    grouping: [
      { field: "color", direction: "asc" },
      { field: "huddle_process", direction: "asc" },
      { field: "completion_due_date", direction: "asc" },
    ],
    ordering: [{ field: "person_in_charge", direction: "desc" }],
  });
  const url = new URL(requestedPath, "https://mango.test");
  assert.equal(url.searchParams.get("section"), "action_items");
  assert.equal(url.searchParams.get("perspective"), "delegated");
  assert.equal(url.searchParams.get("grouping"), "color:asc,huddle_process:asc,completion_due_date:asc");
  assert.equal(url.searchParams.get("ordering"), "person_in_charge:desc");
});

test("Action Item ordering uses its distinct query key and rejects grouping overlap", async () => {
  const paths: string[] = [];
  const requestJSON: BoundRequestJSON = async <T>(path: string): Promise<T> => {
    paths.push(path);
    return { company_id: "company-1", user_id: "viewer-1", action_items: { items: [], has_more: false } } as T;
  };
  await fetchMyWork(requestJSON, {
    companyID: "company-1",
    section: "action_items",
    perspective: "mine",
    grouping: [
      { field: "color", direction: "asc" },
      { field: "huddle_process", direction: "asc" },
      { field: "completion_due_date", direction: "asc" },
    ],
    ordering: [],
  });
  assert.equal(new URL(paths[0] ?? "", "https://mango.test").searchParams.get("ordering"), "none");
  await assert.rejects(fetchMyWork(requestJSON, {
    companyID: "company-1",
    section: "action_items",
    perspective: "delegated",
    grouping: [{ field: "person_in_charge", direction: "asc" }],
    ordering: [{ field: "person_in_charge", direction: "desc" }],
  }), /must be distinct/);
});

test("Action Item saved views use separate Mine and Delegated surfaces with complete settings", async () => {
  const calls: Array<{ path: string; init?: RequestInit & { json?: unknown } }> = [];
  const requestJSON: BoundRequestJSON = async <T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    calls.push({ path, init });
    if (path.startsWith("/v1/saved-views?")) {
      const surface = new URL(path, "https://mango.test").searchParams.get("surface");
      return { saved_views: surface === "my_work_action_items_mine" ? [{ surface, saved_view_id: "mine-view" }] : [] } as T;
    }
    return { saved_view_id: "delegated-view", surface: "my_work_action_items_delegated" } as T;
  };

  const mine = await fetchMyWorkActionItemSavedView(requestJSON, "company-1", "mine");
  assert.equal(mine?.saved_view_id, "mine-view");
  await saveMyWorkActionItemSavedView(requestJSON, {
    companyID: "company-1",
    userID: "viewer-1",
    perspective: "delegated",
    savedViewID: "delegated-view",
    groupings: [
      { field: "color", direction: "asc" },
      { field: "huddle_process", direction: "asc" },
      { field: "completion_due_date", direction: "asc" },
    ],
    ordering: [{ field: "person_in_charge", direction: "asc" }],
    displayedFields: ["person_in_charge", "completion_due_date"],
  });
  assert.equal(calls[1]?.path, "/v1/saved-views/delegated-view");
  assert.deepEqual(calls[1]?.init?.json, {
    company_id: "company-1",
    saved_view_id: "delegated-view",
    surface: "my_work_action_items_delegated",
    principal: "user",
    principal_id: "viewer-1",
    name: "My Work Delegated",
    groupings: [
      { field: "color", direction: "asc" },
      { field: "huddle_process", direction: "asc" },
      { field: "completion_due_date", direction: "asc" },
    ],
    settings: {
      ordering: [{ field: "person_in_charge", direction: "asc" }],
      displayed_fields: ["person_in_charge", "completion_due_date"],
    },
    position: 1000,
  });
});
