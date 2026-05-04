export type EditorProjectionItem = {
  information_id: string;
  type: string;
  information: string;
  created_timestamp?: string;
  updated_timestamp?: string;
};

function compareProjectionFreshness(a: EditorProjectionItem, b: EditorProjectionItem): number {
  const updated = (a.updated_timestamp ?? "").localeCompare(b.updated_timestamp ?? "");
  if (updated !== 0) return updated;
  const created = (a.created_timestamp ?? "").localeCompare(b.created_timestamp ?? "");
  if (created !== 0) return created;
  return a.information_id.localeCompare(b.information_id);
}

export function selectCurrentEditorTextProjection<T extends EditorProjectionItem>(items: T[]): T | null {
  let current: T | null = null;
  for (const item of items) {
    if (item.type !== "Text box") continue;
    if (!current || compareProjectionFreshness(current, item) < 0) current = item;
  }
  return current;
}

