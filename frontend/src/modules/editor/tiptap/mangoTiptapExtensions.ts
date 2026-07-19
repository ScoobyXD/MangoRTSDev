import { Extension, Node, mergeAttributes, type AnyExtension, type Extensions } from "@tiptap/core";
import { FileHandler } from "@tiptap/extension-file-handler";
import Highlight from "@tiptap/extension-highlight";
import Mention from "@tiptap/extension-mention";
import { TableKit } from "@tiptap/extension-table";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import TextAlign from "@tiptap/extension-text-align";
import { Color, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { Plugin } from "@tiptap/pm/state";

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
    };
  },

  parseHTML() {
    return [{ tag: "mango-attachment-image[data-attachment-id]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const { attachmentId, filename, mimeType, width, height, displayWidth, displayHeight, alignment, position, layout, alt, title } = HTMLAttributes;
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

export type MangoTiptapExtensionOptions = {
  editable: boolean;
  onImageFiles?: (files: File[], position: number | null) => void;
  attachmentImageExtension?: AnyExtension;
  mentionUsers?: ReadonlyArray<{ userID: string; name: string; email?: string }>;
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
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
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
        };
      },
      renderHTML({ node, HTMLAttributes }) {
        return ["span", mergeAttributes(HTMLAttributes, {
          "data-type": "mention",
          "data-mango-user-id": node.attrs.userId,
          "data-mango-user-label": node.attrs.label,
          class: "mango-tiptap-mention",
        }), `@${String(node.attrs.label || "user")}`];
      },
    }).configure({
      HTMLAttributes: { class: "mango-tiptap-mention" },
      renderText: ({ node }) => `@${String(node.attrs.label || "user")}`,
      deleteTriggerWithBackspace: true,
      suggestion: {
        items: ({ query }) => {
          const normalized = query.trim().toLowerCase();
          return (options.mentionUsers ?? [])
            .filter((user) => !normalized || user.name.toLowerCase().includes(normalized) || user.email?.toLowerCase().includes(normalized))
            .slice(0, 20)
            .map((user) => ({ id: user.userID, userId: user.userID, label: user.name }));
        },
        command: ({ editor, range, props }) => {
          const value = props as { userId?: string; id?: string; label?: string };
          editor.chain().focus().insertContentAt(range, [{
            type: "mention",
            attrs: { userId: value.userId || value.id, label: value.label || "user" },
          }, { type: "text", text: " " }]).run();
        },
        render: () => {
          let menu: HTMLDivElement | null = null;
          let selectedIndex = 0;
          let current: { items: Array<{ label?: string; userId?: string }>; command: (item: unknown) => void; clientRect?: (() => DOMRect | null) | null } | null = null;
          const close = () => {
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
              button.textContent = item.label || item.userId || "User";
              Object.assign(button.style, {
                display: "block", width: "100%", border: "0", borderRadius: "5px",
                padding: "6px 8px", textAlign: "left", cursor: "pointer",
                background: index === selectedIndex ? "#e0f2fe" : "#ffffff",
              });
              button.addEventListener("mousedown", (event) => {
                event.preventDefault();
                current?.command(item);
              });
              menu?.appendChild(button);
            });
            const rect = current.clientRect?.();
            if (rect) {
              menu.style.left = `${Math.round(rect.left)}px`;
              menu.style.top = `${Math.round(rect.bottom + 4)}px`;
            }
          };
          return {
            onStart: (props) => {
              if (typeof document === "undefined") return;
              close();
              current = props as typeof current;
              menu = document.createElement("div");
              menu.setAttribute("role", "listbox");
              menu.setAttribute("aria-label", "Mention people");
              Object.assign(menu.style, {
                position: "fixed", zIndex: "2100", minWidth: "180px", maxHeight: "240px",
                overflowY: "auto", padding: "4px", border: "1px solid #cbd5e1",
                borderRadius: "8px", background: "#ffffff", boxShadow: "0 8px 24px rgba(15,23,42,.18)",
              });
              document.body.appendChild(menu);
              paint();
            },
            onUpdate: (props) => {
              current = props as typeof current;
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
              if (event.key === "Enter" && current.items[selectedIndex]) {
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
      },
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
