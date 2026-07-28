import {
  isEditorEntityType,
  type ActiveEntityLinkDraft,
  type EditorEntityLink,
  type EditorEntityType,
} from "./editorEntityLinks.js";

export type EditorChatEntityLink = {
  start: number;
  end: number;
  entityType: EditorEntityType;
  entityID: string;
  label: string;
};

export type EditorChatEntitySegment = {
  text: string;
  entity?: EditorChatEntityLink;
};

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function stringField(record: Record<string, unknown>, camel: string, snake: string): string {
  const value = record[camel] ?? record[snake];
  return typeof value === "string" ? value.trim() : "";
}

export function editorChatEntityText(entity: Pick<EditorEntityLink, "label">): string {
  return `#${entity.label.trim()}`;
}

export function normalizeEditorChatEntityLinks(
  message: string,
  values: readonly EditorChatEntityLink[],
): EditorChatEntityLink[] {
  const ordered = values.flatMap((value) => {
    const start = integer(value.start);
    const end = integer(value.end);
    const entityID = value.entityID?.trim() ?? "";
    const label = value.label?.trim() ?? "";
    if (start === null || end === null || start < 0 || end <= start || end > message.length) return [];
    if (!isEditorEntityType(value.entityType) || !entityID || !label) return [];
    if (message.slice(start, end) !== editorChatEntityText({ label })) return [];
    return [{ start, end, entityType: value.entityType, entityID, label }];
  }).sort((left, right) => left.start - right.start || left.end - right.end);

  const result: EditorChatEntityLink[] = [];
  for (const value of ordered) {
    if (result.length > 0 && value.start < result[result.length - 1]!.end) continue;
    result.push(value);
  }
  return result;
}

export function parseEditorChatEntityLinks(value: unknown, message: string): EditorChatEntityLink[] {
  if (!Array.isArray(value)) return [];
  const links = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const start = integer(record.start ?? record.start_offset);
    const end = integer(record.end ?? record.end_offset);
    const entityType = record.entityType ?? record.entity_type;
    const entityID = stringField(record, "entityID", "entity_id");
    const label = stringField(record, "label", "label");
    if (start === null || end === null || !isEditorEntityType(entityType)) return [];
    return [{ start, end, entityType, entityID, label }];
  });
  return normalizeEditorChatEntityLinks(message, links);
}

export function editorChatEntityLinkPayloads(message: string, values: readonly EditorChatEntityLink[]) {
  return normalizeEditorChatEntityLinks(message, values).map((value) => ({
    start: value.start,
    end: value.end,
    entity_type: value.entityType,
    entity_id: value.entityID,
    label: value.label,
  }));
}

export function remapEditorChatEntityLinks(
  previousMessage: string,
  nextMessage: string,
  values: readonly EditorChatEntityLink[],
): EditorChatEntityLink[] {
  if (previousMessage === nextMessage) return normalizeEditorChatEntityLinks(nextMessage, values);
  let prefixLength = 0;
  const maximumPrefix = Math.min(previousMessage.length, nextMessage.length);
  while (prefixLength < maximumPrefix && previousMessage[prefixLength] === nextMessage[prefixLength]) prefixLength += 1;

  let suffixLength = 0;
  const maximumSuffix = Math.min(previousMessage.length - prefixLength, nextMessage.length - prefixLength);
  while (
    suffixLength < maximumSuffix
    && previousMessage[previousMessage.length - 1 - suffixLength] === nextMessage[nextMessage.length - 1 - suffixLength]
  ) suffixLength += 1;

  const previousChangeEnd = previousMessage.length - suffixLength;
  const nextChangeEnd = nextMessage.length - suffixLength;
  const delta = nextChangeEnd - previousChangeEnd;
  const remapped = normalizeEditorChatEntityLinks(previousMessage, values).flatMap((value) => {
    if (value.end <= prefixLength) return [value];
    if (value.start >= previousChangeEnd) return [{ ...value, start: value.start + delta, end: value.end + delta }];
    return [];
  });
  return normalizeEditorChatEntityLinks(nextMessage, remapped);
}

export function replaceEditorChatEntityDraft(
  message: string,
  values: readonly EditorChatEntityLink[],
  draft: ActiveEntityLinkDraft,
  entity: EditorEntityLink,
): { message: string; entityLinks: EditorChatEntityLink[]; caret: number } {
  const text = editorChatEntityText(entity);
  const suffixStartsWithWhitespace = /\s/.test(message.charAt(draft.end));
  const insert = `${text}${suffixStartsWithWhitespace ? "" : " "}`;
  const nextMessage = `${message.slice(0, draft.start)}${insert}${message.slice(draft.end)}`;
  const remapped = remapEditorChatEntityLinks(message, nextMessage, values);
  const entityLink: EditorChatEntityLink = {
    start: draft.start,
    end: draft.start + text.length,
    entityType: entity.entityType,
    entityID: entity.entityID,
    label: entity.label.trim(),
  };
  return {
    message: nextMessage,
    entityLinks: normalizeEditorChatEntityLinks(nextMessage, [...remapped, entityLink]),
    caret: draft.start + insert.length,
  };
}

export function trimEditorChatDraft(
  draft: string,
  values: readonly EditorChatEntityLink[],
): { message: string; entityLinks: EditorChatEntityLink[] } {
  const message = draft.trim();
  const leadingWhitespace = draft.length - draft.trimStart().length;
  return {
    message,
    entityLinks: normalizeEditorChatEntityLinks(message, values.map((value) => ({
      ...value,
      start: value.start - leadingWhitespace,
      end: value.end - leadingWhitespace,
    }))),
  };
}

export function splitEditorChatTextByEntityLinks(
  message: string,
  values: readonly EditorChatEntityLink[],
): EditorChatEntitySegment[] {
  const links = normalizeEditorChatEntityLinks(message, values);
  if (links.length === 0) return message ? [{ text: message }] : [];
  const segments: EditorChatEntitySegment[] = [];
  let cursor = 0;
  for (const entity of links) {
    if (entity.start > cursor) segments.push({ text: message.slice(cursor, entity.start) });
    segments.push({ text: message.slice(entity.start, entity.end), entity });
    cursor = entity.end;
  }
  if (cursor < message.length) segments.push({ text: message.slice(cursor) });
  return segments;
}
