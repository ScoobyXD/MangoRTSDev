export type EditorIndentGuideSegment = {
  depth: number;
  lineStart: number;
  lineEnd: number;
};

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
  const closeDepth = (depth: number, lineEnd: number) => {
    const lineStart = openByDepth.get(depth);
    if (lineStart === undefined) return;
    openByDepth.delete(depth);
    if (lineEnd >= lineStart) segments.push({ depth, lineStart, lineEnd });
  };

  lines.forEach((line, lineIndex) => {
    const isBlank = line.trim().length === 0;
    if (isBlank) {
      for (const depth of [...openByDepth.keys()].sort((a, b) => b - a)) closeDepth(depth, lineIndex - 1);
      return;
    }
    const depth = countIndentDepth(line, indentWidth);
    for (const depthToClose of [...openByDepth.keys()].filter((value) => value > depth).sort((a, b) => b - a)) {
      closeDepth(depthToClose, lineIndex - 1);
    }
    for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
      if (!openByDepth.has(currentDepth)) openByDepth.set(currentDepth, lineIndex);
    }
  });

  const finalLineIndex = Math.max(0, lines.length - 1);
  for (const depth of [...openByDepth.keys()].sort((a, b) => b - a)) {
    closeDepth(depth, finalLineIndex);
  }
  return segments;
}
