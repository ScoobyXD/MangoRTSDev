export const EDITOR_TAB_TEXT = "     ";

export type PlainTextEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export type PlainTextAreaEditingTarget = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange: (selectionStart: number, selectionEnd: number) => void;
  setRangeText?: (replacement: string, start: number, end: number, selectionMode?: "select" | "start" | "end" | "preserve") => void;
  ownerDocument?: {
    execCommand?: (commandId: string, showUI?: boolean, value?: string) => boolean;
  };
};

export function insertEditorTabText(value: string, selectionStart: number, selectionEnd: number): PlainTextEdit {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const nextCursor = start + EDITOR_TAB_TEXT.length;
  return {
    value: `${value.slice(0, start)}${EDITOR_TAB_TEXT}${value.slice(end)}`,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export function insertEditorTabTextIntoTextArea(target: PlainTextAreaEditingTarget): PlainTextEdit {
  const start = Math.max(0, Math.min(target.selectionStart, target.value.length));
  const end = Math.max(start, Math.min(target.selectionEnd, target.value.length));
  const beforeValue = target.value;
  const beforeSelectionStart = target.selectionStart;
  const beforeSelectionEnd = target.selectionEnd;

  // Prefer the browser text insertion command because it participates in the
  // native textarea undo stack. The fallback keeps Tab working in environments
  // that do not expose that command, including headless tests.
  try {
    const execCommand = target.ownerDocument?.execCommand;
    if (typeof execCommand === "function" && execCommand.call(target.ownerDocument, "insertText", false, EDITOR_TAB_TEXT)) {
      if (target.value !== beforeValue || target.selectionStart !== beforeSelectionStart || target.selectionEnd !== beforeSelectionEnd) {
        return {
          value: target.value,
          selectionStart: target.selectionStart,
          selectionEnd: target.selectionEnd,
        };
      }
    }
  } catch {
    // Some browser modes disallow execCommand. Fall through to deterministic
    // range replacement so the key still inserts exactly the same text.
  }

  const edit = insertEditorTabText(beforeValue, start, end);
  if (typeof target.setRangeText === "function") target.setRangeText(EDITOR_TAB_TEXT, start, end, "end");
  if (target.value !== edit.value || target.selectionStart !== edit.selectionStart || target.selectionEnd !== edit.selectionEnd) {
    target.value = edit.value;
    target.setSelectionRange(edit.selectionStart, edit.selectionEnd);
  }
  return {
    value: target.value,
    selectionStart: target.selectionStart,
    selectionEnd: target.selectionEnd,
  };
}
