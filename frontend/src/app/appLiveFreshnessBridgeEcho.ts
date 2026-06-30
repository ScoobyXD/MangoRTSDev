const LOCAL_TRIAGE_CONVERSION_ECHO_TTL_MS = 8_000;

function localTriageConversionMessageIDs(streamMessageID: string): string[] {
  return streamMessageID
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function localTriageConversionMessageKey(sharedInboxID: string | undefined, messageID: string): string {
  return `${sharedInboxID?.trim() ?? ""}\x1f${messageID.trim()}`;
}

export function rememberLocalTriageConversionIDs(cache: Map<string, number>, messageIDs: string[], sharedInboxID?: string): void {
  const ids = Array.from(new Set(messageIDs.map((id) => id.trim()).filter(Boolean)));
  if (ids.length === 0) return;
  const expiresAt = Date.now() + LOCAL_TRIAGE_CONVERSION_ECHO_TTL_MS;
  for (const messageID of ids) cache.set(localTriageConversionMessageKey(sharedInboxID, messageID), expiresAt);
}

export function localTriageConversionWasApplied(cache: Map<string, number>, streamMessageID: string, sharedInboxID?: string): boolean {
  const ids = localTriageConversionMessageIDs(streamMessageID);
  if (ids.length === 0) return false;
  const now = Date.now();
  const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
  let allHandled = true;
  for (const messageID of ids) {
    const key = localTriageConversionMessageKey(cleanSharedInboxID, messageID);
    const expiresAt = cache.get(key) ?? 0;
    if (expiresAt <= now) {
      cache.delete(key);
      allHandled = false;
    }
  }
  return allHandled;
}
