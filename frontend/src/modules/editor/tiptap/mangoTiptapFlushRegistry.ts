export type MangoTiptapFlushRef = {
  companyID: string;
  resourceType: string;
  resourceID: string;
  documentID: string;
};

const flushers = new Map<string, () => Promise<void>>();

function key(ref: MangoTiptapFlushRef): string {
  return [ref.companyID, ref.resourceType, ref.resourceID, ref.documentID].map(encodeURIComponent).join(":");
}

export function registerMangoTiptapFlusher(ref: MangoTiptapFlushRef, flush: () => Promise<void>): () => void {
  const registryKey = key(ref);
  flushers.set(registryKey, flush);
  return () => {
    if (flushers.get(registryKey) === flush) flushers.delete(registryKey);
  };
}

export async function flushMangoTiptapDocument(ref: MangoTiptapFlushRef): Promise<void> {
  await flushers.get(key(ref))?.();
}
