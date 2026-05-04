import type { SelectionIntent } from "../selectionCoordinator";

export type LinkedEntityKind = "node" | "logic_gate";

export type DocumentSaveTarget = {
  entityKind: LinkedEntityKind;
  entityID: string;
  informationID: string;
};

export type DocumentSaveRequest = {
  target: DocumentSaveTarget;
  text: string;
};

export type LinkedSelection = {
  id: string;
  label: string;
  selectionIntent?: SelectionIntent;
};

export const EDITOR_AUTOSAVE_DELAY_MS = 550;

export function documentTargetKey(target: DocumentSaveTarget): string {
  return `${target.entityKind}:${target.entityID}:${target.informationID}`;
}

export function sameSaveRequest(a: DocumentSaveRequest | null, b: DocumentSaveRequest | null): boolean {
  if (!a || !b) return false;
  return documentTargetKey(a.target) === documentTargetKey(b.target) && a.text === b.text;
}

export function generateStableInformationID(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `00000000-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0").slice(0, 12)}`;
}

export function shouldReadStoredSelectionForEvent(hasGap: boolean, hasEventSelection: boolean): boolean {
  return hasGap && !hasEventSelection;
}
