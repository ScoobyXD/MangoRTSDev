function parseDueDateParts(value: string): { year: number; month: number; day: number } | null {
  const raw = value.trim();
  if (!raw) return { year: 0, month: 0, day: 0 };

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  }

  const slash = raw.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!slash) return null;

  const yearInput = Number(slash[3]);
  const year = slash[3].length === 2
    ? (yearInput >= 70 ? 1900 + yearInput : 2000 + yearInput)
    : yearInput;
  return { year, month: Number(slash[1]), day: Number(slash[2]) };
}

export function formatNodeDueDateForEditor(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return raw;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

export function normalizeNodeDueDateDraft(value: string): string | null {
  const parsedParts = parseDueDateParts(value);
  if (!parsedParts) return null;
  if (parsedParts.year === 0 && parsedParts.month === 0 && parsedParts.day === 0) return "";
  const { year, month, day } = parsedParts;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
