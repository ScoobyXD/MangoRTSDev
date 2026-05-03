export const EDITOR_TAB_TEXT = "       ";

export type PlainTextEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
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
