import { entityMatchesAccountFilter } from "../accounts/accountsApi.js";
import type { ProcessNodeStatePatch } from "./kanbanApi.js";
import type { ProcessStatus, ProcessWorkNode } from "./processWork.js";
import {
  KANBAN_LOGIC_GATE_BACKLOG_COLOR,
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_REQUESTED_COLOR,
  KANBAN_LOGIC_GATE_REVIEW_COLOR,
} from "./shared.js";

export const STATUS_KANBAN_COLUMNS = [
  { status: "Requested", title: "Requested", color: KANBAN_LOGIC_GATE_REQUESTED_COLOR, width: 260, height: 280, lane: "bottom" },
  { status: "Backlogs", title: "Backlogs", color: KANBAN_LOGIC_GATE_BACKLOG_COLOR, width: 260, height: 280, lane: "bottom" },
  { status: "Pending", title: "Pending", color: KANBAN_LOGIC_GATE_PENDING_COLOR, width: 260, height: 720, lane: "main" },
  { status: "In Progress", title: "In Progress", color: KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR, width: 260, height: 720, lane: "main" },
  { status: "Review", title: "Review", color: KANBAN_LOGIC_GATE_REVIEW_COLOR, width: 260, height: 720, lane: "main" },
  { status: "Done", title: "Done", color: KANBAN_LOGIC_GATE_DONE_COLOR, width: 260, height: 720, lane: "main" },
] as const satisfies ReadonlyArray<{ status: ProcessStatus; title: string; color: string; width: number; height: number; lane: "main" | "bottom" }>;

type StatusKanbanSortOptions = { dateAddedSort?: boolean; dateAddedDirection?: "asc" | "desc" };
export type StatusKanbanNodeMove = { node_id: string } & Pick<ProcessNodeStatePatch, "status" | "position" | "priority">;

export function compareStatusKanbanNodes(a: ProcessWorkNode, b: ProcessWorkNode, options: StatusKanbanSortOptions = {}): number {
  const dateDifference = (Date.parse(a.created_timestamp) || 0) - (Date.parse(b.created_timestamp) || 0);
  return (options.dateAddedSort ? dateDifference * (options.dateAddedDirection === "asc" ? 1 : -1) : 0)
    || a.position - b.position
    || dateDifference
    || (a.node_id < b.node_id ? -1 : a.node_id > b.node_id ? 1 : 0);
}

/** Status moves retain each Node's step and Issue flag. Input IDs keep selection order. */
export function statusKanbanNodeMovePlan(
  nodes: readonly ProcessWorkNode[],
  nodeIDs: readonly string[],
  status: ProcessStatus,
  beforeNodeID?: string,
  options: { dateAddedSort?: boolean; priority?: number } = {},
): StatusKanbanNodeMove[] {
  const byID = new Map(nodes.map((node) => [node.node_id, node]));
  const ids = new Set(nodeIDs);
  const moved = [...ids].flatMap((id) => { const node = byID.get(id); return node ? [node] : []; });
  if (!moved.length) return [];
  const priority = Number.isInteger(options.priority) && options.priority! >= 1 && options.priority! <= 5 ? options.priority : undefined;
  const patchForNode = (node: ProcessWorkNode, position?: number): StatusKanbanNodeMove[] => {
    const patch: StatusKanbanNodeMove = { node_id: node.node_id };
    if (ids.has(node.node_id)) {
      if (node.status !== status) patch.status = status;
      if (priority !== undefined && node.priority !== priority) patch.priority = priority;
    }
    if (position !== undefined && node.position !== position) patch.position = position;
    return patch.status !== undefined || patch.priority !== undefined || patch.position !== undefined ? [patch] : [];
  };
  if (options.dateAddedSort) return moved.flatMap((node) => patchForNode(node));
  if (beforeNodeID && ids.has(beforeNodeID)) return [];
  const target = [...byID.values()].filter((node) => node.status === status).sort(compareStatusKanbanNodes);
  const siblings = target.filter((node) => !ids.has(node.node_id));
  const index = beforeNodeID ? siblings.findIndex((node) => node.node_id === beforeNodeID) : siblings.length;
  if (index < 0) return [];
  const ordered = [...siblings.slice(0, index), ...moved, ...siblings.slice(index)];
  if (ordered.length === target.length && ordered.every((node, i) => node.node_id === target[i].node_id)) {
    return moved.flatMap((node) => patchForNode(node));
  }
  const previous = siblings[index - 1]?.position ?? 0;
  const next = siblings[index]?.position;
  if (next === undefined ? previous + moved.length * 1000 <= 2147483647 : next - previous > moved.length) {
    const gap = next === undefined ? 1000 : Math.floor((next - previous) / (moved.length + 1));
    return moved.flatMap((node, i) => patchForNode(node, previous + gap * (i + 1)));
  }
  return ordered.flatMap((node, i) => patchForNode(node, (i + 1) * 1000));
}

export function statusKanbanNodeMatchesFilter(node: ProcessWorkNode, query: string, accountIDs: readonly string[] = []): boolean {
  if (!entityMatchesAccountFilter(node, accountIDs)) return false;
  const search = query.trim().toLowerCase();
  if (!search) return true;
  return [
    node.node_title,
    node.node_id,
    node.status,
    node.status.toLowerCase().replace(/ /g, "_"),
    node.status === "Backlogs" ? "backlog" : "",
    node.is_issue ? "issue" : "",
    node.due_date ?? "",
    node.priority == null ? "" : String(node.priority),
    ...(node.accounts ?? []).flatMap((account) => [account.name, account.account_id]),
  ].some((field) => field.toLowerCase().includes(search));
}
