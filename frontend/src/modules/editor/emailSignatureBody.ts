import {
  EDITOR_RICH_TEXT_PREFIX,
  linkifyEditorPlainTextToHTML,
  sanitizeEditorDocumentHTML,
} from "./richTextEditing.js";

export type ScopedEmailSignatureState = Readonly<{
  scopeKey: string;
  loaded: boolean;
  body: string;
}>;

export type EmailSignatureApplicationSession = Readonly<{
  scopeKey: string;
  applied: boolean;
}>;

export function loadedEmailSignatureForScope(state: ScopedEmailSignatureState, scopeKey: string): string | null {
  return state.loaded && state.scopeKey === scopeKey ? state.body : null;
}

export function beginEmailSignatureApplicationSession(
  current: EmailSignatureApplicationSession | null,
  scopeKey: string,
): EmailSignatureApplicationSession {
  return current?.scopeKey === scopeKey ? current : { scopeKey, applied: false };
}

export function applyEmailSignatureOnceForSession(
  body: string,
  signature: string,
  current: EmailSignatureApplicationSession | null,
  scopeKey: string,
): { body: string; session: EmailSignatureApplicationSession } {
  const session = beginEmailSignatureApplicationSession(current, scopeKey);
  if (session.applied) return { body, session };
  return {
    body: applyEmailSignature(body, signature),
    session: { scopeKey, applied: true },
  };
}

function plainTextToEditorHTML(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line ? linkifyEditorPlainTextToHTML(line) : "<br>")
    .join("<br>");
}

function storedSignatureEditorHTML(signature: string): string {
  const cleanSignature = signature.trim();
  if (!cleanSignature) return "";
  if (cleanSignature.startsWith(EDITOR_RICH_TEXT_PREFIX)) {
    return sanitizeEditorDocumentHTML(cleanSignature.slice(EDITOR_RICH_TEXT_PREFIX.length));
  }
  return sanitizeEditorDocumentHTML(`<div>${plainTextToEditorHTML(cleanSignature)}</div>`);
}

function normalizedEditorText(value: string): string {
  const cleanValue = value.startsWith(EDITOR_RICH_TEXT_PREFIX)
    ? sanitizeEditorDocumentHTML(value.slice(EDITOR_RICH_TEXT_PREFIX.length))
    : value;
  return cleanValue
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/(?:&#39;|&apos;)/gi, "'")
    .replace(/&#96;/gi, "`")
    .replace(/\s+/g, " ")
    .trim();
}

export function emailBodyWithoutSignature(body: string, signature: string): string {
  const cleanBody = body.trimEnd();
  const cleanSignature = signature.trim();
  if (!cleanBody || !cleanSignature) return cleanBody;
  if (!cleanBody.startsWith(EDITOR_RICH_TEXT_PREFIX)) {
    return cleanBody.endsWith(cleanSignature)
      ? cleanBody.slice(0, -cleanSignature.length).trimEnd()
      : cleanBody;
  }

  const bodyHTML = sanitizeEditorDocumentHTML(cleanBody.slice(EDITOR_RICH_TEXT_PREFIX.length)).trimEnd();
  const signatureHTML = storedSignatureEditorHTML(cleanSignature).trim();
  if (signatureHTML && bodyHTML.endsWith(signatureHTML)) {
    return EDITOR_RICH_TEXT_PREFIX + bodyHTML.slice(0, -signatureHTML.length).trimEnd();
  }
  return normalizedEditorText(cleanBody) === normalizedEditorText(cleanSignature) ? "" : cleanBody;
}

export function emailBodyHasSignature(body: string, signature: string): boolean {
  const cleanBody = body.trimEnd();
  const cleanSignature = signature.trim();
  if (!cleanBody || !cleanSignature) return false;
  if (!cleanBody.startsWith(EDITOR_RICH_TEXT_PREFIX)) return cleanBody.endsWith(cleanSignature);

  const bodyHTML = sanitizeEditorDocumentHTML(cleanBody.slice(EDITOR_RICH_TEXT_PREFIX.length)).trimEnd();
  const signatureHTML = storedSignatureEditorHTML(cleanSignature).trim();
  if (signatureHTML && bodyHTML.endsWith(signatureHTML)) return true;

  const bodyText = normalizedEditorText(cleanBody);
  const signatureText = normalizedEditorText(cleanSignature);
  return !!signatureText && (bodyText === signatureText || bodyText.endsWith(` ${signatureText}`));
}

export function applyEmailSignature(body: string, signature: string): string {
  const cleanSignature = signature.trim();
  if (!cleanSignature || emailBodyHasSignature(body, cleanSignature)) return body;

  const currentHTML = body.startsWith(EDITOR_RICH_TEXT_PREFIX)
    ? sanitizeEditorDocumentHTML(body.slice(EDITOR_RICH_TEXT_PREFIX.length))
    : body.trim()
      ? sanitizeEditorDocumentHTML(`<div>${plainTextToEditorHTML(body.trimEnd())}</div>`)
      : "";
  const signatureHTML = storedSignatureEditorHTML(cleanSignature);
  const spacerHTML = "<div><br></div><div><br></div>";
  return `${EDITOR_RICH_TEXT_PREFIX}${sanitizeEditorDocumentHTML(`${currentHTML}${spacerHTML}${signatureHTML}`)}`;
}
