export type MentionableCompanyUser = {
  company_id?: string;
  user_id: string;
  email?: string;
  display_name?: string;
  role?: string;
};

export type ActiveMentionDraft = {
  start: number;
  end: number;
  query: string;
};

export type MentionTextSegment = {
  text: string;
  mention: boolean;
  user?: MentionableCompanyUser;
};

export const EDITOR_MENTION_ATTRIBUTE = "data-mango-mention";
export const EDITOR_MENTION_USER_ID_ATTRIBUTE = "data-mango-mention-user-id";
export const EDITOR_MENTION_BACKGROUND = "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(230,252,255,0.66) 46%, rgba(247,239,255,0.72))";
export const EDITOR_MENTION_COLOR = "#0f172a";

const MENTION_BOUNDARY_PATTERN = /[A-Za-z0-9_@.-]/;

export function mentionUserDisplayName(user: MentionableCompanyUser): string {
  const name = (user.display_name ?? "").trim();
  if (name) return name;
  const email = (user.email ?? "").trim();
  if (!email) return user.user_id;
  const atIndex = email.indexOf("@");
  return atIndex > 0 ? email.slice(0, atIndex) : email;
}

export function mentionUserOptionLabel(user: MentionableCompanyUser): string {
  const name = (user.display_name ?? "").trim();
  const email = (user.email ?? "").trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user.user_id;
}

export function normalizedMentionSearch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function readActiveMentionDraft(value: string, caretIndex: number | null): ActiveMentionDraft | null {
  if (caretIndex === null || caretIndex < 0 || caretIndex > value.length) return null;
  const beforeCaret = value.slice(0, caretIndex);
  const atIndex = beforeCaret.lastIndexOf("@");
  if (atIndex < 0) return null;
  const prefix = atIndex > 0 ? value[atIndex - 1] : "";
  if (prefix && MENTION_BOUNDARY_PATTERN.test(prefix)) return null;
  const query = beforeCaret.slice(atIndex + 1);
  if (query.includes("\n") || query.includes("\r")) return null;
  if (query.length > 0 && /\s$/.test(query)) return null;
  if (/[,;:()[\]{}]/.test(query)) return null;
  return { start: atIndex, end: caretIndex, query };
}

export function mentionUserMatches(user: MentionableCompanyUser, query: string): boolean {
  const normalizedQuery = normalizedMentionSearch(query);
  if (!normalizedQuery) return true;
  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const labels = mentionAliasesForUser(user);
  return labels.some((label) => {
    const normalizedLabel = normalizedMentionSearch(label);
    return normalizedLabel.includes(normalizedQuery) || normalizedLabel.replace(/\s+/g, "").includes(compactQuery);
  });
}

export function buildMentionOptions(users: MentionableCompanyUser[], query: string, limit = 8): MentionableCompanyUser[] {
  return users
    .filter((user) => user.user_id.trim() && mentionUserMatches(user, query))
    .sort((a, b) => mentionUserOptionLabel(a).localeCompare(mentionUserOptionLabel(b), undefined, { numeric: true, sensitivity: "base" }))
    .slice(0, Math.max(1, limit));
}

export function applyEditorMentionStyle(element: HTMLElement) {
  element.setAttribute(EDITOR_MENTION_ATTRIBUTE, "true");
  element.style.background = EDITOR_MENTION_BACKGROUND;
  element.style.color = EDITOR_MENTION_COLOR;
  element.style.border = "1px solid rgba(183, 124, 255, 0.34)";
  element.style.borderRadius = "6px";
  element.style.padding = "0 4px";
  element.style.fontWeight = "800";
  element.style.boxShadow = "inset 1px 1px 0 rgba(255,255,255,0.86), 0 2px 7px rgba(15,23,42,0.08)";
  element.style.setProperty("box-decoration-break", "clone");
}

export function createEditorMentionElement(ownerDocument: Document, user: MentionableCompanyUser): HTMLSpanElement {
  const span = ownerDocument.createElement("span");
  applyEditorMentionStyle(span);
  span.setAttribute(EDITOR_MENTION_USER_ID_ATTRIBUTE, user.user_id.trim());
  span.textContent = `@${mentionUserDisplayName(user)}`;
  return span;
}

export function isEditorMentionElement(element: HTMLElement): boolean {
  return element.getAttribute(EDITOR_MENTION_ATTRIBUTE) === "true";
}

export function mentionAliasesForUser(user: MentionableCompanyUser): string[] {
  const email = (user.email ?? "").trim();
  const aliases = [
    mentionUserDisplayName(user),
    mentionUserDisplayName(user).replace(/\s+/g, ""),
    email,
    user.user_id,
  ];
  const atIndex = email.indexOf("@");
  if (atIndex > 0) aliases.push(email.slice(0, atIndex));
  const seen = new Set<string>();
  return aliases
    .map((alias) => alias.trim())
    .filter((alias) => {
      const key = alias.toLowerCase();
      if (!alias || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function mentionBoundaryBefore(value: string, atIndex: number): boolean {
  if (atIndex <= 0) return true;
  return !MENTION_BOUNDARY_PATTERN.test(value[atIndex - 1] ?? "");
}

function mentionBoundaryAfter(value: string, endIndex: number): boolean {
  if (endIndex >= value.length) return true;
  return !MENTION_BOUNDARY_PATTERN.test(value[endIndex] ?? "");
}

export function splitTextByMentions(value: string, users: MentionableCompanyUser[]): MentionTextSegment[] {
  if (!value || !value.includes("@") || users.length === 0) return value ? [{ text: value, mention: false }] : [];
  const aliases = users
    .flatMap((user) => mentionAliasesForUser(user).map((alias) => ({ user, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const segments: MentionTextSegment[] = [];
  let cursor = 0;
  let plainStart = 0;
  const lowerValue = value.toLowerCase();

  while (cursor < value.length) {
    if (value[cursor] !== "@" || !mentionBoundaryBefore(value, cursor)) {
      cursor += 1;
      continue;
    }

    const match = aliases.find(({ alias }) => {
      const start = cursor + 1;
      const end = start + alias.length;
      return lowerValue.slice(start, end) === alias.toLowerCase() && mentionBoundaryAfter(value, end);
    });
    if (!match) {
      cursor += 1;
      continue;
    }

    if (plainStart < cursor) segments.push({ text: value.slice(plainStart, cursor), mention: false });
    const end = cursor + 1 + match.alias.length;
    segments.push({ text: value.slice(cursor, end), mention: true, user: match.user });
    cursor = end;
    plainStart = end;
  }

  if (plainStart < value.length) segments.push({ text: value.slice(plainStart), mention: false });
  return segments;
}
