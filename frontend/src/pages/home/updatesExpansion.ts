export type ExpandableUpdateGroup = {
  id: string;
  groups: readonly ExpandableUpdateGroup[];
};

export function collectUpdateGroupIDs(group: ExpandableUpdateGroup): string[] {
  const ids = [group.id];
  for (const child of group.groups) ids.push(...collectUpdateGroupIDs(child));
  return ids;
}

export function collectAllUpdateGroupIDs(groups: readonly ExpandableUpdateGroup[]): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const groupID of collectUpdateGroupIDs(group)) ids.add(groupID);
  }
  return ids;
}

export function reconcileExpandedUpdateGroupIDs({
  groups,
  manuallyCollapsedGroupIDs,
  reset,
}: {
  groups: readonly ExpandableUpdateGroup[];
  manuallyCollapsedGroupIDs: ReadonlySet<string>;
  reset: boolean;
}): Set<string> {
  const availableGroupIDs = collectAllUpdateGroupIDs(groups);
  if (reset) return availableGroupIDs;

  const nextExpandedGroupIDs = new Set<string>();
  for (const groupID of availableGroupIDs) {
    if (!manuallyCollapsedGroupIDs.has(groupID)) nextExpandedGroupIDs.add(groupID);
  }
  return nextExpandedGroupIDs;
}
