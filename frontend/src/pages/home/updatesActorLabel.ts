export type UpdateActorNotification = {
  actor_user_id?: string;
  title: string;
  body_preview?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveUpdateActorLabel(
  item: UpdateActorNotification,
  resolveUserLabel?: (userID: string) => string,
): string {
  const actorID = item.actor_user_id?.trim() ?? "";
  const resolved = actorID ? resolveUserLabel?.(actorID)?.trim() ?? "" : "";
  const historical = extractActorFromNotification(item);
  return [resolved, historical].find((candidate) => isReadableActorLabel(candidate, actorID)) ?? "Someone";
}

export function isReadableActorLabel(value: string, actorUserID = ""): boolean {
  const candidate = value.trim();
  if (!candidate) return false;
  if (actorUserID.trim() && candidate.localeCompare(actorUserID.trim(), undefined, { sensitivity: "accent" }) === 0) return false;
  return !UUID_PATTERN.test(candidate);
}

function extractActorFromNotification(item: UpdateActorNotification): string {
  const title = item.title.trim();
  const body = (item.body_preview ?? "").trim();
  const mentionMatch = title.match(/^(?:urgent\s+)?(.+?)\s+(?:urgently\s+)?mentioned you\b/i);
  if (mentionMatch?.[1]) return mentionMatch[1].trim();
  const bodyChangedMatch = body.match(/^(.+?)\s+(?:changed|updated|moved|added|removed)\b/i);
  if (bodyChangedMatch?.[1]) return bodyChangedMatch[1].trim();
  const titleActionMatch = title.match(/^(.+?)\s+(?:added|updated|removed|deleted|assigned|sent|attached|gave|requested)\b/i);
  if (titleActionMatch?.[1]) return titleActionMatch[1].trim();
  return "";
}
