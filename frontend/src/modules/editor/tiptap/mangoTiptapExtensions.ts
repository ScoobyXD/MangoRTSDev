import { Extension, Node, mergeAttributes, type AnyExtension, type Editor, type Extensions } from "@tiptap/core";
import { FileHandler } from "@tiptap/extension-file-handler";
import Highlight from "@tiptap/extension-highlight";
import Mention from "@tiptap/extension-mention";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import { createEditorEntityIconElement, editorEntityTypeLabel, type EditorEntityLink } from "../editorEntityLinks.js";
import { EDITOR_MENTION_MENU_VISIBLE_ROWS, mentionUserProfileColor } from "../editorMentions.js";
import { normalizeEditorHighlightColor } from "../richTextEditing.js";

export { Editor as MangoTiptapEditorEngine } from "@tiptap/core";

const mangoBlockNodeNames = [
  "paragraph", "heading", "blockquote", "codeBlock", "horizontalRule",
  "bulletList", "orderedList", "listItem", "taskList", "taskItem", "table",
];

function newBlockID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `mango-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
  const alignment = editor.getAttributes("paragraph").textAlign || editor.getAttributes("heading").textAlign || "left";
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
  return editor.chain().focus().command(({ tr, state, dispatch }) => {
    if (dispatch) dispatch(tr.insertText("\t", state.selection.from, state.selection.to).scrollIntoView());
    return true;
  }).run();
}

export function outdentMangoTiptapSelection(editor: Editor): boolean {
  if (editor.isActive("taskItem")) return editor.chain().focus().liftListItem("taskItem").run();
  if (editor.isActive("listItem")) return editor.chain().focus().liftListItem("listItem").run();
  const { from, empty } = editor.state.selection;
  if (!empty || from <= 1 || editor.state.doc.textBetween(from - 1, from, "\n", "\n") !== "\t") return false;
  return editor.chain().focus().deleteRange({ from: from - 1, to: from }).run();
}

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
        default: "center",
        parseHTML: (element) => ["left", "center", "right"].includes(element.getAttribute("data-alignment") ?? "") ? element.getAttribute("data-alignment") : "center",
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
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some((transaction) => transaction.docChanged)) return null;
        const transaction = newState.tr;
        newState.doc.descendants((node, position) => {
          if (mangoBlockNodeNames.includes(node.type.name) && !node.attrs.blockId) {
            transaction.setNodeMarkup(position, undefined, { ...node.attrs, blockId: newBlockID() });
          }
        });
        return transaction.steps.length > 0 ? transaction : null;
      },
    })];
  },
});

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
  searchEntityLinks?: (query: string) => Promise<EditorEntityLink[]>;
  onEntityLinkSearchError?: (message: string) => void;
};

export function createMangoTiptapExtensions(options: MangoTiptapExtensionOptions): Extensions {
  const extensions: Extensions = [
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
      undoRedo: { depth: 200, newGroupDelay: 500 },
    }),
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
    Mention.extend({
      name: "mangoEntityLink",
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
        };
      },
      parseHTML() {
        return [{ tag: 'span[data-mango-entity-link="true"]' }, { tag: 'a[data-mango-entity-link="true"]' }];
      },
      renderHTML({ node, HTMLAttributes }) {
        const type = String(node.attrs.entityType || "node");
        const entityType = type === "logic_gate" || type === "project" ? type : "node";
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
          role: "link",
          tabindex: "0",
          "aria-label": `Open ${editorEntityTypeLabel(entityType)} ${label}`,
          class: `mango-editor-entity-link mango-editor-entity-link--${entityType}`,
        }), icon, ["span", { class: "mango-editor-entity-label" }, label]];
      },
    }).configure({
      renderText: ({ node }) => String(node.attrs.label || "Entity"),
      deleteTriggerWithBackspace: false,
      suggestions: [{
        char: "#",
        allowSpaces: true,
        items: async ({ query }) => {
          if (!options.searchEntityLinks) return [];
          try {
            return await options.searchEntityLinks(query);
          } catch (cause) {
            options.onEntityLinkSearchError?.(cause instanceof Error ? cause.message : "Unable to search workspace entities");
            return [];
          }
        },
        command: ({ editor, range, props }) => {
          const entity = props as unknown as EditorEntityLink;
          editor.chain().focus().insertContentAt(range, [{
            type: "mangoEntityLink",
            attrs: { entityType: entity.entityType, entityId: entity.entityID, label: entity.label },
          }, { type: "text", text: " " }]).run();
        },
        render: () => {
          let menu: HTMLDivElement | null = null;
          let selectedIndex = 0;
          let current: { items: EditorEntityLink[]; command: (item: EditorEntityLink) => void; clientRect?: (() => DOMRect | null) | null } | null = null;
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
            selectedIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, current.items.length - 1)));
            current.items.forEach((item, index) => {
              const button = document.createElement("button");
              button.type = "button";
              button.setAttribute("role", "option");
              button.setAttribute("aria-selected", index === selectedIndex ? "true" : "false");
              button.dataset.mangoEditorEntityType = item.entityType;
              button.className = "mango-tiptap-suggestion-option mango-tiptap-suggestion-option--entity";
              const icon = createEditorEntityIconElement(document, item.entityType);
              icon.classList.add("mango-tiptap-suggestion-product-icon");
              const details = document.createElement("span");
              details.className = "mango-tiptap-suggestion-copy";
              const label = document.createElement("span");
              label.className = "mango-tiptap-suggestion-label";
              label.textContent = item.label;
              const type = document.createElement("span");
              type.className = "mango-tiptap-suggestion-meta";
              type.textContent = editorEntityTypeLabel(item.entityType);
              details.append(label, type);
              button.append(icon, details);
              button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                current?.command(item);
              });
              menu?.appendChild(button);
            });
            positionSuggestionMenu(menu, 5, current.clientRect);
          };
          return {
            onStart: (props) => {
              if (typeof document === "undefined") return;
              close();
              current = props as unknown as typeof current;
              menu = createSuggestionMenu("Link a Node, Logic Gate, or Project", "data-mango-tiptap-entity-menu");
              menu.classList.add("mango-tiptap-suggestion-menu--entity");
              suggestionMenuPortalTarget(props, document).appendChild(menu);
              stopFollowingAnchor = followSuggestionMenuAnchor(
                menu,
                5,
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
              if ((event.key === "Enter" || (event.key === "Tab" && !event.shiftKey)) && current.items[selectedIndex]) {
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
      }],
    }),
    options.attachmentImageExtension ?? MangoAttachmentImage,
    MangoBlockIdentity,
  ];
  if (options.onImageFiles) {
    extensions.push(FileHandler.configure({
      allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      consumePasteEvent: true,
      onPaste: (_editor, files) => options.onImageFiles?.(files, null),
      onDrop: (_editor, files, position) => options.onImageFiles?.(files, position),
    }));
  }
  return extensions;
}
