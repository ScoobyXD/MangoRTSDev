import React, { useMemo, useState } from "react";
import type { CompanyUser } from "../../modules/communications/communicationsApi";
import type { LogicGateRecord } from "../../modules/logic-gate-map/shared";
import type { NodeRecord } from "../../modules/node-map/shared";
import { logicGateTitle, nodeTitle } from "./homeUtils";

type CustomMatrixAxisField = "priority" | "logicGate" | "status" | "assignee" | "dueDate";

type AxisGroup = {
  key: string;
  label: string;
  sort: number;
  logicGateID?: string;
};

type MatrixCell = {
  key: string;
  nodes: NodeRecord[];
};

const CUSTOM_MATRIX_AXIS_OPTIONS: ReadonlyArray<{ value: CustomMatrixAxisField; label: string }> = [
  { value: "priority", label: "Priority" },
  { value: "logicGate", label: "Logic Gate" },
  { value: "status", label: "Status" },
  { value: "assignee", label: "Assignee" },
  { value: "dueDate", label: "Due Date" },
];

const PRIORITY_GROUPS: AxisGroup[] = [
  { key: "priority:1", label: "1 URGENT(<1hr)", sort: 1 },
  { key: "priority:2", label: "2 By end of day", sort: 2 },
  { key: "priority:3", label: "3 Tomorrow", sort: 3 },
  { key: "priority:4", label: "4 Sprint (1 week)", sort: 4 },
  { key: "priority:5", label: "5 Later (low priority)", sort: 5 },
  { key: "priority:none", label: "No priority", sort: 99 },
];

const STATUS_GROUPS: AxisGroup[] = [
  { key: "status:pending", label: "Pending", sort: 1 },
  { key: "status:in_progress", label: "In Progress", sort: 2 },
  { key: "status:verify", label: "Verify", sort: 3 },
  { key: "status:done", label: "Done", sort: 4 },
  { key: "status:none", label: "No status", sort: 99 },
];

const DUE_DATE_GROUPS: AxisGroup[] = [
  { key: "due:overdue", label: "Overdue", sort: 1 },
  { key: "due:today", label: "Today", sort: 2 },
  { key: "due:this_week", label: "This week", sort: 3 },
  { key: "due:later", label: "Later", sort: 4 },
  { key: "due:none", label: "No due date", sort: 99 },
];

const UNASSIGNED_LOGIC_GATE_GROUP: AxisGroup = {
  key: "logicGate:none",
  label: "Unassigned",
  sort: 999_999,
};

const UNASSIGNED_USER_GROUP: AxisGroup = {
  key: "assignee:none",
  label: "Unassigned",
  sort: 999_999,
};

function normalizeStatusKey(status: string | null | undefined): string {
  const clean = (status ?? "").trim().toLowerCase();
  if (!clean) return "none";
  if (clean === "in progress" || clean === "in_progress") return "in_progress";
  if (clean === "pending") return "pending";
  if (clean === "verify") return "verify";
  if (clean === "done") return "done";
  return clean.replace(/\s+/g, "_");
}

function statusLabel(status: string | null | undefined): string {
  const normalized = normalizeStatusKey(status);
  const known = STATUS_GROUPS.find((group) => group.key === `status:${normalized}`);
  if (known) return known.label;
  const clean = (status ?? "").trim();
  if (!clean) return "No status";
  return clean.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function dueDateGroup(dueDate: string | null | undefined): AxisGroup {
  const clean = (dueDate ?? "").trim();
  if (!clean) return DUE_DATE_GROUPS[DUE_DATE_GROUPS.length - 1];
  const date = new Date(`${clean.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return DUE_DATE_GROUPS[DUE_DATE_GROUPS.length - 1];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  const deltaDays = Math.round((date.getTime() - today.getTime()) / msPerDay);
  if (deltaDays < 0) return DUE_DATE_GROUPS[0];
  if (deltaDays === 0) return DUE_DATE_GROUPS[1];
  if (deltaDays <= 7) return DUE_DATE_GROUPS[2];
  return DUE_DATE_GROUPS[3];
}

function userLabel(user: Pick<CompanyUser, "display_name" | "email" | "user_id"> | undefined, fallbackID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackID.trim() || "Unassigned";
}

function nodeAxisGroups(
  node: NodeRecord,
  field: CustomMatrixAxisField,
  logicGateByID: Map<string, LogicGateRecord>,
  userByID: Map<string, CompanyUser>,
): AxisGroup[] {
  if (field === "priority") {
    const priority = Number(node.priority);
    return [PRIORITY_GROUPS.find((group) => group.key === `priority:${priority}`) ?? PRIORITY_GROUPS[PRIORITY_GROUPS.length - 1]];
  }

  if (field === "status") {
    const key = normalizeStatusKey(node.status);
    const known = STATUS_GROUPS.find((group) => group.key === `status:${key}`);
    return [known ?? { key: `status:${key}`, label: statusLabel(node.status), sort: 50 }];
  }

  if (field === "dueDate") return [dueDateGroup(node.due_date)];

  if (field === "assignee") {
    const assigneeID = node.assignee_user_id?.trim() ?? "";
    if (!assigneeID) return [UNASSIGNED_USER_GROUP];
    return [{
      key: `assignee:${assigneeID}`,
      label: userLabel(userByID.get(assigneeID), assigneeID),
      sort: 100,
    }];
  }

  const logicGateIDs = Array.from(new Set((node.logic_gate_ids ?? []).map((id) => id.trim()).filter(Boolean)));
  if (logicGateIDs.length === 0) return [UNASSIGNED_LOGIC_GATE_GROUP];
  return logicGateIDs.map((logicGateID) => ({
    key: `logicGate:${logicGateID}`,
    label: logicGateTitle(logicGateByID.get(logicGateID)),
    sort: 100,
    logicGateID,
  }));
}

function buildAxisGroups(
  field: CustomMatrixAxisField,
  nodes: NodeRecord[],
  logicGateByID: Map<string, LogicGateRecord>,
  userByID: Map<string, CompanyUser>,
): AxisGroup[] {
  if (field === "priority") return PRIORITY_GROUPS;
  if (field === "status") {
    const groups = new Map(STATUS_GROUPS.map((group) => [group.key, group]));
    for (const node of nodes) {
      for (const group of nodeAxisGroups(node, field, logicGateByID, userByID)) groups.set(group.key, group);
    }
    return Array.from(groups.values()).sort(sortAxisGroups);
  }
  if (field === "dueDate") return DUE_DATE_GROUPS;

  const groups = new Map<string, AxisGroup>();
  for (const node of nodes) {
    for (const group of nodeAxisGroups(node, field, logicGateByID, userByID)) groups.set(group.key, group);
  }
  if (groups.size === 0) groups.set(field === "logicGate" ? UNASSIGNED_LOGIC_GATE_GROUP.key : UNASSIGNED_USER_GROUP.key, field === "logicGate" ? UNASSIGNED_LOGIC_GATE_GROUP : UNASSIGNED_USER_GROUP);
  return Array.from(groups.values()).sort(sortAxisGroups);
}

function sortAxisGroups(left: AxisGroup, right: AxisGroup): number {
  return left.sort - right.sort || left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }) || left.key.localeCompare(right.key);
}

function sortNodes(left: NodeRecord, right: NodeRecord): number {
  const leftPriority = Number.isFinite(Number(left.priority)) ? Number(left.priority) : 999;
  const rightPriority = Number.isFinite(Number(right.priority)) ? Number(right.priority) : 999;
  return leftPriority - rightPriority
    || (left.due_date ?? "").localeCompare(right.due_date ?? "")
    || nodeTitle(left).localeCompare(nodeTitle(right), undefined, { numeric: true, sensitivity: "base" })
    || left.node_id.localeCompare(right.node_id);
}

function axisOptionLabel(value: CustomMatrixAxisField): string {
  return CUSTOM_MATRIX_AXIS_OPTIONS.find((option) => option.value === value)?.label ?? "Field";
}

export function CustomMatrixView({
  loading,
  nodes,
  logicGateByID,
  companyUsers,
  onOpenNode,
  onOpenLogicGate,
}: {
  loading: boolean;
  nodes: NodeRecord[];
  logicGateByID: Map<string, LogicGateRecord>;
  companyUsers: CompanyUser[];
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
}) {
  const [xAxis, setXAxis] = useState<CustomMatrixAxisField>("priority");
  const [yAxis, setYAxis] = useState<CustomMatrixAxisField>("logicGate");
  const userByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id.trim(), user])), [companyUsers]);
  const visibleNodes = useMemo(() => nodes.filter((node) => node.node_id.trim()), [nodes]);

  const matrix = useMemo(() => {
    const columns = buildAxisGroups(xAxis, visibleNodes, logicGateByID, userByID);
    const rows = buildAxisGroups(yAxis, visibleNodes, logicGateByID, userByID);
    const cells = new Map<string, MatrixCell>();
    for (const row of rows) {
      for (const column of columns) cells.set(`${row.key}\u0000${column.key}`, { key: `${row.key}\u0000${column.key}`, nodes: [] });
    }

    for (const node of visibleNodes) {
      const columnGroups = nodeAxisGroups(node, xAxis, logicGateByID, userByID);
      const rowGroups = nodeAxisGroups(node, yAxis, logicGateByID, userByID);
      for (const row of rowGroups) {
        for (const column of columnGroups) {
          const cell = cells.get(`${row.key}\u0000${column.key}`);
          if (cell && !cell.nodes.some((item) => item.node_id === node.node_id)) cell.nodes.push(node);
        }
      }
    }
    for (const cell of cells.values()) cell.nodes.sort(sortNodes);
    return { columns, rows, cells };
  }, [logicGateByID, visibleNodes, userByID, xAxis, yAxis]);

  const placedCount = visibleNodes.length;
  const columnCount = Math.max(1, matrix.columns.length);

  return (
    <section style={customMatrixPanelStyle}>
      <div style={customMatrixSurfaceStyle}>
        <div style={customMatrixHeaderStyle}>
          <div style={customMatrixHeaderTextStyle}>
            <h2 style={customMatrixTitleStyle}>Custom View</h2>
            <div style={customMatrixMetaStyle}>{placedCount} node{placedCount === 1 ? "" : "s"} across company data{loading ? " - Loading" : ""}</div>
          </div>
          <div style={customMatrixControlsStyle}>
            <AxisSelect label="Y-axis" value={yAxis} onChange={setYAxis} />
            <AxisSelect label="X-axis" value={xAxis} onChange={setXAxis} />
          </div>
        </div>
        <div className="kanban-board-scroll" style={customMatrixScrollStyle}>
          <div style={customMatrixGridStyle(columnCount)}>
            <div style={customMatrixCornerStyle}>
              <span style={customMatrixAxisBadgeStyle}>{axisOptionLabel(yAxis)}</span>
              <span style={customMatrixAxisBadgeStyle}>{axisOptionLabel(xAxis)}</span>
            </div>
            {matrix.columns.map((column) => (
              <LogicGateAwareHeader key={column.key} group={column} onOpenLogicGate={onOpenLogicGate} />
            ))}
            {matrix.rows.flatMap((row) => [
              <LogicGateAwareHeader key={`row:${row.key}`} group={row} row onOpenLogicGate={onOpenLogicGate} />,
              ...matrix.columns.map((column) => {
                const cell = matrix.cells.get(`${row.key}\u0000${column.key}`);
                return (
                  <div key={`${row.key}:${column.key}`} style={customMatrixCellStyle}>
                    {cell && cell.nodes.length > 0 ? (
                      cell.nodes.map((node) => (
                        <button
                          key={node.node_id}
                          type="button"
                          title={`Open ${nodeTitle(node)}`}
                          style={customMatrixNodeCardStyle}
                          onClick={() => onOpenNode(node)}
                        >
                          <span style={customMatrixNodeTitleStyle}>{nodeTitle(node)}</span>
                          <span style={customMatrixNodeMetaStyle}>
                            {node.status?.trim() || "No status"}
                            {Number.isFinite(Number(node.priority)) ? ` - P${node.priority}` : ""}
                          </span>
                        </button>
                      ))
                    ) : (
                      <span style={customMatrixEmptyCellStyle}>Empty</span>
                    )}
                  </div>
                );
              }),
            ])}
          </div>
        </div>
      </div>
    </section>
  );
}

function AxisSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CustomMatrixAxisField;
  onChange: (value: CustomMatrixAxisField) => void;
}) {
  return (
    <label style={axisSelectLabelStyle}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as CustomMatrixAxisField)} style={axisSelectStyle}>
        {CUSTOM_MATRIX_AXIS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function LogicGateAwareHeader({
  group,
  row = false,
  onOpenLogicGate,
}: {
  group: AxisGroup;
  row?: boolean;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
}) {
  const content = (
    <>
      <span style={customMatrixHeaderLabelStyle}>{group.label}</span>
      {group.logicGateID && <span style={customMatrixHeaderActionStyle}>Open</span>}
    </>
  );
  if (!group.logicGateID) {
    return <div style={customMatrixAxisHeaderStyle(row)}>{content}</div>;
  }
  return (
    <button
      type="button"
      title={`Open ${group.label} in Logic Gate Arena`}
      style={customMatrixAxisHeaderButtonStyle(row)}
      onClick={() => onOpenLogicGate(group.logicGateID ?? "", group.label)}
    >
      {content}
    </button>
  );
}

const customMatrixPanelStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  padding: 0,
};

const customMatrixSurfaceStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 10,
  padding: "14px 14px 16px",
  borderRadius: 0,
  border: "none",
  background: "linear-gradient(180deg, #fbfbfd 0%, #f5f8fb 100%)",
  color: "#111827",
  overflow: "hidden",
};

const customMatrixHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(180px, 1fr) minmax(320px, auto)",
  alignItems: "start",
  gap: 12,
};

const customMatrixHeaderTextStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 4,
};

const customMatrixTitleStyle: React.CSSProperties = {
  margin: 0,
  minWidth: 0,
  color: "#111827",
  fontSize: 15,
  lineHeight: 1.2,
  fontWeight: 800,
  letterSpacing: 0,
};

const customMatrixMetaStyle: React.CSSProperties = {
  minWidth: 0,
  color: "#64748b",
  fontSize: 11,
  fontWeight: 700,
};

const customMatrixControlsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 8,
};

const axisSelectLabelStyle: React.CSSProperties = {
  minWidth: 150,
  display: "grid",
  gridTemplateColumns: "48px minmax(0, 1fr)",
  alignItems: "center",
  gap: 7,
  color: "#475569",
  fontSize: 10.5,
  fontWeight: 800,
};

const axisSelectStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 30,
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#111827",
  font: "inherit",
  fontSize: 11,
  fontWeight: 700,
  padding: "0 8px",
};

const customMatrixScrollStyle: React.CSSProperties = {
  minHeight: 0,
  height: "100%",
  overflow: "auto",
  padding: "2px 4px 8px 0",
  ["--kanban-board-scroll-accent" as string]: "rgba(20, 184, 166, 0.72)",
  ["--kanban-board-scroll-track" as string]: "rgba(148, 163, 184, 0.16)",
};

function customMatrixGridStyle(columnCount: number): React.CSSProperties {
  return {
    minWidth: Math.max(760, 140 + columnCount * 220),
    display: "grid",
    gridTemplateColumns: `140px repeat(${columnCount}, minmax(220px, 1fr))`,
    gridAutoRows: "minmax(122px, auto)",
    alignItems: "stretch",
    background: "rgba(255, 255, 255, 0.7)",
    border: "1px solid rgba(148, 163, 184, 0.24)",
    borderRadius: 8,
    overflow: "hidden",
  };
}

const customMatrixCornerStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  top: 0,
  zIndex: 8,
  minHeight: 58,
  display: "grid",
  gap: 5,
  alignContent: "center",
  padding: 10,
  borderRight: "1px solid rgba(148, 163, 184, 0.26)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.26)",
  background: "#f8fafc",
};

const customMatrixAxisBadgeStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#475569",
  fontSize: 10,
  fontWeight: 800,
};

function customMatrixAxisHeaderStyle(row: boolean): React.CSSProperties {
  return {
    position: "sticky",
    left: row ? 0 : undefined,
    top: row ? undefined : 0,
    zIndex: row ? 6 : 7,
    minHeight: row ? 122 : 58,
    display: "grid",
    alignContent: "center",
    gap: 4,
    padding: 10,
    borderRight: row ? "1px solid rgba(148, 163, 184, 0.26)" : undefined,
    borderBottom: "1px solid rgba(148, 163, 184, 0.26)",
    background: row ? "#f8fafc" : "#eef6f5",
    color: "#111827",
  };
}

function customMatrixAxisHeaderButtonStyle(row: boolean): React.CSSProperties {
  return {
    ...customMatrixAxisHeaderStyle(row),
    width: "100%",
    border: "none",
    borderRight: row ? "1px solid rgba(148, 163, 184, 0.26)" : undefined,
    borderBottom: "1px solid rgba(148, 163, 184, 0.26)",
    borderRadius: 0,
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
  };
}

const customMatrixHeaderLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  color: "#111827",
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1.25,
};

const customMatrixHeaderActionStyle: React.CSSProperties = {
  width: "max-content",
  borderRadius: 999,
  background: "rgba(20, 184, 166, 0.14)",
  color: "#0f766e",
  fontSize: 9.5,
  fontWeight: 900,
  padding: "2px 6px",
};

const customMatrixCellStyle: React.CSSProperties = {
  minHeight: 122,
  display: "grid",
  alignContent: "start",
  gap: 7,
  padding: 8,
  borderRight: "1px solid rgba(148, 163, 184, 0.18)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  background: "#ffffff",
};

const customMatrixNodeCardStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 48,
  display: "grid",
  gap: 4,
  alignContent: "center",
  border: "1px solid rgba(100, 116, 139, 0.24)",
  borderRadius: 7,
  background: "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(240,249,255,0.78))",
  boxShadow: "0 8px 18px rgba(15, 23, 42, 0.07)",
  color: "#111827",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  padding: "7px 8px",
};

const customMatrixNodeTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11.5,
  fontWeight: 800,
};

const customMatrixNodeMetaStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 700,
};

const customMatrixEmptyCellStyle: React.CSSProperties = {
  alignSelf: "start",
  width: "max-content",
  maxWidth: "100%",
  borderRadius: 999,
  background: "rgba(148, 163, 184, 0.12)",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 800,
  padding: "3px 7px",
};
