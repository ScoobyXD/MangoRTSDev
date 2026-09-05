export const PROCESS_NODE_DRAG = "application/x-mango-process-work-nodes";

import type { Account } from "../accounts/accountsApi.js";
import type { MangoTiptapDocument } from "../editor/tiptap/mangoTiptapDocument.js";

export type ProcessStep = {
  process_step_id: string;
  logic_gate_id: string;
  name: string;
  position: number;
  body_json?: MangoTiptapDocument;
};

export type ProcessStepRelationship = {
  resource_operational_relationship_id: string;
  source: { resource_type: "process_step"; resource_id: string };
  target: { resource_type: "process_step"; resource_id: string };
};

export type ProcessWorkNode = {
  node_id: string;
  node_title: string;
  status: string;
  process_step_id: string | null;
  is_issue: boolean;
  position: number;
  requested_by_user_id?: string;
  placed_by_user_id?: string;
  due_date?: string | null;
  priority?: number | null;
  created_timestamp: string;
  accounts?: Account[];
  created_from_email?: boolean;
  has_project?: boolean;
};

export type ProcessNodeAssignment = {
  assignment_id: string;
  company_id: string;
  node_id: string;
  logic_gate_id: string;
  process_step_id: string | null;
  is_issue: boolean;
  position: number;
  requested_by_user_id?: string;
  placed_by_user_id?: string;
  version: number;
  created_timestamp: string;
  updated_timestamp: string;
};

export type ProcessWorkSnapshot = {
  logic_gate: { logic_gate_id: string; header: string };
  permissions: { can_edit: boolean; can_resolve_requests: boolean };
  steps: ProcessStep[];
  relationships: ProcessStepRelationship[];
  nodes: ProcessWorkNode[];
};

export const PROCESS_WORK_VIEWS = ["Steps", "Requested", "Pending", "Backlog", "Done"] as const;
export type ProcessWorkView = typeof PROCESS_WORK_VIEWS[number];
export type ProcessStatus = "Requested" | "Pending" | "Backlogs" | "In Progress" | "Review" | "Done";
export const PROCESS_STATUSES: ProcessStatus[] = ["Requested", "Pending", "Backlogs", "In Progress", "Review", "Done"];

export function processWorkView(node: Pick<ProcessWorkNode, "status">): ProcessWorkView | null {
  switch (node.status) {
    case "Requested": return "Requested";
    case "Pending": return "Pending";
    case "Backlogs": return "Backlog";
    case "Done": return "Done";
    case "In Progress":
    case "Review": return "Steps";
    default: return null;
  }
}

export function processWorkCounts(nodes: readonly ProcessWorkNode[]): Record<ProcessWorkView, number> {
  const counts = { Steps: 0, Requested: 0, Pending: 0, Backlog: 0, Done: 0 };
  for (const node of nodes) { const view = processWorkView(node); if (view) counts[view] += 1; }
  return counts;
}

export function processStatusColor(status: string): string {
  switch (status) {
    case "Requested": return "#facc15";
    case "Pending": return "#6f7b8a";
    case "Backlogs": return "#8b5cf6";
    case "In Progress": return "#f08a24";
    case "Review": return "#19a8ff";
    case "Done": return "#19c879";
    default: return "#64748b";
  }
}

export function orderedProcessSteps(steps: readonly ProcessStep[]): ProcessStep[] {
  return [...steps].sort((a, b) => a.position - b.position || a.process_step_id.localeCompare(b.process_step_id));
}

export function mergeCreatedProcessStep(steps: readonly ProcessStep[], step: ProcessStep, positionUpdates: Readonly<Record<string, number>> = {}): ProcessStep[] {
  const existing = steps
    .filter((item) => item.process_step_id !== step.process_step_id)
    .map((item) => positionUpdates[item.process_step_id] === undefined ? item : { ...item, position: positionUpdates[item.process_step_id] });
  return orderedProcessSteps([...existing, step]);
}

/** Reordering changes only the selected nodes' location/order, never their status. */
export function processNodeMovePlan(nodes: readonly ProcessWorkNode[], nodeIDs: readonly string[], stepID: string | null, beforeNodeID?: string, options: { dateAddedSort?: boolean; priority?: number } = {}): Array<{ node_id: string; process_step_id: string | null; position?: number; priority?: number }> {
  const ids = new Set(nodeIDs);
  const moved = nodes.filter((node) => ids.has(node.node_id)).sort((a, b) => a.position - b.position);
  const priority = Number.isInteger(options.priority) && options.priority! >= 1 && options.priority! <= 5 ? options.priority : undefined;
  const priorityPatch = (id: string) => priority !== undefined && ids.has(id) ? { priority } : {};
  if (options.dateAddedSort) return moved
    .filter((node) => node.process_step_id !== stepID || (priority !== undefined && node.priority !== priority))
    .map((node) => ({ node_id: node.node_id, process_step_id: stepID, ...priorityPatch(node.node_id) }));
  const siblings = nodes.filter((node) => !ids.has(node.node_id) && node.process_step_id === stepID && processWorkView(node) === "Steps").sort((a, b) => a.position - b.position);
  const beforeIndex = beforeNodeID ? siblings.findIndex((node) => node.node_id === beforeNodeID) : -1;
  const index = beforeIndex >= 0 ? beforeIndex : siblings.length;
  const previous = siblings[index - 1]?.position ?? 0;
  const next = siblings[index]?.position;
  if (next === undefined || next - previous > moved.length) {
    const gap = next === undefined ? 1000 : Math.floor((next - previous) / (moved.length + 1));
    return moved.map((node, i) => ({ node_id: node.node_id, process_step_id: stepID, position: previous + gap * (i + 1), ...priorityPatch(node.node_id) }));
  }
  const result = [...siblings.slice(0, index), ...moved, ...siblings.slice(index)];
  return result.flatMap((node, i) => {
    const position = (i + 1) * 1000;
    return node.position !== position || node.process_step_id !== stepID || (priority !== undefined && ids.has(node.node_id) && node.priority !== priority)
      ? [{ node_id: node.node_id, process_step_id: stepID, position, ...priorityPatch(node.node_id) }]
      : [];
  });
}
