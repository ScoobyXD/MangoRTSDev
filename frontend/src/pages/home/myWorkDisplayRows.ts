import type { MyWorkResourceRow } from "./myWorkGrouping.js";

export type MyWorkDisplayHeaderOptions = {
  showProjectHeaders?: boolean;
  showLogicGateHeaders?: boolean;
  baseDepth?: number;
};

export type MyWorkProjectHeaderDisplayRow = {
  kind: "project_header";
  key: string;
  title: string;
  projectID: string;
  depth: number;
};

export type MyWorkLogicGateHeaderDisplayRow = {
  kind: "logic_gate_header";
  key: string;
  title: string;
  logicGateID: string;
  projectID?: string;
  depth: number;
};

export type MyWorkNodeDisplayRow = {
  kind: "node";
  key: string;
  row: MyWorkResourceRow;
  depth: number;
};

export type MyWorkDisplayRow =
  | MyWorkProjectHeaderDisplayRow
  | MyWorkLogicGateHeaderDisplayRow
  | MyWorkNodeDisplayRow;

export function buildMyWorkDisplayRows(
  rows: MyWorkResourceRow[],
  options: MyWorkDisplayHeaderOptions = {},
): MyWorkDisplayRow[] {
  const showProjectHeaders = options.showProjectHeaders ?? true;
  const showLogicGateHeaders = options.showLogicGateHeaders ?? true;
  const baseDepth = Number.isFinite(Number(options.baseDepth)) ? Number(options.baseDepth) : 0;
  const out: MyWorkDisplayRow[] = [];
  let lastProjectPathKey = "";
  let lastLogicGatePathKey = "";
  let headerSequence = 0;

  rows.forEach((row, rowIndex) => {
    if (row.kind !== "node") return;

    const project = myWorkRowProjectContext(row);
    const logicGate = myWorkRowLogicGateContext(row);
    const fullProjectPathKey = project.exists ? project.key : "project:none";
    const shouldShowProject = showProjectHeaders && project.exists;
    const shouldShowLogicGate = showLogicGateHeaders && logicGate.exists;

    if (shouldShowProject && project.key !== lastProjectPathKey) {
      out.push({
        kind: "project_header",
        key: myWorkDisplayHeaderKey("project", project.key, rowIndex, headerSequence++),
        title: project.title || "Project",
        projectID: project.id,
        depth: baseDepth,
      });
    }

    if (!shouldShowProject) {
      lastProjectPathKey = "";
    } else {
      lastProjectPathKey = project.key;
    }

    const logicGatePathKey = shouldShowLogicGate ? `${fullProjectPathKey}|${logicGate.key}` : "";
    if (shouldShowLogicGate && logicGatePathKey !== lastLogicGatePathKey) {
      out.push({
        kind: "logic_gate_header",
        key: myWorkDisplayHeaderKey("logic_gate", logicGatePathKey, rowIndex, headerSequence++),
        title: logicGate.title || "Logic Gate",
        logicGateID: logicGate.id,
        projectID: project.id || undefined,
        depth: baseDepth + (shouldShowProject ? 1 : 0),
      });
    }
    lastLogicGatePathKey = logicGatePathKey;

    out.push({
      kind: "node",
      key: row.rowKey ?? `${row.kind}:${row.id}:${rowIndex}`,
      row,
      depth: baseDepth + (shouldShowProject ? 1 : 0) + (shouldShowLogicGate ? 1 : 0),
    });
  });

  return out;
}

type MyWorkPathContext = {
  exists: boolean;
  key: string;
  id: string;
  title: string;
};

function myWorkRowProjectContext(row: MyWorkResourceRow): MyWorkPathContext {
  const id = row.projectID?.trim() ?? "";
  const title = row.projectName?.trim() || firstCleanValue(row.projectLabels) || id;
  const key = id ? `project:${id}` : title ? `project-name:${title.toLowerCase()}` : "";
  return { exists: Boolean(key), key, id, title };
}

function myWorkRowLogicGateContext(row: MyWorkResourceRow): MyWorkPathContext {
  const id = firstCleanValue(row.logicGateIDs);
  const title = firstCleanValue(row.logicGateLabels) || id;
  const key = id ? `logic_gate:${id}` : title ? `logic-gate-name:${title.toLowerCase()}` : "";
  return { exists: Boolean(key), key, id, title };
}

function firstCleanValue(values: string[] | undefined): string {
  return values?.find((value) => value.trim())?.trim() ?? "";
}

function myWorkDisplayHeaderKey(kind: "project" | "logic_gate", pathKey: string, rowIndex: number, sequence: number): string {
  return `my-work-display:${kind}:${pathKey}:at:${rowIndex}:header:${sequence}`;
}
