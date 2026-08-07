import type { SidebarPinTree } from "./sidebarPins.js";
import {
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_REQUESTED_COLOR,
  KANBAN_LOGIC_GATE_REVIEW_COLOR,
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
  { key: "inProgress", label: "In Progress", color: KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR, gradient: "linear-gradient(135deg, #fff0d9 0%, #ffb45c 45%, #f08a24 100%)", borderColor: "#e97817", textColor: "#431407", glowColor: "rgba(240, 138, 36, 0.28)" },
  { key: "review", label: "Review", color: KANBAN_LOGIC_GATE_REVIEW_COLOR, gradient: "linear-gradient(135deg, #33ddd5 0%, #19a8ff 100%)", borderColor: "#19a8ff", textColor: "#062d4f", glowColor: "rgba(25, 168, 255, 0.28)" },
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

export function visibleSidebarLogicGateStatusCounts(
  counts: SidebarLogicGateStatusCounts | undefined,
): Array<SidebarLogicGateStatusCountDefinition & { count: number }> {
  if (!counts) return [];
  return SIDEBAR_LOGIC_GATE_STATUS_COUNT_DEFINITIONS.flatMap((definition) => {
    const count = normalizeCount(counts[definition.key]);
    return count > 0 ? [{ ...definition, count }] : [];
  });
}

export function aggregateSidebarPinFolderStatusCounts(
  tree: SidebarPinTree,
  countsByLogicGateID: Readonly<Record<string, SidebarLogicGateStatusCounts | undefined>>,
): Record<string, SidebarLogicGateStatusCounts> {
  const parentByFolderID = new Map(tree.folders.map((folder) => [folder.folderID, folder.parentFolderID]));
  const countsByFolderID: Record<string, SidebarLogicGateStatusCounts> = {};
  for (const folder of tree.folders) countsByFolderID[folder.folderID] = emptySidebarLogicGateStatusCounts();

  for (const pin of tree.pins) {
    if (pin.kind !== "logic_gate") continue;
    const counts = countsByLogicGateID[pin.id];
    if (!counts) continue;
    const visited = new Set<string>();
    for (let folderID = pin.parentFolderID; folderID && !visited.has(folderID); folderID = parentByFolderID.get(folderID) ?? "") {
      visited.add(folderID);
      const folderCounts = countsByFolderID[folderID];
      if (!folderCounts) break;
      addCounts(folderCounts, counts);
    }
  }
  return countsByFolderID;
}

export type SidebarLogicGateStatusCountSyncOptions = {
  logicGateIDs: string[];
  load: (logicGateID: string) => Promise<SidebarLogicGateStatusCounts>;
  subscribe: (onLogicGateChanged: (logicGateID: string) => void) => () => void;
  onChange: (countsByLogicGateID: Record<string, SidebarLogicGateStatusCounts>) => void;
};

export function startSidebarLogicGateStatusCountSync(options: SidebarLogicGateStatusCountSyncOptions): () => void {
  const logicGateIDs = Array.from(new Set(options.logicGateIDs.map((logicGateID) => logicGateID.trim()).filter(Boolean)));
  const tracked = new Set(logicGateIDs);
  const requestVersionByLogicGateID = new Map<string, number>();
  const countsByLogicGateID: Record<string, SidebarLogicGateStatusCounts> = {};
  let disposed = false;

  const refresh = (logicGateID: string) => {
    const cleanLogicGateID = logicGateID.trim();
    if (disposed || !tracked.has(cleanLogicGateID)) return;
    const version = (requestVersionByLogicGateID.get(cleanLogicGateID) ?? 0) + 1;
    requestVersionByLogicGateID.set(cleanLogicGateID, version);
    void options.load(cleanLogicGateID).then(
      (counts) => {
        if (disposed || requestVersionByLogicGateID.get(cleanLogicGateID) !== version) return;
        countsByLogicGateID[cleanLogicGateID] = normalizedCounts(counts);
        options.onChange(cloneCountsByLogicGateID(countsByLogicGateID));
      },
      () => {
        if (disposed || requestVersionByLogicGateID.get(cleanLogicGateID) !== version) return;
        countsByLogicGateID[cleanLogicGateID] = emptySidebarLogicGateStatusCounts();
        options.onChange(cloneCountsByLogicGateID(countsByLogicGateID));
      },
    );
  };

  const unsubscribe = options.subscribe(refresh);
  for (const logicGateID of logicGateIDs) refresh(logicGateID);

  return () => {
    disposed = true;
    unsubscribe();
  };
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

function normalizedCounts(counts: SidebarLogicGateStatusCounts): SidebarLogicGateStatusCounts {
  return {
    request: normalizeCount(counts.request),
    pending: normalizeCount(counts.pending),
    inProgress: normalizeCount(counts.inProgress),
    review: normalizeCount(counts.review),
  };
}

function normalizeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function cloneCountsByLogicGateID(
  countsByLogicGateID: Record<string, SidebarLogicGateStatusCounts>,
): Record<string, SidebarLogicGateStatusCounts> {
  return Object.fromEntries(Object.entries(countsByLogicGateID).map(([logicGateID, counts]) => [logicGateID, { ...counts }]));
}
