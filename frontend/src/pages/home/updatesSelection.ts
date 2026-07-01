export function resolveUpdateClickSelection(input: {
  orderedIDs: string[];
  previousSelectedIDs: Set<string>;
  anchorID: string;
  clickedID: string;
  shiftKey: boolean;
  ctrlKey: boolean;
}): { selectedIDs: Set<string>; anchorID: string } {
  const { orderedIDs, previousSelectedIDs, anchorID, clickedID, shiftKey, ctrlKey } = input;
  if (!clickedID) return { selectedIDs: new Set(previousSelectedIDs), anchorID };

  if (shiftKey && anchorID) {
    const anchorIndex = orderedIDs.indexOf(anchorID);
    const clickedIndex = orderedIDs.indexOf(clickedID);
    if (anchorIndex >= 0 && clickedIndex >= 0) {
      const start = Math.min(anchorIndex, clickedIndex);
      const end = Math.max(anchorIndex, clickedIndex);
      const selectedIDs = new Set(previousSelectedIDs);
      for (const id of orderedIDs.slice(start, end + 1)) selectedIDs.add(id);
      return { selectedIDs, anchorID };
    }
  }

  if (ctrlKey) {
    const selectedIDs = new Set(previousSelectedIDs);
    if (selectedIDs.has(clickedID)) selectedIDs.delete(clickedID);
    else selectedIDs.add(clickedID);
    return { selectedIDs, anchorID: clickedID };
  }

  return { selectedIDs: new Set([clickedID]), anchorID: clickedID };
}

export function orderedUpdateSelection(orderedIDs: string[], selectedIDs: Set<string>): string[] {
  return orderedIDs.filter((id) => selectedIDs.has(id));
}
