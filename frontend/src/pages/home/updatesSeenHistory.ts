const DAY_MS = 24 * 60 * 60 * 1000;

export const SEEN_UPDATES_MAX_WINDOW_DAYS = 90;
export const SEEN_UPDATES_DEFAULT_WINDOW_DAYS = 30;

export type SeenUpdatesRange = {
  oldest_created_timestamp?: string;
  newest_created_timestamp?: string;
};

export type SeenUpdatesDateBounds = {
  oldestDay: number;
  newestDay: number;
};

export type SeenUpdatesDateWindow = SeenUpdatesDateBounds & {
  startDay: number;
  endDay: number;
};

function timestampToUTCDay(value: string | undefined): number | null {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) return null;
  return Math.floor(timestamp / DAY_MS);
}

export function utcDayToDateInput(day: number): string {
  return new Date(Math.trunc(day) * DAY_MS).toISOString().slice(0, 10);
}

export function utcDayToDisplayDate(day: number): string {
  const [year, month, date] = utcDayToDateInput(day).split("-");
  return `${date}/${month}/${year}`;
}

export function displayDateToUTCDay(value: string): number | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const date = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1000 || month < 1 || month > 12 || date < 1 || date > 31) return null;
  const timestamp = Date.UTC(year, month - 1, date);
  const parsed = new Date(timestamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) return null;
  return Math.floor(timestamp / DAY_MS);
}

export function seenUpdatesDateBounds(range: SeenUpdatesRange): SeenUpdatesDateBounds | null {
  const oldestDay = timestampToUTCDay(range.oldest_created_timestamp);
  const newestDay = timestampToUTCDay(range.newest_created_timestamp);
  if (oldestDay === null || newestDay === null) return null;
  return {
    oldestDay: Math.min(oldestDay, newestDay),
    newestDay: Math.max(oldestDay, newestDay),
  };
}

export function createSeenUpdatesDateWindow(bounds: SeenUpdatesDateBounds): SeenUpdatesDateWindow {
  const endDay = bounds.newestDay;
  const startDay = Math.max(bounds.oldestDay, endDay - SEEN_UPDATES_DEFAULT_WINDOW_DAYS + 1);
  return { ...bounds, startDay, endDay };
}

export function moveSeenUpdatesDateWindow(
  window: SeenUpdatesDateWindow,
  edge: "start" | "end",
  nextValue: number,
): SeenUpdatesDateWindow {
  const value = Math.min(window.newestDay, Math.max(window.oldestDay, Math.trunc(nextValue)));
  let startDay = edge === "start" ? Math.min(value, window.endDay) : window.startDay;
  let endDay = edge === "end" ? Math.max(value, window.startDay) : window.endDay;
  if (endDay - startDay + 1 > SEEN_UPDATES_MAX_WINDOW_DAYS) {
    if (edge === "start") endDay = Math.min(window.newestDay, startDay + SEEN_UPDATES_MAX_WINDOW_DAYS - 1);
    else startDay = Math.max(window.oldestDay, endDay - SEEN_UPDATES_MAX_WINDOW_DAYS + 1);
  }
  return { ...window, startDay, endDay };
}

export function seenUpdatesDateQuery(window: SeenUpdatesDateWindow): { fromDate: string; toDate: string } {
  return {
    fromDate: utcDayToDateInput(window.startDay),
    toDate: utcDayToDateInput(window.endDay),
  };
}
