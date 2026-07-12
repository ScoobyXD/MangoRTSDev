export type UpdateStatusSource = {
  type?: string | null;
  title?: string | null;
  body_preview?: string | null;
};

const UPDATE_STATUS_ASSIGNMENT_SAVED = "work_item.logic_gate_assignment_saved";
const UPDATE_STATUS_ASSIGNMENT_MOVED = "work_item.logic_gate_assignment_moved";

function normalizeExtractedUpdateStatus(value: string): string {
  const status = value.trim();
  if (/^a new (?:status|state)$/i.test(status)) return "";
  return status;
}

export function extractUpdateEventStatus(item: UpdateStatusSource): string {
  const type = item.type?.trim() ?? "";
  const title = item.title?.trim() ?? "";
  const body = item.body_preview?.trim() ?? "";
  const titleMatch = title.match(/^Node status changed to\s+(.+)$/i);
  if (titleMatch?.[1]) return normalizeExtractedUpdateStatus(titleMatch[1]);
  if (type === UPDATE_STATUS_ASSIGNMENT_SAVED) {
    const addedMatch = body.match(/\bwas added in\s+([^.]+)\.?$/i);
    if (addedMatch?.[1]) return normalizeExtractedUpdateStatus(addedMatch[1]);
  }
  if (type === UPDATE_STATUS_ASSIGNMENT_MOVED) {
    const movedMatch = body.match(/\bmoved to\s+([^.]+)\.?$/i);
    if (movedMatch?.[1]) return normalizeExtractedUpdateStatus(movedMatch[1]);
  }
  return "";
}

export function resolveUpdateStatusForGrouping(
  item: UpdateStatusSource,
  currentNodeStatus?: string | null,
): string {
  return extractUpdateEventStatus(item) || currentNodeStatus?.trim() || "";
}
