export type MangoTiptapFlushRef = {
  companyID: string;
  resourceType: string;
  resourceID: string;
  documentID: string;
};

export type MangoTiptapResourceRef = Omit<MangoTiptapFlushRef, "documentID">;

type RegisteredFlusher = {
  ref: MangoTiptapFlushRef;
  owner?: MangoTiptapResourceRef;
  flush: () => Promise<void>;
};

const flushers = new Map<string, RegisteredFlusher>();

function key(ref: MangoTiptapFlushRef): string {
  return [ref.companyID, ref.resourceType, ref.resourceID, ref.documentID].map(encodeURIComponent).join(":");
}

export function registerMangoTiptapFlusher(ref: MangoTiptapFlushRef, flush: () => Promise<void>, owner?: MangoTiptapResourceRef): () => void {
  const registryKey = key(ref);
  const registered = { ref, flush, owner };
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
  const matches = (candidate: MangoTiptapResourceRef | undefined) => candidate?.companyID === ref.companyID
    && candidate.resourceType === ref.resourceType
    && candidate.resourceID === ref.resourceID;
  await Promise.all([...flushers.values()]
    .filter((registered) => matches(registered.ref) || matches(registered.owner))
    .map((registered) => registered.flush()));
}
