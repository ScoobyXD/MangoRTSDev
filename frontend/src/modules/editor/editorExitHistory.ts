export type EditorHistoryResourceRef = {
  companyID: string;
  resourceType: "node" | "logic_gate" | "project";
  resourceID: string;
};

type HistorySaver = () => Promise<unknown>;

type HistoryEntry = {
  ref: EditorHistoryResourceRef;
  changeVersion: number;
  savedVersion: number;
  savingVersion: number;
  savePromise: Promise<unknown> | null;
  exitSavers: Set<HistorySaver>;
};

const historyEntries = new Map<string, HistoryEntry>();

function historyKey(ref: EditorHistoryResourceRef): string {
  return [ref.companyID.trim(), ref.resourceType, ref.resourceID.trim()].map(encodeURIComponent).join(":");
}

function historyEntry(ref: EditorHistoryResourceRef): HistoryEntry {
  const key = historyKey(ref);
  const existing = historyEntries.get(key);
  if (existing) return existing;
  const created: HistoryEntry = {
    ref: { ...ref, companyID: ref.companyID.trim(), resourceID: ref.resourceID.trim() },
    changeVersion: 0,
    savedVersion: 0,
    savingVersion: 0,
    savePromise: null,
    exitSavers: new Set(),
  };
  historyEntries.set(key, created);
  return created;
}

export function markEditorHistoryChanged(ref: EditorHistoryResourceRef): void {
  if (!ref.companyID.trim() || !ref.resourceID.trim()) return;
  historyEntry(ref).changeVersion += 1;
}

export async function saveEditorHistory<T>(
  ref: EditorHistoryResourceRef,
  save: () => Promise<T>,
  onlyIfChanged = false,
): Promise<T | undefined> {
  if (!ref.companyID.trim() || !ref.resourceID.trim()) return undefined;
  const entry = historyEntry(ref);
  const targetVersion = entry.changeVersion;
  if (onlyIfChanged && targetVersion <= entry.savedVersion) return undefined;
  if (entry.savePromise && entry.savingVersion >= targetVersion) {
    return entry.savePromise as Promise<T>;
  }

  const previousSave = entry.savePromise;
  entry.savingVersion = targetVersion;
  const savePromise = (previousSave ? previousSave.catch(() => undefined) : Promise.resolve())
    .then(save)
    .then((result) => {
      entry.savedVersion = Math.max(entry.savedVersion, targetVersion);
      return result;
    })
    .finally(() => {
      if (entry.savePromise !== savePromise) return;
      entry.savePromise = null;
      entry.savingVersion = 0;
      if (entry.exitSavers.size === 0 && entry.savedVersion >= entry.changeVersion) {
        historyEntries.delete(historyKey(entry.ref));
      }
    });
  entry.savePromise = savePromise;
  return savePromise;
}

export function saveEditorHistoryOnExit(ref: EditorHistoryResourceRef): Promise<unknown> {
  const entry = historyEntries.get(historyKey(ref));
  const saver = entry?.exitSavers.values().next().value as HistorySaver | undefined;
  return saver ? saveEditorHistory(ref, saver, true) : Promise.resolve(undefined);
}

export function registerEditorHistoryExitSaver(ref: EditorHistoryResourceRef, save: HistorySaver): () => void {
  const entry = historyEntry(ref);
  entry.exitSavers.add(save);
  return () => {
    void saveEditorHistory(ref, save, true).catch(() => undefined);
    entry.exitSavers.delete(save);
    if (entry.exitSavers.size === 0 && !entry.savePromise && entry.savedVersion >= entry.changeVersion) {
      historyEntries.delete(historyKey(ref));
    }
  };
}

export async function saveChangedEditorHistoriesForPageHide(): Promise<void> {
  await Promise.allSettled([...historyEntries.values()].map((entry) => saveEditorHistoryOnExit(entry.ref)));
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    void saveChangedEditorHistoriesForPageHide();
  });
}
