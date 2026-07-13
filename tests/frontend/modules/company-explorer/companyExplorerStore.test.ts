import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyCompanyExplorerSearchTitleUpdate,
  companyExplorerBranchHasMaterializedRows,
  createCompanyExplorerStoreState,
  reduceCompanyExplorerStore,
  shouldLoadCompanyExplorerBranchChildren,
  shouldRefreshKanbanBoardsAfterUpdate,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerStore.js";
import {
  type CompanyExplorerEntityTitleUpdate,
  commitEntityTitleMutation,
  createCommittedTitleEditBuffer,
  createOneShotBlurSuppression,
  foldCommittedEntityTitlesSince,
  foldLatestCommittedEntityTitles,
  preserveEditingEntityTitleInSnapshot,
  publishCommittedEntityTitleUpdate,
  readCommittedEntityTitleVersion,
  resetCommittedEntityTitleRegistryForTests,
  subscribeCommittedEntityTitleUpdates,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerLocalEntityUpdates.js";
import {
  reconcileGVICProjectionLogicGateTitles,
  reconcileGVICProjectionRowTitles,
  reconcileGVICProjectionTitlesByUserID,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerGVICCommittedTitles.js";
import {
  applyCommittedLogicGateTitleToRecords,
  applyCommittedLogicGateTitleToSearchResults,
} from "../../../../frontend/src/modules/editor/editorCommittedTitleState.js";
import type { CompanyExplorerSearchResult } from "../../../../frontend/src/modules/company-explorer/companyExplorerLazyApi.js";
import type { LogicGateRecord } from "../../../../frontend/src/modules/logic-gate-map/shared.js";


function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const node = (id: string, title = id) => ({
  company_id: "c",
  node_id: id,
  name: title,
  created_timestamp: id,
});

const logicGate = (id: string, header = id) => ({
  company_id: "c",
  logic_gate_id: id,
  header,
  created_timestamp: id,
});

const board = (id: string, position: number, created = id) => ({
  company_id: "c",
  board_id: id,
  title: id,
  position,
  created_timestamp: created,
  updated_timestamp: created,
});

const folder = (id: string, parent = "") => ({
  company_id: "c",
  folder_id: id,
  parent_folder_id: parent,
  folder_kind: "logic_gate" as const,
  name: id,
  position: 1000,
  created_timestamp: id,
  updated_timestamp: id,
});

const folderItem = (folderID: string, itemType: "node" | "logic_gate" | "project" | "kanban", itemID: string) => ({
  company_id: "c",
  folder_id: folderID,
  item_type: itemType,
  item_id: itemID,
  position: 1000,
  created_timestamp: itemID,
  updated_timestamp: itemID,
});

const v2Row = (input: {
  entityID: string;
  entityType: "company" | "folder" | "project" | "logic_gate" | "node";
  resourceID?: string;
  parentEntityID?: string;
  edgeID?: string;
}) => ({
  company_id: "c",
  entity_id: input.entityID,
  entity_type: input.entityType,
  resource_id: input.resourceID ?? input.entityID,
  name: input.entityID,
  parent_entity_id: input.parentEntityID ?? "",
  edge_id: input.edgeID,
  position: 1000,
  has_children: false,
  created_timestamp: input.entityID,
  updated_timestamp: input.entityID,
});

run("snapshot reducer replaces explorer snapshot and preserves board list", () => {
  let state = createCompanyExplorerStoreState();
  state = reduceCompanyExplorerStore(state, { type: "setKanbanBoards", boards: [board("board-a", 1000)] });
  state = reduceCompanyExplorerStore(state, {
    type: "applySnapshot",
    snapshot: {
      nodes: [node("node-a", "Alpha")],
      logic_gates: [logicGate("gate-a", "Gate A")],
      folders: [folder("folder-a")],
      folder_items: [folderItem("folder-a", "node", "node-a"), folderItem("folder-a", "logic_gate", "gate-a")],
      rows: [v2Row({ entityID: "node-entity", entityType: "node", resourceID: "node-a", parentEntityID: "folder-a", edgeID: "edge-node-a" })],
    },
  });

  assert.equal(state.folderSnapshotLoaded, true);
  assert.deepEqual(state.nodes.map((item) => item.name), ["Alpha"]);
  assert.deepEqual(state.logicGates.map((item) => [item.logic_gate_id, item.node_id, item.title]), [["gate-a", "gate-a", "Gate A"]]);
  assert.deepEqual(state.folders.map((item) => item.folder_id), ["folder-a"]);
  assert.deepEqual(state.folderItems.map((item) => `${item.item_type}:${item.item_id}`), ["logic_gate:gate-a"]);
  assert.deepEqual(state.rows.map((row) => `${row.entity_type}:${row.resource_id}:${row.edge_id ?? ""}`), []);
  assert.deepEqual(state.kanbanBoards.map((item) => item.board_id), ["board-a"]);
});

run("kanban board reducer keeps sorted boards and removes explorer placement", () => {
  let state = reduceCompanyExplorerStore(createCompanyExplorerStoreState(), {
    type: "setKanbanBoards",
    boards: [board("board-b", 2000), board("board-a", 1000)],
  });
  state = reduceCompanyExplorerStore(state, {
    type: "upsertFolderItems",
    folderItems: [folderItem("folder-a", "kanban", "board-b")],
  });
  state = reduceCompanyExplorerStore(state, {
    type: "applyKanbanBoardsUpdated",
    companyID: "c",
    detail: { companyID: "c", board: board("board-c", 1500) },
  });
  assert.deepEqual(state.kanbanBoards.map((item) => item.board_id), ["board-a", "board-c", "board-b"]);

  state = reduceCompanyExplorerStore(state, {
    type: "applyKanbanBoardsUpdated",
    companyID: "c",
    detail: { companyID: "c", deletedBoardID: "board-b" },
  });
  assert.deepEqual(state.kanbanBoards.map((item) => item.board_id), ["board-a", "board-c"]);
  assert.deepEqual(state.folderItems, []);
  assert.equal(shouldRefreshKanbanBoardsAfterUpdate({ companyID: "c", board: board("board-a", 1000) }, "c"), false);
  assert.equal(shouldRefreshKanbanBoardsAfterUpdate(undefined, "c"), true);
});

run("v2 row reducer preserves manual and native parent contexts", () => {
  let state = createCompanyExplorerStoreState();
  state = reduceCompanyExplorerStore(state, {
    type: "upsertV2Rows",
    rows: [
      {
        company_id: "c",
        entity_id: "gate-entity",
        entity_type: "logic_gate",
        resource_id: "gate-a",
        name: "Gate A",
        parent_entity_id: "folder-entity",
        edge_id: "edge-gate-folder",
        position: 1000,
        has_children: false,
        created_timestamp: "1",
        updated_timestamp: "1",
      },
      {
        company_id: "c",
        entity_id: "gate-entity",
        entity_type: "logic_gate",
        resource_id: "gate-a",
        name: "Gate A",
        parent_entity_id: "project-entity",
        position: 1000,
        has_children: false,
        created_timestamp: "2",
        updated_timestamp: "2",
      },
    ],
  });

  assert.equal(state.rows.length, 2);
  assert.deepEqual(state.rows.map((row) => `${row.parent_entity_id}:${row.edge_id ?? ""}`), [
    "folder-entity:edge-gate-folder",
    "project-entity:",
  ]);

  state = reduceCompanyExplorerStore(state, {
    type: "upsertV2Rows",
    rows: [
      {
        company_id: "c",
        entity_id: "gate-entity",
        entity_type: "logic_gate",
        resource_id: "gate-a",
        name: "Gate A Updated",
        parent_entity_id: "folder-entity",
        edge_id: "edge-gate-folder",
        position: 500,
        has_children: false,
        created_timestamp: "1",
        updated_timestamp: "3",
      },
    ],
  });

  assert.equal(state.rows.length, 2);
  assert.equal(state.rows.find((row) => row.edge_id === "edge-gate-folder")?.name, "Gate A Updated");
  assert.equal(state.rows.find((row) => row.parent_entity_id === "project-entity")?.name, "Gate A");
});

run("loaded branch guard refetches when child rows are no longer materialized", () => {
  const rows = [
    v2Row({ entityID: "folder-entity", entityType: "folder", parentEntityID: "root-entity" }),
    v2Row({ entityID: "gate-entity", entityType: "logic_gate", resourceID: "gate-a", parentEntityID: "folder-entity", edgeID: "edge-gate-a" }),
  ];

  assert.equal(companyExplorerBranchHasMaterializedRows(rows, "folder-entity"), true);
  assert.equal(shouldLoadCompanyExplorerBranchChildren({
    parentEntityID: "folder-entity",
    rows,
    branchLoaded: true,
    branchStale: false,
    branchInflight: false,
  }), false);

  assert.equal(shouldLoadCompanyExplorerBranchChildren({
    parentEntityID: "folder-entity",
    rows: rows.filter((row) => row.parent_entity_id !== "folder-entity"),
    branchLoaded: true,
    branchStale: false,
    branchInflight: false,
  }), true);

  assert.equal(shouldLoadCompanyExplorerBranchChildren({
    parentEntityID: "folder-entity",
    rows,
    branchLoaded: true,
    branchStale: true,
    branchInflight: false,
  }), true);

  assert.equal(shouldLoadCompanyExplorerBranchChildren({
    parentEntityID: "folder-entity",
    rows: [],
    branchLoaded: true,
    branchStale: false,
    branchInflight: true,
  }), false);
});

run("committed editor titles patch mounted explorer records and every materialized V2 placement", () => {
  let state = createCompanyExplorerStoreState();
  state = reduceCompanyExplorerStore(state, {
    type: "mergeSnapshot",
    snapshot: {
      nodes: [node("node-a", "Old node")],
      logic_gates: [logicGate("gate-a", "Old gate")],
      rows: [
        { ...v2Row({ entityID: "gate-entity", entityType: "logic_gate", resourceID: "gate-a", parentEntityID: "folder-a", edgeID: "edge-a" }), name: "Old gate" },
        { ...v2Row({ entityID: "gate-entity", entityType: "logic_gate", resourceID: "gate-a", parentEntityID: "folder-b", edgeID: "edge-b" }), name: "Old gate" },
      ],
    },
  });

  state = reduceCompanyExplorerStore(state, {
    type: "applyEntityTitleUpdate",
    update: { companyID: "c", entityType: "node", resourceID: "node-a", title: "Renamed node" },
  });
  state = reduceCompanyExplorerStore(state, {
    type: "applyEntityTitleUpdate",
    update: { companyID: "c", entityType: "logic_gate", resourceID: "gate-a", title: "Renamed gate" },
  });

  assert.equal(state.nodes[0]?.name, "Renamed node");
  assert.equal(state.logicGates[0]?.header, "Renamed gate");
  assert.equal(state.logicGates[0]?.title, "Renamed gate");
  assert.deepEqual(state.rows.map((row) => row.name), ["Renamed gate", "Renamed gate"]);
});

run("committed editor titles patch active explorer search labels and use a concrete local event", () => {
  const update = { companyID: "c", entityType: "logic_gate" as const, resourceID: "gate-a", title: "Renamed gate" };
  const results = applyCompanyExplorerSearchTitleUpdate([{
    company_id: "c",
    resource_type: "logic_gate",
    resource_id: "gate-a",
    entity_id: "gate-entity",
    display_name: "Old gate",
    match_reason: "name",
    location_path: [{ entity_type: "logic_gate", entity_id: "gate-entity", resource_id: "gate-a", name: "Old gate" }],
    created_timestamp: "1",
    updated_timestamp: "1",
  }], update);
  assert.equal(results[0]?.display_name, "Renamed gate");
  assert.equal(results[0]?.location_path[0]?.name, "Renamed gate");

  const target = new EventTarget();
  let received: CompanyExplorerEntityTitleUpdate | null = null;
  const unsubscribe = subscribeCommittedEntityTitleUpdates((detail) => { received = detail; }, target);
  publishCommittedEntityTitleUpdate(update, target);
  assert.deepEqual(received, update);
  unsubscribe();
  received = null;
  publishCommittedEntityTitleUpdate(update, target);
  assert.equal(received, null);
});

run("latest committed-title registry overlays stale async responses by company, type, and resource", () => {
  resetCommittedEntityTitleRegistryForTests();
  const requestStartVersion = readCommittedEntityTitleVersion();
  const target = new EventTarget();
  publishCommittedEntityTitleUpdate({
    companyID: " company-1 ",
    entityType: "node",
    resourceID: " node-1 ",
    title: "First node title",
  }, target);
  publishCommittedEntityTitleUpdate({
    companyID: "company-1",
    entityType: "node",
    resourceID: "node-1",
    title: "Latest node title",
  }, target);
  publishCommittedEntityTitleUpdate({
    companyID: "company-1",
    entityType: "logic_gate",
    resourceID: "gate-1",
    title: "Latest gate title",
  }, target);
  publishCommittedEntityTitleUpdate({
    companyID: "company-2",
    entityType: "node",
    resourceID: "node-1",
    title: "Foreign title",
  }, target);

  const stale = { node: "Stale node", gate: "Stale gate", applications: 0 };
  const reconciled = foldCommittedEntityTitlesSince(stale, "company-1", requestStartVersion, (current, update) => ({
    ...current,
    node: update.entityType === "node" && update.resourceID === "node-1" ? update.title : current.node,
    gate: update.entityType === "logic_gate" && update.resourceID === "gate-1" ? update.title : current.gate,
    applications: current.applications + 1,
  }));
  assert.deepEqual(reconciled, { node: "Latest node title", gate: "Latest gate title", applications: 2 });

  const allLatest = foldLatestCommittedEntityTitles(stale, "company-1", (current, update) => ({
    ...current,
    node: update.entityType === "node" && update.resourceID === "node-1" ? update.title : current.node,
    gate: update.entityType === "logic_gate" && update.resourceID === "gate-1" ? update.title : current.gate,
    applications: current.applications + 1,
  }));
  assert.deepEqual(allLatest, reconciled);

  const laterRequestStartVersion = readCommittedEntityTitleVersion();
  assert.equal(foldCommittedEntityTitlesSince(stale, "company-1", laterRequestStartVersion, () => {
    throw new Error("commits older than the request must not mask its response");
  }), stale);

  resetCommittedEntityTitleRegistryForTests();
  assert.equal(readCommittedEntityTitleVersion(), 0);
  assert.equal(foldLatestCommittedEntityTitles(stale, "company-1", () => {
    throw new Error("registry must be empty");
  }), stale);
});

run("committed titles patch every mounted GVIC projection cache without crossing companies or resources", () => {
  const rows = [
    {
      company_id: "c",
      projection_row_id: "projection-node-a",
      user_id: "user-a",
      node_name: "Old node",
      logic_gate_id: "gate-a",
      logic_gate_name: "Old gate",
      node_id: "node-a",
      created_timestamp: "1",
      updated_timestamp: "1",
    },
    {
      company_id: "c",
      projection_row_id: "projection-node-b",
      user_id: "user-a",
      node_name: "Other node",
      logic_gate_id: "gate-b",
      logic_gate_name: "Other gate",
      node_id: "node-b",
      created_timestamp: "2",
      updated_timestamp: "2",
    },
    {
      company_id: "foreign",
      projection_row_id: "projection-foreign",
      user_id: "user-a",
      node_name: "Foreign node",
      logic_gate_id: "gate-a",
      logic_gate_name: "Foreign gate",
      node_id: "node-a",
      created_timestamp: "3",
      updated_timestamp: "3",
    },
  ];
  const logicGates = [
    { company_id: "c", logic_gate_id: "gate-a", header: "Old gate", title: "Old gate", marker: "preserved" },
    { company_id: "c", logic_gate_id: "gate-b", header: "Other gate", title: "Other gate", marker: "preserved" },
    { company_id: "foreign", logic_gate_id: "gate-a", header: "Foreign gate", title: "Foreign gate", marker: "preserved" },
  ];
  const nodeUpdate = { companyID: "c", entityType: "node" as const, resourceID: "node-a", title: "Renamed node" };
  const gateUpdate = { companyID: "c", entityType: "logic_gate" as const, resourceID: "gate-a", title: "Renamed gate" };

  const nodeRows = reconcileGVICProjectionRowTitles(rows, nodeUpdate, "c");
  assert.deepEqual(nodeRows.map((row) => row.node_name), ["Renamed node", "Other node", "Foreign node"]);
  assert.equal(nodeRows[1], rows[1]);
  assert.equal(nodeRows[2], rows[2]);
  const gateRows = reconcileGVICProjectionRowTitles(nodeRows, gateUpdate, "c");
  assert.deepEqual(gateRows.map((row) => row.logic_gate_name), ["Renamed gate", "Other gate", "Foreign gate"]);

  const renamedLogicGates = reconcileGVICProjectionLogicGateTitles(logicGates, gateUpdate, "c");
  assert.deepEqual(renamedLogicGates.map((gate) => [gate.header, gate.title]), [
    ["Renamed gate", "Renamed gate"],
    ["Other gate", "Other gate"],
    ["Foreign gate", "Foreign gate"],
  ]);
  assert.equal(renamedLogicGates[0]?.marker, "preserved");
  assert.equal(renamedLogicGates[1], logicGates[1]);
  assert.equal(renamedLogicGates[2], logicGates[2]);

  const byUser = {
    "user-a": { rows, logicGates, loaded: true },
    "user-b": { rows: rows.slice(0, 1), logicGates: logicGates.slice(0, 1), loaded: true },
  };
  const nodeByUser = reconcileGVICProjectionTitlesByUserID(byUser, nodeUpdate, "c");
  const gateByUser = reconcileGVICProjectionTitlesByUserID(nodeByUser, gateUpdate, "c");
  assert.equal(gateByUser["user-a"]?.rows[0]?.node_name, "Renamed node");
  assert.equal(gateByUser["user-a"]?.rows[0]?.logic_gate_name, "Renamed gate");
  assert.equal(gateByUser["user-a"]?.logicGates[0]?.header, "Renamed gate");
  assert.equal(gateByUser["user-b"]?.rows[0]?.node_name, "Renamed node");
  assert.equal(gateByUser["user-b"]?.logicGates[0]?.title, "Renamed gate");

  const foreignUpdate = { ...nodeUpdate, companyID: "foreign", title: "Wrong company" };
  assert.equal(reconcileGVICProjectionRowTitles(gateRows, foreignUpdate, "c"), gateRows);
  assert.equal(reconcileGVICProjectionLogicGateTitles(renamedLogicGates, foreignUpdate, "c"), renamedLogicGates);
  assert.equal(reconcileGVICProjectionTitlesByUserID(gateByUser, foreignUpdate, "c"), gateByUser);
});

run("Company Explorer patches GVIC caches in-place on committed titles without projection reloads", () => {
  const source = readFileSync("frontend/src/modules/company-explorer/CompanyExplorerContent.tsx", "utf8");
  const start = source.indexOf("useEffect(() => subscribeCommittedEntityTitleUpdates");
  const end = source.indexOf("}), [companyID]);", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const subscriber = source.slice(start, end);
  assert.match(subscriber, /setGVICProjectionRows\(/);
  assert.match(subscriber, /setGVICProjectionLogicGates\(/);
  assert.match(subscriber, /setGVICProjectionByUserID\(/);
  assert.doesNotMatch(subscriber, /requestGVICExplorerProjectionRefresh|refreshGVIC/i);
});

run("committed titles fan out to concurrent same-window surfaces without touching editor draft text", () => {
  const target = new EventTarget();
  const titles = new Map<string, string>([
    ["editor:node", "Old node"],
    ["kanban:node", "Old node"],
    ["node-map:node", "Old node"],
    ["explorer:node", "Old node"],
    ["editor:logic_gate", "Old gate"],
    ["kanban:logic_gate", "Old gate"],
    ["logic-gate-map:logic_gate", "Old gate"],
    ["explorer:logic_gate", "Old gate"],
  ]);
  const editorDraft = { text: "unsaved local draft" };
  const unsubscribers = Array.from(titles.keys()).map((surfaceKey) => {
    const entityType = surfaceKey.endsWith(":node") ? "node" : "logic_gate";
    return subscribeCommittedEntityTitleUpdates((update) => {
      if (update.companyID !== "company-1" || update.entityType !== entityType) return;
      titles.set(surfaceKey, update.title);
    }, target);
  });

  publishCommittedEntityTitleUpdate({
    companyID: "company-1",
    entityType: "node",
    resourceID: "node-1",
    title: "Renamed node",
  }, target);
  publishCommittedEntityTitleUpdate({
    companyID: "company-1",
    entityType: "logic_gate",
    resourceID: "gate-1",
    title: "Renamed gate",
  }, target);

  for (const [surfaceKey, title] of titles) {
    assert.equal(title, surfaceKey.endsWith(":node") ? "Renamed node" : "Renamed gate");
  }
  assert.equal(editorDraft.text, "unsaved local draft");
  for (const unsubscribeSurface of unsubscribers) unsubscribeSurface();
});

run("every relevant rename surface publishes and consumes the concrete committed-title event", () => {
  const surfaces = new Map<string, number>([
    ["frontend/src/modules/editor/EditorContent.tsx", 2],
    ["frontend/src/modules/kanban/KanbanContent.tsx", 2],
    ["frontend/src/modules/node-map/NodeMapContent.tsx", 1],
    ["frontend/src/modules/logic-gate-map/LogicGateMapContent.tsx", 1],
    ["frontend/src/modules/company-explorer/CompanyExplorerContent.tsx", 1],
    ["frontend/src/pages/home/HomePage.tsx", 1],
  ]);
  for (const [file, expectedPublishers] of surfaces) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.match(/commitEntityTitleMutation\(/g)?.length, expectedPublishers, `${file} must commit and publish after every supported rename result`);
    assert.match(source, /subscribeCommittedEntityTitleUpdates\(/, `${file} must consume concurrent committed titles`);
  }
});

test("title mutation publishes exactly once after a successful commit and never on rejection", async () => {
  const target = new EventTarget();
  const received: CompanyExplorerEntityTitleUpdate[] = [];
  const unsubscribe = subscribeCommittedEntityTitleUpdates((update) => received.push(update), target);
  let resolveMutation: ((value: string) => void) | undefined;
  const pending = commitEntityTitleMutation(
    () => new Promise<string>((resolve) => { resolveMutation = resolve; }),
    (title) => ({
      companyID: "company-1",
      entityType: "node",
      resourceID: "node-1",
      title,
    }),
    target,
  );

  assert.equal(received.length, 0, "a pending mutation must not publish an optimistic title");
  resolveMutation?.("Renamed node");
  assert.equal(await pending, "Renamed node");
  assert.deepEqual(received, [{
    companyID: "company-1",
    entityType: "node",
    resourceID: "node-1",
    title: "Renamed node",
  }]);

  await assert.rejects(commitEntityTitleMutation(
    async () => { throw new Error("rename_failed"); },
    () => ({
      companyID: "company-1",
      entityType: "node",
      resourceID: "node-1",
      title: "Must not publish",
    }),
    target,
  ), /rename_failed/);
  assert.equal(received.length, 1, "a failed mutation must not publish a committed-title event");
  unsubscribe();
});

test("title edit buffer defers only the active entity and flushes its latest committed title", () => {
  const buffer = createCommittedTitleEditBuffer();
  const draft = { text: "unsaved local draft" };
  const first = {
    companyID: "company-1",
    entityType: "node" as const,
    resourceID: "node-1",
    title: "First remote title",
  };
  const latest = { ...first, title: "Latest remote title" };
  const unrelated = { ...first, resourceID: "node-2", title: "Unrelated title" };

  buffer.begin("node", "node-1");
  assert.equal(buffer.receive(first), undefined);
  buffer.begin("node", "node-1");
  assert.equal(buffer.receive(unrelated), unrelated, "unrelated mounted entities converge immediately");
  assert.equal(buffer.receive(latest), undefined);
  assert.deepEqual(buffer.finish("node", "node-1"), latest);
  assert.equal(draft.text, "unsaved local draft", "committed-title convergence must not alter editor text");
  assert.equal(buffer.receive(first), first, "the entity converges immediately after editing finishes");

  buffer.begin("node", "node-1");
  assert.equal(buffer.receive(latest), undefined);
  buffer.reset();
  assert.equal(buffer.finish("node", "node-1"), undefined, "reset must discard a deferred title on entity switch or unmount");
});

test("one-shot blur suppression makes Enter commit once and Escape commit zero times", () => {
  const suppression = createOneShotBlurSuppression();
  assert.equal(suppression.shouldHandleBlur(), true);
  suppression.suppress();
  assert.equal(suppression.shouldHandleBlur(), false, "the synthetic blur after Enter or Escape is suppressed");
  assert.equal(suppression.shouldHandleBlur(), true, "ordinary later blurs still commit");
});

test("graph snapshots preserve only the active title draft", () => {
  const snapshot = [
    { node_id: "node-1", name: "Stale server title", marker: "incoming" },
    { node_id: "node-2", name: "Other server title", marker: "incoming" },
  ];
  const current = [
    { node_id: "node-1", name: "Active local draft", marker: "current" },
    { node_id: "node-2", name: "Old other title", marker: "current" },
  ];
  const reconciled = preserveEditingEntityTitleInSnapshot(
    snapshot,
    current,
    "node-1",
    (incoming, currentEntity) => incoming.name === currentEntity.name
      ? incoming
      : { ...incoming, name: currentEntity.name },
  );

  assert.notEqual(reconciled, snapshot);
  assert.deepEqual(reconciled.map((item) => item.name), ["Active local draft", "Other server title"]);
  assert.equal(reconciled[1], snapshot[1], "unrelated snapshot rows retain identity");
  assert.equal(preserveEditingEntityTitleInSnapshot(snapshot, current, null, (item) => item), snapshot);
});

test("Editor and map contentEditable titles suppress their synthetic blur exactly once", () => {
  for (const file of [
    "frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx",
    "frontend/src/modules/node-map/NodeMapNodeCard.tsx",
    "frontend/src/modules/logic-gate-map/LogicGateMapNodeCard.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /createOneShotBlurSuppression\(\)/, `${file} must use one-shot blur suppression`);
    assert.match(source, /shouldHandleBlur\(\)/, `${file} must guard the blur commit`);
    assert.equal(source.match(/\.suppress\(\)/g)?.length, 2, `${file} must suppress Enter and Escape blur paths`);
  }
});

run("AppSidebar reconciles open Explorer and pin menu title snapshots", () => {
  const source = readFileSync("frontend/src/app/AppSidebarChrome.tsx", "utf8");
  assert.match(source, /subscribeCommittedEntityTitleUpdates\(/);
  assert.match(source, /setExplorerTriagePriorityMenu\(/);
  assert.match(source, /setPinContextMenu\(/);
  assert.match(source, /setPinTriagePriorityMenu\(/);
  assert.match(source, /resolveCurrentAppSidebarPin\(pins,/);
});

run("Editor async title-bearing responses use request-start committed-title fences", () => {
  const editorSource = readFileSync("frontend/src/modules/editor/EditorContent.tsx", "utf8");
  assert.match(editorSource, /linkedDetailsTitleVersionAtStart = readCommittedEntityTitleVersion\(\)[\s\S]*await Promise\.all/);
  assert.match(editorSource, /loadedLogicGateTitle = foldCommittedEntityTitlesSince\([\s\S]*setLinkedNodeTitle\(\(current\) => editingTitleActiveRef\.current \? current : loadedLogicGateTitle\)/);
  assert.match(editorSource, /loadedNodeTitle = foldCommittedEntityTitlesSince\([\s\S]*preserveNodeTitle\(loadedNodeTitle, current, linkedNodeID\)/);

  const workspaceSource = readFileSync("frontend/src/modules/editor/NodeWorkspaceSurface.tsx", "utf8");
  assert.match(workspaceSource, /setProjectLogicGateOptions\(foldCommittedEntityTitlesSince\(/);
  assert.match(workspaceSource, /setAssignedLogicGateRecords\(foldCommittedEntityTitlesSince\(/);
  assert.match(workspaceSource, /setLogicGateSearchResults\(foldCommittedEntityTitlesSince\(/);
  assert.match(workspaceSource, /applyCommittedLogicGateTitleToSearchResults\(current, update\.resourceID, update\.title\)/);
});
test("Node workspace async title fences reuse record and path-label reconcilers", () => {
  resetCommittedEntityTitleRegistryForTests();
  const titleVersionAtStart = readCommittedEntityTitleVersion();
  publishCommittedEntityTitleUpdate({
    companyID: "company-1",
    entityType: "logic_gate",
    resourceID: "gate-1",
    title: "Committed gate",
  }, new EventTarget());

  const staleRecords: LogicGateRecord[] = [{
    company_id: "company-1",
    logic_gate_id: "gate-1",
    header: "Stale gate",
    created_timestamp: "1",
  }];
  const records = foldCommittedEntityTitlesSince(
    staleRecords,
    "company-1",
    titleVersionAtStart,
    (current, update) => update.entityType === "logic_gate"
      ? applyCommittedLogicGateTitleToRecords(current, update.resourceID, update.title)
      : current,
  );
  assert.equal(records[0]?.header, "Committed gate");

  const staleSearch: CompanyExplorerSearchResult[] = [{
    company_id: "company-1",
    resource_type: "logic_gate",
    resource_id: "gate-1",
    entity_id: "gate-entity-1",
    display_name: "Stale gate",
    match_reason: "name",
    location_path: [{
      entity_type: "logic_gate",
      entity_id: "gate-entity-1",
      resource_id: "gate-1",
      name: "Stale gate",
    }],
    created_timestamp: "1",
    updated_timestamp: "1",
  }];
  const search = foldCommittedEntityTitlesSince(
    staleSearch,
    "company-1",
    titleVersionAtStart,
    (current, update) => update.entityType === "logic_gate"
      ? applyCommittedLogicGateTitleToSearchResults(current, update.resourceID, update.title)
      : current,
  );
  assert.equal(search[0]?.display_name, "Committed gate");
  assert.equal(search[0]?.location_path[0]?.name, "Committed gate");
});
