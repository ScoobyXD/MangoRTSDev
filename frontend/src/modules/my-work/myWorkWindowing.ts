import type { UniversalNestedGroup } from "../grouping/universalGrouping.js";

export type MyWorkGroupSurface = {
  id: string;
  key: string;
  depth: number;
  edge: "first" | "middle" | "last" | "only";
};

export type MyWorkGroupHeaderDisplayEntry<Field extends string> = {
  kind: "group-header";
  entryID: string;
  groupID: string;
  field: Field;
  groupKey: string;
  label: string;
  depth: number;
  rowCount: number;
  surface?: MyWorkGroupSurface;
};

export type MyWorkRowDisplayEntry<Item> = {
  kind: "row";
  entryID: string;
  rowID: string;
  row: Item;
  depth: number;
  parentGroupID?: string;
  surface?: MyWorkGroupSurface;
};

export type MyWorkDisplayEntry<Item, Field extends string> =
  | MyWorkGroupHeaderDisplayEntry<Field>
  | MyWorkRowDisplayEntry<Item>;

export type MyWorkRowNavigationDirection = "previous" | "next";

export function flattenMyWorkGroupedDisplayEntries<Item, Field extends string>(
  groups: ReadonlyArray<UniversalNestedGroup<Item, Field>>,
  rowIdentity: (row: Item) => string,
  hiddenHeaderFields: ReadonlySet<Field> = new Set<Field>(),
  flattenRows = false,
  surfaceField?: Field,
): Array<MyWorkDisplayEntry<Item, Field>> {
  const entries: Array<MyWorkDisplayEntry<Item, Field>> = [];

  const appendGroup = (
    group: UniversalNestedGroup<Item, Field>,
    visibleDepth: number,
    parentSurface?: Omit<MyWorkGroupSurface, "edge">,
  ): number => {
    const headerHidden = hiddenHeaderFields.has(group.field);
    const surface = group.field === surfaceField
      ? { id: group.id, key: group.key, depth: visibleDepth }
      : parentSurface;
    const header: MyWorkGroupHeaderDisplayEntry<Field> = {
      kind: "group-header",
      entryID: `group:${group.id}`,
      groupID: group.id,
      field: group.field,
      groupKey: group.key,
      label: group.label,
      depth: visibleDepth,
      rowCount: 0,
      ...(surface ? { surface: { ...surface, edge: "middle" } } : {}),
    };
    if (!headerHidden) entries.push(header);
    const childDepth = headerHidden ? visibleDepth : visibleDepth + 1;

    if (group.groups.length > 0) {
      for (const nested of group.groups) header.rowCount += appendGroup(nested, childDepth, surface);
      return header.rowCount;
    }

    for (const row of group.rows) {
      const rowID = rowIdentity(row);
      entries.push({
        kind: "row",
        entryID: `${group.id}/row:${rowID}`,
        rowID,
        row,
        depth: flattenRows ? 0 : childDepth,
        parentGroupID: group.id,
        ...(surface ? { surface: { ...surface, edge: "middle" } } : {}),
      });
      header.rowCount += 1;
    }
    return header.rowCount;
  };

  for (const group of groups) appendGroup(group, 0);
  for (let index = 0; index < entries.length; index += 1) {
    const surface = entries[index]?.surface;
    if (!surface) continue;
    const previousMatches = entries[index - 1]?.surface?.id === surface.id;
    const nextMatches = entries[index + 1]?.surface?.id === surface.id;
    entries[index] = {
      ...entries[index],
      surface: {
        ...surface,
        edge: previousMatches ? (nextMatches ? "middle" : "last") : (nextMatches ? "first" : "only"),
      },
    } as MyWorkDisplayEntry<Item, Field>;
  }
  return entries;
}

export function flattenMyWorkUngroupedDisplayEntries<Item>(
  rows: ReadonlyArray<Item>,
  rowIdentity: (row: Item) => string,
): Array<MyWorkRowDisplayEntry<Item>> {
  return rows.map((row) => {
    const rowID = rowIdentity(row);
    return {
      kind: "row",
      entryID: `row:${rowID}`,
      rowID,
      row,
      depth: 0,
    };
  });
}

export function findMyWorkDisplayEntryIndex<Item, Field extends string>(
  entries: ReadonlyArray<MyWorkDisplayEntry<Item, Field>>,
  entryID: string,
): number {
  return entries.findIndex((entry) => entry.entryID === entryID);
}

export function findAdjacentMyWorkRowEntryIndex<Item, Field extends string>(
  entries: ReadonlyArray<MyWorkDisplayEntry<Item, Field>>,
  fromIndex: number,
  direction: MyWorkRowNavigationDirection,
): number | null {
  if (!Number.isFinite(fromIndex)) return null;
  const step = direction === "next" ? 1 : -1;
  for (let index = Math.trunc(fromIndex) + step; index >= 0 && index < entries.length; index += step) {
    if (entries[index]?.kind === "row") return index;
  }
  return null;
}
