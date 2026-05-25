export type NodeContentChangeType = "addition" | "deletion";

export type NodeContentChange = {
  company_id: string;
  change_id: string;
  node_id: string;
  information_id: string;
  change_type: NodeContentChangeType;
  text: string;
  start_offset: number;
  end_offset: number;
  actor_user_id?: string;
  actor_display_name: string;
  created_timestamp: string;
};

export type NodeContentChangeResponse = {
  company_id: string;
  node_id: string;
  changes?: NodeContentChange[];
};

const NODE_PROJECTION_CONTENT_CHANGE_PREFIX = "projection:";

function cleanOffset(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

export function nodeContentChangeSeenGroupKey(change: NodeContentChange): string {
  if (change.change_id.startsWith(NODE_PROJECTION_CONTENT_CHANGE_PREFIX) && change.information_id) {
    return `${change.node_id}:${change.information_id}`;
  }
  return change.change_id;
}

export function resolveNodeAdditionRange(documentText: string, change: NodeContentChange): { startOffset: number; endOffset: number } | null {
  if (change.change_type !== "addition") return null;
  const text = change.text ?? "";
  if (!text) return null;
  const start = cleanOffset(change.start_offset);
  const end = cleanOffset(change.end_offset);
  if (start !== null && end !== null && end > start && end <= documentText.length && documentText.slice(start, end) === text) {
    return { startOffset: start, endOffset: end };
  }
  const fallbackStart = documentText.indexOf(text);
  if (fallbackStart < 0) return null;
  return { startOffset: fallbackStart, endOffset: fallbackStart + text.length };
}

export function resolveNodeDeletionAnchorOffset(documentText: string, change: NodeContentChange): number {
  const start = cleanOffset(change.start_offset) ?? 0;
  return Math.max(0, Math.min(start, documentText.length));
}

export function formatNodeContentChangeLabel(change: NodeContentChange): string {
  const actor = change.actor_display_name?.trim() || "Unknown user";
  const date = new Date(change.created_timestamp);
  const timestamp = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  return timestamp ? `${actor} ${timestamp}` : actor;
}

