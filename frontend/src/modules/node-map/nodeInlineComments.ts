export type NodeInlineCommentMessage = {
  id: string;
  body: string;
  authorLabel: string;
  createdAt: string;
};

export type NodeInlineCommentThread = {
  id: string;
  nodeID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  createdAt: string;
  resolvedAt?: string;
  messages: NodeInlineCommentMessage[];
};

export type NodeInlineCommentDraft = {
  nodeID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  anchorX: number;
  anchorY: number;
};

export type NodeInlineCommentSegment = {
  text: string;
  startOffset: number;
  endOffset: number;
  threadIDs: string[];
};

export const NODE_INLINE_COMMENTS_STORAGE_PREFIX = "mango-node-inline-comments-v1";

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function cleanTimestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function makeID(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function buildNodeInlineCommentsStorageKey(companyID: string): string {
  return `${NODE_INLINE_COMMENTS_STORAGE_PREFIX}:${companyID.trim() || "default"}`;
}

export function createNodeInlineCommentThread(draft: NodeInlineCommentDraft, id = makeID("thread"), createdAt = new Date().toISOString()): NodeInlineCommentThread {
  return {
    id,
    nodeID: draft.nodeID,
    quote: draft.quote,
    startOffset: draft.startOffset,
    endOffset: draft.endOffset,
    createdAt,
    messages: [],
  };
}

export function createNodeInlineCommentMessage(body: string, authorLabel = "You", id = makeID("message"), createdAt = new Date().toISOString()): NodeInlineCommentMessage | null {
  const value = body.trim();
  if (!value) return null;
  return {
    id,
    body: value,
    authorLabel,
    createdAt,
  };
}

function sanitizeMessage(value: unknown): NodeInlineCommentMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const body = cleanText(record.body);
  if (!body) return null;
  const now = new Date().toISOString();
  return {
    id: cleanText(record.id) || makeID("message"),
    body,
    authorLabel: cleanText(record.authorLabel) || "You",
    createdAt: cleanTimestamp(record.createdAt, now),
  };
}

function sanitizeThread(value: unknown): NodeInlineCommentThread | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const nodeID = cleanText(record.nodeID);
  const quote = cleanText(record.quote);
  const startOffset = Math.max(0, cleanInteger(record.startOffset));
  const endOffset = Math.max(startOffset, cleanInteger(record.endOffset));
  if (!nodeID || !quote || endOffset <= startOffset) return null;
  const now = new Date().toISOString();
  const rawMessages = Array.isArray(record.messages) ? record.messages : [];
  const messages = rawMessages.map(sanitizeMessage).filter((message): message is NodeInlineCommentMessage => !!message);
  const resolvedAt = cleanText(record.resolvedAt);
  return {
    id: cleanText(record.id) || makeID("thread"),
    nodeID,
    quote,
    startOffset,
    endOffset,
    createdAt: cleanTimestamp(record.createdAt, now),
    ...(resolvedAt ? { resolvedAt } : {}),
    messages,
  };
}

export function parseNodeInlineCommentThreads(value: string | null): NodeInlineCommentThread[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeThread).filter((thread): thread is NodeInlineCommentThread => !!thread);
  } catch {
    return [];
  }
}

export function readNodeInlineCommentThreads(storageKey: string, storage = browserStorage()): NodeInlineCommentThread[] {
  if (!storage) return [];
  return parseNodeInlineCommentThreads(storage.getItem(storageKey));
}

export function writeNodeInlineCommentThreads(storageKey: string, threads: NodeInlineCommentThread[], storage = browserStorage()): void {
  if (!storage) return;
  if (threads.length === 0) {
    storage.removeItem(storageKey);
    return;
  }
  storage.setItem(storageKey, JSON.stringify(threads));
}

function resolveThreadRange(title: string, thread: NodeInlineCommentThread): { startOffset: number; endOffset: number; threadID: string } | null {
  if (thread.resolvedAt) return null;
  const quote = cleanText(thread.quote);
  if (!quote) return null;
  const boundedStart = Math.max(0, Math.min(title.length, thread.startOffset));
  const boundedEnd = Math.max(boundedStart, Math.min(title.length, thread.endOffset));
  if (boundedEnd > boundedStart && title.slice(boundedStart, boundedEnd) === quote) {
    return { startOffset: boundedStart, endOffset: boundedEnd, threadID: thread.id };
  }
  const fallbackStart = title.indexOf(quote);
  if (fallbackStart < 0) return null;
  return {
    startOffset: fallbackStart,
    endOffset: fallbackStart + quote.length,
    threadID: thread.id,
  };
}

export function buildNodeTitleCommentSegments(title: string, threads: NodeInlineCommentThread[]): NodeInlineCommentSegment[] {
  if (!title) return [];
  const ranges = threads
    .map((thread) => resolveThreadRange(title, thread))
    .filter((range): range is { startOffset: number; endOffset: number; threadID: string } => !!range);
  if (ranges.length === 0) {
    return [{ text: title, startOffset: 0, endOffset: title.length, threadIDs: [] }];
  }

  const breakpoints = new Set([0, title.length]);
  for (const range of ranges) {
    breakpoints.add(range.startOffset);
    breakpoints.add(range.endOffset);
  }
  const ordered = Array.from(breakpoints).sort((a, b) => a - b);
  const segments: NodeInlineCommentSegment[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const startOffset = ordered[index];
    const endOffset = ordered[index + 1];
    if (endOffset <= startOffset) continue;
    const threadIDs = ranges
      .filter((range) => range.startOffset < endOffset && range.endOffset > startOffset)
      .map((range) => range.threadID);
    segments.push({
      text: title.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      threadIDs,
    });
  }
  return segments;
}
