const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLikelyOpaqueEntityID(value: string): boolean {
  const clean = value.trim();
  if (!clean) return false;
  if (UUID_PATTERN.test(clean)) return true;
  const logicGatePrefix = "logic-gate:";
  return clean.toLowerCase().startsWith(logicGatePrefix) && UUID_PATTERN.test(clean.slice(logicGatePrefix.length).trim());
}

export function humanLabelOrFallback(value: string | undefined | null, fallback: string): string {
  const clean = (value ?? "").trim();
  if (!clean || isLikelyOpaqueEntityID(clean)) return fallback;
  return clean;
}

export function preferResolvedEntityLabel(
  currentValue: string | undefined | null,
  nextValue: string | undefined | null,
  fallback: string,
): string {
  const current = humanLabelOrFallback(currentValue, "");
  const next = humanLabelOrFallback(nextValue, fallback);
  if (next === fallback && current && current !== fallback) return current;
  return next;
}
