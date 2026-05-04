export const EVENT_SELECTION_COORDINATOR_UPDATED = "mangoos:selection-coordinator-updated";

export type SelectionEntityKind = "node" | "logic_gate" | "folder";

export type SelectionSourceModule =
  | "company-explorer"
  | "node-map"
  | "logic-gate-map"
  | "kanban"
  | "editor";

export type SelectionIntent = "activate" | "navigate";

export type LiveSelectionChange = {
  companyID: string;
  entityKind: SelectionEntityKind;
  entityID: string;
  label: string;
  sourceFrameID: string;
  sourceModule: SelectionSourceModule;
  targetFrameIDs: string[];
  sequence: number;
  changedAt: number;
  selectedTreeID?: string;
  folderKind?: "node" | "logic_gate";
  folderID?: string;
  folderLabel?: string;
  // "activate" lets linked editors focus their typing surface. "navigate"
  // updates context without stealing focus from keyboard-driven tree movement.
  selectionIntent: SelectionIntent;
};

export type PublishLiveSelectionInput = {
  companyID: string;
  entityKind: SelectionEntityKind;
  entityID?: string;
  label?: string;
  sourceFrameID: string;
  sourceModule: SelectionSourceModule;
  targetFrameIDs: string[];
  selectedTreeID?: string;
  folderKind?: "node" | "logic_gate";
  folderID?: string;
  folderLabel?: string;
  changedAt?: number;
  sequence?: number;
  selectionIntent?: SelectionIntent;
};

const liveSelectionsByTarget = new Map<string, LiveSelectionChange>();
const liveSequencesBySource = new Map<string, number>();

function targetKey(companyID: string, frameID: string): string {
  return `${companyID}:${frameID}`;
}

function uniqueNonBlank(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function nextLiveSelectionSequence(companyID: string, sourceFrameID: string, now = Date.now()): number {
  const key = `${companyID}:${sourceFrameID}`;
  const previous = liveSequencesBySource.get(key) ?? 0;
  const next = Math.max(previous + 1, now);
  liveSequencesBySource.set(key, next);
  return next;
}

export function isSelectionTargetForFrame(selection: LiveSelectionChange, frameID: string): boolean {
  return selection.targetFrameIDs.includes(frameID);
}

export function shouldAcceptLiveSelection(current: LiveSelectionChange | null | undefined, incoming: LiveSelectionChange): boolean {
  if (!current) return true;
  if (current.sourceFrameID === incoming.sourceFrameID) return incoming.sequence > current.sequence;
  if (incoming.changedAt < current.changedAt) return false;
  if (incoming.changedAt > current.changedAt) return true;
  return incoming.sequence > current.sequence;
}

export function readLiveSelectionForFrame(companyID: string, frameID: string): LiveSelectionChange | null {
  return liveSelectionsByTarget.get(targetKey(companyID, frameID)) ?? null;
}

export function publishLiveSelection(input: PublishLiveSelectionInput): LiveSelectionChange {
  const sourceFrameID = input.sourceFrameID.trim();
  const targetFrameIDs = uniqueNonBlank(input.targetFrameIDs).filter((targetID) => targetID !== sourceFrameID);
  const sequence = input.sequence ?? nextLiveSelectionSequence(input.companyID, sourceFrameID);
  const selection: LiveSelectionChange = {
    companyID: input.companyID,
    entityKind: input.entityKind,
    entityID: input.entityID ?? "",
    label: input.label ?? "",
    sourceFrameID,
    sourceModule: input.sourceModule,
    targetFrameIDs,
    sequence,
    changedAt: input.changedAt ?? Date.now(),
    selectedTreeID: input.selectedTreeID,
    folderKind: input.folderKind,
    folderID: input.folderID,
    folderLabel: input.folderLabel,
    selectionIntent: input.selectionIntent ?? "activate",
  };

  const acceptedTargetFrameIDs: string[] = [];
  for (const targetFrameID of targetFrameIDs) {
    const key = targetKey(input.companyID, targetFrameID);
    if (!shouldAcceptLiveSelection(liveSelectionsByTarget.get(key), selection)) continue;
    acceptedTargetFrameIDs.push(targetFrameID);
  }

  const acceptedSelection = { ...selection, targetFrameIDs: acceptedTargetFrameIDs };
  for (const targetFrameID of acceptedTargetFrameIDs) {
    liveSelectionsByTarget.set(targetKey(input.companyID, targetFrameID), acceptedSelection);
  }

  // Junior engineer note:
  // This is the live in-tab selection handoff. It intentionally never writes to
  // the backend and never asks consumers to read localStorage to discover the
  // selected entity. Durable changes still go through explicit REST APIs.
  if (acceptedTargetFrameIDs.length > 0 && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<LiveSelectionChange>(EVENT_SELECTION_COORDINATOR_UPDATED, { detail: acceptedSelection }));
  }

  return acceptedSelection;
}

export function subscribeLiveSelection(
  frameID: string,
  handler: (selection: LiveSelectionChange) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const onSelection = (event: Event) => {
    const selection = (event as CustomEvent<LiveSelectionChange>).detail;
    if (!selection || !isSelectionTargetForFrame(selection, frameID)) return;
    handler(selection);
  };
  window.addEventListener(EVENT_SELECTION_COORDINATOR_UPDATED, onSelection);
  return () => window.removeEventListener(EVENT_SELECTION_COORDINATOR_UPDATED, onSelection);
}
