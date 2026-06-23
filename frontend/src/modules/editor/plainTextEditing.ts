export const EDITOR_TAB_TEXT = "     ";

export type EditorOutlineStyleID = "automatic-outline-numbering" | "bullet-list" | "checklist" | "indent-guides";
export type EditorTabDirection = "indent" | "outdent";
export type EditorInlineFormatCommand = "bold" | "underline" | "hyperlink";

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

function getLineStart(value: string, index: number): number {
  return value.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
}

function getLineEnd(value: string, index: number): number {
  const nextLineBreak = value.indexOf("\n", index);
  return nextLineBreak === -1 ? value.length : nextLineBreak;
}

function readLine(value: string, index: number): { lineStart: number; lineEnd: number; line: string } {
  const lineStart = getLineStart(value, index);
  const lineEnd = getLineEnd(value, index);
  return { lineStart, lineEnd, line: value.slice(lineStart, lineEnd) };
}

function readLineIndentation(line: string): string {
  return /^[ \t\u00a0]*/.exec(line)?.[0] ?? "";
}

function countIndentDepth(indentation: string): number {
  let columns = 0;
  for (const char of indentation) columns += char === "\t" ? EDITOR_TAB_TEXT.length : 1;
  return Math.floor(columns / EDITOR_TAB_TEXT.length);
}

export function isEditorOutlineStyleID(value: string): value is EditorOutlineStyleID {
  return value === "automatic-outline-numbering" || value === "bullet-list" || value === "checklist" || value === "indent-guides";
}

type OutlineMarkerKind = "decimal" | "alpha" | "roman";

type ParsedOutlineLine = {
  indentation: string;
  marker: string;
  delimiter: string;
  spacing: string;
  rest: string;
  depth: number;
};

function outlineMarkerKindForDepth(depth: number): OutlineMarkerKind {
  const normalizedDepth = Math.max(0, depth) % 3;
  if (normalizedDepth === 1) return "alpha";
  if (normalizedDepth === 2) return "roman";
  return "decimal";
}

function firstOutlineMarkerForKind(kind: OutlineMarkerKind): string {
  if (kind === "alpha") return "a";
  if (kind === "roman") return "i";
  return "1";
}

function parseOutlineLine(line: string): ParsedOutlineLine | null {
  const match = /^([ \t\u00a0]*)(\d+(?:\.\d+)*|[a-z]+|[ivxlcdm]+)([.)])([ \t\u00a0]*)(.*)$/i.exec(line);
  if (!match) return null;
  const [, indentation, marker, delimiter, spacing, rest] = match;
  return {
    indentation,
    marker: marker.toLowerCase(),
    delimiter,
    spacing,
    rest,
    depth: countIndentDepth(indentation),
  };
}

function isIndentationOnly(value: string): boolean {
  return /^[ \t\u00a0]*$/.test(value);
}

function normalizeIndentationWhitespace(value: string): string {
  return value.replace(/\u00a0/g, " ");
}

function incrementDecimalMarker(marker: string): string | null {
  const parts = marker.split(".");
  const last = Number(parts[parts.length - 1]);
  if (!Number.isSafeInteger(last) || last < 0) return null;
  parts[parts.length - 1] = String(last + 1);
  return parts.join(".");
}

function alphaToNumber(marker: string): number | null {
  let value = 0;
  for (const char of marker.toLowerCase()) {
    const code = char.charCodeAt(0) - 96;
    if (code < 1 || code > 26) return null;
    value = value * 26 + code;
  }
  return value;
}

function numberToAlpha(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 1) return null;
  let remaining = value;
  let output = "";
  while (remaining > 0) {
    remaining -= 1;
    output = String.fromCharCode(97 + (remaining % 26)) + output;
    remaining = Math.floor(remaining / 26);
  }
  return output;
}

const ROMAN_VALUES: ReadonlyArray<[string, number]> = [
  ["m", 1000],
  ["cm", 900],
  ["d", 500],
  ["cd", 400],
  ["c", 100],
  ["xc", 90],
  ["l", 50],
  ["xl", 40],
  ["x", 10],
  ["ix", 9],
  ["v", 5],
  ["iv", 4],
  ["i", 1],
];

function romanToNumber(marker: string): number | null {
  const normalized = marker.toLowerCase();
  let index = 0;
  let total = 0;
  while (index < normalized.length) {
    const pair = ROMAN_VALUES.find(([token]) => normalized.startsWith(token, index));
    if (!pair) return null;
    total += pair[1];
    index += pair[0].length;
  }
  return total > 0 && numberToRoman(total) === normalized ? total : null;
}

function numberToRoman(value: number): string | null {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3999) return null;
  let remaining = value;
  let output = "";
  for (const [token, amount] of ROMAN_VALUES) {
    while (remaining >= amount) {
      output += token;
      remaining -= amount;
    }
  }
  return output;
}

function incrementOutlineMarker(marker: string, kind: OutlineMarkerKind): string | null {
  if (kind === "decimal") return incrementDecimalMarker(marker);
  if (kind === "alpha") {
    const current = alphaToNumber(marker);
    return current === null ? null : numberToAlpha(current + 1);
  }
  const current = romanToNumber(marker);
  return current === null ? null : numberToRoman(current + 1);
}

function nextMarkerForOutlineDepth(linesBeforeCurrent: string[], depth: number): string {
  const kind = outlineMarkerKindForDepth(depth);
  for (let index = linesBeforeCurrent.length - 1; index >= 0; index -= 1) {
    const parsed = parseOutlineLine(linesBeforeCurrent[index]);
    if (!parsed) continue;
    if (parsed.depth < depth) break;
    if (parsed.depth !== depth) continue;
    const nextMarker = incrementOutlineMarker(parsed.marker, kind);
    if (nextMarker) return nextMarker;
  }
  return firstOutlineMarkerForKind(kind);
}

function replaceCurrentLine(value: string, selectionStart: number, replacementLine: string, cursorOffset: number): PlainTextEdit {
  const { lineStart, lineEnd } = readLine(value, selectionStart);
  const nextCursor = lineStart + Math.max(0, Math.min(cursorOffset, replacementLine.length));
  return {
    value: `${value.slice(0, lineStart)}${replacementLine}${value.slice(lineEnd)}`,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

function outdentPlainLine(value: string, selectionStart: number): PlainTextEdit {
  const { line, lineStart } = readLine(value, selectionStart);
  const removableSpaces = Math.min(EDITOR_TAB_TEXT.length, line.match(/^[ \u00a0]*/)?.[0].length ?? 0);
  const removeCount = line.startsWith("\t") ? 1 : removableSpaces;
  if (removeCount <= 0) return { value, selectionStart, selectionEnd: selectionStart };
  const replacementLine = line.slice(removeCount);
  const nextCursor = Math.max(lineStart, selectionStart - removeCount);
  return {
    value: `${value.slice(0, lineStart)}${replacementLine}${value.slice(lineStart + line.length)}`,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

function updateAutomaticOutlineIndent(value: string, selectionStart: number, direction: EditorTabDirection): PlainTextEdit {
  const { lineStart, line } = readLine(value, selectionStart);
  const parsed = parseOutlineLine(line);
  if (!parsed) {
    if (direction === "outdent") return outdentPlainLine(value, selectionStart);
    const nextCursor = selectionStart + EDITOR_TAB_TEXT.length;
    return {
      value: `${value.slice(0, lineStart)}${EDITOR_TAB_TEXT}${line}${value.slice(lineStart + line.length)}`,
      selectionStart: nextCursor,
      selectionEnd: nextCursor,
    };
  }

  const nextDepth = direction === "outdent" ? Math.max(0, parsed.depth - 1) : parsed.depth + 1;
  const linesBeforeCurrent = value.slice(0, lineStart).split(/\r\n|\n|\r/);
  if (linesBeforeCurrent.length > 0 && linesBeforeCurrent[linesBeforeCurrent.length - 1] === "") linesBeforeCurrent.pop();
  const nextIndentation = EDITOR_TAB_TEXT.repeat(nextDepth);
  const nextMarker = nextMarkerForOutlineDepth(linesBeforeCurrent, nextDepth);
  const spacing = parsed.spacing || " ";
  const replacementLine = `${nextIndentation}${nextMarker}${parsed.delimiter}${spacing}${parsed.rest}`;
  const oldBodyOffset = parsed.indentation.length + parsed.marker.length + parsed.delimiter.length + parsed.spacing.length;
  const nextBodyOffset = nextIndentation.length + nextMarker.length + parsed.delimiter.length + spacing.length;
  const relativeCursor = Math.max(0, selectionStart - lineStart);
  const nextCursorOffset = relativeCursor <= oldBodyOffset
    ? nextBodyOffset
    : nextBodyOffset + (relativeCursor - oldBodyOffset);
  return replaceCurrentLine(value, selectionStart, replacementLine, nextCursorOffset);
}

export function insertEditorTabText(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  outlineStyle: EditorOutlineStyleID = "indent-guides",
  direction: EditorTabDirection = "indent",
): PlainTextEdit {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  if (direction === "outdent") {
    if (outlineStyle === "automatic-outline-numbering") return updateAutomaticOutlineIndent(value, start, "outdent");
    return outdentPlainLine(value, start);
  }
  if (outlineStyle === "automatic-outline-numbering") return updateAutomaticOutlineIndent(value, start, "indent");
  const nextCursor = start + EDITOR_TAB_TEXT.length;
  return {
    value: `${value.slice(0, start)}${EDITOR_TAB_TEXT}${value.slice(end)}`,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export function getAutomaticOutlineContinuation(value: string, selectionStart: number): string | null {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const lineStart = getLineStart(value, start);
  const lineBeforeCaret = value.slice(lineStart, start);
  const parsed = parseOutlineLine(lineBeforeCaret);
  if (!parsed) return null;

  const kind = outlineMarkerKindForDepth(parsed.depth);
  const nextMarker = incrementOutlineMarker(parsed.marker, kind);
  if (!nextMarker) return null;
  return `\n${parsed.indentation}${nextMarker}${parsed.delimiter}${parsed.spacing || " "}`;
}

function getIndentGuideContinuation(value: string, selectionStart: number): string {
  const { line } = readLine(value, selectionStart);
  return `\n${readLineIndentation(line)}`;
}

export function insertEditorEnterText(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  outlineStyle: EditorOutlineStyleID,
  options: { continueAutomaticOutline?: boolean } = {},
): PlainTextEdit {
  const continuation = outlineStyle === "automatic-outline-numbering"
    ? (options.continueAutomaticOutline === false ? null : getAutomaticOutlineContinuation(value, selectionStart))
    : getIndentGuideContinuation(value, selectionStart);
  return replaceSelection(value, selectionStart, selectionEnd, continuation ?? "\n");
}

export function insertAutomaticOutlineFirstText(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  insertedText: string,
): PlainTextEdit | null {
  if (!insertedText || /\r|\n/.test(insertedText) || insertedText.trim().length === 0) return null;
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  if (start !== end) return null;

  const { lineStart, lineEnd, line } = readLine(value, start);
  if (parseOutlineLine(line)) return null;
  const relativeStart = start - lineStart;
  const beforeCaret = line.slice(0, relativeStart);
  const afterCaret = line.slice(relativeStart);
  if (!isIndentationOnly(beforeCaret) || !isIndentationOnly(afterCaret)) return null;

  const indentation = normalizeIndentationWhitespace(beforeCaret);
  const depth = countIndentDepth(indentation);
  const linesBeforeCurrent = value.slice(0, lineStart).split(/\r\n|\n|\r/);
  if (linesBeforeCurrent.length > 0 && linesBeforeCurrent[linesBeforeCurrent.length - 1] === "") linesBeforeCurrent.pop();
  const marker = nextMarkerForOutlineDepth(linesBeforeCurrent, depth);
  const replacementLine = `${indentation}${marker}. ${insertedText}`;
  const nextCursor = lineStart + replacementLine.length;
  return {
    value: `${value.slice(0, lineStart)}${replacementLine}${value.slice(lineEnd)}`,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export function deleteEditorBackspaceText(value: string, selectionStart: number, selectionEnd: number): PlainTextEdit | null {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  if (start !== end || start < EDITOR_TAB_TEXT.length) return null;
  const deleteStart = start - EDITOR_TAB_TEXT.length;
  if (deleteStart < getLineStart(value, start)) return null;
  if (value.slice(deleteStart, start) !== EDITOR_TAB_TEXT) return null;
  return {
    value: `${value.slice(0, deleteStart)}${value.slice(start)}`,
    selectionStart: deleteStart,
    selectionEnd: deleteStart,
  };
}

export function applyEditorInlineFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: EditorInlineFormatCommand,
  href = "https://",
): PlainTextEdit {
  const { start, end } = clampSelection(value, selectionStart, selectionEnd);
  const selectedText = value.slice(start, end);
  if (command === "bold") {
    const insertedText = selectedText ? `**${selectedText}**` : "****";
    const edit = replaceSelection(value, start, end, insertedText);
    return selectedText ? edit : { ...edit, selectionStart: start + 2, selectionEnd: start + 2 };
  }
  if (command === "underline") {
    const insertedText = selectedText ? `<u>${selectedText}</u>` : "<u></u>";
    const edit = replaceSelection(value, start, end, insertedText);
    return selectedText ? edit : { ...edit, selectionStart: start + 3, selectionEnd: start + 3 };
  }

  const safeHref = href.trim() || "https://";
  const label = selectedText || "link";
  const insertedText = `[${label}](${safeHref})`;
  const edit = replaceSelection(value, start, end, insertedText);
  if (selectedText) return edit;
  return { ...edit, selectionStart: start + 1, selectionEnd: start + 5 };
}
