import { Extension, Node, mergeAttributes, textInputRule, type AnyExtension, type Editor, type Extensions, type JSONContent } from "@tiptap/core";
import { FileHandler } from "@tiptap/extension-file-handler";
import Highlight from "@tiptap/extension-highlight";
import Mention from "@tiptap/extension-mention";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createEditorEntityIconElement, editorEntityTypeLabel } from "../editorEntityLinks.js";
import { EDITOR_MENTION_MENU_VISIBLE_ROWS, mentionUserProfileColor } from "../editorMentions.js";
import { normalizeEditorHighlightColor } from "../richTextEditing.js";
import { getCurrentEditorTraceContext, traceEditorFunction } from "../editorTrace.js";
import type { EditorOutlineStyleID } from "../plainTextEditing.js";
import type { MangoTiptapDocument } from "./mangoTiptapDocument.js";

export { Editor as MangoTiptapEditorEngine } from "@tiptap/core";

const mangoBlockNodeNames = [
  "paragraph", "heading", "blockquote", "codeBlock", "horizontalRule",
  "bulletList", "orderedList", "listItem", "taskList", "taskItem", "table",
];
const mangoBlockNodeNameSet = new Set(mangoBlockNodeNames);

function newBlockID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `mango-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readableBlockID(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "";
}

function unusedBlockID(used: Set<string>): string {
  let blockID = newBlockID();
  while (used.has(blockID)) blockID = newBlockID();
  used.add(blockID);
  return blockID;
}

/**
 * Keeps the first occurrence of each valid block ID and replaces missing or
 * repeated IDs. This is used once when canonical or recovery JSON enters an
 * editor, so older snapshots remain readable without saving merely on open.
 */
export function normalizeMangoTiptapBlockIDs(document: JSONContent): JSONContent {
  const used = new Set<string>();
  const normalizeNode = (node: JSONContent): JSONContent => {
    let next = node;
    if (mangoBlockNodeNameSet.has(node.type ?? "")) {
      const currentBlockID = readableBlockID(node.attrs?.blockId);
      if (!currentBlockID || used.has(currentBlockID)) {
        next = { ...next, attrs: { ...next.attrs, blockId: unusedBlockID(used) } };
      } else {
        used.add(currentBlockID);
      }
    }
    if (node.content) {
      let contentChanged = false;
      const content = node.content.map((child) => {
        const normalized = normalizeNode(child);
        if (normalized !== child) contentChanged = true;
        return normalized;
      });
      if (contentChanged) next = { ...next, content };
    }
    return next;
  };
  return normalizeNode(document);
}

function restoreLegacyMangoEntityLinkTypes(document: JSONContent): JSONContent {
  const restoreNode = (node: JSONContent): JSONContent => {
    let next = node;
    if (
      node.type === "mangoEntityLink"
      && !Object.prototype.hasOwnProperty.call(node.attrs ?? {}, "entityType")
    ) {
      next = { ...next, attrs: { ...next.attrs, entityType: "node" } };
    }
    if (node.content) {
      let contentChanged = false;
      const content = node.content.map((child) => {
        const restored = restoreNode(child);
        if (restored !== child) contentChanged = true;
        return restored;
      });
      if (contentChanged) next = { ...next, content };
    }
    return next;
  };
  return restoreNode(document);
}

export function repairMangoTiptapRecoveredDocument(document: MangoTiptapDocument): MangoTiptapDocument {
  const restoredDocument = restoreLegacyMangoEntityLinkTypes(document.document);
  const normalizedDocument = normalizeMangoTiptapBlockIDs(restoredDocument);
  return normalizedDocument === document.document
    ? document
    : { ...document, document: normalizedDocument };
}

type MangoBlockRange = { from: number; to: number };
type MangoBlockEntry = { position: number; blockID: string };
type MangoBlockIDCounts = ReadonlyMap<string, number>;

const mangoBlockIdentityKey = new PluginKey<MangoBlockIDCounts>("mangoBlockIdentity");

function mergeMangoBlockRanges(ranges: MangoBlockRange[]): MangoBlockRange[] {
  const sorted = ranges
    .filter(({ from, to }) => to >= from)
    .sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: MangoBlockRange[] = [];
  sorted.forEach((range) => {
    const previous = merged[merged.length - 1];
    if (!previous || range.from > previous.to) {
      merged.push({ ...range });
      return;
    }
    previous.to = Math.max(previous.to, range.to);
  });
  return merged;
}

function expandedMangoBlockRange(from: number, to: number, documentSize: number): MangoBlockRange {
  return {
    from: Math.max(0, Math.min(from, to) - 1),
    to: Math.min(documentSize, Math.max(Math.min(from, to) + 1, Math.max(from, to) + 1)),
  };
}

function mangoTransactionRanges(transaction: Transaction, side: "before" | "after"): MangoBlockRange[] {
  const documentSize = side === "before" ? transaction.before.content.size : transaction.doc.content.size;
  const ranges: MangoBlockRange[] = [];
  transaction.mapping.maps.forEach((stepMap, stepIndex) => {
    stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (side === "before") {
        const earlierSteps = transaction.mapping.slice(0, stepIndex).invert();
        ranges.push(expandedMangoBlockRange(
          earlierSteps.map(oldStart, -1),
          earlierSteps.map(oldEnd, 1),
          documentSize,
        ));
        return;
      }
      const laterSteps = transaction.mapping.slice(stepIndex + 1);
      ranges.push(expandedMangoBlockRange(
        laterSteps.map(newStart, -1),
        laterSteps.map(newEnd, 1),
        documentSize,
      ));
    });
  });
  return mergeMangoBlockRanges(ranges);
}

function mangoFinalChangedRanges(transactions: readonly Transaction[], documentSize: number): MangoBlockRange[] {
  const ranges: MangoBlockRange[] = [];
  transactions.forEach((changedTransaction, transactionIndex) => {
    changedTransaction.mapping.maps.forEach((stepMap, stepIndex) => {
      stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        const laterSteps = changedTransaction.mapping.slice(stepIndex + 1);
        let from = laterSteps.map(newStart, -1);
        let to = laterSteps.map(newEnd, 1);
        for (let laterIndex = transactionIndex + 1; laterIndex < transactions.length; laterIndex += 1) {
          from = transactions[laterIndex].mapping.map(from, -1);
          to = transactions[laterIndex].mapping.map(to, 1);
        }
        ranges.push(expandedMangoBlockRange(from, to, documentSize));
      });
    });
  });
  return mergeMangoBlockRanges(ranges);
}

function mangoBlockEntries(document: ProseMirrorNode, ranges: readonly MangoBlockRange[]): MangoBlockEntry[] {
  const entries: MangoBlockEntry[] = [];
  const seenPositions = new Set<number>();
  const collect: Parameters<typeof document.nodesBetween>[2] = (node, position) => {
    if (!mangoBlockNodeNameSet.has(node.type.name) || seenPositions.has(position)) return;
    seenPositions.add(position);
    entries.push({ position, blockID: readableBlockID(node.attrs.blockId) });
  };
  ranges.forEach(({ from, to }) => document.nodesBetween(from, to, collect));
  return entries;
}

function allMangoBlockIDCounts(document: ProseMirrorNode): MangoBlockIDCounts {
  const counts = new Map<string, number>();
  mangoBlockEntries(document, [{ from: 0, to: document.content.size }]).forEach(({ blockID }) => {
    if (blockID) counts.set(blockID, (counts.get(blockID) ?? 0) + 1);
  });
  return counts;
}

function updatedMangoBlockIDCounts(transaction: Transaction, current: MangoBlockIDCounts): MangoBlockIDCounts {
  if (!transaction.docChanged) return current;
  const counts = new Map(current);
  mangoBlockEntries(transaction.before, mangoTransactionRanges(transaction, "before")).forEach(({ blockID }) => {
    if (!blockID) return;
    const nextCount = (counts.get(blockID) ?? 0) - 1;
    if (nextCount > 0) counts.set(blockID, nextCount);
    else counts.delete(blockID);
  });
  mangoBlockEntries(transaction.doc, mangoTransactionRanges(transaction, "after")).forEach(({ blockID }) => {
    if (blockID) counts.set(blockID, (counts.get(blockID) ?? 0) + 1);
  });
  return counts;
}
function parsedNumberAttribute(element: HTMLElement, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function readMangoTiptapSelectionState(editor: Editor) {
  const selection = editor.state.selection;
  const caretMarks = selection.empty
    ? (editor.state.storedMarks ?? selection.$from.nodeBefore?.marks ?? selection.$from.marks())
    : null;
  const caretMark = (name: string) => caretMarks?.find((mark) => mark.type.name === name);
  const markAttributes = (name: string) => caretMark(name)?.attrs ?? editor.getAttributes(name);
  const fontSizeValue = String(markAttributes("textStyle").fontSize || "15").replace("px", "");
  const selectedNode = (selection as unknown as { node?: { type?: { name?: string }; attrs?: { alignment?: string } } }).node;
  const selectedImageAlignment = selectedNode?.type?.name === "mangoAttachmentImage"
    ? selectedNode.attrs?.alignment
    : undefined;
  const alignment = selectedImageAlignment
    || editor.getAttributes("paragraph").textAlign
    || editor.getAttributes("heading").textAlign
    || "left";
  return {
    fontSize: Number(fontSizeValue) || 15,
    highlightColor: normalizeEditorHighlightColor(String(markAttributes("highlight").color || "")),
    textAlignment: ["left", "center", "right"].includes(alignment) ? alignment as "left" | "center" | "right" : "left" as const,
    bold: caretMarks ? Boolean(caretMark("bold")) : editor.isActive("bold"),
    underline: caretMarks ? Boolean(caretMark("underline")) : editor.isActive("underline"),
    italic: caretMarks ? Boolean(caretMark("italic")) : editor.isActive("italic"),
    strikethrough: caretMarks ? Boolean(caretMark("strike")) : editor.isActive("strike"),
  };
}

export function indentMangoTiptapSelection(editor: Editor): boolean {
  if (editor.isActive("taskItem")) return editor.chain().focus().sinkListItem("taskItem").run();
  if (editor.isActive("listItem")) return editor.chain().focus().sinkListItem("listItem").run();
  return updateCurrentMangoTiptapIndent(editor, 1);
}

export function outdentMangoTiptapSelection(editor: Editor): boolean {
  if (editor.isActive("taskItem")) return editor.chain().focus().liftListItem("taskItem").run();
  if (editor.isActive("listItem")) return editor.chain().focus().liftListItem("listItem").run();
  return updateCurrentMangoTiptapIndent(editor, -1);
}

function updateCurrentMangoTiptapIndent(editor: Editor, delta: -1 | 1): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== "paragraph" && node.type.name !== "heading") continue;
    const current = Number.isFinite(Number(node.attrs.indentLevel)) ? Math.max(0, Math.trunc(Number(node.attrs.indentLevel))) : 0;
    const next = Math.max(0, Math.min(12, current + delta));
    if (next === current) return false;
    const position = $from.before(depth);
    const transaction = editor.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, indentLevel: next });
    editor.view.dispatch(transaction);
    return true;
  }
  return false;
}

/**
 * Starts the structural outline selected in the shared toolbar. Existing list
 * items keep their own list kind and use Tiptap's normal Enter behavior.
 */
export function handleMangoTiptapOutlineEnter(editor: Editor, outlineStyle: EditorOutlineStyleID): boolean {
  if (!editor.state.selection.empty) return false;
  const { $from } = editor.state.selection;
  const currentBlock = $from.parent;
  const empty = currentBlock.isTextblock && currentBlock.content.size === 0;
  if (editor.isActive("taskItem")) return empty ? false : editor.commands.splitListItem("taskItem");
  if (editor.isActive("listItem")) return empty ? false : editor.commands.splitListItem("listItem");
  if (!editor.isActive("paragraph") && !editor.isActive("heading")) return false;

  if (outlineStyle === "indent-guides") return false;
  if (outlineStyle === "automatic-outline-numbering") {
    return empty ? editor.commands.toggleOrderedList() : false;
  }

  const startList = () => outlineStyle === "checklist"
    ? editor.commands.toggleTaskList()
    : editor.commands.toggleBulletList();
  if (empty) return startList();
  return outlineStyle === "checklist"
    ? editor.chain().splitBlock().toggleTaskList().run()
    : editor.chain().splitBlock().toggleBulletList().run();
}

/**
 * Removes an empty list marker without letting ProseMirror lift the blocks that
 * follow it through several list nesting levels. Older saved documents can
 * contain those blocks as additional children of the empty list item.
 */
function handleMangoTiptapEmptyListItemDelete(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.content.size !== 0 || $from.parentOffset !== 0) return false;

  let itemDepth = -1;
  for (let depth = $from.depth - 1; depth > 0; depth -= 1) {
    const nodeName = $from.node(depth).type.name;
    if (nodeName === "listItem" || nodeName === "taskItem") {
      itemDepth = depth;
      break;
    }
  }
  if (itemDepth < 1) return false;

  const item = $from.node(itemDepth);
  if ($from.index(itemDepth) !== 0 || item.firstChild !== $from.parent) return false;
  const listDepth = itemDepth - 1;
  const list = $from.node(listDepth);
  const validList = item.type.name === "taskItem"
    ? list.type.name === "taskList"
    : list.type.name === "bulletList" || list.type.name === "orderedList";
  if (!validList) return false;

  const itemIndex = $from.index(listDepth);
  const beforeItems: ProseMirrorNode[] = [];
  const afterItems: ProseMirrorNode[] = [];
  const trailingBlocks: ProseMirrorNode[] = [];
  for (let index = 0; index < itemIndex; index += 1) beforeItems.push(list.child(index));
  for (let index = itemIndex + 1; index < list.childCount; index += 1) afterItems.push(list.child(index));
  for (let index = 1; index < item.childCount; index += 1) trailingBlocks.push(item.child(index));

  const listStart = $from.before(listDepth);
  const replacement: ProseMirrorNode[] = [];
  let selectionPosition = listStart + 1;
  let selectionBias: -1 | 1 = 1;
  const createList = (items: ProseMirrorNode[], startOffset = 0) => {
    const attrs = { ...list.attrs };
    if (list.type.name === "orderedList" && startOffset > 0) {
      attrs.start = Math.max(1, Number(list.attrs.start) || 1) + startOffset;
    }
    return list.type.create(attrs, Fragment.fromArray(items), list.marks);
  };

  if (trailingBlocks.length > 0 && beforeItems.length > 0) {
    const previousItem = beforeItems[beforeItems.length - 1];
    const previousContent: ProseMirrorNode[] = [];
    previousItem.forEach((child) => previousContent.push(child));
    const earlierItems = beforeItems.slice(0, -1);
    selectionPosition = listStart
      + earlierItems.reduce((size, node) => size + node.nodeSize, 0)
      + previousItem.content.size
      + 3;
    const joinedPreviousItem = previousItem.copy(Fragment.fromArray([...previousContent, ...trailingBlocks]));
    replacement.push(createList([...earlierItems, joinedPreviousItem, ...afterItems]));
  } else if (trailingBlocks.length === 0) {
    const remainingItems = [...beforeItems, ...afterItems];
    if (remainingItems.length > 0) {
      const remainingList = createList(remainingItems);
      replacement.push(remainingList);
      if (beforeItems.length > 0) {
        selectionPosition = listStart + beforeItems.reduce((size, node) => size + node.nodeSize, 1) - 1;
        selectionBias = -1;
      }
    } else {
      const paragraph = editor.state.schema.nodes.paragraph?.createAndFill();
      if (!paragraph) return false;
      replacement.push(paragraph);
    }
  } else {
    selectionPosition = listStart + 1;
    replacement.push(...trailingBlocks);
    if (afterItems.length > 0) {
      replacement.push(createList(afterItems, itemIndex + 1));
    }
  }

  const transaction = editor.state.tr.replaceWith(
    listStart,
    listStart + list.nodeSize,
    Fragment.fromArray(replacement),
  );
  const boundedSelectionPosition = Math.max(0, Math.min(transaction.doc.content.size, selectionPosition));
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(boundedSelectionPosition), selectionBias));
  editor.view.dispatch(transaction);
  return true;
}

const MangoEmptyListItemDeletion = Extension.create({
  name: "mangoEmptyListItemDeletion",
  priority: 200,

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => handleMangoTiptapEmptyListItemDelete(editor),
      Delete: ({ editor }) => handleMangoTiptapEmptyListItemDelete(editor),
    };
  },
});

export type MangoAttachmentImageAttributes = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  displayWidth: number | null;
  displayHeight: number | null;
  alignment: "left" | "center" | "right";
  position: "inline" | "break";
  layout: "content" | "wide";
  alt: string;
  title: string;
  linkHref: string;
  linkTarget: string;
  linkRel: string;
  linkTitle: string;
};

export const MangoAttachmentImage = Node.create({
  name: "mangoAttachmentImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      attachmentId: { default: "", parseHTML: (element) => element.getAttribute("data-attachment-id") ?? "" },
      filename: { default: "", parseHTML: (element) => element.getAttribute("data-filename") ?? "" },
      mimeType: { default: "", parseHTML: (element) => element.getAttribute("data-mime-type") ?? "" },
      width: { default: null, parseHTML: (element) => parsedNumberAttribute(element, "data-width") },
      height: { default: null, parseHTML: (element) => parsedNumberAttribute(element, "data-height") },
      displayWidth: { default: null, parseHTML: (element) => parsedNumberAttribute(element, "data-display-width") },
      displayHeight: { default: null, parseHTML: (element) => parsedNumberAttribute(element, "data-display-height") },
      alignment: {
        default: "left",
        parseHTML: (element) => ["left", "center", "right"].includes(element.getAttribute("data-alignment") ?? "") ? element.getAttribute("data-alignment") : "left",
      },
      position: {
        default: "break",
        parseHTML: (element) => ["inline", "break"].includes(element.getAttribute("data-position") ?? "") ? element.getAttribute("data-position") : "break",
      },
      layout: {
        default: "content",
        parseHTML: (element) => ["content", "wide"].includes(element.getAttribute("data-layout") ?? "") ? element.getAttribute("data-layout") : "content",
      },
      alt: { default: "", parseHTML: (element) => element.getAttribute("aria-label") ?? "" },
      title: { default: "", parseHTML: (element) => element.getAttribute("title") ?? "" },
      linkHref: { default: "", parseHTML: (element) => element.getAttribute("data-link-href") ?? "" },
      linkTarget: { default: "", parseHTML: (element) => element.getAttribute("data-link-target") ?? "" },
      linkRel: { default: "", parseHTML: (element) => element.getAttribute("data-link-rel") ?? "" },
      linkTitle: { default: "", parseHTML: (element) => element.getAttribute("data-link-title") ?? "" },
    };
  },

  parseHTML() {
    return [{ tag: "mango-attachment-image[data-attachment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { attachmentId, filename, mimeType, width, height, displayWidth, displayHeight, alignment, position, layout, alt, title, linkHref, linkTarget, linkRel, linkTitle } = HTMLAttributes;
    return ["mango-attachment-image", mergeAttributes({
      "data-attachment-id": attachmentId,
      "data-filename": filename,
      "data-mime-type": mimeType,
      "data-width": width,
      "data-height": height,
      "data-display-width": displayWidth,
      "data-display-height": displayHeight,
      "data-alignment": alignment,
      "data-position": position,
      "data-layout": layout,
      "data-link-href": linkHref,
      "data-link-target": linkTarget,
      "data-link-rel": linkRel,
      "data-link-title": linkTitle,
      "aria-label": alt || filename || "Attached image",
      title,
    })];
  },
});

export const MangoBlockIdentity = Extension.create({
  name: "mangoBlockIdentity",

  addGlobalAttributes() {
    return [{
      types: mangoBlockNodeNames,
      attributes: {
        blockId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-block-id"),
          renderHTML: (attributes) => attributes.blockId ? { "data-mango-block-id": attributes.blockId } : {},
        },
      },
    }, {
      types: ["paragraph", "heading"],
      attributes: {
        indentLevel: {
          default: 0,
          parseHTML: (element) => Number(element.getAttribute("data-indent-level") || 0),
          renderHTML: (attributes) => attributes.indentLevel
            ? { "data-indent-level": attributes.indentLevel, style: `margin-left: ${Number(attributes.indentLevel) * 24}px` }
            : {},
        },
      },
    }, {
      types: ["table"],
      attributes: {
        style: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-table-layout"),
          renderHTML: (attributes) => attributes.style === "fixed"
            ? { "data-mango-table-layout": "fixed", style: "table-layout: fixed" }
            : {},
        },
      },
    }, {
      types: ["tableCell", "tableHeader"],
      attributes: {
        align: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-cell-align"),
          renderHTML: (attributes) => ["left", "center", "right"].includes(attributes.align)
            ? { "data-mango-cell-align": attributes.align, style: `text-align: ${attributes.align}` }
            : {},
        },
        backgroundColor: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-cell-background"),
          renderHTML: (attributes) => typeof attributes.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(attributes.backgroundColor)
            ? { "data-mango-cell-background": attributes.backgroundColor, style: `background-color: ${attributes.backgroundColor}` }
            : {},
        },
      },
    }];
  },

  addProseMirrorPlugins() {
    return [new Plugin({
      key: mangoBlockIdentityKey,
      state: {
        init: (_configuration, state) => allMangoBlockIDCounts(state.doc),
        apply: (transaction, current) => updatedMangoBlockIDCounts(transaction, current),
      },
      appendTransaction: (transactions, _oldState, newState) => traceEditorFunction(
        getCurrentEditorTraceContext(),
        "plugin.block_identity.append_transaction",
        "prosemirror.plugin",
        () => {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const changedRanges = mangoFinalChangedRanges(transactions, newState.doc.content.size);
        const changedBlocks = mangoBlockEntries(newState.doc, changedRanges);
        const counts = mangoBlockIdentityKey.getState(newState);
        if (!counts) return null;
        const usedBlockIDs = new Set(counts.keys());
        const transaction = newState.tr;
        const assignFreshBlockID = (position: number) => {
          const node = transaction.doc.nodeAt(position);
          if (!node || !mangoBlockNodeNameSet.has(node.type.name)) return;
          transaction.setNodeMarkup(position, undefined, { ...node.attrs, blockId: unusedBlockID(usedBlockIDs) });
        };
        changedBlocks.filter(({ blockID }) => !blockID).forEach(({ position }) => assignFreshBlockID(position));
        const occurrencesByID = new Map<string, MangoBlockEntry[]>();
        changedBlocks.forEach((entry) => {
          if (!entry.blockID) return;
          const occurrences = occurrencesByID.get(entry.blockID) ?? [];
          occurrences.push(entry);
          occurrencesByID.set(entry.blockID, occurrences);
        });
        occurrencesByID.forEach((occurrences, blockID) => {
          const totalOccurrences = counts.get(blockID) ?? occurrences.length;
          if (totalOccurrences <= 1) return;
          const unchangedOccurrences = Math.max(0, totalOccurrences - occurrences.length);
          const firstReplacement = unchangedOccurrences > 0 ? 0 : 1;
          occurrences.slice(firstReplacement).forEach(({ position }) => assignFreshBlockID(position));
        });
        return transaction.steps.length > 0 ? transaction : null;
        },
        {
          transaction_count: transactions.length,
          changed_transaction_count: transactions.filter((transaction) => transaction.docChanged).length,
          document_size: newState.doc.content.size,
        },
      ),
    })];
  },
});

export const MangoArrowTypography = Extension.create({
  name: "mangoArrowTypography",

  addInputRules() {
    return [
      textInputRule({ find: /->$/, replace: "\u2192" }),
      textInputRule({ find: /<-$/, replace: "\u2190" }),
    ];
  },
});

type MangoPasteLoadingMeta = {
  add?: { id: string; position: number; previewURL?: string; imageCount: number };
  remove?: string;
};

const mangoPasteLoadingKey = new PluginKey<DecorationSet>("mangoPasteLoading");

const MangoPasteLoading = Extension.create({
  name: "mangoPasteLoading",

  addProseMirrorPlugins() {
    return [new Plugin({
      key: mangoPasteLoadingKey,
      state: {
        init: () => DecorationSet.empty,
        apply: (transaction, current) => traceEditorFunction(
          getCurrentEditorTraceContext(),
          "plugin.paste_loading.apply",
          "prosemirror.plugin",
          () => {
          let next = current.map(transaction.mapping, transaction.doc);
          const meta = transaction.getMeta(mangoPasteLoadingKey) as MangoPasteLoadingMeta | undefined;
          if (meta?.remove) {
            next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove));
          }
          if (meta?.add) {
            const { id, previewURL, imageCount } = meta.add;
            const position = Math.max(0, Math.min(meta.add.position, transaction.doc.content.size));
            const widget = Decoration.widget(position, (view) => {
              const ownerDocument = view.dom.ownerDocument;
              const loading = ownerDocument.createElement("span");
              loading.className = "mango-tiptap-paste-loading";
              loading.contentEditable = "false";
              loading.dataset.mangoTiptapPasteLoading = "true";
              loading.setAttribute("role", "status");
              if (previewURL) {
                const preview = ownerDocument.createElement("img");
                preview.src = previewURL;
                preview.alt = "";
                loading.append(preview);
              }
              const label = ownerDocument.createElement("span");
              label.textContent = imageCount === 1 ? "Loading image…" : `Loading ${imageCount} images…`;
              loading.append(label);
              return loading;
            }, { id, side: -1 });
            next = next.add(transaction.doc, [widget]);
          }
          return next;
          }, {
            doc_changed: transaction.docChanged,
            has_meta: Boolean(transaction.getMeta(mangoPasteLoadingKey)),
            document_size: transaction.doc.content.size,
          },
        ),
      },
      props: {
        decorations: (state) => mangoPasteLoadingKey.getState(state),
      },
    })];
  },
});

export function showMangoTiptapPasteLoading(
  editor: Editor,
  id: string,
  position: number,
  imageCount: number,
  previewURL?: string,
): void {
  editor.view.dispatch(editor.state.tr.setMeta(mangoPasteLoadingKey, {
    add: { id, position, imageCount, previewURL },
  } satisfies MangoPasteLoadingMeta));
}

export function hideMangoTiptapPasteLoading(editor: Editor, id: string): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(mangoPasteLoadingKey, {
    remove: id,
  } satisfies MangoPasteLoadingMeta));
}

type MangoMentionSuggestionItem = {
  id: string;
  userId: string;
  label: string;
  email?: string;
};

function mentionInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`).toUpperCase();
}

const SUGGESTION_ROW_HEIGHT_PX = 42;
const SUGGESTION_MENU_BORDER_PX = 2;
const SUGGESTION_ROW_GAP_PX = 3;
const SUGGESTION_MENU_VERTICAL_PADDING_PX = 12;

function positionSuggestionMenu(menu: HTMLDivElement, visibleRows: number, clientRect?: (() => DOMRect | null) | null) {
  const rect = clientRect?.();
  if (!rect) return;
  const ownerDocument = menu.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const viewportWidth = ownerDocument.documentElement.clientWidth || ownerWindow?.innerWidth || 0;
  const viewportHeight = ownerDocument.documentElement.clientHeight || ownerWindow?.innerHeight || 0;
  const menuWidth = Math.max(menu.offsetWidth, 280);
  const left = Math.max(8, Math.min(rect.left, viewportWidth - menuWidth - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(rect.bottom + 7)}px`;
  const desiredHeight = (visibleRows * SUGGESTION_ROW_HEIGHT_PX)
    + ((visibleRows - 1) * SUGGESTION_ROW_GAP_PX) + SUGGESTION_MENU_VERTICAL_PADDING_PX + SUGGESTION_MENU_BORDER_PX;
  const availableHeight = viewportHeight > 0 ? Math.max(88, viewportHeight - rect.bottom - 16) : desiredHeight;
  menu.style.maxHeight = `${Math.min(desiredHeight, availableHeight)}px`;
  menu.dataset.visibleRows = String(visibleRows);
  menu.dataset.side = "bottom";
}

function suggestionMenuPortalTarget(
  props: { editor?: { view?: { dom?: HTMLElement } } },
  ownerDocument: Document,
): HTMLElement {
  const editorDOM = props.editor?.view?.dom;
  return editorDOM?.closest<HTMLElement>('[data-mango-modal-layer="true"]') ?? ownerDocument.body;
}

function createSuggestionMenu(label: string, dataAttribute: string): HTMLDivElement {
  const menu = document.createElement("div");
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", label);
  menu.setAttribute(dataAttribute, "true");
  menu.className = "mango-tiptap-suggestion-menu";
  menu.style.position = "fixed";
  menu.style.zIndex = "2100";
  return menu;
}

function followSuggestionMenuAnchor(
  menu: HTMLDivElement,
  visibleRows: number,
  readClientRect: () => DOMRect | null,
): () => void {
  const ownerWindow = menu.ownerDocument.defaultView;
  if (!ownerWindow) return () => undefined;
  const reposition = () => positionSuggestionMenu(menu, visibleRows, readClientRect);
  ownerWindow.addEventListener("scroll", reposition, true);
  ownerWindow.addEventListener("resize", reposition);
  return () => {
    ownerWindow.removeEventListener("scroll", reposition, true);
    ownerWindow.removeEventListener("resize", reposition);
  };
}
export type MangoTiptapExtensionOptions = {
  editable: boolean;
  onImageFiles?: (files: File[], position: number | null) => void;
  attachmentImageExtension?: AnyExtension;
  mentionUsers?: ReadonlyArray<{ userID: string; name: string; email?: string }>;
  getMentionUsers?: () => ReadonlyArray<{ userID: string; name: string; email?: string }>;
};

export function createMangoTiptapExtensions(options: MangoTiptapExtensionOptions): Extensions {
  const extensions: Extensions = [
    MangoEmptyListItemDeletion,
    StarterKit.configure({
      link: {
        autolink: true,
        linkOnPaste: true,
        openOnClick: !options.editable,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto", "tel"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      },
      underline: {},
      trailingNode: false,
      undoRedo: { depth: 200, newGroupDelay: 500 },
    }),
    MangoArrowTypography,
    TextStyle,
    FontSize,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({
      table: { resizable: true, allowTableNodeSelection: true },
      tableCell: {},
      tableHeader: {},
      tableRow: {},
    }),
    Mention.extend({
      addAttributes() {
        return {
          userId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-user-id"),
            renderHTML: () => ({}),
          },
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-user-label"),
            renderHTML: () => ({}),
          },
          kind: {
            default: "normal",
            parseHTML: (element) => element.getAttribute("data-mango-mention-kind") ?? "normal",
            renderHTML: () => ({}),
          },
        };
      },
      renderHTML({ node, HTMLAttributes }) {
        return ["span", mergeAttributes(HTMLAttributes, {
          "data-type": "mention",
          "data-mango-user-id": node.attrs.userId,
          "data-mango-user-label": node.attrs.label,
          "data-mango-mention-kind": node.attrs.kind,
          class: `mango-tiptap-mention mango-tiptap-mention--${node.attrs.kind === "urgent" ? "urgent" : "normal"}`,
        }), `${node.attrs.kind === "urgent" ? "!" : "@"}${String(node.attrs.label || "user")}`];
      },
    }).configure({
      HTMLAttributes: { class: "mango-tiptap-mention" },
      renderText: ({ node }) => `${node.attrs.kind === "urgent" ? "!" : "@"}${String(node.attrs.label || "user")}`,
      deleteTriggerWithBackspace: true,
      suggestions: (["normal", "urgent"] as const).map((kind) => ({
        char: kind === "urgent" ? "!" : "@",
        items: ({ query }) => {
          const normalized = query.trim().toLowerCase();
          const users = options.getMentionUsers?.() ?? options.mentionUsers ?? [];
          return users
            .filter((user) => !normalized || user.name.toLowerCase().includes(normalized) || user.email?.toLowerCase().includes(normalized))
            .slice(0, 20)
            .map((user) => ({ id: user.userID, userId: user.userID, label: user.name, email: user.email }));
        },
        command: ({ editor, range, props }) => {
          const value = props as { userId?: string; id?: string; label?: string };
          editor.chain().focus().insertContentAt(range, [{
            type: "mention",
            attrs: { userId: value.userId || value.id, label: value.label || "user", kind },
          }, { type: "text", text: " " }]).run();
        },
        render: () => {
          let menu: HTMLDivElement | null = null;
          let selectedIndex = 0;
          let current: { items: MangoMentionSuggestionItem[]; command: (item: unknown) => void; clientRect?: (() => DOMRect | null) | null } | null = null;
          let stopFollowingAnchor: () => void = () => undefined;
          const close = () => {
            stopFollowingAnchor();
            stopFollowingAnchor = () => undefined;
            menu?.remove();
            menu = null;
            current = null;
          };
          const paint = () => {
            if (!menu || !current) return;
            menu.replaceChildren();
            const items = current.items;
            selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, items.length - 1)));
            items.forEach((item, index) => {
              const button = document.createElement("button");
              button.type = "button";
              button.setAttribute("role", "option");
              button.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
              button.className = "mango-tiptap-suggestion-option mango-tiptap-suggestion-option--person";
              button.dataset.mangoMentionKind = kind;
              const color = mentionUserProfileColor({
                user_id: item.userId,
                display_name: item.label,
                email: item.email,
              });
              const avatar = document.createElement("span");
              avatar.className = "mango-tiptap-suggestion-avatar";
              avatar.textContent = mentionInitials(item.label);
              avatar.style.background = color.background;
              avatar.style.color = color.foreground;
              avatar.style.borderColor = color.border;
              const details = document.createElement("span");
              details.className = "mango-tiptap-suggestion-copy";
              const label = document.createElement("span");
              label.className = "mango-tiptap-suggestion-label";
              label.textContent = item.label;
              const email = document.createElement("span");
              email.className = "mango-tiptap-suggestion-meta";
              email.textContent = item.email || (kind === "urgent" ? "Urgent mention" : "Mention");
              details.append(label, email);
              button.append(avatar, details);
              button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                current?.command(item);
              });
              menu?.appendChild(button);
            });
            positionSuggestionMenu(menu, EDITOR_MENTION_MENU_VISIBLE_ROWS, current.clientRect);
          };
          return {
            onStart: (props) => {
              if (typeof document === "undefined") return;
              close();
              current = props as unknown as typeof current;
              menu = createSuggestionMenu(kind === "urgent" ? "Urgently mention people" : "Mention people", "data-mango-tiptap-mention-menu");
              menu.classList.add(`mango-tiptap-suggestion-menu--${kind}`);
              suggestionMenuPortalTarget(props, document).appendChild(menu);
              stopFollowingAnchor = followSuggestionMenuAnchor(
                menu,
                EDITOR_MENTION_MENU_VISIBLE_ROWS,
                () => current?.clientRect?.() ?? null,
              );
              paint();
            },
            onUpdate: (props) => {
              current = props as unknown as typeof current;
              selectedIndex = 0;
              paint();
            },
            onKeyDown: ({ event }) => {
              if (!current) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                selectedIndex = (selectedIndex + direction + current.items.length) % Math.max(1, current.items.length);
                paint();
                return true;
              }
              if ((event.key === "Enter" || event.key === "Tab") && current.items[selectedIndex]) {
                event.preventDefault();
                current.command(current.items[selectedIndex]);
                return true;
              }
              if (event.key === "Escape") {
                close();
                return true;
              }
              return false;
            },
            onExit: close,
          };
        },
      })),
    }),
    Node.create({
      name: "mangoEntityLink",
      group: "inline",
      inline: true,
      atom: true,
      selectable: true,
      addKeyboardShortcuts() {
        return {
          Backspace: () => {
            const { state, view } = this.editor;
            const { selection } = state;
            let from = -1;
            let to = -1;
            let label = "";
            if (selection instanceof NodeSelection && selection.node.type.name === "mangoEntityLink") {
              from = selection.from;
              to = selection.to;
              label = String(selection.node.attrs.label || "Entity");
            } else if (selection.empty && selection.$from.nodeBefore?.type.name === "mangoEntityLink") {
              const entityNode = selection.$from.nodeBefore;
              from = selection.from - entityNode.nodeSize;
              to = selection.from;
              label = String(entityNode.attrs.label || "Entity");
            }
            if (from < 0 || to < from || !label) return false;
            const transaction = state.tr.replaceWith(from, to, state.schema.text(label));
            transaction.setSelection(TextSelection.create(transaction.doc, from + label.length));
            view.dispatch(transaction.scrollIntoView());
            return true;
          },
        };
      },
      addAttributes() {
        return {
          entityType: {
            default: "node",
            parseHTML: (element) => element.getAttribute("data-mango-entity-type") ?? "node",
            renderHTML: () => ({}),
          },
          entityId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-entity-id"),
            renderHTML: () => ({}),
          },
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-entity-label") ?? element.textContent,
            renderHTML: () => ({}),
          },
          emailMessageId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-email-message-id"),
            renderHTML: () => ({}),
          },
          emailThreadId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-email-thread-id"),
            renderHTML: () => ({}),
          },
          emailAccountEmail: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-email-account-email"),
            renderHTML: () => ({}),
          },
          emailSharedInboxId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-email-shared-inbox-id"),
            renderHTML: () => ({}),
          },
          emailMailbox: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-email-mailbox"),
            renderHTML: () => ({}),
          },
        };
      },
      parseHTML() {
        return [{ tag: 'span[data-mango-entity-link="true"]' }, { tag: 'a[data-mango-entity-link="true"]' }];
      },
      renderHTML({ node, HTMLAttributes }) {
        const type = String(node.attrs.entityType || "node");
        const entityType = type === "logic_gate" || type === "project" || type === "email_message" ? type : "node";
        const label = String(node.attrs.label || "Entity");
        const ownerDocument = globalThis.document;
        const icon = ownerDocument
          ? createEditorEntityIconElement(ownerDocument, entityType)
          : ["span", { "aria-hidden": "true", class: `mango-editor-entity-icon mango-editor-entity-icon--${entityType}` }];
        return ["span", mergeAttributes(HTMLAttributes, {
          "data-mango-entity-link": "true",
          "data-mango-entity-type": entityType,
          "data-mango-entity-id": node.attrs.entityId,
          "data-mango-entity-label": label,
          ...(entityType === "email_message" ? {
            "data-mango-email-message-id": node.attrs.emailMessageId || undefined,
            "data-mango-email-thread-id": node.attrs.emailThreadId || undefined,
            "data-mango-email-account-email": node.attrs.emailAccountEmail || undefined,
            "data-mango-email-shared-inbox-id": node.attrs.emailSharedInboxId || undefined,
            "data-mango-email-mailbox": node.attrs.emailMailbox || undefined,
          } : {}),
          role: "link",
          tabindex: "0",
          "aria-label": `Open ${editorEntityTypeLabel(entityType)} ${label}`,
          class: `mango-editor-entity-link mango-editor-entity-link--${entityType}`,
        }), icon, ["span", { class: "mango-editor-entity-label" }, label]];
      },
    }),
    options.attachmentImageExtension ?? MangoAttachmentImage,
    MangoBlockIdentity,
    MangoPasteLoading,
  ];
  if (options.onImageFiles) {
    extensions.push(FileHandler.configure({
      allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      onDrop: (_editor, files, position) => options.onImageFiles?.(files, position),
    }));
  }
  return extensions;
}
