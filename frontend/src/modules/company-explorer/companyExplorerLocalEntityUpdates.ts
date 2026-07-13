export type CommittedEntityTitleUpdate = {
  companyID: string;
  entityType: "node" | "logic_gate";
  resourceID: string;
  title: string;
};

type VersionedCommittedEntityTitleUpdate = CommittedEntityTitleUpdate & { version: number };

const latestCommittedEntityTitleUpdates = new Map<string, VersionedCommittedEntityTitleUpdate>();
let committedEntityTitleVersion = 0;

function normalizeCommittedEntityTitleUpdate(update: CommittedEntityTitleUpdate): CommittedEntityTitleUpdate | null {
  const companyID = update.companyID.trim();
  const resourceID = update.resourceID.trim();
  const title = update.title.trim();
  if (!companyID || !resourceID || !title) return null;
  return { ...update, companyID, resourceID, title };
}

function committedEntityTitleRegistryKey(update: CommittedEntityTitleUpdate): string {
  return `${update.companyID}\u0000${update.entityType}\u0000${update.resourceID}`;
}

export function readCommittedEntityTitleVersion(): number {
  return committedEntityTitleVersion;
}

export function foldLatestCommittedEntityTitles<T>(
  value: T,
  companyID: string,
  reconcile: (current: T, update: CommittedEntityTitleUpdate) => T,
): T {
  return foldCommittedEntityTitlesSince(value, companyID, -1, reconcile);
}

export function foldCommittedEntityTitlesSince<T>(
  value: T,
  companyID: string,
  requestStartVersion: number,
  reconcile: (current: T, update: CommittedEntityTitleUpdate) => T,
): T {
  const cleanCompanyID = companyID.trim();
  if (!cleanCompanyID || latestCommittedEntityTitleUpdates.size === 0) return value;
  let next = value;
  const newerUpdates = Array.from(latestCommittedEntityTitleUpdates.values())
    .filter((update) => update.companyID === cleanCompanyID && update.version > requestStartVersion)
    .sort((left, right) => left.version - right.version);
  for (const update of newerUpdates) {
    next = reconcile(next, update);
  }
  return next;
}

export const EVENT_COMPANY_EXPLORER_ENTITY_TITLE_UPDATED = "mangorts:company-explorer-entity-title-updated";
export const EVENT_COMMITTED_ENTITY_TITLE_UPDATED = EVENT_COMPANY_EXPLORER_ENTITY_TITLE_UPDATED;

export function publishCommittedEntityTitleUpdate(
  update: CommittedEntityTitleUpdate,
  target: EventTarget = window,
): void {
  const normalized = normalizeCommittedEntityTitleUpdate(update);
  if (!normalized) return;
  committedEntityTitleVersion += 1;
  latestCommittedEntityTitleUpdates.set(committedEntityTitleRegistryKey(normalized), {
    ...normalized,
    version: committedEntityTitleVersion,
  });
  target.dispatchEvent(new CustomEvent<CommittedEntityTitleUpdate>(EVENT_COMMITTED_ENTITY_TITLE_UPDATED, {
    detail: normalized,
  }));
}

export async function commitEntityTitleMutation<T>(
  mutation: () => Promise<T>,
  toUpdate: (result: T) => CommittedEntityTitleUpdate | null | undefined,
  target: EventTarget = window,
): Promise<T> {
  const result = await mutation();
  const update = toUpdate(result);
  if (update) publishCommittedEntityTitleUpdate(update, target);
  return result;
}

export type CommittedTitleEditBuffer = ReturnType<typeof createCommittedTitleEditBuffer>;

export function createCommittedTitleEditBuffer() {
  let activeKey = "";
  let pending: CommittedEntityTitleUpdate | undefined;
  const keyFor = (entityType: CommittedEntityTitleUpdate["entityType"], resourceID: string) => `${entityType}:${resourceID.trim()}`;
  return {
    begin(entityType: CommittedEntityTitleUpdate["entityType"], resourceID: string) {
      const nextKey = keyFor(entityType, resourceID);
      if (activeKey === nextKey) return;
      activeKey = nextKey;
      pending = undefined;
    },
    receive(update: CommittedEntityTitleUpdate): CommittedEntityTitleUpdate | undefined {
      if (activeKey && activeKey === keyFor(update.entityType, update.resourceID)) {
        pending = update;
        return undefined;
      }
      return update;
    },
    finish(entityType: CommittedEntityTitleUpdate["entityType"], resourceID: string): CommittedEntityTitleUpdate | undefined {
      const finishedKey = keyFor(entityType, resourceID);
      if (activeKey !== finishedKey) return undefined;
      activeKey = "";
      const result = pending && keyFor(pending.entityType, pending.resourceID) === finishedKey ? pending : undefined;
      pending = undefined;
      return result;
    },
    reset() {
      activeKey = "";
      pending = undefined;
    },
  };
}

export function createOneShotBlurSuppression() {
  let suppressNextBlur = false;
  return {
    suppress() {
      suppressNextBlur = true;
    },
    shouldHandleBlur(): boolean {
      if (!suppressNextBlur) return true;
      suppressNextBlur = false;
      return false;
    },
  };
}

export function preserveEditingEntityTitleInSnapshot<T extends { node_id: string }>(
  snapshot: T[],
  current: T[],
  editingID: string | null,
  preserveTitle: (incoming: T, current: T) => T,
): T[] {
  const cleanEditingID = editingID?.trim() ?? "";
  if (!cleanEditingID) return snapshot;
  const currentEntity = current.find((item) => item.node_id === cleanEditingID);
  if (!currentEntity) return snapshot;
  let changed = false;
  const next = snapshot.map((incoming) => {
    if (incoming.node_id !== cleanEditingID) return incoming;
    const preserved = preserveTitle(incoming, currentEntity);
    if (preserved === incoming) return incoming;
    changed = true;
    return preserved;
  });
  return changed ? next : snapshot;
}

export function resetCommittedEntityTitleRegistryForTests(): void {
  latestCommittedEntityTitleUpdates.clear();
  committedEntityTitleVersion = 0;
}

export function subscribeCommittedEntityTitleUpdates(
  listener: (update: CommittedEntityTitleUpdate) => void,
  target: EventTarget = window,
): () => void {
  const handleUpdate = (event: Event) => listener((event as CustomEvent<CommittedEntityTitleUpdate>).detail);
  target.addEventListener(EVENT_COMMITTED_ENTITY_TITLE_UPDATED, handleUpdate);
  return () => target.removeEventListener(EVENT_COMMITTED_ENTITY_TITLE_UPDATED, handleUpdate);
}

export type CompanyExplorerEntityTitleUpdate = CommittedEntityTitleUpdate;
export const publishCompanyExplorerEntityTitleUpdate = publishCommittedEntityTitleUpdate;
export const subscribeCompanyExplorerEntityTitleUpdates = subscribeCommittedEntityTitleUpdates;
