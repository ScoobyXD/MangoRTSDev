const EXPLICIT_TIME_ZONE_PATTERN = /(?:z|[+-]\d{2}:?\d{2})$/i;

export function parseNotificationTimestamp(value: string): number {
  const raw = value.trim();
  if (!raw) return Number.NaN;
  const normalized = EXPLICIT_TIME_ZONE_PATTERN.test(raw) ? raw : `${raw}Z`;
  return Date.parse(normalized);
}

export function formatNotificationTimestamp(value: string, nowMs = Date.now()): string {
  const timestamp = parseNotificationTimestamp(value);
  if (!Number.isFinite(timestamp)) return "";
  const deltaMs = Math.max(0, nowMs - timestamp);
  if (deltaMs < 60_000) return "Now";
  if (deltaMs < 60 * 60_000) return `${Math.max(1, Math.floor(deltaMs / 60_000))}m`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(deltaMs / (60 * 60_000)))}h`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}
