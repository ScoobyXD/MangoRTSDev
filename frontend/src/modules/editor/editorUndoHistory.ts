export type EditorTextChangeKind = "typing" | "delete" | "paste" | "lineBreak" | "tab" | "unknown";
export type EditorDocumentChangeKind = EditorTextChangeKind | "image" | "resize" | "format";

export type EditorTextSnapshot = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export type EditorUndoHistory = {
  undoStack: EditorUndoGroup[];
  redoStack: EditorUndoGroup[];
  maxGroups: number;
  maxStoredChars: number;
  groupDelayMs: number;
};

export type EditorDocumentUndoSnapshot = {
  html: string;
  selectionStart: number;
  selectionEnd: number;
};

export type EditorDocumentUndoGroup = {
  before: EditorDocumentUndoSnapshot;
  after: EditorDocumentUndoSnapshot;
  kind: EditorDocumentChangeKind;
  timestamp: number;
};

export type EditorDocumentUndoHistory = {
  undoStack: EditorDocumentUndoGroup[];
  redoStack: EditorDocumentUndoGroup[];
  maxGroups: number;
  maxStoredChars: number;
  groupDelayMs: number;
};

type EditorTextChange = {
  from: number;
  removed: string;
  inserted: string;
  beforeSelection: EditorTextSnapshot;
  afterSelection: EditorTextSnapshot;
};

export type EditorUndoGroup = EditorTextChange & {
  kind: EditorTextChangeKind;
  timestamp: number;
};

const DEFAULT_MAX_GROUPS = 100;
const DEFAULT_MAX_STORED_CHARS = 200_000;
const DEFAULT_GROUP_DELAY_MS = 500;
const DEFAULT_DOCUMENT_MAX_GROUPS = 40;
const DEFAULT_DOCUMENT_MAX_STORED_CHARS = 6_000_000;

export function createEditorUndoHistory(config?: Partial<Pick<EditorUndoHistory, "maxGroups" | "maxStoredChars" | "groupDelayMs">>): EditorUndoHistory {
  return {
    undoStack: [],
    redoStack: [],
    maxGroups: config?.maxGroups ?? DEFAULT_MAX_GROUPS,
    maxStoredChars: config?.maxStoredChars ?? DEFAULT_MAX_STORED_CHARS,
    groupDelayMs: config?.groupDelayMs ?? DEFAULT_GROUP_DELAY_MS,
  };
}

export function resetEditorUndoHistory(history: EditorUndoHistory) {
  history.undoStack = [];
  history.redoStack = [];
}

export function createEditorDocumentUndoHistory(config?: Partial<Pick<EditorDocumentUndoHistory, "maxGroups" | "maxStoredChars" | "groupDelayMs">>): EditorDocumentUndoHistory {
  return {
    undoStack: [],
    redoStack: [],
    maxGroups: config?.maxGroups ?? DEFAULT_DOCUMENT_MAX_GROUPS,
    maxStoredChars: config?.maxStoredChars ?? DEFAULT_DOCUMENT_MAX_STORED_CHARS,
    groupDelayMs: config?.groupDelayMs ?? DEFAULT_GROUP_DELAY_MS,
  };
}

export function resetEditorDocumentUndoHistory(history: EditorDocumentUndoHistory) {
  history.undoStack = [];
  history.redoStack = [];
}

export function snapshotEditorText(value: string, selectionStart: number, selectionEnd: number): EditorTextSnapshot {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return { value, selectionStart: start, selectionEnd: end };
}

export function snapshotEditorDocumentHTML(html: string, selectionStart: number, selectionEnd: number): EditorDocumentUndoSnapshot {
  const start = Math.max(0, selectionStart);
  const end = Math.max(start, selectionEnd);
  return { html, selectionStart: start, selectionEnd: end };
}

export function snapshotEditorTextArea(target: Pick<HTMLTextAreaElement, "value" | "selectionStart" | "selectionEnd">): EditorTextSnapshot {
  return snapshotEditorText(target.value, target.selectionStart, target.selectionEnd);
}

export function classifyEditorInputType(inputType: string | undefined): EditorTextChangeKind {
  if (!inputType) return "unknown";
  if (inputType === "insertFromPaste" || inputType === "insertFromDrop") return "paste";
  if (inputType === "insertLineBreak" || inputType === "insertParagraph") return "lineBreak";
  if (inputType.startsWith("delete")) return "delete";
  if (inputType.startsWith("insert")) return "typing";
  return "unknown";
}

export function recordEditorUndoChange(
  history: EditorUndoHistory,
  before: EditorTextSnapshot,
  after: EditorTextSnapshot,
  kind: EditorTextChangeKind,
  timestamp = Date.now(),
) {
  if (before.value === after.value) return;

  const change = deriveEditorTextChange(before, after);
  history.redoStack = [];

  // Keep this strictly local and bounded. Very large replacements are still
  // saved normally, but they do not get copied into memory as undo payloads.
  if (storedChars(change) > history.maxStoredChars) {
    history.undoStack = [];
    return;
  }

  const normalizedKind = normalizeEditorChangeKind(kind, change);
  const last = history.undoStack[history.undoStack.length - 1];
  if (last) {
    const merged = mergeUndoGroup(last, { ...change, kind: normalizedKind, timestamp }, history.groupDelayMs);
    if (merged) {
      history.undoStack[history.undoStack.length - 1] = merged;
      trimUndoHistory(history);
      return;
    }
  }

  history.undoStack.push({ ...change, kind: normalizedKind, timestamp });
  trimUndoHistory(history);
}

export function recordEditorDocumentUndoChange(
  history: EditorDocumentUndoHistory,
  before: EditorDocumentUndoSnapshot,
  after: EditorDocumentUndoSnapshot,
  kind: EditorDocumentChangeKind,
  timestamp = Date.now(),
) {
  if (before.html === after.html) return;
  history.redoStack = [];

  const next: EditorDocumentUndoGroup = { before, after, kind, timestamp };
  if (storedDocumentChars(next) > history.maxStoredChars) {
    resetEditorDocumentUndoHistory(history);
    return;
  }

  const last = history.undoStack[history.undoStack.length - 1];
  if (last && shouldMergeDocumentUndoGroup(last, next, history.groupDelayMs)) {
    history.undoStack[history.undoStack.length - 1] = {
      ...last,
      after,
      timestamp,
    };
    trimDocumentUndoHistory(history);
    return;
  }

  history.undoStack.push(next);
  trimDocumentUndoHistory(history);
}

export function undoEditorText(history: EditorUndoHistory, currentValue: string): EditorTextSnapshot | null {
  const group = history.undoStack.pop();
  if (!group) return null;
  const from = group.from;
  const to = from + group.inserted.length;
  if (currentValue.slice(from, to) !== group.inserted) {
    resetEditorUndoHistory(history);
    return null;
  }

  history.redoStack.push(group);
  return {
    value: `${currentValue.slice(0, from)}${group.removed}${currentValue.slice(to)}`,
    selectionStart: group.beforeSelection.selectionStart,
    selectionEnd: group.beforeSelection.selectionEnd,
  };
}

export function redoEditorText(history: EditorUndoHistory, currentValue: string): EditorTextSnapshot | null {
  const group = history.redoStack.pop();
  if (!group) return null;
  const from = group.from;
  const to = from + group.removed.length;
  if (currentValue.slice(from, to) !== group.removed) {
    resetEditorUndoHistory(history);
    return null;
  }

  history.undoStack.push(group);
  trimUndoHistory(history);
  return {
    value: `${currentValue.slice(0, from)}${group.inserted}${currentValue.slice(to)}`,
    selectionStart: group.afterSelection.selectionStart,
    selectionEnd: group.afterSelection.selectionEnd,
  };
}

export function undoEditorDocument(history: EditorDocumentUndoHistory, currentHTML: string): EditorDocumentUndoSnapshot | null {
  const group = history.undoStack.pop();
  if (!group) return null;
  if (currentHTML !== group.after.html) {
    resetEditorDocumentUndoHistory(history);
    return null;
  }
  history.redoStack.push(group);
  return group.before;
}

export function redoEditorDocument(history: EditorDocumentUndoHistory, currentHTML: string): EditorDocumentUndoSnapshot | null {
  const group = history.redoStack.pop();
  if (!group) return null;
  if (currentHTML !== group.before.html) {
    resetEditorDocumentUndoHistory(history);
    return null;
  }
  history.undoStack.push(group);
  trimDocumentUndoHistory(history);
  return group.after;
}

function deriveEditorTextChange(before: EditorTextSnapshot, after: EditorTextSnapshot): EditorTextChange {
  const beforeValue = before.value;
  const afterValue = after.value;
  let prefix = 0;
  const prefixLimit = Math.min(beforeValue.length, afterValue.length);
  while (prefix < prefixLimit && beforeValue[prefix] === afterValue[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < beforeValue.length - prefix &&
    suffix < afterValue.length - prefix &&
    beforeValue[beforeValue.length - 1 - suffix] === afterValue[afterValue.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    from: prefix,
    removed: beforeValue.slice(prefix, beforeValue.length - suffix),
    inserted: afterValue.slice(prefix, afterValue.length - suffix),
    beforeSelection: before,
    afterSelection: after,
  };
}

function normalizeEditorChangeKind(kind: EditorTextChangeKind, change: EditorTextChange): EditorTextChangeKind {
  if (kind !== "unknown") return kind;
  if (change.inserted.length > 0 && change.removed.length === 0) return "typing";
  if (change.inserted.length === 0 && change.removed.length > 0) return "delete";
  return "unknown";
}

function mergeUndoGroup(last: EditorUndoGroup, next: EditorUndoGroup, groupDelayMs: number): EditorUndoGroup | null {
  if (last.kind !== next.kind || next.timestamp - last.timestamp > groupDelayMs) return null;

  if (next.kind === "typing" && last.removed.length === 0 && next.removed.length === 0 && next.from === last.from + last.inserted.length) {
    return {
      ...last,
      inserted: last.inserted + next.inserted,
      afterSelection: next.afterSelection,
      timestamp: next.timestamp,
    };
  }

  if (next.kind === "delete" && last.inserted.length === 0 && next.inserted.length === 0) {
    if (next.from === last.from) {
      return {
        ...last,
        removed: last.removed + next.removed,
        afterSelection: next.afterSelection,
        timestamp: next.timestamp,
      };
    }
    if (next.from + next.removed.length === last.from) {
      return {
        ...last,
        from: next.from,
        removed: next.removed + last.removed,
        afterSelection: next.afterSelection,
        timestamp: next.timestamp,
      };
    }
  }

  return null;
}

function trimUndoHistory(history: EditorUndoHistory) {
  while (history.undoStack.length > 0 && (history.undoStack.length > history.maxGroups || totalStoredChars(history.undoStack) > history.maxStoredChars)) {
    history.undoStack.shift();
  }
}

function shouldMergeDocumentUndoGroup(last: EditorDocumentUndoGroup, next: EditorDocumentUndoGroup, groupDelayMs: number): boolean {
  return last.kind === "typing" && next.kind === "typing" && next.timestamp - last.timestamp <= groupDelayMs;
}

function trimDocumentUndoHistory(history: EditorDocumentUndoHistory) {
  while (history.undoStack.length > 0 && (history.undoStack.length > history.maxGroups || totalStoredDocumentChars(history.undoStack) > history.maxStoredChars)) {
    history.undoStack.shift();
  }
}

function totalStoredDocumentChars(groups: EditorDocumentUndoGroup[]) {
  return groups.reduce((total, group) => total + storedDocumentChars(group), 0);
}

function storedDocumentChars(group: EditorDocumentUndoGroup) {
  return group.before.html.length + group.after.html.length;
}

function totalStoredChars(groups: EditorUndoGroup[]) {
  return groups.reduce((total, group) => total + storedChars(group), 0);
}

function storedChars(change: Pick<EditorTextChange, "removed" | "inserted">) {
  return change.removed.length + change.inserted.length;
}
