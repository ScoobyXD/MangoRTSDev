import type { Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { handlePaste as handleProseMirrorTablePaste, TableMap } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";
import Papa from "papaparse";

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

const TABLE_CLIPBOARD_MARKUP = /<(?:table|thead|tbody|tfoot|tr|td|th)\b/i;

function normalizedOneRowTableSlice(slice: Slice): Slice {
  const tables: ProseMirrorNode[] = [];
  for (let index = 0; index < slice.content.childCount; index += 1) {
    const node = slice.content.child(index);
    if (node.type.spec.tableRole === "table" && node.childCount === 1) {
      tables.push(node);
    } else {
      return slice;
    }
  }
  if (tables.length < 2) return slice;
  const columns = TableMap.get(tables[0]).width;
  if (!tables.every((table) => TableMap.get(table).width === columns)) return slice;
  const rows = tables.map((table) => table.child(0));
  const table = tables[0].copy(Fragment.from(rows));
  if (TableMap.get(table).problems) return slice;
  return new Slice(Fragment.from(table), 0, 0);
}

function tsvTableSlice(schema: Schema, text: string, explicitTSV: boolean): Slice | null {
  if (!explicitTSV && !text.includes("\t")) return null;
  const parsed = Papa.parse<string[]>(text, { delimiter: "\t", skipEmptyLines: false });
  if (parsed.errors.length > 0) return null;
  const rows = parsed.data.map((row) => row.map((value) => String(value)));
  const lastRow = rows[rows.length - 1];
  if (text.endsWith("\n") && rows.length > 1 && lastRow?.length === 1 && lastRow[0] === "") rows.pop();
  const columns = rows[0]?.length ?? 0;
  if (columns < (explicitTSV ? 1 : 2) || rows.some((row) => row.length !== columns)) return null;
  const tableType = schema.nodes.table;
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  const paragraphType = schema.nodes.paragraph;
  if (!tableType || !rowType || !cellType || !paragraphType) return null;
  const tableRows = rows.map((row) => rowType.create(null, row.map((value) => {
    const paragraphs = value.replace(/\r\n?/g, "\n").split("\n").map((line) => (
      paragraphType.create(null, line ? schema.text(line) : undefined)
    ));
    return cellType.create(null, paragraphs);
  })));
  return new Slice(Fragment.from(tableType.create(null, tableRows)), 0, 0);
}

function insertTableClipboardSlice(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  if (handleProseMirrorTablePaste(view, event, slice)) return true;
  view.dispatch(view.state.tr
    .replaceSelection(slice)
    .scrollIntoView()
    .setMeta("paste", true)
    .setMeta("uiEvent", "paste"));
  return true;
}

/** Normalizes external table-shaped clipboard data, then delegates cell placement to ProseMirror tables. */
export function handleMangoTiptapTableClipboardPaste(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  const normalized = normalizedOneRowTableSlice(slice);
  if (normalized !== slice) return insertTableClipboardSlice(view, event, normalized);
  const clipboardData = event.clipboardData;
  if (!clipboardData || TABLE_CLIPBOARD_MARKUP.test(clipboardData.getData("text/html"))) return false;
  if (view.state.selection.$from.parent.type.spec.code) return false;
  const explicitTSV = clipboardData.getData("text/tab-separated-values");
  const table = tsvTableSlice(view.state.schema, explicitTSV || clipboardData.getData("text/plain"), Boolean(explicitTSV));
  return table ? insertTableClipboardSlice(view, event, table) : false;
}

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
