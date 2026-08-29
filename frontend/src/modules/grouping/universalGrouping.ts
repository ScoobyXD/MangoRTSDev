export type UniversalGroupValue = {
  key: string;
  label: string;
  sortValue: string | number;
  sortLast?: boolean;
};

export type UniversalGroupingSetting<Field extends string> = {
  field: Field;
  direction: "asc" | "desc";
};

export type UniversalNestedGroup<Item, Field extends string> = UniversalGroupValue & {
  id: string;
  field: Field;
  depth: number;
  groups: Array<UniversalNestedGroup<Item, Field>>;
  rows: Item[];
};

export type UniversalGroupingAdapter<Item, Field extends string> = {
  rootID: string;
  rowKey: (item: Item) => string;
  getValues: (item: Item, field: Field) => UniversalGroupValue[];
  sortRows: (items: Item[]) => Item[];
  preserveGroupOrder?: boolean;
};

export function buildUniversalNestedGroups<Item, Field extends string>(
  items: Item[],
  groupings: Array<UniversalGroupingSetting<Field>>,
  adapter: UniversalGroupingAdapter<Item, Field>,
): Array<UniversalNestedGroup<Item, Field>> {
  return buildUniversalNestedGroupLevel(items, groupings, adapter, 0, adapter.rootID);
}

export function computeUniversalDefaultExpandedGroupIDs<Item, Field extends string>(
  groups: Array<UniversalNestedGroup<Item, Field>>,
): Set<string> {
  const expanded = new Set<string>();
  const visit = (items: Array<UniversalNestedGroup<Item, Field>>, level: number) => {
    const limit = Math.max(1, level);
    items.forEach((group, index) => {
      if (index >= limit) return;
      expanded.add(group.id);
      visit(group.groups, level + 1);
    });
  };
  visit(groups, 1);
  return expanded;
}

function buildUniversalNestedGroupLevel<Item, Field extends string>(
  rows: Item[],
  groupings: Array<UniversalGroupingSetting<Field>>,
  adapter: UniversalGroupingAdapter<Item, Field>,
  depth: number,
  parentID: string,
): Array<UniversalNestedGroup<Item, Field>> {
  const grouping = groupings[depth];
  if (!grouping) return [];
  const byKey = new Map<string, UniversalGroupValue & { rows: Item[]; rowKeys: Set<string> }>();
  for (const row of rows) {
    const values = adapter.getValues(row, grouping.field);
    if (values.length === 0) continue;
    const rowKey = adapter.rowKey(row);
    const seenValues = new Set<string>();
    for (const value of values) {
      if (seenValues.has(value.key)) continue;
      seenValues.add(value.key);
      const existing = byKey.get(value.key) ?? { ...value, rows: [], rowKeys: new Set<string>() };
      if (!existing.rowKeys.has(rowKey)) {
        existing.rowKeys.add(rowKey);
        existing.rows.push(row);
      }
      byKey.set(value.key, existing);
    }
  }
  const groupedValues = Array.from(byKey.values());
  const orderedGroups = adapter.preserveGroupOrder
    ? groupedValues
    : sortUniversalGroups(groupedValues, grouping.direction);
  return orderedGroups.map((group) => {
    const id = `${parentID}/${grouping.field}:${group.key}`;
    return {
      key: group.key,
      label: group.label,
      sortValue: group.sortValue,
      sortLast: group.sortLast,
      id,
      field: grouping.field,
      depth,
      rows: groupings[depth + 1] ? [] : adapter.sortRows(group.rows),
      groups: buildUniversalNestedGroupLevel(group.rows, groupings, adapter, depth + 1, id),
    };
  });
}

function sortUniversalGroups<T extends UniversalGroupValue>(groups: T[], direction: "asc" | "desc"): T[] {
  const regular = groups.filter((group) => !group.sortLast).sort(compareUniversalGroupValues);
  const trailing = groups.filter((group) => group.sortLast).sort(compareUniversalGroupValues);
  return direction === "desc" ? [...regular.reverse(), ...trailing] : [...regular, ...trailing];
}

function compareUniversalGroupValues(left: UniversalGroupValue, right: UniversalGroupValue): number {
  if (typeof left.sortValue === "number" && typeof right.sortValue === "number") {
    return left.sortValue - right.sortValue
      || left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })
      || left.key.localeCompare(right.key);
  }
  return String(left.sortValue).localeCompare(String(right.sortValue), undefined, { numeric: true, sensitivity: "base" })
    || left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })
    || left.key.localeCompare(right.key);
}
