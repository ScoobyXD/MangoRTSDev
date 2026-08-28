import type { Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from "@tiptap/pm/model";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import {
  addColumn,
  addRow,
  handlePaste as handleProseMirrorTablePaste,
  removeColumn,
  removeRow,
  TableMap,
} from "@tiptap/pm/tables";
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
  minimumRows: number;
  minimumColumns: number;
  rowHeight: number;
  columnWidth: number;
};

export type MangoTiptapTableResize = {
  rows: number;
  columns: number;
};

type ActiveMangoTiptapTable = {
  table: ProseMirrorNode;
  tablePosition: number;
  map: TableMap;
};

type MangoTiptapTableRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  tableStart: number;
  map: TableMap;
  table: ProseMirrorNode;
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

function readActiveMangoTiptapTable(editor: Editor): ActiveMangoTiptapTable | null {
  const { selection } = editor.state;
  if (selection instanceof NodeSelection && selection.node.type.name === "table") {
    return {
      table: selection.node,
      tablePosition: selection.from,
      map: TableMap.get(selection.node),
    };
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const table = $from.node(depth);
    if (table.type.name !== "table") continue;
    return {
      table,
      tablePosition: $from.before(depth),
      map: TableMap.get(table),
    };
  }
  const table = $from.nodeAfter;
  if (table?.type.name !== "table") return null;
  return {
    table,
    tablePosition: $from.pos,
    map: TableMap.get(table),
  };
}

function mangoTiptapTableCellIsEmpty(cell: ProseMirrorNode): boolean {
  return cell.childCount === 1 && cell.firstChild?.isTextblock === true && cell.firstChild.childCount === 0;
}

function readMangoTiptapTableMinimumSize(table: ProseMirrorNode, map: TableMap): { rows: number; columns: number } {
  let rows = 1;
  let columns = 1;
  const visited = new Set<number>();
  for (const position of map.map) {
    if (visited.has(position)) continue;
    visited.add(position);
    const cell = table.nodeAt(position);
    if (!cell || mangoTiptapTableCellIsEmpty(cell)) continue;
    const cellRect = map.findCell(position);
    rows = Math.max(rows, cellRect.top + 1);
    columns = Math.max(columns, cellRect.left + 1);
  }
  return { rows, columns };
}

function readMangoTiptapTableRect(tr: Transaction, tablePosition: number): MangoTiptapTableRect | null {
  const table = tr.doc.nodeAt(tablePosition);
  if (!table || table.type.name !== "table") return null;
  const map = TableMap.get(table);
  return {
    left: 0,
    top: 0,
    right: map.width,
    bottom: map.height,
    tableStart: tablePosition + 1,
    map,
    table,
  };
}

/** Reads the table containing the current editor selection in editor-scroll coordinates. */
export function readActiveMangoTiptapTableFrame(editor: Editor, root: HTMLElement): MangoTiptapTableFrame | null {
  if (!editor.isActive("table")) return null;
  try {
    const activeTable = readActiveMangoTiptapTable(editor);
    if (!activeTable) return null;
    const TableElement = root.ownerDocument.defaultView?.HTMLTableElement;
    const ElementType = root.ownerDocument.defaultView?.Element;
    const tableDOM = editor.view.nodeDOM(activeTable.tablePosition);
    const table = TableElement && tableDOM instanceof TableElement
      ? tableDOM
      : ElementType && tableDOM instanceof ElementType
        ? tableDOM.querySelector("table")
        : null;
    if (!TableElement || !(table instanceof TableElement)) return null;
    const rows = Math.max(1, activeTable.map.height);
    const columns = Math.max(1, activeTable.map.width);
    const minimumSize = readMangoTiptapTableMinimumSize(activeTable.table, activeTable.map);
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
      minimumRows: minimumSize.rows,
      minimumColumns: minimumSize.columns,
      rowHeight: MANGO_TIPTAP_TABLE_DEFAULT_ROW_HEIGHT_PX,
      columnWidth: Math.max(MANGO_TIPTAP_TABLE_DEFAULT_COLUMN_WIDTH_PX, Math.round(width / columns)),
    };
  } catch {
    return null;
  }
}

function quantizeMangoTiptapTableResize(distance: number, cellSize: number): number {
  if (!Number.isFinite(distance) || distance === 0) return 0;
  const cells = Math.floor((Math.abs(distance) + cellSize / 2) / cellSize);
  return cells === 0 ? 0 : Math.sign(distance) * cells;
}

/** Converts a bottom-right drag into safe whole-row and whole-column changes. */
export function calculateMangoTiptapTableResize(input: {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  rows: number;
  columns: number;
  minimumRows: number;
  minimumColumns: number;
  rowHeight: number;
  columnWidth: number;
}): MangoTiptapTableResize {
  const rowHeight = Number.isFinite(input.rowHeight) ? Math.max(1, input.rowHeight) : MANGO_TIPTAP_TABLE_DEFAULT_ROW_HEIGHT_PX;
  const columnWidth = Number.isFinite(input.columnWidth) ? Math.max(1, input.columnWidth) : MANGO_TIPTAP_TABLE_DEFAULT_COLUMN_WIDTH_PX;
  const rows = Number.isFinite(input.rows) ? Math.max(1, Math.trunc(input.rows)) : 1;
  const columns = Number.isFinite(input.columns) ? Math.max(1, Math.trunc(input.columns)) : 1;
  const minimumRows = Number.isFinite(input.minimumRows) ? Math.max(1, Math.min(rows, Math.trunc(input.minimumRows))) : 1;
  const minimumColumns = Number.isFinite(input.minimumColumns) ? Math.max(1, Math.min(columns, Math.trunc(input.minimumColumns))) : 1;
  return {
    rows: Math.max(minimumRows - rows, quantizeMangoTiptapTableResize(input.currentY - input.startY, rowHeight)),
    columns: Math.max(minimumColumns - columns, quantizeMangoTiptapTableResize(input.currentX - input.startX, columnWidth)),
  };
}

/** Applies a safe bottom/right table resize in one ProseMirror transaction. */
export function resizeMangoTiptapTable(editor: Editor, resize: MangoTiptapTableResize, columnWidth: number): boolean {
  const activeTable = readActiveMangoTiptapTable(editor);
  if (!activeTable) return false;
  const minimumSize = readMangoTiptapTableMinimumSize(activeTable.table, activeTable.map);
  const requestedRows = Number.isFinite(resize.rows) ? Math.trunc(resize.rows) : 0;
  const requestedColumns = Number.isFinite(resize.columns) ? Math.trunc(resize.columns) : 0;
  const rows = Math.max(minimumSize.rows - activeTable.map.height, requestedRows);
  const columns = Math.max(minimumSize.columns - activeTable.map.width, requestedColumns);
  if (rows === 0 && columns === 0) return false;
  const originalDocument = editor.state.doc;
  const originalSelection = editor.state.selection;
  const tr = editor.state.tr;
  let rect = readMangoTiptapTableRect(tr, activeTable.tablePosition);
  if (!rect) return false;
  if (columns > 0) {
    for (let index = 0; index < columns; index += 1) addColumn(tr, rect, rect.map.width);
  } else {
    for (let index = 0; index < Math.abs(columns); index += 1) {
      rect = readMangoTiptapTableRect(tr, activeTable.tablePosition);
      if (!rect) return false;
      removeColumn(tr, rect, rect.map.width - 1);
    }
  }
  for (let index = 0; index < Math.abs(rows); index += 1) {
    rect = readMangoTiptapTableRect(tr, activeTable.tablePosition);
    if (!rect) return false;
    if (rows > 0) addRow(tr, rect, rect.map.height);
    else removeRow(tr, rect, rect.map.height - 1);
  }
  const resizedTable = tr.doc.nodeAt(activeTable.tablePosition);
  if (!resizedTable || resizedTable.type.name !== "table") return false;
  const resizedMap = TableMap.get(resizedTable);
  const equalColumnWidth = Number.isFinite(columnWidth)
    ? Math.max(MANGO_TIPTAP_TABLE_DEFAULT_COLUMN_WIDTH_PX, Math.round(columnWidth))
    : MANGO_TIPTAP_TABLE_DEFAULT_COLUMN_WIDTH_PX;
  const visited = new Set<number>();
  for (const position of resizedMap.map) {
    if (visited.has(position)) continue;
    visited.add(position);
    const cell = resizedTable.nodeAt(position);
    if (!cell || (cell.type.name !== "tableCell" && cell.type.name !== "tableHeader")) continue;
    const colwidth = Array.from({ length: Math.max(1, Number(cell.attrs.colspan) || 1) }, () => equalColumnWidth);
    if (Array.isArray(cell.attrs.colwidth) && cell.attrs.colwidth.length === colwidth.length
      && cell.attrs.colwidth.every((width: number, index: number) => width === colwidth[index])) continue;
    tr.setNodeMarkup(activeTable.tablePosition + 1 + position, undefined, { ...cell.attrs, colwidth });
  }
  if (tr.doc.eq(originalDocument)) return false;
  tr.setSelection(originalSelection.map(tr.doc, tr.mapping));
  editor.view.dispatch(tr);
  return true;
}
