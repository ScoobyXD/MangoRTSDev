export type MangoTiptapFlushRef = {
  companyID: string;
  resourceType: string;
  resourceID: string;
  documentID: string;
};

export type MangoTiptapResourceRef = Omit<MangoTiptapFlushRef, "documentID">;

type RegisteredFlusher = {
  ref: MangoTiptapFlushRef;
  flush: () => Promise<void>;
};

const flushers = new Map<string, RegisteredFlusher>();

function key(ref: MangoTiptapFlushRef): string {
  return [ref.companyID, ref.resourceType, ref.resourceID, ref.documentID].map(encodeURIComponent).join(":");
}

export function registerMangoTiptapFlusher(ref: MangoTiptapFlushRef, flush: () => Promise<void>): () => void {
  const registryKey = key(ref);
  const registered = { ref, flush };
  flushers.set(registryKey, registered);
  return () => {
    if (flushers.get(registryKey) !== registered) return;
    setTimeout(() => {
      if (flushers.get(registryKey) === registered) flushers.delete(registryKey);
    }, 0);
  };
}

export async function flushMangoTiptapDocument(ref: MangoTiptapFlushRef): Promise<void> {
  await flushers.get(key(ref))?.flush();
}

export async function flushMangoTiptapResource(ref: MangoTiptapResourceRef): Promise<void> {
  await Promise.all([...flushers.values()]
    .filter((registered) => (
      registered.ref.companyID === ref.companyID
      && registered.ref.resourceType === ref.resourceType
      && registered.ref.resourceID === ref.resourceID
    ))
    .map((registered) => registered.flush()));
}
