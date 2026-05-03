export type DocumentTextEdit = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

type ListMarker = {
  kind: "bullet" | "ordered";
  indent: string;
  marker: string;
  contentStart: number;
};

function lineBounds(value: string, index: number): { start: number; end: number; text: string } {
  const safeIndex = Math.max(0, Math.min(index, value.length));
  const previousBreak = value.lastIndexOf("\n", Math.max(0, safeIndex - 1));
  const nextBreak = value.indexOf("\n", safeIndex);
  const start = previousBreak === -1 ? 0 : previousBreak + 1;
  const end = nextBreak === -1 ? value.length : nextBreak;
  return { start, end, text: value.slice(start, end) };
}

function toAlpha(index: number): string {
  let remaining = Math.max(1, index);
  let out = "";
  while (remaining > 0) {
    remaining -= 1;
    out = String.fromCharCode(65 + (remaining % 26)) + out;
    remaining = Math.floor(remaining / 26);
  }
  return out;
}

export function orderedMarkerForLevel(level: number, ordinal = 1): string {
  const style = ((level % 3) + 3) % 3;
  if (style === 1) return `${toAlpha(ordinal)}.`;
  if (style === 2) return `${ordinal}${toAlpha(ordinal)}.`;
  return `${ordinal}.`;
}

function parseListLine(line: string): ListMarker | null {
  const match = /^(\t*)((?:[-*])|(?:\d+[A-Z]?|[A-Z]|[a-z])[\.)])(\s*)/.exec(line);
  if (!match || match[3].length === 0) return null;
  const marker = match[2];
  return {
    kind: marker === "-" || marker === "*" ? "bullet" : "ordered",
    indent: match[1],
    marker,
    contentStart: match[0].length,
  };
}

function nextOrderedMarker(marker: string): string {
  const bare = marker.replace(/[.)]$/, "");
  const numberAlpha = /^(\d+)([A-Z])$/.exec(bare);
  if (numberAlpha) return `${numberAlpha[1]}${toAlpha(numberAlpha[2].charCodeAt(0) - 63)}.`;
  if (/^\d+$/.test(bare)) return `${Number(bare) + 1}.`;
  if (/^[A-Z]$/.test(bare)) return `${toAlpha(bare.charCodeAt(0) - 63)}.`;
  if (/^[a-z]$/.test(bare)) return `${String.fromCharCode(Math.min(122, bare.charCodeAt(0) + 1))}.`;
  return "1.";
}

function replaceRange(input: DocumentTextEdit, start: number, end: number, replacement: string): DocumentTextEdit {
  return {
    value: `${input.value.slice(0, start)}${replacement}${input.value.slice(end)}`,
    selectionStart: start + replacement.length,
    selectionEnd: start + replacement.length,
  };
}

function normalizeShortcutOnSpace(input: DocumentTextEdit): DocumentTextEdit | null {
  if (input.selectionStart !== input.selectionEnd) return null;
  const line = lineBounds(input.value, input.selectionStart);
  const beforeCaret = input.value.slice(line.start, input.selectionStart);
  const ordered = /^(\t*)1$/.exec(beforeCaret);
  if (ordered) return replaceRange(input, line.start, input.selectionStart, `${ordered[1]}1. `);
  const bullet = /^(\t*)[-*]$/.exec(beforeCaret);
  if (bullet) return replaceRange(input, line.start, input.selectionStart, `${bullet[1]}- `);
  return null;
}

function applyEnter(input: DocumentTextEdit): DocumentTextEdit | null {
  if (input.selectionStart !== input.selectionEnd) return null;
  const line = lineBounds(input.value, input.selectionStart);
  const list = parseListLine(line.text);
  if (!list) return null;

  const content = line.text.slice(list.contentStart);
  if (content.trim().length === 0) {
    return replaceRange(input, line.start, line.end, list.indent);
  }

  const marker = list.kind === "bullet" ? "-" : nextOrderedMarker(list.marker);
  return replaceRange(input, input.selectionStart, input.selectionEnd, `\n${list.indent}${marker} `);
}

function reindentListLine(line: string, shiftKey: boolean): string {
  const list = parseListLine(line);
  if (!list) {
    if (!shiftKey) return `\t${line}`;
    if (line.startsWith("\t")) return line.slice(1);
    if (line.startsWith("  ")) return line.slice(2);
    return line;
  }

  const nextIndent = shiftKey ? list.indent.slice(0, Math.max(0, list.indent.length - 1)) : `${list.indent}\t`;
  const content = line.slice(list.contentStart);
  const nextMarker = list.kind === "bullet" ? "-" : orderedMarkerForLevel(nextIndent.length, 1);
  return `${nextIndent}${nextMarker} ${content}`;
}

function applyTab(input: DocumentTextEdit, shiftKey: boolean): DocumentTextEdit {
  const startLine = lineBounds(input.value, input.selectionStart);
  const endIndex = input.selectionEnd > input.selectionStart && input.value[input.selectionEnd - 1] === "\n"
    ? input.selectionEnd - 1
    : input.selectionEnd;
  const endLine = lineBounds(input.value, endIndex);
  const selectedText = input.value.slice(startLine.start, endLine.end);
  const lines = selectedText.split("\n");
  const nextText = lines.map((line) => reindentListLine(line, shiftKey)).join("\n");
  const nextValue = `${input.value.slice(0, startLine.start)}${nextText}${input.value.slice(endLine.end)}`;
  const delta = nextText.length - selectedText.length;

  if (input.selectionStart === input.selectionEnd) {
    const currentLine = lines[0] ?? "";
    const nextLine = nextText;
    const list = parseListLine(currentLine);
    const nextList = parseListLine(nextLine);
    const caretOffset = input.selectionStart - startLine.start;
    if (list && nextList && caretOffset >= list.contentStart) {
      const contentOffset = caretOffset - list.contentStart;
      const nextCaret = startLine.start + nextList.contentStart + contentOffset;
      return { value: nextValue, selectionStart: nextCaret, selectionEnd: nextCaret };
    }
    const nextCaret = input.selectionStart + delta;
    return { value: nextValue, selectionStart: nextCaret, selectionEnd: nextCaret };
  }

  return {
    value: nextValue,
    selectionStart: startLine.start,
    selectionEnd: input.selectionEnd + delta,
  };
}

export function applyDocumentTextareaKey(input: DocumentTextEdit & { key: string; shiftKey?: boolean }): DocumentTextEdit | null {
  if (input.key === "Tab") return applyTab(input, Boolean(input.shiftKey));
  if (input.key === "Enter") return applyEnter(input);
  if (input.key === " " || input.key === "Spacebar") return normalizeShortcutOnSpace(input);
  return null;
}
