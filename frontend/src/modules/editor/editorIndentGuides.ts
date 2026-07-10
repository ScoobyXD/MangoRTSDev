export type EditorIndentGuideSegment = {
  depth: number;
  lineStart: number;
  lineEnd: number;
};

const EDITOR_INDENT_GUIDE_SPACE_WIDTH_EM = 0.25;

function positiveCSSNumber(value: string | number | undefined, allowPixels = false): number | null {
  const cleanValue = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (typeof cleanValue === "string") {
    const pattern = allowPixels ? /^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/ : /^(?:\d+(?:\.\d+)?|\.\d+)$/;
    if (!pattern.test(cleanValue)) return null;
  }
  const parsed = typeof cleanValue === "number" ? cleanValue : Number.parseFloat(cleanValue ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function resolveEditorIndentGuideLineHeightPx(
  fontSize: string | number | undefined,
  lineHeight: string | number | undefined,
  fallbackFontSizePx: number,
  fallbackLineHeight: number,
): number {
  const resolvedFontSize = positiveCSSNumber(fontSize, true) ?? fallbackFontSizePx;
  if (typeof lineHeight === "string" && lineHeight.trim().toLowerCase().endsWith("px")) {
    return positiveCSSNumber(lineHeight, true) ?? (resolvedFontSize * fallbackLineHeight);
  }
  const resolvedLineHeight = positiveCSSNumber(lineHeight) ?? fallbackLineHeight;
  return resolvedFontSize * resolvedLineHeight;
}

// Indent guide left positions must follow the rendered width of EDITOR_TAB_TEXT's
// five spaces. Do not use `ch` here: `ch` is the width of "0", which only lined
// up when the editor was forced to monospace. Node and Logic Gate editors use the
// app's proportional Inter font, so each nested guide advances by five spaces.
export function editorIndentGuideLeftForDepth(depth: number, spacesPerIndent: number): string {
  const visibleDepth = Math.max(0, Math.floor(depth) - 1);
  const indentWidth = Math.max(1, Math.floor(spacesPerIndent));
  const leftEm = visibleDepth * indentWidth * EDITOR_INDENT_GUIDE_SPACE_WIDTH_EM;
  return `${Number(leftEm.toFixed(4))}em`;
}

function countIndentDepth(line: string, spacesPerIndent: number): number {
  let columns = 0;
  for (const char of line) {
    if (char === " " || char === "\u00a0") {
      columns += 1;
      continue;
    }
    if (char === "\t") {
      columns += spacesPerIndent;
      continue;
    }
    break;
  }
  return Math.floor(columns / spacesPerIndent);
}

export function buildEditorIndentGuideSegments(text: string, spacesPerIndent: number): EditorIndentGuideSegment[] {
  const indentWidth = Math.max(1, Math.floor(spacesPerIndent));
  const lines = text.split(/\r\n|\n|\r/);
  const openByDepth = new Map<number, number>();
  const segments: EditorIndentGuideSegment[] = [];
  let previousNonBlankDepth = 0;

  const closeDepth = (depth: number, lineEnd: number) => {
    const lineStart = openByDepth.get(depth);
    if (lineStart === undefined) return;
    openByDepth.delete(depth);
    if (lineEnd >= lineStart) segments.push({ depth, lineStart, lineEnd });
  };

  lines.forEach((line, lineIndex) => {
    const isBlank = line.trim().length === 0;
    const depth = isBlank && line.length === 0 ? previousNonBlankDepth : countIndentDepth(line, indentWidth);
    for (const depthToClose of [...openByDepth.keys()].filter((value) => value > depth).sort((a, b) => b - a)) {
      closeDepth(depthToClose, lineIndex - 1);
    }
    for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
      if (!openByDepth.has(currentDepth)) openByDepth.set(currentDepth, lineIndex);
    }
    if (!isBlank) previousNonBlankDepth = depth;
  });

  const finalLineIndex = Math.max(0, lines.length - 1);
  for (const depth of [...openByDepth.keys()].sort((a, b) => b - a)) {
    closeDepth(depth, finalLineIndex);
  }
  return segments;
}
