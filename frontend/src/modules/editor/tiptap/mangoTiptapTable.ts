import type { Editor } from "@tiptap/core";

export const MANGO_TIPTAP_TABLE_DEFAULT_COLUMN_WIDTH_PX = 112;
export const MANGO_TIPTAP_TABLE_DEFAULT_ROW_HEIGHT_PX = 36;

export type MangoTiptapTableFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
  rows: number;
  columns: number;
  rowHeight: number;
  columnWidth: number;
};

export type MangoTiptapTableGrowth = {
  rows: number;
  columns: number;
};

function directDOMElement(node: Node): Element | null {
  return node.nodeType === 1 ? node as Element : node.parentElement;
}

function renderedTableColumnCount(table: HTMLTableElement): number {
  return Array.from(table.rows).reduce((maximum, row) => Math.max(
    maximum,
    Array.from(row.cells).reduce((count, cell) => count + Math.max(1, cell.colSpan), 0),
  ), 0);
}

/** Reads the table containing the current editor selection in editor-scroll coordinates. */
export function readActiveMangoTiptapTableFrame(editor: Editor, root: HTMLElement): MangoTiptapTableFrame | null {
  if (!editor.isActive("table")) return null;
  try {
    const domAtSelection = editor.view.domAtPos(editor.state.selection.from);
    const table = directDOMElement(domAtSelection.node)?.closest("table");
    const TableElement = root.ownerDocument.defaultView?.HTMLTableElement;
    if (!TableElement || !(table instanceof TableElement)) return null;
    const rows = Math.max(1, table.rows.length);
    const columns = Math.max(1, renderedTableColumnCount(table));
    const rootRect = root.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const width = tableRect.width > 0
      ? tableRect.width
      : columns * MANGO_TIPTAP_TABLE_DEFAULT_COLUMN_WIDTH_PX;
    const height = tableRect.height > 0
      ? tableRect.height
      : rows * MANGO_TIPTAP_TABLE_DEFAULT_ROW_HEIGHT_PX;
    return {
      left: tableRect.left - rootRect.left + root.scrollLeft,
      top: tableRect.top - rootRect.top + root.scrollTop,
      width,
      height,
      rows,
      columns,
      rowHeight: Math.max(MANGO_TIPTAP_TABLE_DEFAULT_ROW_HEIGHT_PX, height / rows),
      columnWidth: Math.max(MANGO_TIPTAP_TABLE_DEFAULT_COLUMN_WIDTH_PX, width / columns),
    };
  } catch {
    return null;
  }
}

/** Converts a bottom-right drag into whole equal-sized row and column additions. */
export function calculateMangoTiptapTableGrowth(input: {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  rowHeight: number;
  columnWidth: number;
}): MangoTiptapTableGrowth {
  const rowHeight = Math.max(1, input.rowHeight);
  const columnWidth = Math.max(1, input.columnWidth);
  return {
    rows: Math.max(0, Math.floor((input.currentY - input.startY + rowHeight / 2) / rowHeight)),
    columns: Math.max(0, Math.floor((input.currentX - input.startX + columnWidth / 2) / columnWidth)),
  };
}

/** Adds the previewed table area in one ProseMirror transaction and resets all columns to equal widths. */
export function growMangoTiptapTable(editor: Editor, growth: MangoTiptapTableGrowth): boolean {
  const rows = Math.max(0, Math.trunc(growth.rows));
  const columns = Math.max(0, Math.trunc(growth.columns));
  if (rows === 0 && columns === 0) return false;
  let chain = editor.chain();
  for (let index = 0; index < columns; index += 1) chain = chain.addColumnAfter();
  for (let index = 0; index < rows; index += 1) chain = chain.addRowAfter();
  chain = chain.command(({ tr }) => {
    const { $from } = tr.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const table = $from.node(depth);
      if (table.type.name !== "table") continue;
      const tablePosition = $from.before(depth);
      table.descendants((node, offset) => {
        if (node.type.name !== "tableCell" && node.type.name !== "tableHeader") return;
        if (node.attrs.colwidth == null) return;
        tr.setNodeMarkup(tablePosition + 1 + offset, undefined, { ...node.attrs, colwidth: null });
      });
      return true;
    }
    return false;
  });
  return chain.run();
}
