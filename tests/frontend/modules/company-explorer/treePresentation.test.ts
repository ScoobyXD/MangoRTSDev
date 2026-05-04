import assert from "node:assert/strict";
import {
  EXPLORER_DEFAULT_EXPANDED_ROW_IDS,
  EXPLORER_ROOT_ROW_LABELS,
  EXPLORER_ROOT_ROW_ORDER,
  buildExplorerFindSelection,
  buildExplorerRowBatchReorderPlan,
  buildExplorerRowReorderPlan,
  formatExplorerFolderLabel,
  resolveExplorerClickSelection,
  resolveExplorerCreationTargets,
  resolveExplorerDeleteTarget,
  resolveExplorerDropTarget,
  resolveExplorerKeyboardNavigation,
  resolveExplorerRenameTarget,
  resolveExplorerRootDropTarget,
  shouldAcceptMapSelectionAfterExplorerSelection,
} from "../../../../frontend/src/modules/company-explorer/treePresentation.js";

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("root presentation uses one collapsible company row and excludes virtual category rows", () => {
  assert.deepEqual([...EXPLORER_ROOT_ROW_ORDER], ["folder-root"]);
  assert.equal((EXPLORER_ROOT_ROW_ORDER as readonly string[]).includes("folder-notes"), false);
  assert.equal((EXPLORER_ROOT_ROW_ORDER as readonly string[]).includes("folder-logic"), false);
  assert.equal((EXPLORER_ROOT_ROW_ORDER as readonly string[]).includes("folder-nodes"), false);
  assert.deepEqual([...EXPLORER_DEFAULT_EXPANDED_ROW_IDS], ["folder-root"]);
});

run("folder labels do not display counts", () => {
  assert.equal(EXPLORER_ROOT_ROW_LABELS["folder-root"], "Company");
  assert.equal(formatExplorerFolderLabel("Invoices"), "Invoices");
});

run("context creation targets nested logic gate folders", () => {
  const targets = resolveExplorerCreationTargets({ kind: "folder", folderKind: "logic_gate", folderID: "logic-folder-1" });
  assert.deepEqual(targets, {
    preferredFolderKind: "logic_gate",
    preferredFolderParentID: "logic-folder-1",
    nodeFolderParentID: "",
    logicGateFolderParentID: "logic-folder-1",
    nodeParentFolderID: "",
    logicGateParentFolderID: "logic-folder-1",
  });
});

run("context creation targets node siblings from a node row", () => {
  const targets = resolveExplorerCreationTargets({ kind: "node", folderKind: "node", folderID: "node-folder-1" });
  assert.deepEqual(targets, {
    preferredFolderKind: "node",
    preferredFolderParentID: "node-folder-1",
    nodeFolderParentID: "node-folder-1",
    logicGateFolderParentID: "",
    nodeParentFolderID: "node-folder-1",
    logicGateParentFolderID: "",
  });
});

run("rename targets only resolve for concrete folders and entities", () => {
  assert.deepEqual(resolveExplorerRenameTarget({ kind: "folder", folderKind: "node", folderID: "folder-1" }), { kind: "folder", id: "folder-1" });
  assert.deepEqual(resolveExplorerRenameTarget({ kind: "node", nodeID: "node-1" }), { kind: "node", id: "node-1" });
  assert.deepEqual(resolveExplorerRenameTarget({ kind: "logic_gate", logicGateID: "gate-1" }), { kind: "logic_gate", id: "gate-1" });
  assert.deepEqual(resolveExplorerRenameTarget({ kind: "kanban", kanbanBoardID: "board-1" }), { kind: "kanban", id: "board-1" });
  assert.equal(resolveExplorerRenameTarget({ kind: "folder", folderKind: "node" }), null);
});

run("delete targets only resolve for concrete folders and entities", () => {
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "folder", folderKind: "node", folderID: "folder-1" }), { kind: "folder", id: "folder-1", folderKind: "node" });
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "node", nodeID: "node-1" }), { kind: "node", id: "node-1" });
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "logic_gate", logicGateID: "gate-1" }), { kind: "logic_gate", id: "gate-1" });
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "kanban", kanbanBoardID: "board-1" }), { kind: "kanban", id: "board-1" });
  assert.equal(resolveExplorerDeleteTarget({ kind: "folder", folderKind: "node" }), null);
});

run("drop targets resolve item rows to their containing folder", () => {
  assert.deepEqual(
    resolveExplorerDropTarget(
      { kind: "node", folderKind: "node", folderID: "test-folder", nodeID: "node-1" },
      { kind: "folder", folderKind: "node", folderID: "lotion-folder" },
    ),
    { folderID: "test-folder", folderKind: "node", treeID: "workspace-folder-test-folder" },
  );

  assert.deepEqual(
    resolveExplorerDropTarget(
      { kind: "logic_gate", folderKind: "logic_gate", folderID: "gate-folder", logicGateID: "gate-1" },
      { kind: "logic_gate", itemType: "logic_gate", itemID: "gate-2" },
    ),
    { folderID: "gate-folder", folderKind: "logic_gate", treeID: "workspace-folder-gate-folder" },
  );

  assert.equal(
    resolveExplorerDropTarget(
      { kind: "node", folderKind: "node", folderID: "test-folder", nodeID: "node-1" },
      { kind: "logic_gate", itemType: "logic_gate", itemID: "gate-1" },
    ),
    null,
  );
  assert.equal(resolveExplorerDropTarget({ kind: "node", nodeID: "root-node" }, { kind: "node", itemType: "node", itemID: "node-2" }), null);

  assert.deepEqual(
    resolveExplorerDropTarget(
      { kind: "logic_gate", folderKind: "logic_gate", folderID: "gate-folder", logicGateID: "gate-1" },
      {
        kind: "batch",
        itemType: "logic_gate",
        items: [
          { itemType: "logic_gate", itemID: "gate-2" },
          { itemType: "logic_gate", itemID: "gate-3" },
        ],
      },
    ),
    { folderID: "gate-folder", folderKind: "logic_gate", treeID: "workspace-folder-gate-folder" },
  );

  assert.deepEqual(
    resolveExplorerDropTarget(
      { kind: "node", folderKind: "node", folderID: "node-folder", nodeID: "node-1" },
      { kind: "kanban", itemType: "kanban", itemID: "board-1" },
    ),
    { folderID: "node-folder", folderKind: "node", treeID: "workspace-folder-node-folder" },
  );

  assert.deepEqual(
    resolveExplorerDropTarget(
      { kind: "logic_gate", folderKind: "logic_gate", folderID: "gate-folder", logicGateID: "gate-1" },
      { kind: "kanban", itemType: "kanban", itemID: "board-1" },
    ),
    { folderID: "gate-folder", folderKind: "logic_gate", treeID: "workspace-folder-gate-folder" },
  );
});

run("folder drops can target the Company root", () => {
  assert.deepEqual(
    resolveExplorerRootDropTarget(
      { kind: "folder" },
      { kind: "folder", folderKind: "logic_gate", folderID: "logic-folder-1" },
    ),
    { folderID: "", folderKind: "logic_gate", treeID: "folder-root" },
  );
  assert.equal(
    resolveExplorerRootDropTarget(
      { kind: "folder" },
      { kind: "node", itemType: "node", itemID: "node-1" },
    ),
    null,
  );
});

run("row reorder plan uses sparse single-row position updates", () => {
  const plan = buildExplorerRowReorderPlan(
    [
      { id: "a", position: 1000, createdTimestamp: "1" },
      { id: "b", position: 2000, createdTimestamp: "2" },
      { id: "c", position: 3000, createdTimestamp: "3" },
    ],
    "a",
    "c",
    "after",
  );
  assert.deepEqual(plan.updates, [{ rowID: "a", position: 4000 }]);
  assert.deepEqual(plan.rows.map((row) => row.id), ["b", "c", "a"]);

  const compacted = buildExplorerRowReorderPlan(
    [
      { id: "a", position: 1, createdTimestamp: "1" },
      { id: "b", position: 2, createdTimestamp: "2" },
      { id: "c", position: 3, createdTimestamp: "3" },
    ],
    "c",
    "a",
    "before",
  );
  assert.deepEqual(compacted.updates, [
    { rowID: "c", position: 1000 },
    { rowID: "a", position: 2000 },
    { rowID: "b", position: 3000 },
  ]);
});

run("batch row reorder plan keeps selected rows together in drag order", () => {
  const plan = buildExplorerRowBatchReorderPlan(
    [
      { id: "a", position: 1000, createdTimestamp: "1" },
      { id: "b", position: 2000, createdTimestamp: "2" },
      { id: "c", position: 3000, createdTimestamp: "3" },
      { id: "d", position: 4000, createdTimestamp: "4" },
      { id: "e", position: 5000, createdTimestamp: "5" },
    ],
    ["b", "c"],
    "e",
    "after",
  );

  assert.deepEqual(plan.rows.map((row) => row.id), ["a", "d", "e", "b", "c"]);
  assert.deepEqual(plan.updates, [
    { rowID: "b", position: 6000 },
    { rowID: "c", position: 7000 },
  ]);
});

run("click selection supports plain, shift range, and ctrl toggle behavior", () => {
  const orderedIDs = ["root", "a", "b", "c", "d"];

  const plain = resolveExplorerClickSelection({
    orderedIDs,
    previousSelectedIDs: new Set(["root"]),
    anchorID: "root",
    clickedID: "b",
    shiftKey: false,
    ctrlKey: false,
  });
  assert.deepEqual([...plain.selectedIDs], ["b"]);
  assert.equal(plain.anchorID, "b");

  const range = resolveExplorerClickSelection({
    orderedIDs,
    previousSelectedIDs: new Set(["root", ...plain.selectedIDs]),
    anchorID: plain.anchorID,
    clickedID: "d",
    shiftKey: true,
    ctrlKey: false,
  });
  assert.deepEqual([...range.selectedIDs], ["root", "b", "c", "d"]);
  assert.equal(range.anchorID, "b");

  const toggle = resolveExplorerClickSelection({
    orderedIDs,
    previousSelectedIDs: plain.selectedIDs,
    anchorID: plain.anchorID,
    clickedID: "d",
    shiftKey: false,
    ctrlKey: true,
  });
  assert.deepEqual([...toggle.selectedIDs], ["b", "d"]);
  assert.equal(toggle.anchorID, "d");

  const additiveRange = resolveExplorerClickSelection({
    orderedIDs,
    previousSelectedIDs: new Set(["root"]),
    anchorID: "b",
    clickedID: "d",
    shiftKey: true,
    ctrlKey: true,
  });
  assert.deepEqual([...additiveRange.selectedIDs], ["root", "b", "c", "d"]);
  assert.equal(additiveRange.anchorID, "b");
});

run("keyboard navigation moves selection and expands folders without DOM focus assumptions", () => {
  const rows = [
    { id: "folder-root", kind: "folder" as const },
    { id: "node-a", kind: "node" as const },
    { id: "workspace-folder-1", kind: "folder" as const },
  ];
  const down = resolveExplorerKeyboardNavigation({
    rows,
    selectedTreeID: "folder-root",
    expandedIDs: new Set(["folder-root"]),
    key: "ArrowDown",
  });
  assert.equal(down.handled, true);
  assert.equal(down.selectedTreeID, "node-a");

  const expand = resolveExplorerKeyboardNavigation({
    rows,
    selectedTreeID: "workspace-folder-1",
    expandedIDs: new Set(["folder-root"]),
    key: "ArrowRight",
  });
  assert.equal(expand.handled, true);
  assert.deepEqual([...(expand.expandedIDs ?? new Set())], ["folder-root", "workspace-folder-1"]);
});

run("find selection expands ancestor folders and highlights every requested entity", () => {
  const plan = buildExplorerFindSelection({
    entities: [
      { kind: "node", id: "node-a" },
      { kind: "node", id: "node-b" },
    ],
    nodeIDs: ["node-a", "node-b"],
    logicGateIDs: [],
    folders: [
      { company_id: "c", folder_id: "parent", folder_kind: "node", name: "Parent", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
      { company_id: "c", folder_id: "child", parent_folder_id: "parent", folder_kind: "node", name: "Child", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
    ],
    folderItems: [
      { company_id: "c", folder_id: "child", item_type: "node", item_id: "node-a", position: 1000, created_timestamp: "3", updated_timestamp: "3" },
    ],
    currentExpandedIDs: [],
  });

  assert.deepEqual(plan.selectedTreeIDs, ["node-node-a", "node-node-b"]);
  assert.equal(plan.primaryTreeID, "node-node-a");
  assert.deepEqual([...plan.expandedTreeIDs].sort(), ["folder-root", "workspace-folder-child", "workspace-folder-parent"]);
});

run("find selection ignores duplicate and unknown requested entities", () => {
  const plan = buildExplorerFindSelection({
    entities: [
      { kind: "logic_gate", id: "gate-a" },
      { kind: "logic_gate", id: "gate-a" },
      { kind: "logic_gate", id: "missing" },
    ],
    nodeIDs: [],
    logicGateIDs: ["gate-a"],
    folders: [],
    folderItems: [],
    currentExpandedIDs: ["workspace-folder-open"],
  });

  assert.deepEqual(plan.selectedTreeIDs, ["logic-gate-gate-a"]);
  assert.equal(plan.primaryEntity?.id, "gate-a");
  assert.deepEqual([...plan.expandedTreeIDs].sort(), ["folder-root", "workspace-folder-open"]);
});

run("stale opposite-map selections do not override recent Explorer domain changes", () => {
  assert.equal(
    shouldAcceptMapSelectionAfterExplorerSelection({
      incomingDomain: "node",
      currentDomain: "logic_gate",
      localSelectionChangedAt: 2000,
      incomingChangedAt: 1500,
      now: 2100,
    }),
    false,
  );
  assert.equal(
    shouldAcceptMapSelectionAfterExplorerSelection({
      incomingDomain: "node",
      currentDomain: "logic_gate",
      localSelectionChangedAt: 2000,
      incomingChangedAt: 2500,
      now: 2600,
    }),
    true,
  );
});
