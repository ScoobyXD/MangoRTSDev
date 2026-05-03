export type EditorScrollMemory = {
  remember: (targetKey: string, scrollTop: number) => void;
  read: (targetKey: string) => number | undefined;
  size: () => number;
};

export function createEditorScrollMemory(maxEntries = 300): EditorScrollMemory {
  const positions = new Map<string, number>();
  const limit = Math.max(1, Math.floor(maxEntries));

  return {
    remember(targetKey, scrollTop) {
      const key = targetKey.trim();
      if (!key || !Number.isFinite(scrollTop)) return;

      // Keep this cache bounded because an editor can visit many documents in
      // one session. Re-inserting the key makes the oldest entry easy to evict.
      if (positions.has(key)) positions.delete(key);
      positions.set(key, Math.max(0, Math.floor(scrollTop)));
      while (positions.size > limit) {
        const oldestKey = positions.keys().next().value;
        if (!oldestKey) break;
        positions.delete(oldestKey);
      }
    },
    read(targetKey) {
      const key = targetKey.trim();
      if (!positions.has(key)) return undefined;
      const value = positions.get(key);
      if (value === undefined) return undefined;
      positions.delete(key);
      positions.set(key, value);
      return value;
    },
    size() {
      return positions.size;
    },
  };
}
