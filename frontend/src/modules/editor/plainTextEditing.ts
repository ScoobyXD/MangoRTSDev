export const EDITOR_TAB_TEXT = "     ";

export type EditorOutlineStyleID = "automatic-outline-numbering" | "indent-guides";

export const DEFAULT_EDITOR_OUTLINE_STYLE: EditorOutlineStyleID = "indent-guides";

export type PlainTextEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function clampSelection(value: string, selectionStart: number, selectionEnd: number): { start: number; end: number } {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  return { start, end };
}

function replaceSelection(value: string, selectionStart: number, selectionEnd: number, insertedText: string): PlainTextEdit {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  const nextCursor = start + insertedText.length;
  return {
    value: `${value.slice(0, start)}${insertedText}${value.slice(end)}`,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export function isEditorOutlineStyleID(value: string): value is EditorOutlineStyleID {
  return value === "automatic-outline-numbering" || value === "indent-guides";
}

export function insertEditorTabText(value: string, selectionStart: number, selectionEnd: number): PlainTextEdit {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  const nextCursor = start + EDITOR_TAB_TEXT.length;
  return {
    value: `${value.slice(0, start)}${EDITOR_TAB_TEXT}${value.slice(end)}`,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

function incrementOutlineNumber(numberText: string): string | null {
  const parts = numberText.split(".");
  const last = Number(parts[parts.length - 1]);
  if (!Number.isSafeInteger(last) || last < 0) return null;
  parts[parts.length - 1] = String(last + 1);
  return parts.join(".");
}

export function getAutomaticOutlineContinuation(value: string, selectionStart: number): string | null {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineBeforeCaret = value.slice(lineStart, start);
  const match = /^([ \t]*)(\d+(?:\.\d+)*)([.)])([ \t]+).*$/.exec(lineBeforeCaret);
  if (!match) return null;

  const [, indentation, numberText, delimiter, spacing] = match;
  const nextNumber = incrementOutlineNumber(numberText);
  if (!nextNumber) return null;
  return `\n${indentation}${nextNumber}${delimiter}${spacing}`;
}

export function insertEditorEnterText(value: string, selectionStart: number, selectionEnd: number, outlineStyle: EditorOutlineStyleID): PlainTextEdit {
  const continuation = outlineStyle === "automatic-outline-numbering"
    ? getAutomaticOutlineContinuation(value, selectionStart)
    : null;
  return replaceSelection(value, selectionStart, selectionEnd, continuation ?? "\n");
}
