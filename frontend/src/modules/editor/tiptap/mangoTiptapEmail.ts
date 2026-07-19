import type { JSONContent } from "@tiptap/core";
import { parseMangoTiptapDocument } from "./mangoTiptapDocument.js";

function escapeHTML(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function styleAttribute(styles: Array<string | undefined>): string {
  const value = styles.filter(Boolean).join(";");
  return value ? ` style="${escapeHTML(value)}"` : "";
}

function renderMarks(text: string, marks: JSONContent["marks"] = []): string {
  return (marks ?? []).reduce((content, mark) => {
    const attrs = mark.attrs ?? {};
    switch (mark.type) {
      case "bold": return `<strong>${content}</strong>`;
      case "italic": return `<em>${content}</em>`;
      case "underline": return `<u>${content}</u>`;
      case "strike": return `<s>${content}</s>`;
      case "code": return `<code>${content}</code>`;
      case "highlight": return `<mark${styleAttribute([attrs.color ? `background-color:${attrs.color}` : undefined])}>${content}</mark>`;
      case "textStyle":
        return `<span${styleAttribute([
          attrs.fontSize ? `font-size:${attrs.fontSize}` : undefined,
          attrs.color ? `color:${attrs.color}` : undefined,
        ])}>${content}</span>`;
      case "link":
        return `<a href="${escapeHTML(attrs.href)}" target="_blank" rel="noopener noreferrer">${content}</a>`;
      default:
        return content;
    }
  }, escapeHTML(text));
}

function renderChildren(node: JSONContent): string {
  return (node.content ?? []).map(renderNode).join("");
}

function renderNode(node: JSONContent): string {
  const attrs = node.attrs ?? {};
  const alignment = typeof attrs.textAlign === "string" ? `text-align:${attrs.textAlign}` : undefined;
  const indent = Number.isFinite(attrs.indentLevel) && Number(attrs.indentLevel) > 0
    ? `margin-left:${Number(attrs.indentLevel) * 24}px`
    : undefined;
  switch (node.type) {
    case "doc": return renderChildren(node);
    case "text": return renderMarks(node.text ?? "", node.marks);
    case "hardBreak": return "<br>";
    case "paragraph": return `<p${styleAttribute([alignment, indent])}>${renderChildren(node) || "<br>"}</p>`;
    case "heading": {
      const level = Math.max(1, Math.min(6, Math.trunc(Number(attrs.level) || 1)));
      return `<h${level}${styleAttribute([alignment, indent])}>${renderChildren(node)}</h${level}>`;
    }
    case "blockquote": return `<blockquote>${renderChildren(node)}</blockquote>`;
    case "codeBlock": return `<pre><code>${renderChildren(node)}</code></pre>`;
    case "horizontalRule": return "<hr>";
    case "bulletList": return `<ul>${renderChildren(node)}</ul>`;
    case "orderedList": return `<ol start="${escapeHTML(attrs.start ?? 1)}">${renderChildren(node)}</ol>`;
    case "taskList": return `<ul data-mango-task-list="true">${renderChildren(node)}</ul>`;
    case "listItem": return `<li>${renderChildren(node)}</li>`;
    case "taskItem": return `<li data-checked="${attrs.checked === true ? "true" : "false"}">${attrs.checked === true ? "&#9745; " : "&#9744; "}${renderChildren(node)}</li>`;
    case "table": return `<table style="border-collapse:collapse;width:100%"><tbody>${renderChildren(node)}</tbody></table>`;
    case "tableRow": return `<tr>${renderChildren(node)}</tr>`;
    case "tableHeader":
    case "tableCell": {
      const tag = node.type === "tableHeader" ? "th" : "td";
      const colwidth = Array.isArray(attrs.colwidth) && attrs.colwidth[0] ? `width:${attrs.colwidth[0]}px` : undefined;
      return `<${tag} colspan="${escapeHTML(attrs.colspan ?? 1)}" rowspan="${escapeHTML(attrs.rowspan ?? 1)}"${styleAttribute(["border:1px solid #cbd5e1", "padding:6px", colwidth, attrs.backgroundColor ? `background-color:${attrs.backgroundColor}` : undefined, attrs.align ? `text-align:${attrs.align}` : undefined])}>${renderChildren(node)}</${tag}>`;
    }
    case "mention": return `<span data-mango-mention-user-id="${escapeHTML(attrs.userId)}">@${escapeHTML(attrs.label || attrs.userId)}</span>`;
    case "mangoAttachmentImage": {
      const width = Number(attrs.displayWidth || attrs.width || 0);
      const height = Number(attrs.displayHeight || attrs.height || 0);
      return `<img src="mango-attachment:${encodeURIComponent(String(attrs.attachmentId))}" data-mango-attachment-id="${escapeHTML(attrs.attachmentId)}" alt="${escapeHTML(attrs.alt || attrs.filename || "Attached image")}" title="${escapeHTML(attrs.title || attrs.filename || "")}"${width > 0 ? ` width="${Math.round(width)}"` : ""}${height > 0 ? ` height="${Math.round(height)}"` : ""}${styleAttribute(["max-width:100%", "height:auto", attrs.alignment === "center" ? "display:block;margin-left:auto;margin-right:auto" : attrs.alignment === "right" ? "display:block;margin-left:auto" : undefined])}>`;
    }
    default: return "";
  }
}

export function serializeMangoTiptapEmailHTML(serialized: string): string {
  const parsed = parseMangoTiptapDocument(serialized);
  if (!parsed.valid) throw new Error(`invalid_tiptap_email_document: ${parsed.error}`);
  return `<div data-mango-email-body="true" data-mango-editor-format="tiptap-json" style="font:14px/1.5 Helvetica,Arial,sans-serif;overflow-wrap:anywhere">${renderNode(parsed.value.document)}</div>`;
}

export function serializeRichEditorBodyForEmailDelivery(serialized: string): string | null {
  const parsed = parseMangoTiptapDocument(serialized);
  return parsed.valid ? serializeMangoTiptapEmailHTML(serialized) : null;
}
