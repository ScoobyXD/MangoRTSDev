import type { UniversalGroupValue } from "./universalGrouping.js";

type CanonicalStatusDefinition = {
  key: string;
  label: string;
  sortValue: number;
};

const CANONICAL_STATUS_BY_TOKEN = new Map<string, CanonicalStatusDefinition>();

function registerStatus(
  definition: CanonicalStatusDefinition,
  aliases: readonly string[],
): void {
  for (const alias of aliases) CANONICAL_STATUS_BY_TOKEN.set(alias, definition);
}

registerStatus(
  { key: "in_progress", label: "In Progress", sortValue: 1 },
  ["in_progress", "inprogress", "ip"],
);
registerStatus(
  { key: "review", label: "Review", sortValue: 2 },
  ["review", "verify", "verification", "verified"],
);
registerStatus(
  { key: "pending", label: "Pending", sortValue: 3 },
  ["pending", "p"],
);
registerStatus(
  { key: "requested", label: "Requested", sortValue: 4 },
  ["request", "requested", "requests", "r"],
);
registerStatus(
  { key: "backlog", label: "Backlog", sortValue: 5 },
  ["backlog", "backlogs", "back_log", "back_logs", "backlogged", "b"],
);
registerStatus(
  { key: "done", label: "Done", sortValue: 6 },
  ["done", "complete", "completed", "closed", "archived", "d"],
);

export function normalizeUniversalStatusToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");
}

export function getUniversalStatusGroupValue(value: string): UniversalGroupValue {
  const normalized = normalizeUniversalStatusToken(value);
  if (!normalized) {
    return {
      key: "no_status",
      label: "No status",
      sortValue: 5.5,
      sortLast: true,
    };
  }

  const canonical = CANONICAL_STATUS_BY_TOKEN.get(normalized);
  if (canonical) {
    return {
      ...canonical,
      sortLast: canonical.key === "done",
    };
  }

  return {
    key: `unknown:${normalized}`,
    label: normalized
      .replace(/_/g, " ")
      .replace(/\b\w/g, (character) => character.toUpperCase()),
    sortValue: 50,
  };
}
