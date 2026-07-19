import type { EmailAttachment, EmailMessage } from "../../modules/communications/communicationsApi.js";
import { editorBodyHasEmailContent, serializeEditorBodyForEmailHTML } from "../../modules/editor/richTextEditing.js";
import { serializeRichEditorBodyForEmailDelivery } from "../../modules/editor/tiptap/mangoTiptapEmail.js";
import { formatAddressList } from "./homeUtils.js";

const MANGO_ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORWARDED_SAFE_TAGS = new Set([
  "a", "abbr", "address", "b", "blockquote", "br", "caption", "center", "cite", "code",
  "col", "colgroup", "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "img", "ins", "li", "ol", "p", "pre", "s", "small",
  "span", "strike", "strong", "style", "sub", "sup", "table", "tbody", "td", "tfoot",
  "th", "thead", "tr", "tt", "u", "ul",
]);
const FORWARDED_DANGEROUS_SELECTOR = [
  "script", "iframe", "object", "embed", "form", "input", "button", "textarea", "select",
  "option", "meta", "link", "base", "svg", "math", "video", "audio", "source", "canvas",
].join(",");

function escapeHTML(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function cleanContentID(value: string | undefined): string {
  return (value ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function forwardedAttachmentIDByContentID(message: EmailMessage): Map<string, string> {
  const result = new Map<string, string>();
  for (const attachment of message.attachments ?? []) {
    const contentID = cleanContentID(attachment.content_id);
    const attachmentID = attachment.attachment_id?.trim() ?? "";
    if (contentID && MANGO_ATTACHMENT_ID_PATTERN.test(attachmentID)) result.set(contentID, attachmentID);
  }
  return result;
}

function rewriteCIDURL(value: string, attachmentByContentID: Map<string, string>): string {
  const cleanValue = value.trim();
  if (!cleanValue.toLowerCase().startsWith("cid:")) return cleanValue;
  const contentID = cleanContentID(cleanValue.slice(4));
  const attachmentID = attachmentByContentID.get(contentID);
  return attachmentID ? `mango-attachment:${encodeURIComponent(attachmentID)}` : `cid:${contentID}`;
}

function safeForwardedURL(value: string, kind: "link" | "image", attachmentByContentID: Map<string, string>): string {
  const rewritten = rewriteCIDURL(value, attachmentByContentID);
  if (/^https?:\/\//i.test(rewritten) || /^\/\//.test(rewritten)) return rewritten;
  if (kind === "link" && /^(?:mailto|tel):/i.test(rewritten)) return rewritten;
  if (kind === "image" && /^(?:cid:|mango-attachment:)/i.test(rewritten)) return rewritten;
  return "";
}

function sanitizeForwardedCSS(value: string): string {
  return value
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/(?:expression|behavior|-moz-binding)\s*:[^;}]+;?/gi, "")
    .replace(/url\(\s*(['"]?)\s*(?:javascript|vbscript|data):[\s\S]*?\1\s*\)/gi, "none")
    .replace(/position\s*:\s*fixed\s*;?/gi, "")
    .replace(/z-index\s*:\s*[0-9]+\s*;?/gi, "");
}

function imageLooksLikeTracker(element: HTMLElement): boolean {
  const width = Number.parseFloat(element.getAttribute("width") ?? "");
  const height = Number.parseFloat(element.getAttribute("height") ?? "");
  const style = element.getAttribute("style") ?? "";
  const hidden = /(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\D|$))/i.test(style);
  const tinyStyle = /width\s*:\s*[01](?:px)?(?:\s*!important)?\s*;?/i.test(style)
    && /height\s*:\s*[01](?:px)?(?:\s*!important)?\s*;?/i.test(style);
  return hidden || tinyStyle || (Number.isFinite(width) && width <= 1 && Number.isFinite(height) && height <= 1);
}

function sanitizeForwardedHTMLWithDOM(rawHTML: string, attachmentByContentID: Map<string, string>): string {
  const parsed = new DOMParser().parseFromString(rawHTML, "text/html");
  const styles = Array.from(parsed.querySelectorAll("style"))
    .map((style) => sanitizeForwardedCSS(style.textContent ?? "").trim())
    .filter(Boolean);
  parsed.querySelectorAll("style").forEach((style) => style.remove());
  parsed.querySelectorAll(FORWARDED_DANGEROUS_SELECTOR).forEach((element) => element.remove());

  for (const element of Array.from(parsed.body.querySelectorAll("*"))) {
    const tagName = element.tagName.toLowerCase();
    if (!FORWARDED_SAFE_TAGS.has(tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || ["srcdoc", "ping", "action", "formaction", "nonce", "integrity", "contenteditable", "tabindex"].includes(name)) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.hasAttribute("style")) {
      const style = sanitizeForwardedCSS(element.getAttribute("style") ?? "").trim();
      if (style) element.setAttribute("style", style);
      else element.removeAttribute("style");
    }
    if (element instanceof HTMLAnchorElement) {
      const href = safeForwardedURL(element.getAttribute("href") ?? "", "link", attachmentByContentID);
      if (href) element.setAttribute("href", href);
      else element.removeAttribute("href");
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
    if (element instanceof HTMLImageElement) {
      if (imageLooksLikeTracker(element)) {
        element.remove();
        continue;
      }
      const src = safeForwardedURL(element.getAttribute("src") ?? "", "image", attachmentByContentID);
      if (src) element.setAttribute("src", src);
      else element.removeAttribute("src");
      element.removeAttribute("srcset");
      element.removeAttribute("usemap");
      element.setAttribute("referrerpolicy", "no-referrer");
      element.setAttribute("style", `${element.getAttribute("style") ?? ""};max-width:100%;height:auto;`);
    }
  }

  const safeStyles = styles.map((style) => `<style data-mango-forwarded-style="true">${style}</style>`).join("");
  return `${safeStyles}${parsed.body.innerHTML}`.trim();
}

function sanitizeForwardedHTMLFallback(rawHTML: string, attachmentByContentID: Map<string, string>): string {
  if (!/<[a-z!/][\s\S]*>/i.test(rawHTML)) return escapeHTML(rawHTML).replace(/\r?\n/g, "<br>");
  let result = rawHTML
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, "")
    .replace(/<(script|iframe|object|embed|form|button|textarea|select|svg|math|video|audio|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(?:input|meta|link|base|source)\b[^>]*\/?\s*>/gi, "")
    .replace(/<img\b(?=[^>]*(?:width\s*=\s*["']?1(?:px)?["']?))(?=[^>]*(?:height\s*=\s*["']?1(?:px)?["']?))[^>]*>/gi, "")
    .replace(/\s+on[a-z0-9_-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:srcdoc|ping|action|formaction|nonce|integrity|contenteditable|tabindex)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(href|src)\s*=\s*(["'])([\s\S]*?)\2/gi, (_match, name: string, quote: string, value: string) => (
      /^(?:javascript|vbscript|data):/i.test(value.trim()) ? "" : ` ${name}=${quote}${value}${quote}`
    ))
    .replace(/\s+style\s*=\s*(["'])([\s\S]*?)\1/gi, (_match, quote: string, css: string) => {
      const safeCSS = sanitizeForwardedCSS(css).trim();
      return safeCSS ? ` style=${quote}${safeCSS}${quote}` : "";
    })
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (_match, attributes: string, css: string) => `<style${attributes}>${sanitizeForwardedCSS(css)}</style>`);
  result = result.replace(/\bcid:([^"'\s)>]+)/gi, (_match, contentID: string) => {
    const normalized = cleanContentID(contentID);
    const attachmentID = attachmentByContentID.get(normalized);
    return attachmentID ? `mango-attachment:${encodeURIComponent(attachmentID)}` : `cid:${normalized}`;
  });
  return result.trim();
}

export function sanitizeForwardedEmailHTML(rawHTML: string, message?: EmailMessage | null): string {
  const source = rawHTML.trim();
  if (!source) return "";
  const attachmentByContentID = message ? forwardedAttachmentIDByContentID(message) : new Map<string, string>();
  if (typeof DOMParser !== "undefined") return sanitizeForwardedHTMLWithDOM(source, attachmentByContentID);
  return sanitizeForwardedHTMLFallback(source, attachmentByContentID);
}

function formatForwardedDate(date: number | undefined): string {
  if (!Number.isFinite(date ?? NaN)) return "";
  return new Date(Math.max(0, Math.trunc(date ?? 0)) * 1000).toLocaleString();
}

function forwardedHeaderRow(label: string, value: string): string {
  if (!value.trim()) return "";
  return `<div style="margin:0 0 2px;"><strong>${escapeHTML(label)}:</strong> ${escapeHTML(value)}</div>`;
}

export function buildForwardedEmailHTML(message: EmailMessage): string {
  const body = sanitizeForwardedEmailHTML(message.body || message.snippet || "", message);
  const header = [
    forwardedHeaderRow("From", formatAddressList(message.from) || "Unknown sender"),
    forwardedHeaderRow("Date", formatForwardedDate(message.date)),
    forwardedHeaderRow("Subject", message.subject || "(no subject)"),
    forwardedHeaderRow("To", formatAddressList(message.to)),
    forwardedHeaderRow("Cc", formatAddressList(message.cc)),
  ].join("");
  return [
    '<section data-mango-forwarded-message="true" style="margin-top:20px;padding-top:14px;border-top:1px solid #cbd5e1;color:#111827;">',
    '<div style="margin:0 0 10px;font:700 13px/1.4 Arial,sans-serif;color:#334155;">---------- Forwarded message ---------</div>',
    `<div style="margin:0 0 14px;font:12px/1.45 Arial,sans-serif;color:#334155;">${header}</div>`,
    `<div data-mango-forwarded-body="true" style="min-width:0;max-width:100%;overflow-wrap:anywhere;">${body}</div>`,
    "</section>",
  ].join("");
}

export function buildForwardedComposeBody(editorBody: string, sourceMessage: EmailMessage | null | undefined): string {
  const authoredBody = serializeRichEditorBodyForEmailDelivery(editorBody)
    ?? (editorBodyHasEmailContent(editorBody) ? serializeEditorBodyForEmailHTML(editorBody) : "");
  if (!sourceMessage) return authoredBody;
  const forwardedBody = buildForwardedEmailHTML(sourceMessage);
  return authoredBody ? `${authoredBody}<br><br>${forwardedBody}` : forwardedBody;
}

export function forwardedProviderAttachmentID(attachment: EmailAttachment): string {
  return attachment.id?.trim() || "";
}

export function forwardedAttachmentsForCopy(message: EmailMessage): EmailAttachment[] {
  const body = message.body || message.snippet || "";
  return (message.attachments ?? []).filter((attachment) => {
    const providerID = forwardedProviderAttachmentID(attachment);
    if (!providerID) return false;
    if (!attachment.is_inline && !attachment.content_id?.trim()) return true;
    const contentID = cleanContentID(attachment.content_id);
    return Boolean(contentID && body.toLowerCase().includes(`cid:${contentID}`));
  });
}

export function withForwardedAttachmentCopy(message: EmailMessage, providerAttachmentID: string, mangoAttachmentID: string): EmailMessage {
  return {
    ...message,
    attachments: (message.attachments ?? []).map((attachment) => (
      forwardedProviderAttachmentID(attachment) === providerAttachmentID
        ? { ...attachment, attachment_id: mangoAttachmentID }
        : { ...attachment }
    )),
  };
}
