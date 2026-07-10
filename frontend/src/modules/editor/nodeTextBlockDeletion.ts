export type TextBlockChatProjectionReference = {
  id: string;
  blockID: string;
};

export function projectionIDsForTextBlockDeletion(
  blockID: string,
  chatMessages: readonly TextBlockChatProjectionReference[],
): string[] {
  const cleanBlockID = blockID.trim();
  if (!cleanBlockID) return [];
  const projectionIDs = new Set<string>([cleanBlockID]);
  for (const message of chatMessages) {
    if (message.blockID.trim() !== cleanBlockID) continue;
    const messageID = message.id.trim();
    if (messageID) projectionIDs.add(messageID);
  }
  return Array.from(projectionIDs);
}

export function resolveAttachedEmailHostBlockID(
  blockIDs: readonly string[],
  focusedBlockID: string,
): string {
  const survivingBlockIDs = blockIDs.map((blockID) => blockID.trim()).filter(Boolean);
  const focused = focusedBlockID.trim();
  if (focused && survivingBlockIDs.includes(focused)) return focused;
  return survivingBlockIDs[0] ?? "";
}
