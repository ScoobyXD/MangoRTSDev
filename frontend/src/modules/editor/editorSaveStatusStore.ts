import type { MangoTiptapSaveState } from "./tiptap/mangoTiptapSync.js";

const states = new Map<string, MangoTiptapSaveState>();
const listeners = new Map<string, Set<() => void>>();

function sameSaveState(left: MangoTiptapSaveState | undefined, right: MangoTiptapSaveState): boolean {
  return left?.status === right.status
    && left.updatedTimestamp === right.updatedTimestamp
    && left.revision === right.revision
    && left.message === right.message
    && left.unresolvedFailure === right.unresolvedFailure;
}

function needsFailureAttention(state: MangoTiptapSaveState | undefined): boolean {
  return state?.status === "failed" || Boolean(state?.unresolvedFailure);
}

function pageSessionSaveState(
  previous: MangoTiptapSaveState | undefined,
  incoming: MangoTiptapSaveState,
): MangoTiptapSaveState {
  if (needsFailureAttention(previous)) return previous!;
  if (!needsFailureAttention(incoming)) return incoming;
  return { ...incoming, status: "failed", unresolvedFailure: true };
}

export function publishEditorSaveState(storageKey: string, state: MangoTiptapSaveState): MangoTiptapSaveState {
  const previous = states.get(storageKey);
  const published = pageSessionSaveState(previous, state);
  if (sameSaveState(previous, published)) return published;
  states.set(storageKey, published);
  listeners.get(storageKey)?.forEach((listener) => listener());
  return published;
}

export function readEditorSaveState(storageKey: string): MangoTiptapSaveState | undefined {
  return states.get(storageKey);
}

export function subscribeEditorSaveState(storageKey: string, listener: () => void): () => void {
  const keyListeners = listeners.get(storageKey) ?? new Set<() => void>();
  keyListeners.add(listener);
  listeners.set(storageKey, keyListeners);
  return () => {
    keyListeners.delete(listener);
    if (keyListeners.size === 0) listeners.delete(storageKey);
  };
}
