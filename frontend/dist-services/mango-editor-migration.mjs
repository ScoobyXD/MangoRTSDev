// scripts/mango-editor-migration.ts
import { createHash as createHash2, randomUUID } from "node:crypto";
import { generateHTML as generateHTML2 } from "@tiptap/html/server";
import pg from "pg";
import * as Y from "yjs";

// scripts/mango-html-to-json-core.ts
import { createHash } from "node:crypto";
import { generateHTML, generateJSON } from "@tiptap/html/server";
import { Window } from "happy-dom";

// src/modules/editor/editorRuntimeMetrics.ts
var metricNames = [
  "active_editors",
  "dirty_editors",
  "listeners",
  "observers",
  "recovery_requests",
  "indexeddb_reads",
  "indexeddb_writes",
  "image_requests",
  "transactions",
  "full_document_serializations",
  "network_saves",
  "conflicts"
];
var metrics = new Map(metricNames.map((name) => [name, 0]));

// src/modules/editor/editorImages.ts
var MAX_STORED_IMAGE_BYTES = 8 * 1024 * 1024;
var MIN_STORED_IMAGE_BYTES = 512 * 1024;
var TARGET_EDITOR_DOCUMENT_HTML_BYTES = 12 * 1024 * 1024;

// src/modules/company-explorer/CompanyExplorerEntityIcon.tsx
import React from "react";
import { jsx } from "react/jsx-runtime";
var SVG_NAMESPACE = "http://www.w3.org/2000/svg";
var SVG_DOM_ATTRIBUTE_NAMES = {
  gradientUnits: "gradientUnits",
  stopColor: "stop-color",
  stopOpacity: "stop-opacity",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeOpacity: "stroke-opacity",
  strokeWidth: "stroke-width"
};
var NODE_BODY_PATH = "M3.7 1.7h5.45l3.15 3.15v9.45H3.7z";
var NODE_DETAIL_PATH = "M9.15 1.7v3.15h3.15M5.55 7.25h4.9M5.55 9.55h4.9M5.55 11.85h3.25";
var PROJECT_BODY_PATH = "M2.3 3.1h11.4v9.8H2.3z";
var PROJECT_DETAIL_PATH = "M4.1 5.25h3.2M4.1 7.85h5.7M4.1 10.45h3.9";
var PROJECT_CHECKS_PATH = "M11.25 5.15h1.3v1.3h-1.3zM11.25 7.45h1.3v1.3h-1.3zM11.25 9.75h1.3v1.3h-1.3z";
var LOGIC_GATE_CONNECTION_PATH = "M1.4 5.25h3.05M1.4 10.75h3.05M11.7 8h2.9";
var LOGIC_GATE_BODY_PATH = "M4.35 3.55h3.35c2.45 0 4.45 1.95 4.45 4.45s-2 4.45-4.45 4.45H4.35z";
function iconSpecs(kind, tone, id) {
  if (kind === "node") {
    const stroke = tone === "inverse" ? "#ffffff" : tone === "orange" ? "#ff9708" : `url(#${id})`;
    return [
      ...tone === "default" ? [{
        tag: "defs",
        attrs: {},
        children: [{
          tag: "linearGradient",
          attrs: { id, x1: "8", y1: "1.7", x2: "8", y2: "14.3", gradientUnits: "userSpaceOnUse" },
          children: [
            { tag: "stop", attrs: { stopColor: "#33ddd5" } },
            { tag: "stop", attrs: { offset: "1", stopColor: "#19a8ff" } }
          ]
        }]
      }] : [],
      { tag: "path", attrs: { d: NODE_BODY_PATH, fill: "none", stroke, strokeWidth: "1.35", strokeLinejoin: "round" } },
      { tag: "path", attrs: { d: NODE_DETAIL_PATH, fill: "none", stroke, strokeWidth: "1.05", strokeLinecap: "round" } }
    ];
  }
  if (kind === "project") {
    const stroke = tone === "inverse" ? "#ffffff" : tone === "orange" ? "#ff9708" : "#2563eb";
    const fill = tone === "inverse" ? "rgba(255,255,255,0.10)" : tone === "orange" ? "rgba(255,151,8,0.10)" : "rgba(37,99,235,0.10)";
    return [
      { tag: "path", attrs: { d: PROJECT_BODY_PATH, fill, stroke, strokeWidth: "1.25", strokeLinejoin: "round" } },
      { tag: "path", attrs: { d: PROJECT_DETAIL_PATH, fill: "none", stroke, strokeWidth: "1.05", strokeLinecap: "round" } },
      { tag: "path", attrs: { d: PROJECT_CHECKS_PATH, fill: stroke } }
    ];
  }
  return [
    {
      tag: "defs",
      attrs: {},
      children: [{
        tag: "linearGradient",
        attrs: { id, x1: "1.4", y1: "3.55", x2: "14.6", y2: "12.45", gradientUnits: "userSpaceOnUse" },
        children: [
          { tag: "stop", attrs: { stopColor: "#7cff9b" } },
          { tag: "stop", attrs: { offset: "0.58", stopColor: "#19f07a" } },
          { tag: "stop", attrs: { offset: "1", stopColor: "#00c86f" } }
        ]
      }]
    },
    {
      tag: "path",
      attrs: { d: LOGIC_GATE_CONNECTION_PATH, fill: "none", stroke: `url(#${id})`, strokeWidth: "1.25", strokeLinecap: "round" }
    },
    {
      tag: "path",
      attrs: { d: LOGIC_GATE_BODY_PATH, fill: "none", stroke: `url(#${id})`, strokeWidth: "1.35", strokeLinejoin: "round" }
    },
    { tag: "circle", attrs: { cx: "4.35", cy: "5.25", r: "0.85", fill: "#19f07a" } },
    { tag: "circle", attrs: { cx: "4.35", cy: "10.75", r: "0.85", fill: "#19f07a" } },
    { tag: "circle", attrs: { cx: "12.15", cy: "8", r: "0.85", fill: "#19f07a" } }
  ];
}
function appendDOMSpec(ownerDocument, parent, spec) {
  const element = ownerDocument.createElementNS(SVG_NAMESPACE, spec.tag);
  Object.entries(spec.attrs).forEach(([name, value]) => {
    element.setAttribute(SVG_DOM_ATTRIBUTE_NAMES[name] ?? name, String(value));
  });
  spec.children?.forEach((child) => appendDOMSpec(ownerDocument, element, child));
  parent.appendChild(element);
}
var explorerEntityDOMIconSequence = 0;
function createExplorerEntityIconElement(ownerDocument, kind, tone = "default") {
  explorerEntityDOMIconSequence += 1;
  const id = `mango-${kind}-dom-icon-${explorerEntityDOMIconSequence}`;
  const svg = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.style.display = "block";
  svg.style.flexShrink = "0";
  iconSpecs(kind, tone, id).forEach((spec) => appendDOMSpec(ownerDocument, svg, spec));
  return svg;
}

// src/auth/cognitoAuth.ts
var COGNITO_PASSWORD_RESET_SECONDS = 60 * 60;
var currentUserCacheGeneration = 0;
function getAuthSessionCacheGeneration() {
  return currentUserCacheGeneration;
}

// src/modules/node-map/NodeRecordStore.ts
var nodeRecordStoreAuthGeneration = getAuthSessionCacheGeneration();

// src/modules/editor/editorEntityLinks.ts
function editorEntityTypeLabel(type) {
  if (type === "logic_gate") return "Logic Gate";
  return type === "project" ? "Project" : "Node";
}
function createEditorEntityIconElement(ownerDocument, entityType) {
  const icon = createExplorerEntityIconElement(ownerDocument, entityType);
  icon.classList.add("mango-editor-entity-icon", `mango-editor-entity-icon--${entityType}`);
  return icon;
}

// src/modules/editor/richTextEditing.ts
function editorHighlightByteHex(value) {
  return Math.round(value).toString(16).padStart(2, "0");
}
var EDITOR_HIGHLIGHT_NAMED_COLOR_ALIASES = {
  yellow: "#ffff00",
  orange: "#ffa500",
  red: "#ff0000",
  pink: "#ffc0cb",
  purple: "#800080",
  blue: "#0000ff",
  cyan: "#00ffff",
  aqua: "#00ffff",
  green: "#008000",
  lime: "#00ff00"
};
function normalizeEditorHighlightColor(value) {
  const cleanValue = value?.trim().toLowerCase() ?? "";
  if (!cleanValue) return null;
  const named = EDITOR_HIGHLIGHT_NAMED_COLOR_ALIASES[cleanValue];
  if (named) return named;
  const shortHex = /^#([0-9a-f]{3})$/.exec(cleanValue);
  if (shortHex) {
    const [r, g, b] = shortHex[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const longHex = /^#([0-9a-f]{6})$/.exec(cleanValue);
  if (longHex) return `#${longHex[1]}`;
  const rgb = /^rgba?\(\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)(?:\s*,\s*([0-9]+(?:\.[0-9]+)?))?\s*\)$/.exec(cleanValue);
  if (!rgb) return null;
  const red = Number.parseFloat(rgb[1]);
  const green = Number.parseFloat(rgb[2]);
  const blue = Number.parseFloat(rgb[3]);
  const alpha = rgb[4] === void 0 ? 1 : Number.parseFloat(rgb[4]);
  if (![red, green, blue, alpha].every(Number.isFinite)) return null;
  if (red < 0 || red > 255 || green < 0 || green > 255 || blue < 0 || blue > 255 || alpha !== 1) return null;
  return `#${editorHighlightByteHex(red)}${editorHighlightByteHex(green)}${editorHighlightByteHex(blue)}`;
}

// src/modules/editor/tiptap/mangoTiptapExtensions.ts
import { Extension, Node as Node2, mergeAttributes } from "@tiptap/core";
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
import { Editor } from "@tiptap/core";
var mangoBlockNodeNames = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "table"
];
function newBlockID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `mango-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function parsedNumberAttribute(element, name) {
  const raw = element.getAttribute(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
var MangoAttachmentImage = Node2.create({
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
        parseHTML: (element) => ["left", "center", "right"].includes(element.getAttribute("data-alignment") ?? "") ? element.getAttribute("data-alignment") : "center"
      },
      position: {
        default: "break",
        parseHTML: (element) => ["inline", "break"].includes(element.getAttribute("data-position") ?? "") ? element.getAttribute("data-position") : "break"
      },
      layout: {
        default: "content",
        parseHTML: (element) => ["content", "wide"].includes(element.getAttribute("data-layout") ?? "") ? element.getAttribute("data-layout") : "content"
      },
      alt: { default: "", parseHTML: (element) => element.getAttribute("aria-label") ?? "" },
      title: { default: "", parseHTML: (element) => element.getAttribute("title") ?? "" },
      linkHref: { default: "", parseHTML: (element) => element.getAttribute("data-link-href") ?? "" },
      linkTarget: { default: "", parseHTML: (element) => element.getAttribute("data-link-target") ?? "" },
      linkRel: { default: "", parseHTML: (element) => element.getAttribute("data-link-rel") ?? "" },
      linkTitle: { default: "", parseHTML: (element) => element.getAttribute("data-link-title") ?? "" }
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
      title
    })];
  }
});
var MangoBlockIdentity = Extension.create({
  name: "mangoBlockIdentity",
  addGlobalAttributes() {
    return [{
      types: mangoBlockNodeNames,
      attributes: {
        blockId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-block-id"),
          renderHTML: (attributes) => attributes.blockId ? { "data-mango-block-id": attributes.blockId } : {}
        }
      }
    }, {
      types: ["paragraph", "heading"],
      attributes: {
        indentLevel: {
          default: 0,
          parseHTML: (element) => Number(element.getAttribute("data-indent-level") || 0),
          renderHTML: (attributes) => attributes.indentLevel ? { "data-indent-level": attributes.indentLevel, style: `margin-left: ${Number(attributes.indentLevel) * 24}px` } : {}
        }
      }
    }, {
      types: ["table"],
      attributes: {
        style: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-table-layout"),
          renderHTML: (attributes) => attributes.style === "fixed" ? { "data-mango-table-layout": "fixed", style: "table-layout: fixed" } : {}
        }
      }
    }, {
      types: ["tableCell", "tableHeader"],
      attributes: {
        align: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-cell-align"),
          renderHTML: (attributes) => ["left", "center", "right"].includes(attributes.align) ? { "data-mango-cell-align": attributes.align, style: `text-align: ${attributes.align}` } : {}
        },
        backgroundColor: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-mango-cell-background"),
          renderHTML: (attributes) => typeof attributes.backgroundColor === "string" && /^#[0-9a-f]{6}$/i.test(attributes.backgroundColor) ? { "data-mango-cell-background": attributes.backgroundColor, style: `background-color: ${attributes.backgroundColor}` } : {}
        }
      }
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some((transaction2) => transaction2.docChanged)) return null;
        const transaction = newState.tr;
        newState.doc.descendants((node, position) => {
          if (mangoBlockNodeNames.includes(node.type.name) && !node.attrs.blockId) {
            transaction.setNodeMarkup(position, void 0, { ...node.attrs, blockId: newBlockID() });
          }
        });
        return transaction.steps.length > 0 ? transaction : null;
      }
    })];
  }
});
function createMangoTiptapExtensions(options) {
  const extensions = [
    StarterKit.configure({
      link: {
        autolink: true,
        linkOnPaste: true,
        openOnClick: !options.editable,
        defaultProtocol: "https",
        protocols: ["http", "https", "mailto", "tel"],
        HTMLAttributes: { rel: "noopener noreferrer nofollow" }
      },
      underline: {},
      undoRedo: options.collaboration ? false : { depth: 200, newGroupDelay: 500 }
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
      tableRow: {}
    }),
    Mention.extend({
      addAttributes() {
        return {
          userId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-user-id"),
            renderHTML: () => ({})
          },
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-user-label"),
            renderHTML: () => ({})
          },
          kind: {
            default: "normal",
            parseHTML: (element) => element.getAttribute("data-mango-mention-kind") ?? "normal",
            renderHTML: () => ({})
          }
        };
      },
      renderHTML({ node, HTMLAttributes }) {
        return ["span", mergeAttributes(HTMLAttributes, {
          "data-type": "mention",
          "data-mango-user-id": node.attrs.userId,
          "data-mango-user-label": node.attrs.label,
          "data-mango-mention-kind": node.attrs.kind,
          class: `mango-tiptap-mention mango-tiptap-mention--${node.attrs.kind === "urgent" ? "urgent" : "normal"}`
        }), `${node.attrs.kind === "urgent" ? "!" : "@"}${String(node.attrs.label || "user")}`];
      }
    }).configure({
      HTMLAttributes: { class: "mango-tiptap-mention" },
      renderText: ({ node }) => `${node.attrs.kind === "urgent" ? "!" : "@"}${String(node.attrs.label || "user")}`,
      deleteTriggerWithBackspace: true,
      suggestions: ["normal", "urgent"].map((kind) => ({
        char: kind === "urgent" ? "!" : "@",
        items: ({ query }) => {
          const normalized = query.trim().toLowerCase();
          return (options.mentionUsers ?? []).filter((user) => !normalized || user.name.toLowerCase().includes(normalized) || user.email?.toLowerCase().includes(normalized)).slice(0, 20).map((user) => ({ id: user.userID, userId: user.userID, label: user.name }));
        },
        command: ({ editor, range, props }) => {
          const value = props;
          editor.chain().focus().insertContentAt(range, [{
            type: "mention",
            attrs: { userId: value.userId || value.id, label: value.label || "user", kind }
          }, { type: "text", text: " " }]).run();
        },
        render: () => {
          let menu = null;
          let selectedIndex = 0;
          let current = null;
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
                display: "block",
                width: "100%",
                border: "0",
                borderRadius: "5px",
                padding: "6px 8px",
                textAlign: "left",
                cursor: "pointer",
                background: index === selectedIndex ? "#e0f2fe" : "#ffffff"
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
              current = props;
              menu = document.createElement("div");
              menu.setAttribute("role", "listbox");
              menu.setAttribute("aria-label", kind === "urgent" ? "Urgently mention people" : "Mention people");
              menu.setAttribute("data-mango-tiptap-mention-menu", "true");
              Object.assign(menu.style, {
                position: "fixed",
                zIndex: "2100",
                minWidth: "180px",
                maxHeight: "240px",
                overflowY: "auto",
                padding: "4px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "#ffffff",
                boxShadow: "0 8px 24px rgba(15,23,42,.18)"
              });
              document.body.appendChild(menu);
              paint();
            },
            onUpdate: (props) => {
              current = props;
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
            onExit: close
          };
        }
      }))
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
          }
        };
      },
      addAttributes() {
        return {
          entityType: {
            default: "node",
            parseHTML: (element) => element.getAttribute("data-mango-entity-type") ?? "node",
            renderHTML: () => ({})
          },
          entityId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-entity-id"),
            renderHTML: () => ({})
          },
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-mango-entity-label") ?? element.textContent,
            renderHTML: () => ({})
          }
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
        const icon = ownerDocument ? createEditorEntityIconElement(ownerDocument, entityType) : ["span", { "aria-hidden": "true", class: `mango-editor-entity-icon mango-editor-entity-icon--${entityType}` }];
        return ["span", mergeAttributes(HTMLAttributes, {
          "data-mango-entity-link": "true",
          "data-mango-entity-type": entityType,
          "data-mango-entity-id": node.attrs.entityId,
          "data-mango-entity-label": label,
          role: "link",
          tabindex: "0",
          "aria-label": `Open ${editorEntityTypeLabel(entityType)} ${label}`,
          class: `mango-editor-entity-link mango-editor-entity-link--${entityType}`
        }), icon, ["span", { class: "mango-editor-entity-label" }, label]];
      }
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
          const entity = props;
          editor.chain().focus().insertContentAt(range, [{
            type: "mangoEntityLink",
            attrs: { entityType: entity.entityType, entityId: entity.entityID, label: entity.label }
          }, { type: "text", text: " " }]).run();
        },
        render: () => {
          let menu = null;
          let selectedIndex = 0;
          let current = null;
          const close = () => {
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
              Object.assign(button.style, {
                display: "grid",
                gridTemplateColumns: "18px minmax(0,1fr) auto",
                alignItems: "center",
                gap: "7px",
                width: "100%",
                border: "0",
                borderRadius: "6px",
                padding: "7px 8px",
                textAlign: "left",
                cursor: "pointer",
                background: index === selectedIndex ? "#e0f2fe" : "#ffffff",
                color: "#0f172a"
              });
              const icon = createEditorEntityIconElement(document, item.entityType);
              const label = document.createElement("span");
              label.textContent = item.label;
              label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:750";
              const type = document.createElement("span");
              type.textContent = editorEntityTypeLabel(item.entityType);
              type.style.cssText = "font-size:10px;color:#64748b;font-weight:700";
              button.append(icon, label, type);
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
              current = props;
              menu = document.createElement("div");
              menu.setAttribute("role", "listbox");
              menu.setAttribute("aria-label", "Link a Node, Logic Gate, or Project");
              menu.setAttribute("data-mango-tiptap-entity-menu", "true");
              Object.assign(menu.style, {
                position: "fixed",
                zIndex: "2100",
                minWidth: "280px",
                maxWidth: "min(420px, calc(100vw - 16px))",
                maxHeight: "280px",
                overflowY: "auto",
                padding: "4px",
                border: "1px solid #cbd5e1",
                borderRadius: "8px",
                background: "#ffffff",
                boxShadow: "0 8px 24px rgba(15,23,42,.18)"
              });
              document.body.appendChild(menu);
              paint();
            },
            onUpdate: (props) => {
              current = props;
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
              if ((event.key === "Enter" || event.key === "Tab" && !event.shiftKey) && current.items[selectedIndex]) {
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
            onExit: close
          };
        }
      }]
    }),
    options.attachmentImageExtension ?? MangoAttachmentImage,
    MangoBlockIdentity
  ];
  if (options.onImageFiles) {
    extensions.push(FileHandler.configure({
      allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      consumePasteEvent: true,
      onPaste: (_editor, files) => options.onImageFiles?.(files, null),
      onDrop: (_editor, files, position) => options.onImageFiles?.(files, position)
    }));
  }
  return extensions;
}

// src/modules/editor/tiptap/mangoTiptapDocument.ts
var MANGO_TIPTAP_FORMAT = "mango-tiptap-json";
var MANGO_TIPTAP_SCHEMA_VERSION = 1;
var nodeAttributes = {
  doc: /* @__PURE__ */ new Set(),
  paragraph: /* @__PURE__ */ new Set(["blockId", "textAlign", "indentLevel"]),
  heading: /* @__PURE__ */ new Set(["blockId", "level", "textAlign", "indentLevel"]),
  blockquote: /* @__PURE__ */ new Set(["blockId"]),
  codeBlock: /* @__PURE__ */ new Set(["blockId", "language"]),
  horizontalRule: /* @__PURE__ */ new Set(["blockId"]),
  text: /* @__PURE__ */ new Set(),
  hardBreak: /* @__PURE__ */ new Set(),
  bulletList: /* @__PURE__ */ new Set(["blockId"]),
  orderedList: /* @__PURE__ */ new Set(["blockId", "start", "type"]),
  listItem: /* @__PURE__ */ new Set(["blockId"]),
  taskList: /* @__PURE__ */ new Set(["blockId"]),
  taskItem: /* @__PURE__ */ new Set(["blockId", "checked"]),
  table: /* @__PURE__ */ new Set(["blockId", "style"]),
  tableRow: /* @__PURE__ */ new Set(),
  tableHeader: /* @__PURE__ */ new Set(["colspan", "rowspan", "colwidth", "align", "backgroundColor"]),
  tableCell: /* @__PURE__ */ new Set(["colspan", "rowspan", "colwidth", "align", "backgroundColor"]),
  mention: /* @__PURE__ */ new Set(["userId", "label", "kind"]),
  mangoEntityLink: /* @__PURE__ */ new Set(["entityType", "entityId", "label"]),
  mangoAttachmentImage: /* @__PURE__ */ new Set([
    "attachmentId",
    "filename",
    "mimeType",
    "width",
    "height",
    "displayWidth",
    "displayHeight",
    "alignment",
    "position",
    "layout",
    "alt",
    "title",
    "linkHref",
    "linkTarget",
    "linkRel",
    "linkTitle"
  ])
};
var markAttributes = {
  bold: /* @__PURE__ */ new Set(),
  italic: /* @__PURE__ */ new Set(),
  underline: /* @__PURE__ */ new Set(),
  strike: /* @__PURE__ */ new Set(),
  code: /* @__PURE__ */ new Set(),
  textStyle: /* @__PURE__ */ new Set(["fontSize", "color"]),
  highlight: /* @__PURE__ */ new Set(["color"]),
  link: /* @__PURE__ */ new Set(["href", "target", "rel", "class", "title"])
};
var inlineNodes = /* @__PURE__ */ new Set(["text", "hardBreak", "mention", "mangoEntityLink"]);
var textContainers = /* @__PURE__ */ new Set(["paragraph", "heading"]);
var blockNodes = /* @__PURE__ */ new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "bulletList",
  "orderedList",
  "taskList",
  "table",
  "mangoAttachmentImage"
]);
var blockContainers = /* @__PURE__ */ new Set(["doc", "blockquote", "tableCell", "tableHeader"]);
var listContainers = /* @__PURE__ */ new Set(["bulletList", "orderedList", "taskList"]);
var atomNodes = /* @__PURE__ */ new Set(["text", "hardBreak", "horizontalRule", "mention", "mangoEntityLink", "mangoAttachmentImage"]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}
function positiveInteger(value, maximum = 1e5) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum;
}
function validateAttributes(kind, value, allowed, path) {
  if (value === void 0) return null;
  if (!isRecord(value)) return `${path}.attrs must be an object`;
  for (const [name, attribute] of Object.entries(value)) {
    if (!allowed.has(name)) return `${path}.attrs.${name} is not supported for ${kind}`;
    if (attribute !== null && typeof attribute !== "string" && typeof attribute !== "number" && typeof attribute !== "boolean" && !Array.isArray(attribute)) return `${path}.attrs.${name} has an invalid value`;
    if (Array.isArray(attribute) && !attribute.every((item) => typeof item === "number" && Number.isFinite(item))) {
      return `${path}.attrs.${name} must contain only numbers`;
    }
  }
  const attrs = value;
  if (kind === "mention" && (typeof attrs.userId !== "string" || !attrs.userId.trim())) {
    return `${path}.attrs.userId is required`;
  }
  if (kind === "mention" && !["normal", "urgent"].includes(String(attrs.kind))) {
    return `${path}.attrs.kind must be normal or urgent`;
  }
  if (kind === "mangoEntityLink") {
    if (!["node", "logic_gate", "project"].includes(String(attrs.entityType))) return `${path}.attrs.entityType is invalid`;
    if (typeof attrs.entityId !== "string" || !attrs.entityId.trim() || attrs.entityId.length > 160) return `${path}.attrs.entityId is required`;
    if (typeof attrs.label !== "string" || !attrs.label.trim() || attrs.label.length > 500) return `${path}.attrs.label is required`;
  }
  if (kind === "mangoAttachmentImage") {
    if (typeof attrs.attachmentId !== "string" || !attrs.attachmentId.trim()) return `${path}.attrs.attachmentId is required`;
    if (Object.values(attrs).some((attribute) => typeof attribute === "string" && /^(blob:|data:)/i.test(attribute))) {
      return `${path} cannot store transient Blob or data URLs`;
    }
  }
  if (kind === "link") {
    const href = attrs.href;
    if (typeof href !== "string" || !href.trim()) return `${path}.attrs.href is required`;
    if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href.trim())) return `${path}.attrs.href uses an unsafe protocol`;
  }
  if (attrs.blockId !== void 0 && attrs.blockId !== null && (typeof attrs.blockId !== "string" || !attrs.blockId.trim() || attrs.blockId.length > 160)) {
    return `${path}.attrs.blockId is invalid`;
  }
  if (attrs.indentLevel !== void 0 && (!Number.isInteger(attrs.indentLevel) || Number(attrs.indentLevel) < 0 || Number(attrs.indentLevel) > 12)) {
    return `${path}.attrs.indentLevel must be an integer from 0 through 12`;
  }
  if (attrs.textAlign !== void 0 && attrs.textAlign !== null && !["left", "center", "right"].includes(String(attrs.textAlign))) {
    return `${path}.attrs.textAlign is invalid`;
  }
  if (kind === "heading" && !positiveInteger(attrs.level, 6)) return `${path}.attrs.level must be from 1 through 6`;
  if (kind === "orderedList" && attrs.start !== void 0 && attrs.start !== null && !positiveInteger(attrs.start)) return `${path}.attrs.start is invalid`;
  if (kind === "orderedList" && attrs.type !== void 0 && attrs.type !== null && !["1", "a", "A", "i", "I"].includes(String(attrs.type))) {
    return `${path}.attrs.type is invalid`;
  }
  if (kind === "taskItem" && attrs.checked !== void 0 && attrs.checked !== null && typeof attrs.checked !== "boolean") return `${path}.attrs.checked must be boolean`;
  if (kind === "table" && attrs.style !== void 0 && attrs.style !== null && !["auto", "fixed"].includes(String(attrs.style))) return `${path}.attrs.style is invalid`;
  if (kind === "tableCell" || kind === "tableHeader") {
    if (attrs.colspan !== void 0 && attrs.colspan !== null && !positiveInteger(attrs.colspan, 1e3)) return `${path}.attrs.colspan is invalid`;
    if (attrs.rowspan !== void 0 && attrs.rowspan !== null && !positiveInteger(attrs.rowspan, 1e3)) return `${path}.attrs.rowspan is invalid`;
    if (attrs.colwidth !== void 0 && attrs.colwidth !== null && (!Array.isArray(attrs.colwidth) || !attrs.colwidth.every((item) => positiveInteger(item)))) return `${path}.attrs.colwidth is invalid`;
    if (attrs.align !== void 0 && attrs.align !== null && !["left", "center", "right"].includes(String(attrs.align))) return `${path}.attrs.align is invalid`;
    if (attrs.backgroundColor !== void 0 && attrs.backgroundColor !== null && !safeColor(attrs.backgroundColor)) return `${path}.attrs.backgroundColor is invalid`;
  }
  if (kind === "textStyle") {
    if (attrs.fontSize !== void 0 && attrs.fontSize !== null) {
      const match = typeof attrs.fontSize === "string" ? /^(\d+)px$/.exec(attrs.fontSize) : null;
      if (!match || Number(match[1]) < 10 || Number(match[1]) > 28) return `${path}.attrs.fontSize is invalid`;
    }
    if (attrs.color !== void 0 && attrs.color !== null && !safeColor(attrs.color)) return `${path}.attrs.color is invalid`;
  }
  if (kind === "highlight" && attrs.color !== void 0 && attrs.color !== null && !safeColor(attrs.color)) return `${path}.attrs.color is invalid`;
  if (kind === "mangoAttachmentImage") {
    if (typeof attrs.mimeType !== "string" || !/^image\/(jpeg|png|gif|webp)$/i.test(attrs.mimeType)) return `${path}.attrs.mimeType is invalid`;
    for (const name of ["width", "height", "displayWidth", "displayHeight"]) {
      if (attrs[name] !== void 0 && attrs[name] !== null && !positiveInteger(attrs[name])) return `${path}.attrs.${name} is invalid`;
    }
    if (attrs.alignment !== void 0 && attrs.alignment !== null && !["left", "center", "right"].includes(String(attrs.alignment))) return `${path}.attrs.alignment is invalid`;
    if (attrs.position !== void 0 && attrs.position !== null && !["inline", "break"].includes(String(attrs.position))) return `${path}.attrs.position is invalid`;
    if (attrs.layout !== void 0 && attrs.layout !== null && !["content", "wide"].includes(String(attrs.layout))) return `${path}.attrs.layout is invalid`;
    if (attrs.linkHref !== void 0 && attrs.linkHref !== null && attrs.linkHref !== "" && !/^(https?:|mailto:|tel:|\/|#)/i.test(String(attrs.linkHref))) {
      return `${path}.attrs.linkHref uses an unsafe protocol`;
    }
    if (attrs.linkTarget !== void 0 && attrs.linkTarget !== null && attrs.linkTarget !== "" && !["_blank", "_self"].includes(String(attrs.linkTarget))) {
      return `${path}.attrs.linkTarget is invalid`;
    }
  }
  return null;
}
function validateNode(value, path, depth, count) {
  if (depth > 100) return `${path} is nested too deeply`;
  if (!isRecord(value)) return `${path} must be an object`;
  count.value += 1;
  if (count.value > 1e5) return "document contains too many nodes";
  const type = value.type;
  if (typeof type !== "string" || !(type in nodeAttributes)) return `${path}.type is unknown`;
  for (const key of Object.keys(value)) {
    if (!["type", "attrs", "content", "text", "marks"].includes(key)) return `${path} contains unsupported property ${key}`;
  }
  const attrError = validateAttributes(type, value.attrs, nodeAttributes[type], path);
  if (attrError) return attrError;
  if (type === "text") {
    if (typeof value.text !== "string") return `${path}.text is required`;
    if (value.content !== void 0) return `${path}.content is not valid on text`;
  } else if (value.text !== void 0) {
    return `${path}.text is only valid on text nodes`;
  }
  if (value.marks !== void 0) {
    if (type !== "text" && type !== "mention" || !Array.isArray(value.marks)) return `${path}.marks is invalid`;
    for (let index = 0; index < value.marks.length; index += 1) {
      const mark = value.marks[index];
      if (!isRecord(mark) || typeof mark.type !== "string" || !(mark.type in markAttributes)) {
        return `${path}.marks[${index}] is unknown`;
      }
      for (const key of Object.keys(mark)) if (!["type", "attrs"].includes(key)) return `${path}.marks[${index}] contains unsupported property ${key}`;
      const markError = validateAttributes(mark.type, mark.attrs, markAttributes[mark.type], `${path}.marks[${index}]`);
      if (markError) return markError;
    }
  }
  const content = value.content;
  if (content !== void 0 && !Array.isArray(content)) return `${path}.content must be an array`;
  if (content === void 0) return type === "doc" ? `${path}.content is required` : null;
  if (atomNodes.has(type)) return `${path}.content is not valid on ${type}`;
  if (["doc", "blockquote", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "tableRow", "tableCell", "tableHeader"].includes(type) && content.length === 0) {
    return `${path}.content cannot be empty for ${type}`;
  }
  for (let index = 0; index < content.length; index += 1) {
    const child = content[index];
    const childType = isRecord(child) ? child.type : void 0;
    if (textContainers.has(type) && (typeof childType !== "string" || !inlineNodes.has(childType))) {
      return `${path}.content[${index}] is not valid inside ${type}`;
    }
    if (type === "codeBlock" && childType !== "text") return `${path}.content[${index}] is not text`;
    if (listContainers.has(type) && childType !== (type === "taskList" ? "taskItem" : "listItem")) {
      return `${path}.content[${index}] is not a valid list item`;
    }
    if (type === "table" && childType !== "tableRow") return `${path}.content[${index}] is not a table row`;
    if (type === "tableRow" && childType !== "tableCell" && childType !== "tableHeader") {
      return `${path}.content[${index}] is not a table cell`;
    }
    if (blockContainers.has(type) && (typeof childType !== "string" || !blockNodes.has(childType))) {
      return `${path}.content[${index}] is not a valid block`;
    }
    if ((type === "listItem" || type === "taskItem") && (typeof childType !== "string" || !blockNodes.has(childType) || index === 0 && childType !== "paragraph")) {
      return `${path}.content[${index}] is not valid inside ${type}`;
    }
    const childError = validateNode(child, `${path}.content[${index}]`, depth + 1, count);
    if (childError) return childError;
  }
  return null;
}
function validateMangoTiptapDocumentStructure(value) {
  if (!isRecord(value)) return { valid: false, error: "document envelope must be an object" };
  for (const key of Object.keys(value)) {
    if (!["format", "schema_version", "document"].includes(key)) return { valid: false, error: `document envelope contains unsupported property ${key}` };
  }
  if (value.format !== MANGO_TIPTAP_FORMAT) return { valid: false, error: "document format is not mango-tiptap-json" };
  if (value.schema_version !== MANGO_TIPTAP_SCHEMA_VERSION) return { valid: false, error: "document schema version is not supported" };
  if (!isRecord(value.document) || value.document.type !== "doc") return { valid: false, error: "document root must be doc" };
  const nodeError = validateNode(value.document, "document", 0, { value: 0 });
  if (nodeError) return { valid: false, error: nodeError };
  return { valid: true, value };
}
function validateMangoTiptapDocument(value) {
  return validateMangoTiptapDocumentStructure(value);
}

// scripts/mango-html-to-json-core.ts
var LEGACY_HTML_PREFIX = "<!-- mango-editor-html-v1 -->";
var BLOCK_NODE_NAMES = /* @__PURE__ */ new Set([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "table"
]);
var UNSAFE_ELEMENTS = "script,style,iframe,object,embed,link,meta,base";
function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function normalizedText(value) {
  return value.normalize("NFC").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}
function unescapeLegacyTagAttributeQuotes(html) {
  let result = "";
  let inTag = false;
  let quote = null;
  for (let index = 0; index < html.length; index += 1) {
    const character = html[index];
    if (!inTag) {
      if (character === "<" && /[A-Za-z!/?]/.test(html[index + 1] ?? "")) inTag = true;
      result += character;
      continue;
    }
    if (character === "\\" && (html[index + 1] === '"' || html[index + 1] === "'")) {
      const escapedQuote = html[index + 1];
      result += escapedQuote;
      quote = quote === escapedQuote ? null : quote ?? escapedQuote;
      index += 1;
      continue;
    }
    result += character;
    if (character === '"' || character === "'") quote = quote === character ? null : quote ?? character;
    if (character === ">" && quote === null) inTag = false;
  }
  return result;
}
var HTML_BLOCK_TAGS = /* @__PURE__ */ new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "div",
  "figure",
  "figcaption",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
]);
function collectHTMLText(node) {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1) return "";
  const element = node;
  const tag = element.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "mango-attachment-image") return "\n";
  const content = Array.from(element.childNodes).map(collectHTMLText).join("");
  return HTML_BLOCK_TAGS.has(tag) ? `
${content}
` : content;
}
function safeNumber(value) {
  const parsed = Number.parseFloat(value?.trim() ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function legacyAttachmentID(src) {
  const clean = src.trim();
  if (!clean.startsWith("mango-attachment:")) return "";
  const encoded = clean.slice("mango-attachment:".length);
  try {
    return decodeURIComponent(encoded).trim();
  } catch {
    return encoded.trim();
  }
}
function setOptionalAttribute(element, name, value) {
  if (value === null || value === void 0 || value === "") return;
  element.setAttribute(name, String(value));
}
function normalizedImageMimeType(value) {
  const clean = value.trim().toLowerCase();
  if (clean === "image/jpg") return "image/jpeg";
  return /^image\/(jpeg|png|gif|webp)$/.test(clean) ? clean : "";
}
function inferredImageMimeType(filename) {
  const clean = filename.trim().toLowerCase();
  if (/\.jpe?g$/.test(clean)) return "image/jpeg";
  if (/\.png$/.test(clean)) return "image/png";
  if (/\.gif$/.test(clean)) return "image/gif";
  if (/\.webp$/.test(clean)) return "image/webp";
  return "";
}
function dataImageFingerprint(source) {
  const match = /^data:([^;,]+);base64,([\s\S]*)$/i.exec(source.trim());
  if (!match) return null;
  const mimeType = normalizedImageMimeType(match[1]);
  if (!mimeType) return null;
  try {
    const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    if (bytes.length === 0) return null;
    return { mimeType, byteSize: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch {
    return null;
  }
}
function attachmentPreference(metadata) {
  if (metadata.relationshipKind === "inline_image") return 0;
  if (metadata.relationshipKind === "migrated_inline_image") return 1;
  if (metadata.relationshipKind === "file_attachment") return 2;
  return 3;
}
function normalizeLegacyImages(root, document2, attachments) {
  const sortedAttachments = [...attachments].sort(
    (left, right) => attachmentPreference(left) - attachmentPreference(right) || left.attachmentId.localeCompare(right.attachmentId) || String(left.sourceResourceAttachmentId ?? "").localeCompare(String(right.sourceResourceAttachmentId ?? ""))
  );
  const frames = Array.from(root.querySelectorAll('span[data-mango-editor-image="true"]'));
  for (const frame of frames) {
    const image = frame.querySelector("img");
    const source = image?.getAttribute("src")?.trim() ?? "";
    const linkedAnchor = frame.closest("a[href]");
    const linkHref = linkedAnchor?.getAttribute("href")?.trim() ?? "";
    const directAttachmentID = frame.getAttribute("data-mango-editor-attachment-id")?.trim() || legacyAttachmentID(source);
    const fingerprint = directAttachmentID ? null : dataImageFingerprint(source);
    const metadata = directAttachmentID ? sortedAttachments.find((item) => item.attachmentId === directAttachmentID) : fingerprint ? sortedAttachments.find((item) => item.byteSize === fingerprint.byteSize && item.sha256 === fingerprint.sha256) : void 0;
    const attachmentID = directAttachmentID || metadata?.attachmentId || "";
    if (!attachmentID) {
      throw new Error("Legacy image has no permanent attachment ID; conversion stopped before storing a temporary image URL.");
    }
    const converted = document2.createElement("mango-attachment-image");
    converted.setAttribute("data-attachment-id", attachmentID);
    const filename = frame.getAttribute("data-mango-editor-filename")?.trim() || metadata?.filename || "";
    const mimeType = normalizedImageMimeType(frame.getAttribute("data-mango-editor-mime-type") ?? "") || normalizedImageMimeType(metadata?.mimeType ?? "") || fingerprint?.mimeType || inferredImageMimeType(filename);
    if (!mimeType) throw new Error(`Legacy image attachment ${attachmentID} has no supported image MIME type.`);
    setOptionalAttribute(converted, "data-filename", filename);
    converted.setAttribute("data-mime-type", mimeType);
    const width = safeNumber(frame.style.width || image?.getAttribute("width")) ?? metadata?.width ?? null;
    const height = safeNumber(frame.style.height || image?.getAttribute("height")) ?? metadata?.height ?? null;
    setOptionalAttribute(converted, "data-width", width);
    setOptionalAttribute(converted, "data-height", height);
    setOptionalAttribute(converted, "data-display-width", width);
    setOptionalAttribute(converted, "data-display-height", height);
    const floatSide = frame.style.float.trim().toLowerCase();
    converted.setAttribute("data-alignment", floatSide === "right" ? "right" : "left");
    converted.setAttribute("data-position", "break");
    converted.setAttribute("data-layout", "content");
    setOptionalAttribute(converted, "aria-label", image?.getAttribute("alt")?.trim());
    setOptionalAttribute(converted, "title", image?.getAttribute("title")?.trim());
    if (linkHref && /^(https?:|mailto:|tel:|\/|#)/i.test(linkHref)) {
      converted.setAttribute("data-link-href", linkHref);
      setOptionalAttribute(converted, "data-link-target", linkedAnchor?.getAttribute("target")?.trim());
      setOptionalAttribute(converted, "data-link-rel", linkedAnchor?.getAttribute("rel")?.trim());
      setOptionalAttribute(converted, "data-link-title", linkedAnchor?.getAttribute("title")?.trim());
    }
    frame.replaceWith(converted);
  }
  const remainingImages = Array.from(root.querySelectorAll("img"));
  if (remainingImages.length > 0) {
    throw new Error(`Found ${remainingImages.length} image(s) without Mango attachment wrappers; conversion stopped to avoid losing them.`);
  }
}
function hasMeaningfulInlineContent(node) {
  if (node.nodeType === 3) return Boolean(node.textContent?.trim());
  if (node.nodeType !== 1) return false;
  const element = node;
  return element.tagName.toLowerCase() === "br" || Boolean(element.textContent?.trim()) || element.childElementCount > 0;
}
function normalizeBlocksInsideInlineElements(root) {
  const selector = `${[...HTML_BLOCK_TAGS].join(",")},mango-attachment-image`;
  while (true) {
    const block = Array.from(root.querySelectorAll(selector)).find((element) => {
      const parent2 = element.parentElement;
      return parent2 && parent2 !== root && !HTML_BLOCK_TAGS.has(parent2.tagName.toLowerCase());
    });
    if (!block) return;
    const wrapper = block.parentElement;
    const parent = wrapper.parentNode;
    if (!parent) return;
    const before = wrapper.cloneNode(false);
    while (wrapper.firstChild && wrapper.firstChild !== block) before.appendChild(wrapper.firstChild);
    const after = wrapper.cloneNode(false);
    while (block.nextSibling) after.appendChild(block.nextSibling);
    if (hasMeaningfulInlineContent(before)) parent.insertBefore(before, wrapper);
    parent.insertBefore(block, wrapper);
    if (hasMeaningfulInlineContent(after)) parent.insertBefore(after, wrapper);
    wrapper.remove();
  }
}
function isBlockElement(node) {
  return node.nodeType === 1 && (HTML_BLOCK_TAGS.has(node.tagName.toLowerCase()) || node.tagName.toLowerCase() === "mango-attachment-image");
}
function normalizeLegacyListItems(root, document2) {
  for (const item of Array.from(root.querySelectorAll("li"))) {
    let paragraph = null;
    for (const child of Array.from(item.childNodes)) {
      if (isBlockElement(child)) {
        paragraph = null;
        continue;
      }
      if (child.nodeType === 8) continue;
      if (!paragraph && !hasMeaningfulInlineContent(child)) {
        child.remove();
        continue;
      }
      if (!paragraph) {
        paragraph = document2.createElement("p");
        item.insertBefore(paragraph, child);
      }
      paragraph.appendChild(child);
    }
    if (item.firstElementChild?.tagName.toLowerCase() !== "p") {
      item.insertBefore(document2.createElement("p"), item.firstChild);
    }
  }
}
function normalizeRootInlineRuns(root, document2) {
  let paragraph = null;
  for (const child of Array.from(root.childNodes)) {
    const isBlock = child.nodeType === 1 && (HTML_BLOCK_TAGS.has(child.tagName.toLowerCase()) || child.tagName.toLowerCase() === "mango-attachment-image");
    if (isBlock) {
      paragraph = null;
      continue;
    }
    if (child.nodeType === 8) continue;
    if (!paragraph && !hasMeaningfulInlineContent(child)) {
      child.remove();
      continue;
    }
    if (!paragraph) {
      paragraph = document2.createElement("p");
      root.insertBefore(paragraph, child);
    }
    paragraph.appendChild(child);
  }
  const hasBlock = Array.from(root.children).some(
    (child) => HTML_BLOCK_TAGS.has(child.tagName.toLowerCase()) || child.tagName.toLowerCase() === "mango-attachment-image"
  );
  if (!hasBlock) root.appendChild(document2.createElement("p"));
}
function normalizeLegacyMentions(root) {
  for (const mention of Array.from(root.querySelectorAll('span[data-mango-mention="true"]'))) {
    const userID = mention.getAttribute("data-mango-mention-user-id")?.trim() ?? "";
    if (!userID) throw new Error("Legacy mention has no user ID.");
    const visible = (mention.textContent ?? "").trim();
    const rawKind = mention.getAttribute("data-mango-mention-kind")?.trim().toLowerCase();
    const kind = rawKind === "urgent" || visible.startsWith("!") ? "urgent" : "normal";
    const label = mention.getAttribute("data-mango-user-label")?.trim() || visible.replace(/^[@!]/, "").trim() || "user";
    mention.setAttribute("data-type", "mention");
    mention.setAttribute("data-mango-user-id", userID);
    mention.setAttribute("data-mango-user-label", label);
    mention.setAttribute("data-mango-mention-kind", kind);
  }
}
function normalizeLegacyLists(root) {
  for (const list of Array.from(root.querySelectorAll('ul[data-mango-editor-list="checklist"]'))) {
    list.setAttribute("data-type", "taskList");
    for (const item of Array.from(list.children)) {
      if (item.tagName.toLowerCase() !== "li") continue;
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", item.getAttribute("data-mango-editor-checklist-checked") === "true" ? "true" : "false");
    }
  }
}
function normalizeLegacyTextStyles(root) {
  for (const element of Array.from(root.querySelectorAll("[style]"))) {
    const rawColor = element.style.color.trim();
    if (rawColor && !["inherit", "initial", "currentcolor", "transparent"].includes(rawColor.toLowerCase())) {
      const color = normalizeEditorHighlightColor(rawColor);
      if (!color) throw new Error(`Unsupported legacy text color: ${rawColor}`);
      element.style.color = color;
    }
    const rawFontSize = element.style.fontSize.trim();
    if (rawFontSize) {
      const fontSize = Number.parseFloat(rawFontSize);
      if (!Number.isFinite(fontSize) || fontSize < 10 || fontSize > 28) {
        throw new Error(`Legacy font size is outside the JSON editor range: ${rawFontSize}`);
      }
      element.style.fontSize = `${Math.round(fontSize)}px`;
    }
  }
}
function normalizeLegacyHighlights(root, document2) {
  const candidates = Array.from(root.querySelectorAll("span,mark"));
  for (const element of candidates) {
    const htmlElement = element;
    const color = normalizeEditorHighlightColor(
      element.getAttribute("data-mango-editor-highlight") || htmlElement.style.backgroundColor
    );
    if (!color) continue;
    if (element.tagName.toLowerCase() === "mark") {
      element.setAttribute("data-color", color);
      htmlElement.style.backgroundColor = color;
      continue;
    }
    const mark = document2.createElement("mark");
    mark.setAttribute("data-color", color);
    mark.setAttribute("style", `background-color: ${color}`);
    while (element.firstChild) mark.appendChild(element.firstChild);
    element.appendChild(mark);
    element.removeAttribute("data-mango-editor-highlight");
    htmlElement.style.removeProperty("background-color");
  }
}
function normalizeLegacyTables(root) {
  for (const cell of Array.from(root.querySelectorAll("td,th"))) {
    const htmlCell = cell;
    const align = cell.getAttribute("data-mango-editor-table-text-align")?.trim().toLowerCase() || htmlCell.style.textAlign.trim().toLowerCase();
    if (["left", "center", "right"].includes(align)) cell.setAttribute("data-mango-cell-align", align);
    const background = normalizeEditorHighlightColor(htmlCell.style.backgroundColor);
    if (background) cell.setAttribute("data-mango-cell-background", background);
  }
}
function normalizeVisibleLegacyRootNewlines(root, document2) {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== 3) continue;
    const value = child.textContent ?? "";
    if (!value.trim() || !/[\r\n]/.test(value)) continue;
    const lines = value.replace(/\r\n?/g, "\n").split("\n");
    const fragment = document2.createDocumentFragment();
    lines.forEach((line, index) => {
      if (line) fragment.appendChild(document2.createTextNode(line));
      if (index < lines.length - 1) fragment.appendChild(document2.createElement("br"));
    });
    child.replaceWith(fragment);
  }
}
function normalizeLegacyHTML(storedHTML, options) {
  const prefixedHTML = storedHTML.startsWith(LEGACY_HTML_PREFIX) ? storedHTML.slice(LEGACY_HTML_PREFIX.length) : storedHTML;
  const html = unescapeLegacyTagAttributeQuotes(prefixedHTML);
  const window2 = new Window({ settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
    disableIframePageLoading: true,
    disableComputedStyleRendering: true
  } });
  try {
    const document2 = window2.document;
    const root = document2.createElement("div");
    root.innerHTML = html;
    for (const unsafe of Array.from(root.querySelectorAll(UNSAFE_ELEMENTS))) unsafe.remove();
    normalizeLegacyImages(root, document2, options.attachments ?? []);
    normalizeLegacyMentions(root);
    normalizeLegacyLists(root);
    normalizeLegacyTextStyles(root);
    normalizeLegacyHighlights(root, document2);
    normalizeLegacyTables(root);
    normalizeVisibleLegacyRootNewlines(root, document2);
    normalizeBlocksInsideInlineElements(root);
    normalizeLegacyListItems(root, document2);
    normalizeRootInlineRuns(root, document2);
    const normalized = root.innerHTML;
    return {
      html: normalized,
      text: normalizedText(collectHTMLText(root)),
      sourceCounts: countNormalizedHTML(root)
    };
  } finally {
    window2.happyDOM.abort();
    window2.happyDOM.close();
  }
}
function emptyCounts() {
  return {
    textCharacters: 0,
    paragraphs: 0,
    headings: 0,
    bulletLists: 0,
    orderedLists: 0,
    taskLists: 0,
    listItems: 0,
    tables: 0,
    links: 0,
    bold: 0,
    italic: 0,
    underline: 0,
    strike: 0,
    highlights: 0,
    mentions: 0,
    entityLinks: 0,
    attachmentImages: 0
  };
}
function countNormalizedHTML(root) {
  const counts = emptyCounts();
  counts.textCharacters = normalizedText(collectHTMLText(root)).length;
  counts.paragraphs = root.querySelectorAll("p").length;
  counts.headings = root.querySelectorAll("h1,h2,h3,h4,h5,h6").length;
  counts.taskLists = root.querySelectorAll('ul[data-type="taskList"]').length;
  counts.bulletLists = Array.from(root.querySelectorAll("ul")).filter((node) => node.getAttribute("data-type") !== "taskList").length;
  counts.orderedLists = root.querySelectorAll("ol").length;
  counts.listItems = root.querySelectorAll("li").length;
  counts.tables = root.querySelectorAll("table").length;
  const meaningfulCount = (selector) => Array.from(root.querySelectorAll(selector)).filter((element) => Boolean(normalizedText(collectHTMLText(element)))).length;
  counts.links = meaningfulCount("a[href]") + root.querySelectorAll("mango-attachment-image[data-link-href]").length;
  counts.bold = meaningfulCount("strong,b");
  counts.italic = meaningfulCount("em,i");
  counts.underline = meaningfulCount("u");
  counts.strike = meaningfulCount("s,strike,del");
  counts.highlights = meaningfulCount("mark");
  counts.mentions = root.querySelectorAll('span[data-type="mention"]').length;
  counts.entityLinks = root.querySelectorAll('[data-mango-entity-link="true"]').length;
  counts.attachmentImages = root.querySelectorAll("mango-attachment-image[data-attachment-id]").length;
  return counts;
}
function deterministicBlockID(sourceHash, path, type) {
  return `mango-import-${sha256(`${sourceHash}:${path}:${type}`).slice(0, 32)}`;
}
function normalizeGeneratedJSON(node) {
  const result = { ...node };
  if (node.marks) {
    result.marks = node.marks.map((mark) => {
      if (mark.type === "textStyle") {
        const attrs = { ...mark.attrs };
        const rawColor = attrs.color;
        if (typeof rawColor === "string") {
          if (rawColor.trim()) {
            const color = normalizeEditorHighlightColor(rawColor);
            if (!color) throw new Error(`Unsupported generated textStyle color: ${rawColor}`);
            attrs.color = color;
          } else {
            delete attrs.color;
          }
        }
        const rawFontSize = attrs.fontSize;
        if (typeof rawFontSize === "string") {
          if (rawFontSize.trim()) {
            const fontSize = Number.parseFloat(rawFontSize);
            if (!Number.isFinite(fontSize) || fontSize < 10 || fontSize > 28) {
              throw new Error(`Generated font size is outside the JSON editor range: ${rawFontSize}`);
            }
            attrs.fontSize = `${Math.round(fontSize)}px`;
          } else {
            delete attrs.fontSize;
          }
        }
        return { ...mark, attrs };
      }
      if (mark.type === "highlight" && typeof mark.attrs?.color === "string") {
        const rawColor = mark.attrs.color.trim();
        if (!rawColor) return { ...mark, attrs: {} };
        const color = normalizeEditorHighlightColor(rawColor);
        if (!color) throw new Error(`Unsupported generated highlight color: ${rawColor}`);
        return { ...mark, attrs: { ...mark.attrs, color } };
      }
      return mark;
    });
  }
  if (node.type !== "text" && node.type !== "mention" && result.marks !== void 0) {
    if ((result.marks?.length ?? 0) > 0 && node.type !== "hardBreak") {
      throw new Error(`Generated ${node.type || "unknown"} node unexpectedly contains text marks.`);
    }
    delete result.marks;
  }
  if (node.content) result.content = node.content.map(normalizeGeneratedJSON);
  return result;
}
function addDeterministicBlockIDs(node, sourceHash, path = "0") {
  const result = { ...node };
  if (node.type && BLOCK_NODE_NAMES.has(node.type)) {
    result.attrs = { ...node.attrs ?? {}, blockId: node.attrs?.blockId || deterministicBlockID(sourceHash, path, node.type) };
  }
  if (node.content) {
    result.content = node.content.map((child, index) => addDeterministicBlockIDs(child, sourceHash, `${path}.${index}`));
  }
  return result;
}
function collectJSONText(node) {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") {
    const kind = node.attrs?.kind === "urgent" ? "!" : "@";
    return `${kind}${String(node.attrs?.label || "user")}`;
  }
  if (node.type === "mangoEntityLink") return String(node.attrs?.label || "Entity");
  const content = (node.content ?? []).map(collectJSONText).join("");
  return BLOCK_NODE_NAMES.has(node.type ?? "") || ["doc", "tableRow", "tableCell", "tableHeader"].includes(node.type ?? "") ? `
${content}
` : content;
}
function countJSON(document2) {
  const counts = emptyCounts();
  const visit = (node) => {
    const type = node.type ?? "";
    if (type === "text") counts.textCharacters += normalizedText(node.text ?? "").length;
    if (type === "paragraph") counts.paragraphs += 1;
    if (type === "heading") counts.headings += 1;
    if (type === "bulletList") counts.bulletLists += 1;
    if (type === "orderedList") counts.orderedLists += 1;
    if (type === "taskList") counts.taskLists += 1;
    if (type === "listItem" || type === "taskItem") counts.listItems += 1;
    if (type === "table") counts.tables += 1;
    if (type === "mention") counts.mentions += 1;
    if (type === "mangoEntityLink") counts.entityLinks += 1;
    if (type === "mangoAttachmentImage") {
      counts.attachmentImages += 1;
      if (typeof node.attrs?.linkHref === "string" && node.attrs.linkHref.trim()) counts.links += 1;
    }
    for (const mark of node.marks ?? []) {
      if (mark.type === "link") counts.links += 1;
      if (mark.type === "bold") counts.bold += 1;
      if (mark.type === "italic") counts.italic += 1;
      if (mark.type === "underline") counts.underline += 1;
      if (mark.type === "strike") counts.strike += 1;
      if (mark.type === "highlight") counts.highlights += 1;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(document2);
  counts.textCharacters = normalizedText(collectJSONText(document2)).length;
  return counts;
}
function assertPreserved(source, target) {
  const exact = [
    "taskLists",
    "bulletLists",
    "orderedLists",
    "listItems",
    "tables",
    "mentions",
    "entityLinks",
    "attachmentImages"
  ];
  const differences = exact.filter((name) => source[name] !== target[name]);
  const formatting = ["links", "bold", "italic", "underline", "strike", "highlights"];
  differences.push(...formatting.filter((name) => source[name] > 0 && target[name] === 0));
  if (differences.length > 0) {
    throw new Error(`Conversion changed supported rich-text structures: ${differences.map((name) => `${name} ${source[name]} -> ${target[name]}`).join(", ")}`);
  }
}
function convertMangoLegacyHTML(storedHTML, options = {}) {
  const sourceSHA256 = sha256(storedHTML);
  const sourceMD5 = createHash("md5").update(storedHTML, "utf8").digest("hex");
  const normalized = normalizeLegacyHTML(storedHTML, options);
  const extensions = createMangoTiptapExtensions({ editable: false });
  const generated = generateJSON(normalized.html, extensions);
  const document2 = {
    format: MANGO_TIPTAP_FORMAT,
    schema_version: MANGO_TIPTAP_SCHEMA_VERSION,
    document: addDeterministicBlockIDs(normalizeGeneratedJSON(generated), sourceSHA256)
  };
  const validation = validateMangoTiptapDocument(document2);
  if (!validation.valid) throw new Error(`Mango JSON validation failed: ${validation.error}`);
  const convertedText = normalizedText(collectJSONText(document2.document));
  if (normalized.text !== convertedText) {
    throw new Error(`Conversion changed visible text (source ${normalized.text.length} characters, JSON ${convertedText.length} characters).`);
  }
  const jsonCounts = countJSON(document2.document);
  assertPreserved(normalized.sourceCounts, jsonCounts);
  const roundTripHTML = generateHTML(document2.document, extensions);
  const roundTripJSON = generateJSON(roundTripHTML, extensions);
  const roundTripText = normalizedText(collectJSONText(roundTripJSON));
  if (roundTripText !== convertedText) throw new Error("Tiptap JSON-to-HTML round trip changed visible text.");
  return {
    document: document2,
    normalizedHTML: normalized.html,
    roundTripHTML,
    sourceSHA256,
    sourceMD5,
    normalizedText: convertedText,
    sourceCounts: normalized.sourceCounts,
    jsonCounts,
    warnings: []
  };
}

// src/modules/editor/tiptap/mangoTiptapYjs.ts
import { getSchema } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
var MANGO_TIPTAP_SCHEMA = getSchema(createMangoTiptapExtensions({ editable: false }));
function mangoProsemirrorJSONToYDoc(document2, field = "default") {
  return prosemirrorJSONToYDoc(MANGO_TIPTAP_SCHEMA, document2, field);
}

// src/modules/editor/editorProjection.ts
var EDITOR_TEXT_BLOCK_CONTENT_PREFIX = "<!-- mango-node-text-block-v1 -->";

// scripts/mango-editor-migration.ts
var { Pool } = pg;
var OWNER_TYPES = ["node", "project", "logic_gate"];
function sha2562(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function stableJSON(value) {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJSON(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function nodeProjectionDocument(information) {
  if (!information.startsWith(EDITOR_TEXT_BLOCK_CONTENT_PREFIX)) return information;
  let payload;
  try {
    payload = JSON.parse(information.slice(EDITOR_TEXT_BLOCK_CONTENT_PREFIX.length));
  } catch {
    throw new Error("node_textbox_projection_envelope_is_invalid_json");
  }
  if (!payload || typeof payload !== "object" || typeof payload.document !== "string") {
    throw new Error("node_textbox_projection_envelope_has_no_document");
  }
  return payload.document;
}
function parseArguments(argv) {
  const values = /* @__PURE__ */ new Map();
  const flags = /* @__PURE__ */ new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--allow-write") {
      flags.add(argument);
      continue;
    }
    if (!argument.startsWith("--")) throw new Error(`unexpected_argument:${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing_value:${argument}`);
    values.set(argument, value);
    index += 1;
  }
  const mode = String(values.get("--mode") || "");
  if (!["inventory", "dry-run", "backfill", "shadow", "readiness", "activate", "rollback-export", "rollback"].includes(mode)) {
    throw new Error("mode must be inventory, dry-run, backfill, shadow, readiness, activate, rollback-export, or rollback");
  }
  const companyID = String(values.get("--company") || "").trim().toLowerCase();
  if (!/^[0-9a-f-]{36}$/.test(companyID)) throw new Error("--company must be a UUID");
  const owner = String(values.get("--owner") || "node");
  const owners = owner === "all" ? [...OWNER_TYPES] : [owner];
  if (owners.some((item) => !OWNER_TYPES.includes(item))) throw new Error("--owner must be node, project, logic_gate, or all");
  const batchSize = Number(values.get("--batch-size") || 100);
  const limit = Number(values.get("--limit") || Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1e3) throw new Error("--batch-size must be from 1 through 1000");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  return {
    mode,
    companyID,
    owners,
    runID: String(values.get("--run-id") || randomUUID()).toLowerCase(),
    batchSize,
    limit,
    allowWrite: flags.has("--allow-write"),
    confirmation: String(values.get("--confirm") || ""),
    backupReference: String(values.get("--backup-reference") || "").trim()
  };
}
function assertWriteSafety(args) {
  if (!["backfill", "shadow", "readiness", "activate", "rollback-export", "rollback"].includes(args.mode)) return;
  if (!args.allowWrite) throw new Error(`${args.mode} requires --allow-write`);
  const verbs = {
    backfill: "BACKFILL",
    readiness: "VALIDATE",
    shadow: "SHADOW",
    activate: "ACTIVATE",
    "rollback-export": "EXPORT",
    rollback: "ROLLBACK"
  };
  if (args.confirmation !== `${verbs[args.mode]} ${args.companyID}`) {
    throw new Error(`${args.mode} requires --confirm "${verbs[args.mode]} ${args.companyID}"`);
  }
  if (["backfill", "shadow", "activate", "rollback-export", "rollback"].includes(args.mode) && !args.backupReference) {
    throw new Error(`${args.mode} requires --backup-reference`);
  }
}
async function listSources(client, companyID, owner, after, limit) {
  if (owner === "node") {
    const result2 = await client.query(
      `with ranked as (
         select projection.company_id::text,
                'node'::text as resource_type,
                projection.node_id::text as resource_id,
                projection.information_id::text as document_id,
                projection.revision::text,
                projection.information as source_information,
                projection.is_deleted,
                projection.created_timestamp,
                projection.updated_timestamp,
                (row_number() over(partition by projection.company_id,projection.node_id order by projection.created_timestamp,projection.information_id)*1024)::text as display_order,
                coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'attachmentId',attachment.attachment_id::text,
                    'sourceResourceAttachmentId',link.resource_attachment_id::text,
                    'filename',attachment.original_filename,
                    'mimeType',attachment.mime_type,
                    'byteSize',attachment.byte_size,
                    'sha256',attachment.sha256,
                    'width',attachment.original_width,
                    'height',attachment.original_height,
                    'relationshipKind',link.relationship_kind
                  ) order by
                    case link.relationship_kind when 'inline_image' then 0 when 'migrated_inline_image' then 1 when 'file_attachment' then 2 else 3 end,
                    attachment.attachment_id,link.resource_attachment_id)
                  from resource_attachments link
                  join attachments attachment
                    on attachment.company_id=link.company_id and attachment.attachment_id=link.attachment_id
                  where link.company_id=projection.company_id
                    and link.resource_type='node'
                    and link.resource_id=projection.node_id::text
                    and link.information_id=projection.information_id
                    and link.deleted_timestamp is null
                    and attachment.deleted_timestamp is null
                ),'[]'::jsonb) as attachment_metadata
           from node_projection_table projection
          where projection.company_id=$1::uuid and projection.type='Text box'::information_type
       )
       select * from ranked
        where ($2::uuid is null or (resource_id::uuid,document_id::uuid)>($2::uuid,$3::uuid))
        order by resource_id::uuid,document_id::uuid
        limit $4`,
      [companyID, after?.resourceID ?? null, after?.documentID ?? null, limit]
    );
    return result2.rows.map(({ source_information, ...row }) => ({
      ...row,
      canonical_html: nodeProjectionDocument(source_information)
    }));
  }
  const result = await client.query(
    `select company_id::text,resource_type,resource_id::text,document_id::text,revision::text,canonical_html,
            is_deleted,created_timestamp,updated_timestamp,'0'::text as display_order,'[]'::jsonb as attachment_metadata
       from editor_collaboration_documents
      where company_id=$1::uuid and resource_type=$2 and not is_deleted
        and ($3::uuid is null or (resource_id,document_id)>($3::uuid,$4::uuid))
      order by resource_id,document_id
      limit $5`,
    [companyID, owner, after?.resourceID ?? null, after?.documentID ?? null, limit]
  );
  return result.rows;
}
async function sourceInventory(client, companyID, owner) {
  const result = owner === "node" ? await client.query(
    `select count(*)::integer as total_count,
              count(*) filter(where not is_deleted)::integer as active_count,
              count(*) filter(where is_deleted)::integer as deleted_count,
              count(distinct node_id)::integer as owner_count,
              coalesce(sum(octet_length(case
                when information like '<!-- mango-node-text-block-v1 -->%'
                  then coalesce(substring(information from length('<!-- mango-node-text-block-v1 -->')+1)::jsonb->>'document','')
                else information end)),0)::bigint as source_bytes,
              coalesce(max(octet_length(case
                when information like '<!-- mango-node-text-block-v1 -->%'
                  then coalesce(substring(information from length('<!-- mango-node-text-block-v1 -->')+1)::jsonb->>'document','')
                else information end)),0)::integer as largest_source_bytes
         from node_projection_table
        where company_id=$1::uuid and type='Text box'::information_type`,
    [companyID]
  ) : await client.query(
    `select count(*)::integer as total_count,
              count(*)::integer as active_count,
              0::integer as deleted_count,
              count(distinct resource_id)::integer as owner_count,
              coalesce(sum(octet_length(canonical_html)),0)::bigint as source_bytes,
              coalesce(max(octet_length(canonical_html)),0)::integer as largest_source_bytes
         from editor_collaboration_documents
        where company_id=$1::uuid and resource_type=$2 and not is_deleted`,
    [companyID, owner]
  );
  const row = result.rows[0];
  return {
    owner_type: owner,
    total_count: Number(row.total_count),
    active_count: Number(row.active_count),
    deleted_count: Number(row.deleted_count),
    owner_count: Number(row.owner_count),
    source_bytes: Number(row.source_bytes),
    largest_source_bytes: Number(row.largest_source_bytes)
  };
}
async function nodeInventory(client, companyID) {
  const result = await client.query(
    `select node_id::text,
            count(*)::integer as total_count,
            count(*) filter(where not is_deleted)::integer as active_count,
            count(*) filter(where is_deleted)::integer as deleted_count,
            coalesce(sum(octet_length(case
              when information like '<!-- mango-node-text-block-v1 -->%'
                then coalesce(substring(information from length('<!-- mango-node-text-block-v1 -->')+1)::jsonb->>'document','')
              else information end)),0)::bigint as source_bytes,
            coalesce(max(octet_length(case
              when information like '<!-- mango-node-text-block-v1 -->%'
                then coalesce(substring(information from length('<!-- mango-node-text-block-v1 -->')+1)::jsonb->>'document','')
              else information end)),0)::integer as largest_source_bytes
       from node_projection_table
      where company_id=$1::uuid and type='Text box'::information_type
      group by node_id
      order by node_id`,
    [companyID]
  );
  return result.rows.map((row) => ({
    node_id: String(row.node_id),
    total_count: Number(row.total_count),
    active_count: Number(row.active_count),
    deleted_count: Number(row.deleted_count),
    source_bytes: Number(row.source_bytes),
    largest_source_bytes: Number(row.largest_source_bytes)
  }));
}
function identityFor(source, sourceSHA) {
  return sha2562([source.company_id, source.resource_type, source.resource_id, source.document_id, source.revision, sourceSHA].join(":"));
}
function nodeAttachmentIDs(document2) {
  const ids = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (node.type === "mangoAttachmentImage") {
      const attachmentID = typeof node.attrs?.attachmentId === "string" ? node.attrs.attachmentId.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(attachmentID)) {
        throw new Error("node_inline_image_attachment_id_is_not_a_uuid");
      }
      ids.add(attachmentID);
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(document2.document);
  return [...ids].sort();
}
async function ensureNodeAttachmentLinks(client, source, document2) {
  const attachmentIDs = nodeAttachmentIDs(document2);
  for (const attachmentID of attachmentIDs) {
    const selectSourceLink = () => client.query(
      `select resource_attachment_id::text
         from resource_attachments
        where company_id=$1::uuid and resource_type='node' and resource_id=$2
          and information_id=$3::uuid and attachment_id=$4::uuid and deleted_timestamp is null
          and relationship_kind in ('inline_image','migrated_inline_image','file_attachment')
        order by case relationship_kind when 'inline_image' then 0 when 'migrated_inline_image' then 1 else 2 end,
                 resource_attachment_id
        limit 1`,
      [source.company_id, source.resource_id, source.document_id, attachmentID]
    );
    let sourceLink = await selectSourceLink();
    if (sourceLink.rowCount !== 1) {
      await client.query(
        `insert into resource_attachments(
           resource_attachment_id,company_id,resource_type,resource_id,attachment_id,information_id,
           message_id,editor_surface,relationship_kind,created_timestamp
         )
         select $1::uuid,$2::uuid,'node',$3,$4::uuid,$5::uuid,'','node_text_block','migrated_inline_image',$6::timestamptz
           from attachments
          where company_id=$2::uuid and attachment_id=$4::uuid and deleted_timestamp is null
         on conflict do nothing`,
        [randomUUID(), source.company_id, source.resource_id, attachmentID, source.document_id, source.created_timestamp]
      );
      sourceLink = await selectSourceLink();
    }
    if (sourceLink.rowCount !== 1) throw new Error(`node_inline_image_attachment_not_found:${attachmentID}`);
    await client.query(
      `insert into node_textbox_attachment_links(
         company_id,node_id,textbox_id,attachment_link_id,attachment_id,relationship_kind,
         source_resource_attachment_id,created_timestamp
       ) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'inline_image',$6::uuid,$7::timestamptz)
       on conflict do nothing`,
      [source.company_id, source.resource_id, source.document_id, randomUUID(), attachmentID, sourceLink.rows[0].resource_attachment_id, source.created_timestamp]
    );
  }
  const targetLinks = await client.query(
    `select link.attachment_id::text,
            link.source_resource_attachment_id is not null
              and source_link.deleted_timestamp is null
              and source_link.company_id=link.company_id
              and source_link.resource_type='node'
              and source_link.resource_id=link.node_id::text
              and source_link.information_id=link.textbox_id
              and source_link.attachment_id=link.attachment_id as source_identity_matches
       from node_textbox_attachment_links link
       left join resource_attachments source_link
         on source_link.resource_attachment_id=link.source_resource_attachment_id
      where link.company_id=$1::uuid and link.node_id=$2::uuid and link.textbox_id=$3::uuid
        and link.relationship_kind='inline_image' and link.deleted_timestamp is null
      order by link.attachment_id`,
    [source.company_id, source.resource_id, source.document_id]
  );
  const actualIDs = targetLinks.rows.map((row) => String(row.attachment_id));
  if (stableJSON(actualIDs) !== stableJSON(attachmentIDs) || targetLinks.rows.some((row) => !row.source_identity_matches)) {
    throw new Error("node_attachment_target_identity_conflict");
  }
  return attachmentIDs.length;
}
async function ensureRun(client, args, expectedCount) {
  const ownerType = args.owners.length === 1 ? args.owners[0] : "all";
  const mode = args.mode === "rollback-export" ? "rollback_export" : args.mode === "backfill" ? "backfill" : args.mode === "shadow" ? "shadow_validate" : "dry_run";
  const result = await client.query(
    `insert into editor_conversion_runs(
       conversion_run_id,company_id,owner_type,mode,status,batch_size,source_snapshot_timestamp,
       backup_reference,expected_count,started_timestamp
     ) values($1::uuid,$2::uuid,$3,$4,'running',$5,clock_timestamp(),$6,$7,clock_timestamp())
     on conflict(conversion_run_id) do update set
       status='running',
       started_timestamp=coalesce(editor_conversion_runs.started_timestamp,excluded.started_timestamp)
     where editor_conversion_runs.company_id=excluded.company_id
       and editor_conversion_runs.owner_type=excluded.owner_type
       and (
         editor_conversion_runs.mode=excluded.mode
         or (editor_conversion_runs.mode='backfill' and excluded.mode='shadow_validate')
       )
       and editor_conversion_runs.batch_size=excluded.batch_size
       and editor_conversion_runs.backup_reference=excluded.backup_reference
       and editor_conversion_runs.expected_count=excluded.expected_count
     returning conversion_run_id`,
    [args.runID, args.companyID, ownerType, mode, args.batchSize, args.backupReference, expectedCount]
  );
  if (result.rowCount !== 1) {
    throw new Error("conversion_run_identity_conflict");
  }
}
async function writeTransitionalNodeTarget(client, source, document2) {
  await client.query(
    `insert into editor_json_documents(
       company_id,resource_type,resource_id,document_id,document_schema_version,revision,
       canonical_document,canonical_annotations,is_deleted,created_timestamp,updated_timestamp
     ) values($1::uuid,'node',$2,$3,1,$4,$5::jsonb,'[]'::jsonb,$6,$7,$8)
     on conflict(company_id,resource_type,resource_id,document_id) do update set
       document_schema_version=excluded.document_schema_version,
       canonical_document=excluded.canonical_document,
       is_deleted=excluded.is_deleted,
       updated_timestamp=clock_timestamp()
     where editor_json_documents.revision=0`,
    [
      source.company_id,
      source.resource_id,
      source.document_id,
      Number(source.revision),
      JSON.stringify(document2),
      source.is_deleted,
      source.created_timestamp,
      source.updated_timestamp
    ]
  );
  const target = await client.query(
    `select canonical_document,is_deleted
       from editor_json_documents
      where company_id=$1::uuid and resource_type='node' and resource_id=$2 and document_id=$3`,
    [source.company_id, source.resource_id, source.document_id]
  );
  if (target.rowCount !== 1 || stableJSON(target.rows[0].canonical_document) !== stableJSON(document2) || Boolean(target.rows[0].is_deleted) !== source.is_deleted) {
    throw new Error("editor_json_target_identity_conflict");
  }
}
async function writeNodeTarget(client, source, document2, plainText, sourceSHA, targetSHA, runID) {
  const yDocument = mangoProsemirrorJSONToYDoc(document2.document, "default");
  const checkpoint = Y.encodeStateAsUpdate(yDocument);
  const stateVector = Y.encodeStateVector(yDocument);
  const proposedEpoch = randomUUID();
  yDocument.destroy();
  await client.query(
    `insert into node_textboxes(
       company_id,node_id,textbox_id,source_information_id,document_schema_version,document_json,plain_text,
       content_revision,collaboration_epoch,latest_update_sequence,materialized_through_sequence,display_order,
       source_html_sha256,target_json_sha256,conversion_run_id,created_timestamp,updated_timestamp,deleted_timestamp
     ) values(
       $1::uuid,$2::uuid,$3::uuid,$3::uuid,1,$4::jsonb,$5,0,$6::uuid,0,0,$7::bigint,
       $8,$9,$10::uuid,$11::timestamptz,$12::timestamptz,
       case when $13::boolean then $12::timestamptz else null::timestamptz end
     )
     on conflict(company_id,node_id,textbox_id) do nothing`,
    [
      source.company_id,
      source.resource_id,
      source.document_id,
      JSON.stringify(document2),
      plainText,
      proposedEpoch,
      Number(source.display_order),
      sourceSHA,
      targetSHA,
      runID,
      source.created_timestamp,
      source.updated_timestamp,
      source.is_deleted
    ]
  );
  const target = await client.query(
    `select collaboration_epoch::text,document_json,plain_text,source_html_sha256,target_json_sha256,
            latest_update_sequence,materialized_through_sequence,deleted_timestamp is not null as is_deleted
       from node_textboxes
      where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid`,
    [source.company_id, source.resource_id, source.document_id]
  );
  if (target.rowCount !== 1 || stableJSON(target.rows[0].document_json) !== stableJSON(document2) || String(target.rows[0].plain_text) !== plainText || target.rows[0].source_html_sha256 !== sourceSHA || target.rows[0].target_json_sha256 !== targetSHA || Number(target.rows[0].latest_update_sequence) !== 0 || Number(target.rows[0].materialized_through_sequence) !== 0 || Boolean(target.rows[0].is_deleted) !== source.is_deleted) {
    throw new Error("node_target_identity_conflict");
  }
  await ensureNodeAttachmentLinks(client, source, document2);
  await client.query(
    `insert into node_textbox_yjs_checkpoints(
       company_id,node_id,textbox_id,checkpoint_id,collaboration_epoch,through_update_sequence,
       checkpoint_payload,state_vector,document_schema_version,document_json,plain_text,checkpoint_reason,retain_until
     ) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,0,$6,$7,1,$8::jsonb,$9,'migration_seed',clock_timestamp()+interval '100 years')
     on conflict(company_id,node_id,textbox_id,collaboration_epoch,through_update_sequence) do nothing`,
    [
      source.company_id,
      source.resource_id,
      source.document_id,
      randomUUID(),
      target.rows[0].collaboration_epoch,
      Buffer.from(checkpoint),
      Buffer.from(stateVector),
      JSON.stringify(document2),
      plainText
    ]
  );
  const checkpointTarget = await client.query(
    `select document_json,plain_text
       from node_textbox_yjs_checkpoints
      where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$3::uuid
        and collaboration_epoch=$4::uuid and through_update_sequence=0`,
    [source.company_id, source.resource_id, source.document_id, target.rows[0].collaboration_epoch]
  );
  if (checkpointTarget.rowCount !== 1 || stableJSON(checkpointTarget.rows[0].document_json) !== stableJSON(document2) || String(checkpointTarget.rows[0].plain_text) !== plainText) {
    throw new Error("node_checkpoint_target_identity_conflict");
  }
}
async function writeOwnedTarget(client, source, document2, plainText, sourceSHA, targetSHA, runID) {
  const table = source.resource_type === "project" ? "project_editor_documents" : "logic_gate_editor_documents";
  const ownerColumn = source.resource_type === "project" ? "project_id" : "logic_gate_id";
  await client.query(
    `insert into ${table}(
       company_id,${ownerColumn},document_id,source_document_id,document_schema_version,revision,document_json,
       plain_text,source_html,source_html_sha256,target_json_sha256,conversion_run_id
     ) values($1::uuid,$2::uuid,$3, $3,1,0,$4::jsonb,$5,$6,$7,$8,$9::uuid)
     on conflict(company_id,${ownerColumn},document_id) do nothing`,
    [source.company_id, source.resource_id, source.document_id, JSON.stringify(document2), plainText, source.canonical_html, sourceSHA, targetSHA, runID]
  );
  const target = await client.query(
    `select source_html_sha256,target_json_sha256 from ${table}
      where company_id=$1::uuid and ${ownerColumn}=$2::uuid and document_id=$3`,
    [source.company_id, source.resource_id, source.document_id]
  );
  if (target.rowCount !== 1 || target.rows[0].source_html_sha256 !== sourceSHA || target.rows[0].target_json_sha256 !== targetSHA) {
    throw new Error(`${source.resource_type}_target_identity_conflict`);
  }
}
async function assertSourceCurrent(client, source) {
  const result = source.resource_type === "node" ? await client.query(
    `select revision::text,information as source_information,is_deleted
         from node_projection_table
        where company_id=$1::uuid and node_id=$2::uuid and information_id=$3::uuid
          and type='Text box'::information_type
        for share`,
    [source.company_id, source.resource_id, source.document_id]
  ) : await client.query(
    `select revision::text,canonical_html,is_deleted
         from editor_collaboration_documents
        where company_id=$1::uuid and resource_type=$2 and resource_id=$3::uuid and document_id=$4::uuid
        for share`,
    [source.company_id, source.resource_type, source.resource_id, source.document_id]
  );
  const current = result.rows[0];
  const currentHTML = source.resource_type === "node" && current ? nodeProjectionDocument(String(current.source_information)) : String(current?.canonical_html ?? "");
  if (result.rowCount !== 1 || String(current.revision) !== source.revision || currentHTML !== source.canonical_html || Boolean(current.is_deleted) !== source.is_deleted) {
    throw new Error("legacy_source_changed_during_conversion");
  }
}
async function recordFailedItem(client, source, runID, itemIdentity, sourceSHA, error) {
  await client.query(
    `insert into editor_conversion_items(
       conversion_run_id,company_id,owner_type,owner_id,document_id,source_revision,item_identity_sha256,source_html_snapshot,
       source_html_sha256,status,failure_report
     ) values($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,'failed',$10::jsonb)
     on conflict(conversion_run_id,owner_type,owner_id,document_id) do update set
       retry_count=editor_conversion_items.retry_count+1,status='failed',failure_report=excluded.failure_report
     where editor_conversion_items.item_identity_sha256=excluded.item_identity_sha256`,
    [
      runID,
      source.company_id,
      source.resource_type,
      source.resource_id,
      source.document_id,
      Number(source.revision),
      itemIdentity,
      source.canonical_html,
      sourceSHA,
      JSON.stringify({ error: error instanceof Error ? error.message : "unknown" })
    ]
  );
}
async function convertAndMaybeWrite(client, source, args) {
  const sourceSHA = sha2562(source.canonical_html);
  const itemIdentity = identityFor(source, sourceSHA);
  let converted;
  let document2;
  try {
    converted = convertMangoLegacyHTML(source.canonical_html, { attachments: source.attachment_metadata });
    const validation = validateMangoTiptapDocument(converted.document);
    if (!validation.valid) throw new Error(validation.error);
    document2 = validation.value;
  } catch (error) {
    if (args.mode === "backfill") await recordFailedItem(client, source, args.runID, itemIdentity, sourceSHA, error);
    throw error;
  }
  const targetSerialized = stableJSON(document2);
  const targetSHA = sha2562(targetSerialized);
  const report = {
    owner_type: source.resource_type,
    owner_id: source.resource_id,
    document_id: source.document_id,
    source_revision: Number(source.revision),
    source_deleted: source.is_deleted,
    source_bytes: Buffer.byteLength(source.canonical_html, "utf8"),
    target_json_bytes: Buffer.byteLength(targetSerialized, "utf8"),
    source_sha256: sourceSHA,
    target_sha256: targetSHA,
    normalized_text_sha256: sha2562(converted.normalizedText),
    item_identity_sha256: itemIdentity,
    text_match: true,
    structure_match: true,
    source_structure_counts: converted.sourceCounts,
    target_structure_counts: converted.jsonCounts,
    warnings: converted.warnings,
    comment_anchor_report: { strategy: "quote-plus-context-to-yjs-relative-position", requires_review: converted.warnings.length > 0 },
    attachment_reference_report: {
      inline_images: converted.jsonCounts.attachmentImages,
      permanent_links: nodeAttachmentIDs(document2).length,
      preserved_by_attachment_id: true
    }
  };
  if (args.mode !== "backfill") return report;
  await client.query("begin");
  try {
    await assertSourceCurrent(client, source);
    const ledgerItem = await client.query(
      `insert into editor_conversion_items(
       conversion_run_id,company_id,owner_type,owner_id,document_id,source_revision,item_identity_sha256,source_html_snapshot,
       source_html_sha256,target_json_sha256,status,warning_report,comment_anchor_report,attachment_reference_report,converted_timestamp
       ) values($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,clock_timestamp())
       on conflict(conversion_run_id,owner_type,owner_id,document_id) do update set
         retry_count=editor_conversion_items.retry_count+1,
         status=excluded.status,
          warning_report=excluded.warning_report,
          failure_report=null,
          converted_timestamp=excluded.converted_timestamp
        where editor_conversion_items.item_identity_sha256=excluded.item_identity_sha256
        returning item_identity_sha256`,
      [
        args.runID,
        source.company_id,
        source.resource_type,
        source.resource_id,
        source.document_id,
        Number(source.revision),
        itemIdentity,
        source.canonical_html,
        sourceSHA,
        targetSHA,
        converted.warnings.length ? "warning" : "converted",
        JSON.stringify(converted.warnings),
        JSON.stringify(report.comment_anchor_report),
        JSON.stringify(report.attachment_reference_report)
      ]
    );
    if (ledgerItem.rowCount !== 1) throw new Error("source_identity_changed_for_run");
    if (source.resource_type === "node") {
      await writeTransitionalNodeTarget(client, source, document2);
      await writeNodeTarget(client, source, document2, converted.normalizedText, sourceSHA, targetSHA, args.runID);
    } else {
      await writeOwnedTarget(client, source, document2, converted.normalizedText, sourceSHA, targetSHA, args.runID);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    await recordFailedItem(client, source, args.runID, itemIdentity, sourceSHA, error);
    throw error;
  }
  return report;
}
async function sourceCount(client, companyID, owners) {
  const inventories = await Promise.all(owners.map((owner) => sourceInventory(client, companyID, owner)));
  return inventories.reduce((total, inventory) => total + inventory.total_count, 0);
}
async function runConversion(client, args) {
  const inventories = await Promise.all(args.owners.map((owner) => sourceInventory(client, args.companyID, owner)));
  const expected = inventories.reduce((total, inventory) => total + inventory.total_count, 0);
  if (args.mode === "inventory") {
    const perNode2 = args.owners.includes("node") ? await nodeInventory(client, args.companyID) : [];
    process.stdout.write(`${JSON.stringify({
      company_id: args.companyID,
      owners: args.owners,
      expected_count: expected,
      active_count: inventories.reduce((total, inventory) => total + inventory.active_count, 0),
      deleted_count: inventories.reduce((total, inventory) => total + inventory.deleted_count, 0),
      source_bytes: inventories.reduce((total, inventory) => total + inventory.source_bytes, 0),
      owner_totals: inventories,
      per_node_totals: perNode2
    })}
`);
    return;
  }
  if (args.mode === "backfill") await ensureRun(client, args, expected);
  let processed = 0;
  let failed = 0;
  const perNode = /* @__PURE__ */ new Map();
  for (const owner of args.owners) {
    let after = null;
    while (processed < args.limit) {
      const sources = await listSources(client, args.companyID, owner, after, Math.min(args.batchSize, args.limit - processed));
      if (sources.length === 0) break;
      for (const source of sources) {
        const nodeTotal = source.resource_type === "node" ? perNode.get(source.resource_id) ?? {
          node_id: source.resource_id,
          processed: 0,
          active: 0,
          deleted: 0,
          failed: 0,
          source_bytes: 0,
          target_json_bytes: 0
        } : null;
        if (nodeTotal) {
          nodeTotal.processed += 1;
          nodeTotal.active += source.is_deleted ? 0 : 1;
          nodeTotal.deleted += source.is_deleted ? 1 : 0;
          nodeTotal.source_bytes += Buffer.byteLength(source.canonical_html, "utf8");
          perNode.set(source.resource_id, nodeTotal);
        }
        try {
          const report = await convertAndMaybeWrite(client, source, args);
          process.stdout.write(`${JSON.stringify({ status: "ok", ...report })}
`);
          if (nodeTotal) nodeTotal.target_json_bytes += Number(report.target_json_bytes);
        } catch (error) {
          failed += 1;
          if (nodeTotal) nodeTotal.failed += 1;
          process.stdout.write(`${JSON.stringify({ status: "failed", owner_type: source.resource_type, owner_id: source.resource_id, document_id: source.document_id, error: error instanceof Error ? error.message : "unknown" })}
`);
        }
        processed += 1;
      }
      const last = sources.at(-1);
      after = { resourceID: last.resource_id, documentID: last.document_id };
    }
  }
  if (args.mode === "backfill") {
    await client.query(
      `with totals as (
         select count(*) filter(where status in ('converted','warning','validated'))::bigint as converted,
                count(*) filter(where status='warning')::bigint as warnings,
                count(*) filter(where status='failed')::bigint as failures
           from editor_conversion_items
          where conversion_run_id=$1::uuid
       )
       update editor_conversion_runs run set
         converted_count=totals.converted,
         warning_count=totals.warnings,
         failed_count=totals.failures,
         status=case
           when totals.failures > 0 or $2::integer > 0 then 'failed'
           when totals.converted = run.expected_count then 'completed'
           else 'paused'
         end,
         completed_timestamp=case when totals.failures=0 and $2::integer=0 and totals.converted=run.expected_count then clock_timestamp() else null end
       from totals
       where run.conversion_run_id=$1::uuid`,
      [args.runID, failed]
    );
  }
  if (perNode.size > 0) {
    process.stdout.write(`${JSON.stringify({ per_node_totals: [...perNode.values()].sort((left, right) => left.node_id.localeCompare(right.node_id)) })}
`);
  }
  process.stdout.write(`${JSON.stringify({ summary: true, expected, processed, failed, run_id: args.runID, mode: args.mode })}
`);
  if (failed > 0) process.exitCode = 2;
}
async function shadowValidate(client, args) {
  let mismatches = 0;
  if (args.allowWrite) await ensureRun(client, args, await sourceCount(client, args.companyID, args.owners));
  for (const owner of args.owners) {
    const sources = await listSources(client, args.companyID, owner, null, args.limit);
    for (const source of sources) {
      const converted = convertMangoLegacyHTML(source.canonical_html, { attachments: source.attachment_metadata });
      const expectedSHA = sha2562(stableJSON(converted.document));
      let actualSHA = sha2562("");
      let equivalent = false;
      let differences = [];
      if (owner === "node") {
        const target = await client.query(
          `select textbox.document_json as permanent_document,
                  textbox.plain_text as permanent_plain_text,
                  textbox.deleted_timestamp is not null as permanent_deleted,
                  transitional.canonical_document as transitional_document,
                  transitional.is_deleted as transitional_deleted,
                  checkpoint.document_json as checkpoint_document,
                  checkpoint.plain_text as checkpoint_plain_text
             from node_textboxes textbox
             left join editor_json_documents transitional
               on transitional.company_id=textbox.company_id
              and transitional.resource_type='node'
              and transitional.resource_id=textbox.node_id::text
              and transitional.document_id=textbox.textbox_id::text
             left join node_textbox_yjs_checkpoints checkpoint
               on checkpoint.company_id=textbox.company_id
              and checkpoint.node_id=textbox.node_id
              and checkpoint.textbox_id=textbox.textbox_id
              and checkpoint.collaboration_epoch=textbox.collaboration_epoch
              and checkpoint.through_update_sequence=0
            where textbox.company_id=$1::uuid and textbox.node_id=$2::uuid and textbox.textbox_id=$3::uuid`,
          [args.companyID, source.resource_id, source.document_id]
        );
        if (target.rowCount !== 1) {
          differences = [{ kind: "missing_node_targets" }];
        } else {
          const row = target.rows[0];
          const permanentSHA = sha2562(stableJSON(row.permanent_document));
          const transitionalSHA = row.transitional_document ? sha2562(stableJSON(row.transitional_document)) : sha2562("");
          const checkpointSHA = row.checkpoint_document ? sha2562(stableJSON(row.checkpoint_document)) : sha2562("");
          actualSHA = permanentSHA;
          if (permanentSHA !== expectedSHA) differences.push({ kind: "permanent_json_checksum", expected_sha256: expectedSHA, actual_sha256: permanentSHA });
          if (transitionalSHA !== expectedSHA) differences.push({ kind: "transitional_json_checksum", expected_sha256: expectedSHA, actual_sha256: transitionalSHA });
          if (checkpointSHA !== expectedSHA) differences.push({ kind: "checkpoint_json_checksum", expected_sha256: expectedSHA, actual_sha256: checkpointSHA });
          if (String(row.permanent_plain_text) !== converted.normalizedText) differences.push({ kind: "permanent_plain_text" });
          if (String(row.checkpoint_plain_text) !== converted.normalizedText) differences.push({ kind: "checkpoint_plain_text" });
          if (Boolean(row.permanent_deleted) !== source.is_deleted) differences.push({ kind: "permanent_deleted_state" });
          if (Boolean(row.transitional_deleted) !== source.is_deleted) differences.push({ kind: "transitional_deleted_state" });
          const expectedAttachmentIDs = nodeAttachmentIDs(converted.document);
          const attachmentLinks = await client.query(
            `select link.attachment_id::text,
                    link.source_resource_attachment_id is not null
                      and source_link.deleted_timestamp is null
                      and source_link.company_id=link.company_id
                      and source_link.resource_type='node'
                      and source_link.resource_id=link.node_id::text
                      and source_link.information_id=link.textbox_id
                      and source_link.attachment_id=link.attachment_id as source_identity_matches
               from node_textbox_attachment_links link
               left join resource_attachments source_link
                 on source_link.resource_attachment_id=link.source_resource_attachment_id
              where link.company_id=$1::uuid and link.node_id=$2::uuid and link.textbox_id=$3::uuid
                and link.relationship_kind='inline_image' and link.deleted_timestamp is null
              order by link.attachment_id`,
            [args.companyID, source.resource_id, source.document_id]
          );
          const actualAttachmentIDs = attachmentLinks.rows.map((link) => String(link.attachment_id));
          if (stableJSON(actualAttachmentIDs) !== stableJSON(expectedAttachmentIDs)) {
            differences.push({ kind: "permanent_attachment_ids", expected: expectedAttachmentIDs.length, actual: actualAttachmentIDs.length });
          }
          if (attachmentLinks.rows.some((link) => !link.source_identity_matches)) {
            differences.push({ kind: "permanent_attachment_source_identity" });
          }
        }
        equivalent = differences.length === 0;
      } else {
        const table = owner === "project" ? "project_editor_documents" : "logic_gate_editor_documents";
        const column = owner === "project" ? "project_id" : "logic_gate_id";
        const target = await client.query(`select document_json from ${table} where company_id=$1::uuid and ${column}=$2::uuid and document_id=$3`, [args.companyID, source.resource_id, source.document_id]);
        actualSHA = target.rowCount === 1 ? sha2562(stableJSON(target.rows[0].document_json)) : sha2562("");
        equivalent = expectedSHA === actualSHA;
        differences = equivalent ? [] : [{ kind: "json_checksum", expected_sha256: expectedSHA, actual_sha256: actualSHA }];
      }
      if (!equivalent) mismatches += 1;
      if (args.allowWrite) {
        await client.query(
          `insert into editor_shadow_comparisons(
           comparison_id,conversion_run_id,company_id,owner_type,owner_id,document_id,legacy_sha256,json_sha256,
           rendered_text_sha256,equivalent,differences,latency_ms
           ) values($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$8,$9,$10,$11::jsonb,$12)
           on conflict(conversion_run_id,owner_type,owner_id,document_id) do update set
             legacy_sha256=excluded.legacy_sha256,json_sha256=excluded.json_sha256,
             rendered_text_sha256=excluded.rendered_text_sha256,equivalent=excluded.equivalent,
             differences=excluded.differences,latency_ms=excluded.latency_ms,compared_timestamp=clock_timestamp()`,
          [
            randomUUID(),
            args.runID,
            args.companyID,
            owner,
            source.resource_id,
            source.document_id,
            sha2562(source.canonical_html),
            actualSHA,
            sha2562(converted.normalizedText),
            equivalent,
            JSON.stringify(differences),
            0
          ]
        );
      }
      process.stdout.write(`${JSON.stringify({
        owner_type: owner,
        owner_id: source.resource_id,
        document_id: source.document_id,
        source_deleted: source.is_deleted,
        equivalent,
        expected_sha256: expectedSHA,
        actual_sha256: actualSHA,
        differences
      })}
`);
    }
  }
  process.stdout.write(`${JSON.stringify({ summary: true, mismatches })}
`);
  if (mismatches > 0) process.exitCode = 2;
}
async function validateReadiness(client, args) {
  for (const owner of args.owners) {
    const inventory = await sourceInventory(client, args.companyID, owner);
    let convertedTotal = 0;
    let convertedActive = 0;
    let convertedDeleted = 0;
    let transitionalTotal = inventory.total_count;
    let checkpointTotal = inventory.total_count;
    if (owner === "node") {
      const targetResult = await client.query(
        `select count(*)::bigint as total,
                count(*) filter(where target.deleted_timestamp is null)::bigint as active,
                count(*) filter(where target.deleted_timestamp is not null)::bigint as deleted
           from node_projection_table source
           join node_textboxes target
             on target.company_id=source.company_id
            and target.node_id=source.node_id
            and target.textbox_id=source.information_id
            and target.source_information_id=source.information_id
          where source.company_id=$1::uuid and source.type='Text box'::information_type`,
        [args.companyID]
      );
      convertedTotal = Number(targetResult.rows[0].total);
      convertedActive = Number(targetResult.rows[0].active);
      convertedDeleted = Number(targetResult.rows[0].deleted);
      const transitionalResult = await client.query(
        `select count(*)::bigint as count
           from node_projection_table source
           join editor_json_documents target
             on target.company_id=source.company_id
            and target.resource_type='node'
            and target.resource_id=source.node_id::text
            and target.document_id=source.information_id::text
          where source.company_id=$1::uuid and source.type='Text box'::information_type`,
        [args.companyID]
      );
      transitionalTotal = Number(transitionalResult.rows[0].count);
      const checkpointResult = await client.query(
        `select count(*)::bigint as count
           from node_projection_table source
           join node_textboxes target
             on target.company_id=source.company_id
            and target.node_id=source.node_id
            and target.textbox_id=source.information_id
           join node_textbox_yjs_checkpoints checkpoint
             on checkpoint.company_id=target.company_id
            and checkpoint.node_id=target.node_id
            and checkpoint.textbox_id=target.textbox_id
            and checkpoint.collaboration_epoch=target.collaboration_epoch
            and checkpoint.through_update_sequence=0
          where source.company_id=$1::uuid and source.type='Text box'::information_type`,
        [args.companyID]
      );
      checkpointTotal = Number(checkpointResult.rows[0].count);
    } else {
      const targetQuery = owner === "project" ? "select count(*)::bigint as count from project_editor_documents where company_id=$1::uuid" : "select count(*)::bigint as count from logic_gate_editor_documents where company_id=$1::uuid";
      const targetResult = await client.query(targetQuery, [args.companyID]);
      convertedTotal = Number(targetResult.rows[0].count);
      convertedActive = convertedTotal;
    }
    const failureResult = await client.query("select count(*)::bigint as count from editor_conversion_items where conversion_run_id=$1::uuid and owner_type=$2 and status='failed'", [args.runID, owner]);
    const comparisonResult = await client.query(
      "select count(*)::bigint as compared,count(*) filter(where not equivalent)::bigint as mismatches from editor_shadow_comparisons where conversion_run_id=$1::uuid and owner_type=$2",
      [args.runID, owner]
    );
    const failed = Number(failureResult.rows[0].count);
    const compared = Number(comparisonResult.rows[0].compared);
    const mismatches = Number(comparisonResult.rows[0].mismatches);
    const ready = inventory.total_count === convertedTotal && inventory.active_count === convertedActive && inventory.deleted_count === convertedDeleted && transitionalTotal === inventory.total_count && checkpointTotal === inventory.total_count && failed === 0 && compared === inventory.total_count && mismatches === 0;
    await client.query(
      `insert into editor_rollout_gates(company_id,owner_type,rollout_state,expected_count,converted_count,failed_count,shadow_mismatch_count,validation_run_id,validated_timestamp)
       values($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid,case when $3='ready' then clock_timestamp() end)
       on conflict(company_id,owner_type) do update set rollout_state=excluded.rollout_state,expected_count=excluded.expected_count,
       converted_count=excluded.converted_count,failed_count=excluded.failed_count,shadow_mismatch_count=excluded.shadow_mismatch_count,
       validation_run_id=excluded.validation_run_id,validated_timestamp=excluded.validated_timestamp,updated_timestamp=clock_timestamp()`,
      [args.companyID, owner, ready ? "ready" : "shadow", inventory.active_count, convertedActive, failed, mismatches, args.runID]
    );
    process.stdout.write(`${JSON.stringify({
      owner_type: owner,
      expected_total: inventory.total_count,
      expected_active: inventory.active_count,
      expected_deleted: inventory.deleted_count,
      converted_total: convertedTotal,
      converted_active: convertedActive,
      converted_deleted: convertedDeleted,
      transitional_total: transitionalTotal,
      checkpoint_total: checkpointTotal,
      failed,
      compared,
      mismatches,
      ready
    })}
`);
    if (!ready) process.exitCode = 2;
  }
}
async function activate(client, args) {
  if (args.owners.length !== 3) throw new Error("activation is company-wide and requires --owner all");
  await client.query("begin");
  try {
    await client.query("lock table node_projection_table,editor_collaboration_documents in share mode");
    const sourceRows = await client.query(
      `with source as (
         select company_id,'node'::text as resource_type,node_id as resource_id,
                information_id::text as document_id,revision,information as source_information
           from node_projection_table
          where company_id=$1::uuid and type='Text box'::information_type and not is_deleted
         union all
         select company_id,resource_type,resource_id,document_id::text,revision,canonical_html as source_information
           from editor_collaboration_documents
          where company_id=$1::uuid and resource_type in ('project','logic_gate') and not is_deleted
       )
       select source.resource_type,source.revision::bigint as current_revision,source.source_information,
              item.source_revision::bigint as converted_revision,item.source_html_sha256
         from source
         join editor_rollout_gates gate
           on gate.company_id=source.company_id and gate.owner_type=source.resource_type
         left join editor_conversion_items item
           on item.conversion_run_id=gate.validation_run_id
          and item.company_id=source.company_id
          and item.owner_type=source.resource_type
          and item.owner_id=source.resource_id
          and item.document_id=source.document_id`,
      [args.companyID]
    );
    const expectedRows = await client.query(
      "select coalesce(sum(expected_count),0)::bigint as expected_count from editor_rollout_gates where company_id=$1::uuid and owner_type=any($2::text[]) and rollout_state='ready'",
      [args.companyID, OWNER_TYPES]
    );
    const sourceDrift = sourceRows.rows.some((row) => {
      const currentHTML = row.resource_type === "node" ? nodeProjectionDocument(String(row.source_information)) : String(row.source_information);
      return row.converted_revision === null || Number(row.current_revision) !== Number(row.converted_revision) || sha2562(currentHTML) !== row.source_html_sha256;
    });
    if (sourceRows.rowCount !== Number(expectedRows.rows[0].expected_count) || sourceDrift) {
      throw new Error("legacy_source_changed_after_validation");
    }
    const gates = await client.query(
      `select count(*)::integer as count,coalesce(sum(expected_count),0)::bigint as expected,coalesce(sum(converted_count),0)::bigint as converted
       from editor_rollout_gates where company_id=$1::uuid and owner_type=any($2::text[]) and rollout_state='ready'
       and expected_count=converted_count and failed_count=0 and shadow_mismatch_count=0`,
      [args.companyID, OWNER_TYPES]
    );
    if (Number(gates.rows[0].count) !== 3) throw new Error("all_owner_rollout_gates_must_be_ready");
    await client.query(
      `insert into workspace_editor_formats(company_id,editor_format,migration_state,document_schema_version,expected_document_count,converted_document_count,validated_timestamp,cutover_timestamp)
       values($1::uuid,'tiptap_json','ready',1,$2,$3,clock_timestamp(),clock_timestamp())
       on conflict(company_id) do update set editor_format='tiptap_json',migration_state='ready',
       expected_document_count=excluded.expected_document_count,converted_document_count=excluded.converted_document_count,
       validated_timestamp=excluded.validated_timestamp,cutover_timestamp=excluded.cutover_timestamp`,
      [args.companyID, gates.rows[0].expected, gates.rows[0].converted]
    );
    await client.query("update editor_rollout_gates set rollout_state='active',activated_timestamp=clock_timestamp(),updated_timestamp=clock_timestamp() where company_id=$1::uuid", [args.companyID]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
async function rollbackExport(client, args) {
  await ensureRun(client, { ...args, owners: ["node"] }, 0);
  const extensions = createMangoTiptapExtensions({ editable: false });
  for (const owner of args.owners) {
    const query = owner === "node" ? "select node_id::text as owner_id,textbox_id::text as document_id,content_revision as revision,latest_update_sequence,materialized_through_sequence,document_json,deleted_timestamp is not null as is_deleted from node_textboxes where company_id=$1::uuid" : owner === "project" ? "select project_id::text as owner_id,document_id,revision,null::bigint as latest_update_sequence,null::bigint as materialized_through_sequence,document_json,is_deleted from project_editor_documents where company_id=$1::uuid" : "select logic_gate_id::text as owner_id,document_id,revision,null::bigint as latest_update_sequence,null::bigint as materialized_through_sequence,document_json,is_deleted from logic_gate_editor_documents where company_id=$1::uuid";
    const rows = await client.query(query, [args.companyID]);
    for (const row of rows.rows) {
      if (owner === "node" && Number(row.latest_update_sequence) !== Number(row.materialized_through_sequence)) {
        throw new Error(`node_not_materialized:${row.owner_id}:${row.document_id}`);
      }
      const validation = validateMangoTiptapDocument(row.document_json);
      if (!validation.valid) throw new Error(validation.error);
      const html = `<!-- mango-editor-html-v1 -->${generateHTML2(validation.value.document, extensions)}`;
      await client.query(
        `insert into editor_rollback_exports(
         rollback_export_id,company_id,owner_type,owner_id,document_id,source_revision,source_update_sequence,
         source_is_deleted,source_json_sha256,exported_html,exported_html_sha256,export_run_id
         ) values($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::uuid)
         on conflict(company_id,owner_type,owner_id,document_id,source_revision) do nothing`,
        [randomUUID(), args.companyID, owner, row.owner_id, row.document_id, Number(row.revision), row.latest_update_sequence, Boolean(row.is_deleted), sha2562(stableJSON(validation.value)), html, sha2562(html), args.runID]
      );
    }
  }
  await client.query("update editor_rollout_gates set rollback_export_completed_timestamp=clock_timestamp(),updated_timestamp=clock_timestamp() where company_id=$1::uuid and owner_type=any($2::text[])", [args.companyID, args.owners]);
}
async function rollback(client, args) {
  if (args.owners.length !== 3) throw new Error("rollback is company-wide and requires --owner all");
  await client.query("begin");
  try {
    await client.query(
      "update editor_rollout_gates set rollout_state='rollback_pending',rollback_requested_timestamp=clock_timestamp(),updated_timestamp=clock_timestamp() where company_id=$1::uuid and rollout_state='active'",
      [args.companyID]
    );
    const coverage = await client.query(
      `select count(*)::integer as count from editor_rollout_gates
       where company_id=$1::uuid and owner_type=any($2::text[]) and rollout_state in ('active','rollback_pending')
       and rollback_export_completed_timestamp is not null`,
      [args.companyID, OWNER_TYPES]
    );
    if (Number(coverage.rows[0].count) !== 3) throw new Error("current_rollback_export_required");
    const missingExports = await client.query(
      `with current_documents as (
         select 'node'::text as owner_type,node_id as owner_id,textbox_id::text as document_id,content_revision as revision,latest_update_sequence as update_sequence
           from node_textboxes where company_id=$1::uuid and deleted_timestamp is null
         union all
         select 'project',project_id,document_id,revision,null::bigint from project_editor_documents where company_id=$1::uuid
         union all
         select 'logic_gate',logic_gate_id,document_id,revision,null::bigint from logic_gate_editor_documents where company_id=$1::uuid
       )
       select count(*)::bigint as count from current_documents current_document
        where not exists (
          select 1 from editor_rollback_exports export
           where export.company_id=$1::uuid and export.owner_type=current_document.owner_type
             and export.owner_id=current_document.owner_id and export.document_id=current_document.document_id
             and export.source_revision=current_document.revision
             and export.source_update_sequence is not distinct from current_document.update_sequence
        )`,
      [args.companyID]
    );
    if (Number(missingExports.rows[0].count) !== 0) throw new Error("current_rollback_export_does_not_cover_all_documents");
    await client.query(
      "update workspace_editor_formats set editor_format='legacy_html',migration_state='validated',cutover_timestamp=null,updated_timestamp=clock_timestamp() where company_id=$1::uuid",
      [args.companyID]
    );
    await client.query(
      `update editor_collaboration_documents legacy set
       canonical_html=export.exported_html,is_deleted=export.source_is_deleted,
       revision=legacy.revision+1,updated_timestamp=clock_timestamp()
       from (
         select distinct on(owner_type,owner_id,document_id) owner_type,owner_id,document_id,exported_html,source_is_deleted
         from editor_rollback_exports where company_id=$1::uuid
         order by owner_type,owner_id,document_id,source_revision desc
       ) export
       where legacy.company_id=$1::uuid and legacy.resource_type=export.owner_type
         and legacy.resource_id=export.owner_id and legacy.document_id::text=export.document_id`,
      [args.companyID]
    );
    await client.query(
      `insert into editor_collaboration_documents(
         company_id,resource_type,resource_id,document_id,revision,canonical_html,is_deleted,created_timestamp,updated_timestamp
       )
       select export.company_id,export.owner_type,export.owner_id,export.document_id::uuid,
              export.source_revision,export.exported_html,export.source_is_deleted,clock_timestamp(),clock_timestamp()
       from (
         select distinct on(owner_type,owner_id,document_id)
                company_id,owner_type,owner_id,document_id,source_revision,exported_html,source_is_deleted
         from editor_rollback_exports where company_id=$1::uuid
         order by owner_type,owner_id,document_id,source_revision desc
       ) export
       where not exists (
         select 1 from editor_collaboration_documents legacy
         where legacy.company_id=export.company_id and legacy.resource_type=export.owner_type
           and legacy.resource_id=export.owner_id and legacy.document_id::text=export.document_id
       )`,
      [args.companyID]
    );
    await client.query(
      "update editor_rollout_gates set rollout_state='rolled_back',rolled_back_timestamp=clock_timestamp(),updated_timestamp=clock_timestamp() where company_id=$1::uuid",
      [args.companyID]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
async function main() {
  const args = parseArguments(process.argv.slice(2));
  assertWriteSafety(args);
  const databaseURL = String(process.env.MANGORTS_MIGRATION_DATABASE_URL || "").trim();
  if (!databaseURL) throw new Error("MANGORTS_MIGRATION_DATABASE_URL is required");
  const pool = new Pool({ connectionString: databaseURL, max: 2, application_name: "mangorts-editor-migration" });
  const client = await pool.connect();
  try {
    if (!args.allowWrite) await client.query("begin read only");
    if (["inventory", "dry-run", "backfill"].includes(args.mode)) await runConversion(client, args);
    else if (args.mode === "shadow") await shadowValidate(client, args);
    else if (args.mode === "readiness") await validateReadiness(client, args);
    else if (args.mode === "activate") await activate(client, args);
    else if (args.mode === "rollback-export") await rollbackExport(client, args);
    else if (args.mode === "rollback") await rollback(client, args);
    if (!args.allowWrite) await client.query("rollback");
  } finally {
    client.release();
    await pool.end();
  }
}
void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "unknown migration failure"}
`);
  process.exitCode = 1;
});
