import type { SidebarPinTree } from "./sidebarPins.js";
import {
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_REQUESTED_COLOR,
  type KanbanCard,
  type KanbanColumn,
} from "../modules/kanban/shared.js";

export type SidebarLogicGateStatusKey = "request" | "pending" | "inProgress" | "review";

export type SidebarLogicGateStatusCounts = Record<SidebarLogicGateStatusKey, number>;

export type SidebarLogicGateStatusCountDefinition = {
  key: SidebarLogicGateStatusKey;
  label: string;
  color: string;
  gradient: string;
  borderColor: string;
  textColor: string;
  glowColor: string;
};

export const SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS: readonly SidebarLogicGateStatusCountDefinition[] = [
  { key: "request", label: "Request", color: KANBAN_LOGIC_GATE_REQUESTED_COLOR, gradient: "linear-gradient(135deg, #fffbd1 0%, #fff24d 42%, #facc15 100%)", borderColor: "#f5c400", textColor: "#422006", glowColor: "rgba(250, 204, 21, 0.28)" },
  { key: "pending", label: "Pending", color: KANBAN_LOGIC_GATE_PENDING_COLOR, gradient: "linear-gradient(135deg, #ffffff 0%, #f1f5f9 48%, #d9e0e8 100%)", borderColor: "#cbd5e1", textColor: "#334155", glowColor: "rgba(148, 163, 184, 0.20)" },
  { key: "inProgress", label: "In Progress", color: "rgb(254, 155, 70)", gradient: "none", borderColor: "#f58b32", textColor: "#5f2409", glowColor: "rgba(254, 155, 70, 0.24)" },
  { key: "review", label: "Review", color: "#19a8ff", gradient: "linear-gradient(180deg, #33ddd5 0%, #19a8ff 100%)", borderColor: "#19a8ff", textColor: "#062d4f", glowColor: "rgba(25, 168, 255, 0.28)" },
];

export function emptySidebarLogicGateStatusCounts(): SidebarLogicGateStatusCounts {
  return { request: 0, pending: 0, inProgress: 0, review: 0 };
}

export function countSidebarLogicGateStatuses(
  contents: { columns: Array<Pick<KanbanColumn, "column_id" | "title">>; cards: Array<Pick<KanbanCard, "column_id">> },
): SidebarLogicGateStatusCounts {
  const statusByColumnID = new Map<string, SidebarLogicGateStatusKey>();
  for (const column of contents.columns) {
    const status = sidebarLogicGateStatusKey(column.column_id) ?? sidebarLogicGateStatusKey(column.title);
    if (status) statusByColumnID.set(column.column_id, status);
  }

  const counts = emptySidebarLogicGateStatusCounts();
  for (const card of contents.cards) {
    const status = statusByColumnID.get(card.column_id) ?? sidebarLogicGateStatusKey(card.column_id);
    if (status) counts[status] += 1;
  }
  return counts;
}

export function aggregateSidebarPinFolderStatusCounts(
  tree: SidebarPinTree,
  countsByLogicGateID: Readonly<Record<string, SidebarLogicGateStatusCounts | undefined>>,
): Record<string, SidebarLogicGateStatusCounts> {
  const parentByFolderID = new Map(tree.folders.map((folder) => [folder.folderID, folder.parentFolderID]));
  const countsByFolderID: Record<string, SidebarLogicGateStatusCounts> = {};

  for (const pin of tree.pins) {
    if (pin.kind !== "logic_gate") continue;
    const counts = countsByLogicGateID[pin.id];
    if (!counts) continue;
    const visited = new Set<string>();
    for (let folderID = pin.parentFolderID; folderID && !visited.has(folderID); folderID = parentByFolderID.get(folderID) ?? "") {
      if (!parentByFolderID.has(folderID)) break;
      visited.add(folderID);
      const folderCounts = countsByFolderID[folderID] ?? (countsByFolderID[folderID] = emptySidebarLogicGateStatusCounts());
      addCounts(folderCounts, counts);
    }
  }
  return countsByFolderID;
}

function sidebarLogicGateStatusKey(value: string): SidebarLogicGateStatusKey | null {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (normalized === "request" || normalized === "requested" || normalized === "requests") return "request";
  if (normalized === "pending") return "pending";
  if (normalized === "in progress" || normalized === "inprogress") return "inProgress";
  if (normalized === "review") return "review";
  return null;
}

function addCounts(target: SidebarLogicGateStatusCounts, source: SidebarLogicGateStatusCounts): void {
  for (const definition of SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS) {
    target[definition.key] += normalizeCount(source[definition.key]);
  }
}

function normalizeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
