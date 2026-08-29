import type { UniversalNestedGroup } from "../grouping/universalGrouping.js";

export type MyWorkGroupHeaderDisplayEntry<Field extends string> = {
  kind: "group-header";
  entryID: string;
  groupID: string;
  field: Field;
  groupKey: string;
  label: string;
  depth: number;
  rowCount: number;
};

export type MyWorkRowDisplayEntry<Item> = {
  kind: "row";
  entryID: string;
  rowID: string;
  row: Item;
  depth: number;
  parentGroupID?: string;
};

export type MyWorkDisplayEntry<Item, Field extends string> =
  | MyWorkGroupHeaderDisplayEntry<Field>
  | MyWorkRowDisplayEntry<Item>;

export type MyWorkRowNavigationDirection = "previous" | "next";

export function flattenMyWorkGroupedDisplayEntries<Item, Field extends string>(
  groups: ReadonlyArray<UniversalNestedGroup<Item, Field>>,
  rowIdentity: (row: Item) => string,
): Array<MyWorkDisplayEntry<Item, Field>> {
  const entries: Array<MyWorkDisplayEntry<Item, Field>> = [];

  const appendGroup = (group: UniversalNestedGroup<Item, Field>): number => {
    const header: MyWorkGroupHeaderDisplayEntry<Field> = {
      kind: "group-header",
      entryID: `group:${group.id}`,
      groupID: group.id,
      field: group.field,
      groupKey: group.key,
      label: group.label,
      depth: group.depth,
      rowCount: 0,
    };
    entries.push(header);

    if (group.groups.length > 0) {
      for (const nested of group.groups) header.rowCount += appendGroup(nested);
      return header.rowCount;
    }

    for (const row of group.rows) {
      const rowID = rowIdentity(row);
      entries.push({
        kind: "row",
        entryID: `${group.id}/row:${rowID}`,
        rowID,
        row,
        depth: group.depth + 1,
        parentGroupID: group.id,
      });
      header.rowCount += 1;
    }
    return header.rowCount;
  };

  for (const group of groups) appendGroup(group);
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
