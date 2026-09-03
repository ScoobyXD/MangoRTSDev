import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
} from "../../../../frontend/src/modules/company-explorer/treePresentation.js";
import { getExplorerRowContainerID } from "../../../../frontend/src/modules/company-explorer/companyExplorerDragDrop.js";
import { buildCompanyExplorerSearchTreeRows, buildCompanyExplorerTreeRows, buildCompanyExplorerV2TreeRows, buildScopedCompanyExplorerTreeRows, findCompanyExplorerRootFolderByName, isCompanyExplorerV2FolderItemPlacementRow } from "../../../../frontend/src/modules/company-explorer/companyExplorerTreeRows.js";
import { buildCompanyExplorerContextMenuSections, createInitialCompanyExplorerExpandedRows, filterExplorerRowsForCustomTopLevel } from "../../../../frontend/src/modules/company-explorer/CompanyExplorerContentModel.js";

const systemFolders = [
  { company_id: "c", folder_id: "logic-root", folder_kind: "logic_gate" as const, name: "Logic Gates", position: 200, created_timestamp: "0", updated_timestamp: "0" },
  { company_id: "c", folder_id: "project-root", folder_kind: "project" as const, name: "Projects", position: 300, created_timestamp: "0", updated_timestamp: "0" },
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

run("node rows do not participate in Company Explorer reordering", () => {
  assert.equal(getExplorerRowContainerID({
    id: "logic-gate-gate-1-node-node-1",
    label: "Node 1",
    depth: 1,
    kind: "node",
    nodeID: "node-1",
    scopeLevel: 1,
    position: 1000,
    createdTimestamp: "0",
    parentLogicGateID: "gate-1",
    syntheticKind: "logic_gate_children",
  }), null);
});

run("company explorer context menu keeps fixed sections with disabled unavailable actions", () => {
  const sections = buildCompanyExplorerContextMenuSections({
    permissionsEnabled: true,
    createFolderEnabled: true,
    createLogicGateEnabled: true,
    createProjectEnabled: true,
    renameEnabled: false,
    deleteEnabled: true,
  });

  assert.deepEqual(sections.map((section) => section.map((action) => action.label)), [
    ["Folder Permissions"],
    ["Create New Folder", "Create Process", "Create Project"],
    ["Rename", "Delete"],
  ]);
  assert.deepEqual(sections.map((section) => section.map((action) => action.enabled)), [
    [true],
    [true, true, true],
    [false, true],
  ]);
});

run("folder labels do not display counts", () => {
  assert.equal(formatExplorerFolderLabel("Invoices"), "Invoices");
  assert.equal(formatExplorerFolderLabel("Logic Gates"), "Processes");
  assert.equal(formatExplorerFolderLabel("Active Logic Gates"), "Active Processes");
  assert.equal(formatExplorerFolderLabel("Logic Gates by Function"), "Processes by Function");
  assert.equal(formatExplorerFolderLabel("Logic Gates by Person"), "Processes by Person");
});

run("tree rows render a blank root when the workspace is empty", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(),
    nodes: [],
    logicGates: [],
    projects: [],
    folders: systemFolders,
    folderItems: [],
    rootRowOrder: {},
  });
  assert.deepEqual(rows.map((row) => row.id), ["workspace-folder-logic-root", "workspace-folder-project-root"]);
});

run("tree rows ignore source nodes in the main Company Explorer", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(),
    nodes: [{ company_id: "c", node_id: "node-a", name: "Alpha", created_timestamp: "1" }],
    logicGates: [],
    projects: [],
    folders: systemFolders,
    folderItems: [],
    rootRowOrder: {},
  });
  assert.deepEqual(rows.map((row) => row.id), ["workspace-folder-logic-root", "workspace-folder-project-root"]);
  assert.equal(rows.some((row) => row.kind === "node"), false);
});


run("search tree rows merge shared paths and render each matching resource once", () => {
  const rows = buildCompanyExplorerSearchTreeRows([
    {
      company_id: "c",
      resource_type: "logic_gate",
      resource_id: "gate-a",
      entity_id: "gate-a",
      display_name: "Search Gate",
      match_reason: "name_exact",
      location_path: [
        { entity_type: "folder", entity_id: "unfiled", name: "Unfiled" },
        { entity_type: "folder", entity_id: "logic-gates", name: "Logic Gates" },
      ],
      has_children: true,
      created_timestamp: "3",
      updated_timestamp: "3",
    },
    {
      company_id: "c",
      resource_type: "node",
      resource_id: "node-a",
      entity_id: "node-a",
      display_name: "Search Node",
      match_reason: "name_exact",
      location_path: [
        { entity_type: "folder", entity_id: "unfiled", name: "Unfiled" },
        { entity_type: "folder", entity_id: "logic-gates", name: "Logic Gates" },
        { entity_type: "logic_gate", entity_id: "gate-a", resource_id: "gate-a", name: "Search Gate" },
      ],
      has_children: true,
      created_timestamp: "4",
      updated_timestamp: "4",
    },
  ]);

  assert.deepEqual(rows.map((row) => row.label), ["Unfiled", "Processes", "Search Gate", "Search Node"]);
  assert.deepEqual(rows.map((row) => row.depth), [0, 1, 2, 3]);
  assert.deepEqual(rows.map((row) => row.kind), ["folder", "folder", "logic_gate", "node"]);
  assert.equal(rows.filter((row) => row.entityID === "unfiled").length, 1);
  assert.equal(rows.filter((row) => row.entityID === "gate-a").length, 1);
  assert.equal(rows[2]?.logicGateID, "gate-a");
  assert.equal(rows[2]?.folderLabel, "Unfiled / Processes");
  assert.equal(rows[2]?.syntheticKind, "search_result");
  assert.equal(rows[2]?.hasChildren, true);
  assert.equal(rows[3]?.nodeID, "node-a");
  assert.equal(rows[3]?.syntheticKind, "search_result");
  assert.equal(rows[3]?.hasChildren, false);
});

run("search rows rename only stored Logic Gate folder labels", () => {
  const rows = buildCompanyExplorerSearchTreeRows([
    {
      company_id: "c",
      resource_type: "folder",
      resource_id: "logic-gates",
      entity_id: "logic-gates",
      display_name: "Logic Gates",
      match_reason: "name_exact",
      location_path: [],
      protected_default_folder: true,
      has_children: true,
      created_timestamp: "1",
      updated_timestamp: "1",
    },
    {
      company_id: "c",
      resource_type: "logic_gate",
      resource_id: "gate-named-logic-gates",
      entity_id: "gate-named-logic-gates",
      display_name: "Logic Gates",
      match_reason: "name_exact",
      location_path: [],
      has_children: false,
      created_timestamp: "2",
      updated_timestamp: "2",
    },
  ]);

  assert.deepEqual(rows.map((row) => row.label), ["Processes", "Logic Gates"]);
});

run("search tree renders directly authorized results at the root when their locations are restricted", () => {
  const rows = buildCompanyExplorerSearchTreeRows([
    {
      company_id: "c",
      resource_type: "logic_gate",
      resource_id: "gate-restricted-path",
      entity_id: "gate-restricted-path",
      display_name: "Visible Gate",
      match_reason: "name_exact",
      location_path: [],
      has_children: false,
      created_timestamp: "1",
      updated_timestamp: "1",
    },
    {
      company_id: "c",
      resource_type: "project",
      resource_id: "project-restricted-path",
      entity_id: "project-restricted-path",
      display_name: "Visible Project",
      match_reason: "name_exact",
      location_path: [],
      has_children: false,
      created_timestamp: "2",
      updated_timestamp: "2",
    },
    {
      company_id: "c",
      resource_type: "node",
      resource_id: "node-restricted-path",
      entity_id: "node-restricted-path",
      display_name: "Visible Node",
      match_reason: "name_exact",
      location_path: [],
      has_children: false,
      created_timestamp: "3",
      updated_timestamp: "3",
    },
  ]);

  assert.deepEqual(rows.map((row) => row.label), ["Visible Gate", "Visible Project", "Visible Node"]);
  assert.deepEqual(rows.map((row) => row.depth), [0, 0, 0]);
  assert.deepEqual(rows.map((row) => row.parentEntityID), ["", "", ""]);
  assert.deepEqual(rows.map((row) => row.folderLabel), ["", "", ""]);
  assert.equal(rows.every((row) => row.syntheticKind === "search_result"), true);
});

run("company explorer search debounces and aborts superseded requests", () => {
  const content = readFileSync(resolve(process.cwd(), "frontend/src/modules/company-explorer/CompanyExplorerContent.tsx"), "utf8");
  const api = readFileSync(resolve(process.cwd(), "frontend/src/modules/company-explorer/companyExplorerLazyApi.ts"), "utf8");
  assert.match(content, /const controller = new AbortController\(\)/);
  assert.match(content, /window\.setTimeout\(\(\) => \{/);
  assert.match(content, /controller\.signal/);
  assert.match(content, /window\.clearTimeout\(timer\)/);
  assert.match(content, /controller\.abort\(\)/);
  assert.match(api, /signal\?: AbortSignal/);
  assert.match(api, /\{ signal \}/);
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
        name: "Logic Gates",
        parent_entity_id: "company-entity",
        edge_id: "edge-folder-a",
        position: 1000,
        has_children: true,
        native_context: { protected_default_folder: "true" },
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
  ]);
  assert.equal(rows[1]?.entityType, "folder");
  assert.equal(rows[1]?.folderID, "folder-a");
  assert.equal(rows[1]?.edgeID, "edge-folder-a");
  assert.equal(rows[1]?.label, "Processes");
  assert.equal(rows[1]?.protectedDefaultFolder, true);
  assert.equal(rows[2]?.logicGateID, "gate-a");
  assert.equal(rows[2]?.folderLabel, "Processes");
  assert.equal(rows[2]?.hasChildren, false);
  assert.equal(rows.some((row) => row.kind === "node"), false);
});

run("v2 tree rows hide project relationship children to keep one Explorer instance per resource", () => {
  const rows = buildCompanyExplorerV2TreeRows({
    expanded: new Set(["folder-root", "workspace-folder-folder-a", "project-project-a"]),
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
        entity_id: "project-entity",
        entity_type: "project",
        resource_id: "project-a",
        name: "Project A",
        parent_entity_id: "company-entity",
        edge_id: "edge-project-a",
        position: 2000,
        has_children: true,
        created_timestamp: "3",
        updated_timestamp: "3",
      },
      {
        company_id: "c",
        entity_id: "gate-entity",
        entity_type: "logic_gate",
        resource_id: "gate-a",
        name: "Gate A",
        parent_entity_id: "folder-a",
        edge_id: "edge-gate-folder",
        position: 1000,
        has_children: false,
        created_timestamp: "4",
        updated_timestamp: "4",
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
        created_timestamp: "5",
        updated_timestamp: "5",
      },
    ],
  });

  assert.deepEqual(rows.map((row) => row.id), [
    "folder-root",
    "workspace-folder-folder-a",
    "logic-gate-gate-a",
    "project-project-a",
  ]);
  assert.equal(rows[2]?.parentEntityID, "folder-a");
  assert.equal(rows[2]?.edgeID, "edge-gate-folder");
  assert.equal(rows[3]?.hasChildren, false);
  assert.equal(rows.some((row) => row.parentEntityID === "project-entity"), false);
});

run("v2 delete targets keep explorer entity identity separate from source ids", () => {
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

  assert.deepEqual(resolveExplorerDeleteTarget(rows[1]), { kind: "folder", id: "folder-a", folderKind: "logic_gate", entityID: "folder-a", entityType: "folder" });
  assert.deepEqual(resolveExplorerDeleteTarget(rows[2]), { kind: "logic_gate", id: "gate-a", entityID: "gate-entity", entityType: "logic_gate", edgeID: "edge-gate-a" });
  assert.equal(rows.some((row) => row.kind === "node"), false);
  assert.equal(resolveExplorerDeleteTarget({ kind: "node", nodeID: "node-a", entityID: "node-entity", entityType: "node" }), null);
});

run("v2 native rows without source resource ids are not deletable as source records", () => {
  assert.equal(resolveExplorerDeleteTarget({
    id: "node-node-entity",
    kind: "node",
    entityID: "node-entity",
    entityType: "node",
  }), null);
});

run("protected default folder rows do not resolve destructive actions", () => {
  const row = {
    id: "workspace-folder-unfiled",
    kind: "folder" as const,
    folderKind: "logic_gate" as const,
    folderID: "unfiled",
    protectedDefaultFolder: true,
  };
  assert.equal(resolveExplorerDeleteTarget(row), null);
  assert.equal(resolveExplorerRenameTarget(row), null);
});

run("v2 folder item placement detection rejects node rows", () => {
  const rows = [
    { company_id: "c", entity_id: "folder-a", entity_type: "folder" as const, name: "Folder A", position: 1000, has_children: true, created_timestamp: "1", updated_timestamp: "1" },
    { company_id: "c", entity_id: "gate-a", entity_type: "logic_gate" as const, resource_id: "gate-a", name: "Gate A", position: 1000, has_children: true, created_timestamp: "2", updated_timestamp: "2" },
    { company_id: "c", entity_id: "node-folder", entity_type: "node" as const, resource_id: "node-folder", name: "Folder Node", parent_entity_id: "folder-a", edge_id: "explorer-item-edge", position: 1000, has_children: false, created_timestamp: "3", updated_timestamp: "3" },
    { company_id: "c", entity_id: "node-root", entity_type: "node" as const, resource_id: "node-root", name: "Root Node", edge_id: "root-explorer-item-edge", position: 1000, has_children: false, created_timestamp: "4", updated_timestamp: "4" },
    { company_id: "c", entity_id: "node-assigned", entity_type: "node" as const, resource_id: "node-assigned", name: "Assigned Node", parent_entity_id: "gate-a", edge_id: "logic-gate-assignment-edge", position: 1000, has_children: false, created_timestamp: "5", updated_timestamp: "5" },
  ];

  assert.equal(isCompanyExplorerV2FolderItemPlacementRow(rows[2], rows), false);
  assert.equal(isCompanyExplorerV2FolderItemPlacementRow(rows[3], rows), false);
  assert.equal(isCompanyExplorerV2FolderItemPlacementRow(rows[4], rows), false);
});

run("tree rows ignore stale node folder items", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(["workspace-folder-logic-root"]),
    nodes: [
      { company_id: "c", node_id: "future", name: "Future", created_timestamp: "1" },
    ],
    logicGates: [],
    projects: [],
    folders: systemFolders,
    folderItems: [{ company_id: "c", folder_id: "logic-root", item_type: "node", item_id: "future", position: 1000, created_timestamp: "5", updated_timestamp: "5" }],
    rootRowOrder: {},
  });
  assert.deepEqual(rows.map((row) => row.id), [
    "workspace-folder-logic-root",
    "workspace-folder-project-root",
  ]);
});

run("root folders from different domains can be locally ordered together", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(),
    nodes: [],
    logicGates: [],
    projects: [],
    folders: [
      ...systemFolders,
      { company_id: "c", folder_id: "node-root", folder_kind: "node", name: "Node Root", position: 1000, created_timestamp: "1", updated_timestamp: "1" },
      { company_id: "c", folder_id: "logic-custom", folder_kind: "logic_gate", name: "Logic Custom", position: 1000, created_timestamp: "2", updated_timestamp: "2" },
    ],
    folderItems: [],
    rootRowOrder: { "workspace-folder-logic-root": 500 },
  });
  assert.deepEqual(rows.map((row) => row.id), [
    "workspace-folder-logic-root",
    "workspace-folder-logic-custom",
    "workspace-folder-project-root",
  ]);
});

run("custom top-level rows exclude default roots and keep custom branches", () => {
  const rows = [
    { id: "RACI-default-folders", label: "Default Folders", depth: 0, kind: "folder" as const, folderKind: "logic_gate" as const, scopeLevel: 0, position: 1000, createdTimestamp: "", syntheticKind: "default_scope_folder" as const },
    { id: "RACI-folder-responsible", label: "Responsible", depth: 1, kind: "folder" as const, folderKind: "logic_gate" as const, scopeLevel: 1, position: 1000, createdTimestamp: "", syntheticKind: "RACI_folder" as const },
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
      hiddenRootFolderNames: ["Logic Gates by Function", "Mango RACI Responsible"],
    }).map((row) => row.id),
    ["workspace-folder-custom", "logic-gate-custom"],
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
    { company_id: "c", folder_id: "responsible-root", folder_kind: "logic_gate" as const, name: "Mango RACI Responsible", position: 1000, created_timestamp: "1", updated_timestamp: "1", scope_type: "company" as const },
    { company_id: "c", folder_id: "custom-a", parent_folder_id: "responsible-root", folder_kind: "logic_gate" as const, name: "Custom Responsible A", position: 1000, created_timestamp: "2", updated_timestamp: "2", scope_type: "user" as const, scope_id: "user-1" },
    { company_id: "c", folder_id: "custom-b", parent_folder_id: "responsible-root", folder_kind: "logic_gate" as const, name: "Custom Responsible B", position: 2000, created_timestamp: "3", updated_timestamp: "3", scope_type: "user" as const, scope_id: "user-1" },
  ];
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(["workspace-folder-responsible-root", "workspace-folder-custom-a", "workspace-folder-custom-b"]),
    nodes: [],
    logicGates: [
      { company_id: "c", logic_gate_id: "gate-a", node_id: "gate-a", header: "Gate A", title: "Gate A", created_timestamp: "4" },
      { company_id: "c", logic_gate_id: "gate-b", node_id: "gate-b", header: "Gate B", title: "Gate B", created_timestamp: "5" },
    ],
    projects: [],
    folders,
    folderItems: [
      { company_id: "c", folder_id: "custom-a", item_type: "logic_gate", item_id: "gate-a", position: 1000, created_timestamp: "6", updated_timestamp: "6" },
      { company_id: "c", folder_id: "custom-b", item_type: "logic_gate", item_id: "gate-b", position: 1000, created_timestamp: "7", updated_timestamp: "7" },
    ],
    rootRowOrder: {},
  });

  assert.deepEqual(rows.map((row) => [row.id, row.depth, row.kind, row.label]), [
    ["workspace-folder-responsible-root", 0, "folder", "Mango RACI Responsible"],
    ["workspace-folder-custom-a", 1, "folder", "Custom Responsible A"],
    ["logic-gate-gate-a", 2, "logic_gate", "Gate A"],
    ["workspace-folder-custom-b", 1, "folder", "Custom Responsible B"],
    ["logic-gate-gate-b", 2, "logic_gate", "Gate B"],
  ]);
});

run("custom logic gate rows stay leaves when expanded", () => {
  const rows = buildCompanyExplorerTreeRows({
    expanded: new Set(["workspace-folder-custom", "logic-gate-gate-a"]),
    nodes: [{ company_id: "c", node_id: "node-a", name: "Nested node", logic_gate_ids: ["gate-a"], created_timestamp: "5" }],
    logicGates: [
      { company_id: "c", logic_gate_id: "gate-a", node_id: "gate-a", header: "Gate A", title: "Gate A", created_timestamp: "4" },
    ],
    projects: [],
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
  assert.equal(rows[logicGateIndex]?.hasChildren, false);
  assert.deepEqual(rows.slice(logicGateIndex, logicGateIndex + 1).map((row) => [row.id, row.depth, row.kind, row.parentLogicGateID ?? ""]), [
    ["logic-gate-gate-a", 1, "logic_gate", ""],
  ]);
});

run("context creation targets nested logic gate folders", () => {
  const targets = resolveExplorerCreationTargets({ kind: "folder", folderKind: "logic_gate", folderID: "logic-folder-1" });
  assert.deepEqual(targets, {
    preferredFolderKind: "logic_gate",
    preferredFolderParentID: "logic-folder-1",
    nodeFolderParentID: "",
    logicGateFolderParentID: "logic-folder-1",
    projectFolderParentID: "",
    nodeParentFolderID: "",
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

run("context creation ignores node row placement", () => {
  const targets = resolveExplorerCreationTargets({ kind: "node", folderKind: "node", folderID: "node-folder-1" });
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

run("rename targets only resolve for concrete folders and entities", () => {
  assert.equal(resolveExplorerRenameTarget({ kind: "folder", folderKind: "node", folderID: "folder-1" }), null);
  assert.equal(resolveExplorerRenameTarget({ kind: "node", nodeID: "node-1" }), null);
  assert.deepEqual(resolveExplorerRenameTarget({ kind: "logic_gate", logicGateID: "gate-1" }), { kind: "logic_gate", id: "gate-1" });
  assert.equal(resolveExplorerRenameTarget({ kind: "folder", folderKind: "node" }), null);
  assert.equal(resolveExplorerRenameTarget({ kind: "folder", folderKind: "node", folderID: "system", systemKey: "history" }), null);
});

run("delete targets only resolve for concrete folders and entities", () => {
  assert.equal(resolveExplorerDeleteTarget({ kind: "folder", folderKind: "node", folderID: "folder-1" }), null);
  assert.equal(resolveExplorerDeleteTarget({ kind: "node", nodeID: "node-1" }), null);
  assert.deepEqual(resolveExplorerDeleteTarget({ kind: "logic_gate", logicGateID: "gate-1" }), { kind: "logic_gate", id: "gate-1" });
  assert.equal(resolveExplorerDeleteTarget({ kind: "folder", folderKind: "node" }), null);
  assert.equal(resolveExplorerDeleteTarget({ kind: "folder", folderKind: "node", folderID: "system", systemKey: "active_nodes" }), null);
});

run("drop targets resolve item rows to their containing folder", () => {
  assert.equal(
    resolveExplorerDropTarget(
      { kind: "node", folderKind: "node", folderID: "test-folder", nodeID: "node-1" },
      { kind: "folder", folderKind: "node", folderID: "lotion-folder" },
    ),
    null,
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
    selectedFolderID: "",
    selectedFolderKind: "node",
  });

  assert.equal(selection.entityKind, "node");
  assert.equal(selection.entityID, "node-a");
  assert.equal(selection.selectedNodeID, "node-a");
  assert.equal(selection.selectedLogicGateID, "");
  assert.equal(selection.isLogicGateContext, false);
});

run("published folder selection keeps the matching entity domain", () => {
  const logicFolder = resolveExplorerPublishedSelection({
    selectedTreeID: "workspace-folder-logic",
    selectedNodeID: "",
    selectedLogicGateID: "",
    selectedFolderID: "logic",
    selectedFolderKind: "logic_gate",
  });
  assert.equal(logicFolder.entityKind, "folder");
  assert.equal(logicFolder.entityID, "logic");
  assert.equal(logicFolder.isLogicGateContext, true);
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
