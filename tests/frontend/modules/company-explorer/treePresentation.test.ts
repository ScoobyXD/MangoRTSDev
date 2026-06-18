import assert from "node:assert/strict";
import {
  EXPLORER_ROOT_ROW_LABELS,
  EXPLORER_ROOT_ROW_ORDER,
  buildExplorerFindSelection,
  buildExplorerRowBatchReorderPlan,
  buildExplorerRowReorderPlan,
  buildExplorerSearchResults,
  buildExplorerSearchViewRows,
  formatExplorerFolderLabel,
  getExplorerScrollTopForRow,
  resolveExplorerClickSelection,
  resolveExplorerCreationTargets,
  resolveExplorerDeleteTarget,
  resolveExplorerDropTarget,
  resolveExplorerKeyboardNavigation,
  resolveExplorerPublishedSelection,
  resolveExplorerRenameTarget,
  resolveExplorerRootDropTarget,
  shouldAcceptClearedMapSelectionAfterExplorerSelection,
  shouldAcceptMapSelectionAfterExplorerSelection,
} from "../../../../frontend/src/modules/company-explorer/treePresentation.js";
import { buildCompanyExplorerTreeRows, buildCompanyExplorerV2TreeRows, buildScopedCompanyExplorerTreeRows, findCompanyExplorerRootFolderByName } from "../../../../frontend/src/modules/company-explorer/companyExplorerTreeRows.js";
import { buildCompanyExplorerContextMenuSections, createInitialCompanyExplorerExpandedRows, filterExplorerRowsForCustomTopLevel } from "../../../../frontend/src/modules/company-explorer/CompanyExplorerContentModel.js";

const systemFolders = [
  { company_id: "c", folder_id: "system-active", folder_kind: "node" as const, system_key: "active_nodes" as const, name: "Active Nodes", position: 200, created_timestamp: "0", updated_timestamp: "0" },
  { company_id: "c", folder_id: "system-history", folder_kind: "node" as const, system_key: "history" as const, name: "History", position: 300, created_timestamp: "0", updated_timestamp: "0" },
];

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("root presentation has no visible default company row", () => {
  assert.deepEqual([...EXPLORER_ROOT_ROW_ORDER], []);
  assert.equal((EXPLORER_ROOT_ROW_ORDER as readonly string[]).includes("folder-notes"), false);
  assert.equal((EXPLORER_ROOT_ROW_ORDER as readonly string[]).includes("folder-logic"), false);
  assert.equal((EXPLORER_ROOT_ROW_ORDER as readonly string[]).includes("folder-nodes"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(EXPLORER_ROOT_ROW_LABELS, "folder-root"), false);
});

run("company explorer starts each page load with collapsed rows", () => {
  const initialExpanded = createInitialCompanyExplorerExpandedRows();
  assert.deepEqual([...initialExpanded], []);
  initialExpanded.add("workspace-folder-open");
  assert.deepEqual([...createInitialCompanyExplorerExpandedRows()], []);
});

run("company explorer context menu keeps fixed sections with disabled unavailable actions", () => {
  const sections = buildCompanyExplorerContextMenuSections({
    permissionsEnabled: true,
    createFolderEnabled: true,
    createNodeEnabled: false,
    createLogicGateEnabled: true,
    createProjectEnabled: true,
    renameEnabled: false,
    deleteEnabled: true,
  });

  assert.deepEqual(sections.map((section) => section.map((action) => action.label)), [
    ["Folder Permissions"],
    ["Create New Folder", "Create Node", "Create Logic Gate", "Create Project"],
    ["Rename", "Delete"],
  ]);
  assert.deepEqual(sections.map((section) => section.map((action) => action.enabled)), [
    [true],
    [true, false, true, true],
    [false, true],
  ]);
});

run("folder labels do not display counts", () => {
  assert.equal(formatExplorerFolderLabel("Invoices"), "Invoices");
});

run("tree rows render a blank root when the workspace is empty", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(),
    nodes: [],
    logicGates: [],
    projects: [],
    kanbanBoards: [],
    folders: systemFolders,
    folderItems: [],
    rootRowOrder: {},
  });
  assert.deepEqual(rows.map((row) => row.id), ["workspace-folder-system-active", "workspace-folder-system-history"]);
});

run("tree rows render root content without a synthetic Company folder", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(),
    nodes: [{ company_id: "c", node_id: "node-a", title: "Alpha", created_timestamp: "1" }],
    logicGates: [],
    projects: [],
    kanbanBoards: [],
    folders: systemFolders,
    folderItems: [],
    rootRowOrder: {},
  });
  assert.deepEqual(rows.map((row) => row.id), ["workspace-folder-system-active", "workspace-folder-system-history", "node-node-a"]);
  assert.equal(rows[rows.length - 1]?.depth, 0);
});

run("v2 tree rows preserve the existing tree shell ids and metadata", () => {
  const rows = buildCompanyExplorerV2TreeRows({
    expanded: new Set(["folder-root", "workspace-folder-folder-a", "logic-gate-gate-a"]),
    rows: [
      {
        company_id: "c",
        entity_id: "company-entity",
        entity_type: "company",
        resource_id: "c",
        name: "Company",
        position: 1000,
        has_children: true,
        created_timestamp: "1",
        updated_timestamp: "1",
      },
      {
        company_id: "c",
        entity_id: "folder-a",
        entity_type: "folder",
        name: "Folder A",
        parent_entity_id: "company-entity",
        edge_id: "edge-folder-a",
        position: 1000,
        has_children: true,
        created_timestamp: "2",
        updated_timestamp: "2",
      },
      {
        company_id: "c",
        entity_id: "gate-entity",
        entity_type: "logic_gate",
        resource_id: "gate-a",
        name: "Gate A",
        parent_entity_id: "folder-a",
        edge_id: "edge-gate-a",
        position: 1000,
        has_children: true,
        created_timestamp: "3",
        updated_timestamp: "3",
      },
      {
        company_id: "c",
        entity_id: "node-entity",
        entity_type: "node",
        resource_id: "node-a",
        name: "Node A",
        parent_entity_id: "gate-entity",
        position: 1000,
        has_children: false,
        created_timestamp: "4",
        updated_timestamp: "4",
      },
    ],
  });

  assert.deepEqual(rows.map((row) => row.id), [
    "folder-root",
    "workspace-folder-folder-a",
    "logic-gate-gate-a",
    "logic-gate-gate-a-node-node-a",
  ]);
  assert.equal(rows[1]?.entityType, "folder");
  assert.equal(rows[1]?.folderID, "folder-a");
  assert.equal(rows[1]?.edgeID, "edge-folder-a");
  assert.equal(rows[2]?.logicGateID, "gate-a");
  assert.equal(rows[3]?.nodeID, "node-a");
  assert.equal(rows[3]?.parentEntityID, "gate-entity");
});

run("automatic folders hold active node placements and due-date history", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(["workspace-folder-system-active", "workspace-folder-system-history"]),
    nodes: [
      { company_id: "c", node_id: "future", title: "Future", due_date: "2026-05-08", created_timestamp: "1" },
      { company_id: "c", node_id: "past", title: "Past", due_date: "2026-05-06", created_timestamp: "2" },
      { company_id: "c", node_id: "today", title: "Today", due_date: "2026-05-07", created_timestamp: "3" },
    ],
    logicGates: [],
    projects: [],
    kanbanBoards: [{ company_id: "c", board_id: "board-1", title: "Launch", position: 1000, created_timestamp: "4", updated_timestamp: "4" }],
    folders: systemFolders,
    folderItems: [{ company_id: "c", folder_id: "system-active", item_type: "node", item_id: "future", position: 1000, created_timestamp: "5", updated_timestamp: "5" }],
    rootRowOrder: {},
    todayISODate: "2026-05-07",
  });
  assert.deepEqual(rows.map((row) => row.id), [
    "workspace-folder-system-active",
    "node-future",
    "workspace-folder-system-history",
    "system-history-node-past",
    "node-past",
    "node-today",
  ]);
});

run("root folders from different domains can be locally ordered together", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(),
    nodes: [],
    logicGates: [],
    projects: [],
    kanbanBoards: [],
    folders: [
      ...systemFolders,
      { company_id: "c", folder_id: "node-root", folder_kind: "node", name: "Node Root", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
      { company_id: "c", folder_id: "logic-root", folder_kind: "logic_gate", name: "Logic Root", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
    ],
    folderItems: [],
    rootRowOrder: { "workspace-folder-logic-root": 500 },
  });
  assert.deepEqual(rows.map((row) => row.id), [
    "workspace-folder-system-active",
    "workspace-folder-system-history",
    "workspace-folder-logic-root",
    "workspace-folder-node-root",
  ]);
});

run("custom top-level rows exclude default roots and keep custom branches", () => {
  const rows = [
    { id: "raci-default-folders", label: "Default Folders", depth: 0, kind: "folder" as const, folderKind: "logic_gate" as const, scopeLevel: 0, position: 1000, createdTimestamp: "", syntheticKind: "default_scope_folder" as const },
    { id: "raci-folder-generated", label: "Generated", depth: 1, kind: "folder" as const, folderKind: "logic_gate" as const, scopeLevel: 1, position: 1000, createdTimestamp: "", syntheticKind: "raci_folder" as const },
    { id: "workspace-folder-system-active", label: "Active Nodes", depth: 0, kind: "folder" as const, folderID: "system-active", folderKind: "node" as const, systemKey: "active_nodes" as const, scopeLevel: 0, position: 200, createdTimestamp: "0" },
    { id: "node-system", label: "System Node", depth: 1, kind: "node" as const, nodeID: "system", folderID: "system-active", folderKind: "node" as const, scopeLevel: 1, position: 1000, createdTimestamp: "1" },
    { id: "workspace-folder-function-root", label: "Logic Gates by Function", depth: 0, kind: "folder" as const, folderID: "function-root", folderKind: "logic_gate" as const, scopeLevel: 0, position: 300, createdTimestamp: "0" },
    { id: "workspace-folder-function-child", label: "Finance", depth: 1, kind: "folder" as const, folderID: "function-child", parentFolderID: "function-root", folderKind: "logic_gate" as const, scopeLevel: 1, position: 1000, createdTimestamp: "1" },
    { id: "workspace-folder-custom", label: "MangoRTS", depth: 0, kind: "folder" as const, folderID: "custom", folderKind: "logic_gate" as const, scopeLevel: 0, position: 400, createdTimestamp: "0" },
    { id: "logic-gate-custom", label: "Development Work", depth: 1, kind: "logic_gate" as const, logicGateID: "custom-gate", folderID: "custom", folderKind: "logic_gate" as const, scopeLevel: 1, position: 1000, createdTimestamp: "1" },
    { id: "node-root", label: "Unfoldered Node", depth: 0, kind: "node" as const, nodeID: "root", folderID: "", folderKind: "node" as const, scopeLevel: 0, position: 500, createdTimestamp: "1" },
  ];

  assert.deepEqual(
    filterExplorerRowsForCustomTopLevel({
      rows,
      hiddenRootFolderNames: ["Logic Gates by Function", "Mango GVIC Generated"],
    }).map((row) => row.id),
    ["workspace-folder-custom", "logic-gate-custom", "node-root"],
  );
});

run("scoped explorer rows render children under a named logic-gate root", () => {
  const folders = [
    { company_id: "c", folder_id: "function-root", folder_kind: "logic_gate" as const, name: "Logic Gates by function", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
    { company_id: "c", folder_id: "person-root", folder_kind: "logic_gate" as const, name: "Logic Gates by person", position: 2000, created_timestamp: "2", updated_timestamp: "2" },
    { company_id: "c", folder_id: "function-child", parent_folder_id: "function-root", folder_kind: "logic_gate" as const, name: "Billing", position: 1000, created_timestamp: "3", updated_timestamp: "3" },
  ];
  const root = findCompanyExplorerRootFolderByName(folders, "logic_gate", "logic gates by function");
  assert.equal(root?.folder_id, "function-root");

  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(["workspace-folder-function-root", "workspace-folder-function-child", "workspace-folder-person-root"]),
    nodes: [],
    logicGates: [
      { company_id: "c", logic_gate_id: "gate-a", node_id: "gate-a", header: "A/R followup", title: "A/R followup", created_timestamp: "4" },
      { company_id: "c", logic_gate_id: "gate-b", node_id: "gate-b", header: "Exec review", title: "Exec review", created_timestamp: "5" },
    ],
    projects: [],
    kanbanBoards: [],
    folders,
    folderItems: [
      { company_id: "c", folder_id: "function-child", item_type: "logic_gate", item_id: "gate-a", position: 1000, created_timestamp: "6", updated_timestamp: "6" },
      { company_id: "c", folder_id: "person-root", item_type: "logic_gate", item_id: "gate-b", position: 1000, created_timestamp: "7", updated_timestamp: "7" },
    ],
    rootRowOrder: {},
  });

  assert.deepEqual(buildScopedCompanyExplorerTreeRows(rows, "function-root").map((row) => [row.id, row.depth]), [
    ["workspace-folder-function-child", 0],
    ["logic-gate-gate-a", 1],
  ]);
});

run("raw scoped tree rows keep custom folders under default-named parents", () => {
  const folders = [
    { company_id: "c", folder_id: "generated-root", folder_kind: "logic_gate" as const, name: "Mango GVIC Generated", position: 1000, created_timestamp: "1", updated_timestamp: "1", scope_type: "company" as const },
    { company_id: "c", folder_id: "custom-a", parent_folder_id: "generated-root", folder_kind: "logic_gate" as const, name: "Custom Generated A", position: 1000, created_timestamp: "2", updated_timestamp: "2", scope_type: "user" as const, scope_id: "user-1" },
    { company_id: "c", folder_id: "custom-b", parent_folder_id: "generated-root", folder_kind: "logic_gate" as const, name: "Custom Generated B", position: 2000, created_timestamp: "3", updated_timestamp: "3", scope_type: "user" as const, scope_id: "user-1" },
  ];
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(["workspace-folder-generated-root", "workspace-folder-custom-a", "workspace-folder-custom-b"]),
    nodes: [],
    logicGates: [
      { company_id: "c", logic_gate_id: "gate-a", node_id: "gate-a", header: "Gate A", title: "Gate A", created_timestamp: "4" },
      { company_id: "c", logic_gate_id: "gate-b", node_id: "gate-b", header: "Gate B", title: "Gate B", created_timestamp: "5" },
    ],
    projects: [],
    kanbanBoards: [],
    folders,
    folderItems: [
      { company_id: "c", folder_id: "custom-a", item_type: "logic_gate", item_id: "gate-a", position: 1000, created_timestamp: "6", updated_timestamp: "6" },
      { company_id: "c", folder_id: "custom-b", item_type: "logic_gate", item_id: "gate-b", position: 1000, created_timestamp: "7", updated_timestamp: "7" },
    ],
    rootRowOrder: {},
  });

  assert.deepEqual(rows.map((row) => [row.id, row.depth, row.kind, row.label]), [
    ["workspace-folder-generated-root", 0, "folder", "Mango GVIC Generated"],
    ["workspace-folder-custom-a", 1, "folder", "Custom Generated A"],
    ["logic-gate-gate-a", 2, "logic_gate", "Gate A"],
    ["workspace-folder-custom-b", 1, "folder", "Custom Generated B"],
    ["logic-gate-gate-b", 2, "logic_gate", "Gate B"],
  ]);
});

run("custom logic gate rows render assigned nodes when expanded", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(["workspace-folder-custom", "logic-gate-gate-a"]),
    nodes: [{ company_id: "c", node_id: "node-a", title: "Nested node", logic_gate_ids: ["gate-a"], created_timestamp: "5" }],
    logicGates: [
      { company_id: "c", logic_gate_id: "gate-a", node_id: "gate-a", header: "Gate A", title: "Gate A", created_timestamp: "4" },
    ],
    projects: [],
    kanbanBoards: [],
    folders: [
      ...systemFolders,
      { company_id: "c", folder_id: "custom", folder_kind: "logic_gate" as const, name: "MangoRTS", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
    ],
    folderItems: [
      { company_id: "c", folder_id: "custom", item_type: "logic_gate", item_id: "gate-a", position: 1000, created_timestamp: "6", updated_timestamp: "6" },
    ],
    rootRowOrder: {},
  });

  const logicGateIndex = rows.findIndex((row) => row.id === "logic-gate-gate-a");
  assert.notEqual(logicGateIndex, -1);
  assert.equal(rows[logicGateIndex]?.hasChildren, true);
  assert.deepEqual(rows.slice(logicGateIndex, logicGateIndex + 2).map((row) => [row.id, row.depth, row.kind, row.parentLogicGateID ?? ""]), [
    ["logic-gate-gate-a", 1, "logic_gate", ""],
    ["logic-gate-gate-a-node-node-a", 2, "node", "gate-a"],
  ]);
});

run("context creation targets nested logic gate folders", () => {
  const targets = resolveExplorerCreationTargets({ kind: "folder", folderKind: "logic_gate", folderID: "logic-folder-1" });
  assert.deepEqual(targets, {
    preferredFolderKind: "logic_gate",
    preferredFolderParentID: "logic-folder-1",
    nodeFolderParentID: "logic-folder-1",
    logicGateFolderParentID: "logic-folder-1",
    projectFolderParentID: "",
    nodeParentFolderID: "logic-folder-1",
    logicGateParentFolderID: "logic-folder-1",
    projectParentFolderID: "logic-folder-1",
  });
});

run("context creation defaults blank areas to root custom folders", () => {
  const targets = resolveExplorerCreationTargets(null);
  assert.deepEqual(targets, {
    preferredFolderKind: "logic_gate",
    preferredFolderParentID: "",
    nodeFolderParentID: "",
    logicGateFolderParentID: "",
    projectFolderParentID: "",
    nodeParentFolderID: "",
    logicGateParentFolderID: "",
    projectParentFolderID: "",
  });
});

run("context creation targets node siblings from a node row", () => {
  const targets = resolveExplorerCreationTargets({ kind: "node", folderKind: "node", folderID: "node-folder-1" });
  assert.deepEqual(targets, {
    preferredFolderKind: "node",
    preferredFolderParentID: "node-folder-1",
    nodeFolderParentID: "node-folder-1",
    logicGateFolderParentID: "",
    projectFolderParentID: "",
    nodeParentFolderID: "node-folder-1",
    logicGateParentFolderID: "node-folder-1",
    projectParentFolderID: "node-folder-1",
  });
});

run("rename targets only resolve for concrete folders and entities", () => {
  assert.deepEqual(resolveExplorerRenameTarget({ kind: "folder", folderKind: "node", folderID: "folder-1" }), { kind: "folder", id: "folder-1" });
  assert.deepEqual(resolveExplorerRenameTarget({ kind: "node", nodeID: "node-1" }), { kind: "node", id: "node-1" });
  assert.deepEqual(resolveExplorerRenameTarget({ kind: "logic_gate", logicGateID: "gate-1" }), { kind: "logic_gate", id: "gate-1" });
  assert.equal(resolveExplorerRenameTarget({ kind: "kanban", kanbanBoardID: "board-1" }), null);
  assert.equal(resolveExplorerRenameTarget({ kind: "folder", folderKind: "node" }), null);
  assert.equal(resolveExplorerRenameTarget({ kind: "folder", folderKind: "node", folderID: "system", systemKey: "history" }), null);
});

run("delete targets only resolve for concrete folders and entities", () => {
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "folder", folderKind: "node", folderID: "folder-1" }), { kind: "folder", id: "folder-1", folderKind: "node" });
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "node", nodeID: "node-1" }), { kind: "node", id: "node-1" });
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "logic_gate", logicGateID: "gate-1" }), { kind: "logic_gate", id: "gate-1" });
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "kanban", kanbanBoardID: "board-1" }), { kind: "kanban", id: "board-1" });
  assert.equal(resolveExplorerDeleteTarget({ kind: "folder", folderKind: "node" }), null);
  assert.equal(resolveExplorerDeleteTarget({ kind: "folder", folderKind: "node", folderID: "system", systemKey: "active_nodes" }), null);
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

  assert.equal(
    resolveExplorerDropTarget(
      { kind: "node", folderKind: "node", folderID: "node-folder", nodeID: "node-1" },
      { kind: "kanban", itemType: "kanban", itemID: "board-1" },
    ),
    null,
  );

  assert.equal(
    resolveExplorerDropTarget(
      { kind: "logic_gate", folderKind: "logic_gate", folderID: "gate-folder", logicGateID: "gate-1" },
      { kind: "kanban", itemType: "kanban", itemID: "board-1" },
    ),
    null,
  );
});

run("folder drops can target the internal root", () => {
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

run("published selection follows the active tree row during domain switches", () => {
  const selection = resolveExplorerPublishedSelection({
    selectedTreeID: "node-node-a",
    selectedNodeID: "node-a",
    selectedLogicGateID: "stale-gate",
    selectedKanbanBoardID: "",
    selectedFolderID: "",
    selectedFolderKind: "node",
    targetFrameKind: "node-map",
  });

  assert.equal(selection.entityKind, "node");
  assert.equal(selection.entityID, "node-a");
  assert.equal(selection.selectedNodeID, "node-a");
  assert.equal(selection.selectedLogicGateID, "");
  assert.equal(selection.isLogicGateContext, false);
});

run("published folder selection targets the matching map domain", () => {
  const logicFolder = resolveExplorerPublishedSelection({
    selectedTreeID: "workspace-folder-logic",
    selectedNodeID: "",
    selectedLogicGateID: "",
    selectedKanbanBoardID: "",
    selectedFolderID: "logic",
    selectedFolderKind: "logic_gate",
    targetFrameKind: "node-map",
  });
  assert.equal(logicFolder.entityKind, "folder");
  assert.equal(logicFolder.entityID, "logic");
  assert.equal(logicFolder.isLogicGateContext, true);

  const emptyRootForLogicMap = resolveExplorerPublishedSelection({
    selectedTreeID: "folder-root",
    selectedNodeID: "",
    selectedLogicGateID: "",
    selectedKanbanBoardID: "",
    selectedFolderID: "",
    targetFrameKind: "logic-map",
  });
  assert.equal(emptyRootForLogicMap.isLogicGateContext, true);
});

run("keyboard navigation moves selection and expands folders without DOM focus assumptions", () => {
  const rows = [
    { id: "node-a", kind: "node" as const },
    { id: "workspace-folder-1", kind: "folder" as const },
  ];
  const down = resolveExplorerKeyboardNavigation({
    rows,
    selectedTreeID: "folder-root",
    expandedIDs: new Set(),
    key: "ArrowDown",
  });
  assert.equal(down.handled, true);
  assert.equal(down.selectedTreeID, "node-a");

  const expand = resolveExplorerKeyboardNavigation({
    rows,
    selectedTreeID: "workspace-folder-1",
    expandedIDs: new Set(),
    key: "ArrowRight",
  });
  assert.equal(expand.handled, true);
  assert.deepEqual([...(expand.expandedIDs ?? new Set())], ["workspace-folder-1"]);
});

run("find scrolling accounts for the Explorer header and keeps the target above the bottom edge", () => {
  assert.equal(getExplorerScrollTopForRow({
    rowIndex: 20,
    rowHeight: 30,
    rowsTopOffset: 31,
    currentScrollTop: 360,
    viewportHeight: 300,
    bottomPadding: 30,
    maxScrollTop: 1000,
  }), 391);
});

run("find scrolling can center a selected result", () => {
  assert.equal(getExplorerScrollTopForRow({
    rowIndex: 20,
    rowHeight: 30,
    rowsTopOffset: 31,
    currentScrollTop: 360,
    viewportHeight: 300,
    bottomPadding: 30,
    maxScrollTop: 1000,
    align: "center",
  }), 496);
});

run("search falls back to the whole company when selected folder has no matches", () => {
  const rows = [
    { id: "workspace-folder-a", label: "Folder A", depth: 0, kind: "folder" as const, folderID: "a", folderKind: "node" as const },
    { id: "node-alpha", label: "Alpha", depth: 1, kind: "node" as const, nodeID: "alpha", folderID: "a", folderKind: "node" as const },
    { id: "workspace-folder-b", label: "Folder B", depth: 0, kind: "folder" as const, folderID: "b", folderKind: "node" as const },
    { id: "node-beta", label: "Beta", depth: 1, kind: "node" as const, nodeID: "beta", folderID: "b", folderKind: "node" as const },
  ];
  assert.deepEqual(
    buildExplorerSearchResults({ rows, selectedRowID: "workspace-folder-a", query: "beta" }).map((row) => row.id),
    ["node-beta"],
  );
  assert.deepEqual(
    buildExplorerSearchResults({ rows, selectedRowID: "workspace-folder-a", query: "alpha" }).map((row) => row.id),
    ["node-alpha"],
  );
});

run("search view filters rows inline and keeps ancestor folders for context", () => {
  const rows = [
    { id: "workspace-folder-a", label: "Operations", depth: 0, kind: "folder" as const, folderID: "a", folderKind: "node" as const },
    { id: "node-alpha", label: "Alpha", depth: 1, kind: "node" as const, nodeID: "alpha", folderID: "a", folderKind: "node" as const },
    { id: "workspace-folder-b", label: "Finance", depth: 0, kind: "folder" as const, folderID: "b", folderKind: "node" as const },
    { id: "node-forecast", label: "Forecast", depth: 1, kind: "node" as const, nodeID: "forecast", folderID: "b", folderKind: "node" as const },
  ];
  assert.deepEqual(
    buildExplorerSearchViewRows({ rows, query: "for" }).map((row) => row.id),
    ["workspace-folder-b", "node-forecast"],
  );
});

run("search does not match every folder by row kind", () => {
  const rows = [
    { id: "workspace-folder-ops", label: "Operations", depth: 0, kind: "folder" as const, folderID: "ops", folderKind: "node" as const },
    { id: "node-forecast", label: "Forecast", depth: 0, kind: "node" as const, nodeID: "forecast", folderID: "", folderKind: "node" as const },
  ];
  assert.deepEqual(
    buildExplorerSearchResults({ rows, selectedRowID: "", query: "f" }).map((row) => row.id),
    ["node-forecast"],
  );
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

run("stale same-domain map selections do not override rapid Explorer navigation", () => {
  assert.equal(
    shouldAcceptMapSelectionAfterExplorerSelection({
      incomingDomain: "node",
      currentDomain: "node",
      localSelectionChangedAt: 2000,
      incomingChangedAt: 2050,
      now: 2060,
    }),
    false,
  );
  assert.equal(
    shouldAcceptMapSelectionAfterExplorerSelection({
      incomingDomain: "node",
      currentDomain: "node",
      localSelectionChangedAt: 2000,
      incomingChangedAt: 1990,
      now: 2010,
    }),
    false,
  );
  assert.equal(
    shouldAcceptMapSelectionAfterExplorerSelection({
      incomingDomain: "node",
      currentDomain: "node",
      localSelectionChangedAt: 2000,
      incomingChangedAt: 2200,
      now: 2210,
    }),
    true,
  );
});

run("untimestamped map selections wait out recent Explorer intent", () => {
  assert.equal(
    shouldAcceptMapSelectionAfterExplorerSelection({
      incomingDomain: "node",
      currentDomain: "folder",
      localSelectionChangedAt: 2000,
      now: 2100,
    }),
    false,
  );
  assert.equal(
    shouldAcceptMapSelectionAfterExplorerSelection({
      incomingDomain: "node",
      currentDomain: "folder",
      localSelectionChangedAt: 2000,
      now: 3000,
    }),
    true,
  );
});

run("fresh cleared map selections do not erase a recent Explorer click", () => {
  assert.equal(
    shouldAcceptClearedMapSelectionAfterExplorerSelection({
      currentDomain: "node",
      localSelectionChangedAt: 2000,
      incomingChangedAt: 2050,
      now: 2100,
    }),
    false,
  );
  assert.equal(
    shouldAcceptClearedMapSelectionAfterExplorerSelection({
      currentDomain: "node",
      localSelectionChangedAt: 2000,
      incomingChangedAt: 2050,
      now: 3000,
    }),
    true,
  );
});
