export type TextBlockProjectionSaveRequest<TContent> = {
  blockID: string;
  content: TContent;
  sentVersion: number;
  baseRevision: number;
};

export type TextBlockProjectionSaveAck = { revision: number };

export type TextBlockProjectionSaveSeed<TContent> = {
  blockID: string;
  content: TContent;
  revision?: number;
};

export type TextBlockProjectionSaveStateSnapshot<TContent> = {
  latestContent: TContent;
  localVersion: number;
  baseRevision: number;
  hasChanged: boolean;
  saveInProgress: boolean;
  saveNeededAfterCurrentSave: boolean;
};

export type TextBlockProjectionSaveControllerOptions<TContent> = {
  saveBlock: (request: TextBlockProjectionSaveRequest<TContent>) => Promise<TextBlockProjectionSaveAck | void>;
  onBlockSaveInProgressChange?: (blockID: string, saveInProgress: boolean) => void;
  onSaveAcknowledged?: (blockID: string, content: TContent, revision: number, fullySaved: boolean) => void;
  onSaveError?: (blockID: string, cause: unknown) => void;
};

export type TextBlockProjectionSaveController<TContent> = {
  configure: (options: TextBlockProjectionSaveControllerOptions<TContent>) => void;
  replaceBlocksAsHasNotChanged: (blocks: TextBlockProjectionSaveSeed<TContent>[]) => void;
  replaceBlockAsHasNotChanged: (block: TextBlockProjectionSaveSeed<TContent>) => void;
  adoptLatestRevision: (blockID: string, revision: number) => void;
  clear: () => void;
  removeBlock: (blockID: string) => void;
  markHasChanged: (blockID: string, content: TContent) => number;
  hasAnyChangedOrSaveInProgress: () => boolean;
  getSnapshot: (blockID: string) => TextBlockProjectionSaveStateSnapshot<TContent> | null;
  startLatestContentSave: (blockID: string) => void;
  saveLatestContent: (blockID: string) => Promise<void>;
  waitForInProgressSaveThenRemoveBlock: (blockID: string) => Promise<void>;
  waitForInProgressSave: (blockID: string) => Promise<TextBlockProjectionSaveStateSnapshot<TContent> | null>;
  flushChangedBlocks: () => Promise<void>;
};

type TextBlockProjectionSaveState<TContent> = TextBlockProjectionSaveStateSnapshot<TContent> & { savePromise?: Promise<void>; deleteRequested?: boolean };

export function createTextBlockProjectionSaveController<TContent>(): TextBlockProjectionSaveController<TContent> {
  const blockSaves = new Map<string, TextBlockProjectionSaveState<TContent>>();
  let options: TextBlockProjectionSaveControllerOptions<TContent> | null = null;

  function configure(nextOptions: TextBlockProjectionSaveControllerOptions<TContent>): void { options = nextOptions; }

  function cleanRevision(revision: number): number { return Number.isInteger(revision) && revision >= 0 ? revision : 0; }

  function replaceBlockAsHasNotChanged(block: TextBlockProjectionSaveSeed<TContent>): void {
    if (!block.blockID) return;
    blockSaves.set(block.blockID, { latestContent: block.content, localVersion: 0, baseRevision: cleanRevision(block.revision ?? 0), hasChanged: false, saveInProgress: false, saveNeededAfterCurrentSave: false });
  }

  function replaceBlocksAsHasNotChanged(blocks: TextBlockProjectionSaveSeed<TContent>[]): void {
    blockSaves.clear();
    for (const block of blocks) replaceBlockAsHasNotChanged(block);
  }

  function adoptLatestRevision(blockID: string, revision: number): void {
    const state = blockSaves.get(blockID);
    if (!state || state.saveInProgress) return;
    state.baseRevision = cleanRevision(revision);
    state.hasChanged = true;
  }

  function clear(): void { blockSaves.clear(); }
  function removeBlock(blockID: string): void { blockSaves.delete(blockID); }

  function ensureBlock(blockID: string, content: TContent): TextBlockProjectionSaveState<TContent> {
    const existing = blockSaves.get(blockID);
    if (existing) return existing;
    const created: TextBlockProjectionSaveState<TContent> = { latestContent: content, localVersion: 0, baseRevision: 0, hasChanged: false, saveInProgress: false, saveNeededAfterCurrentSave: false };
    blockSaves.set(blockID, created);
    return created;
  }

  function markHasChanged(blockID: string, content: TContent): number {
    const state = ensureBlock(blockID, content);
    if (state.deleteRequested) return state.localVersion;
    state.latestContent = content;
    state.localVersion += 1;
    state.hasChanged = true;
    if (state.saveInProgress) state.saveNeededAfterCurrentSave = true;
    return state.localVersion;
  }

  function hasAnyChangedOrSaveInProgress(): boolean {
    for (const state of blockSaves.values()) if (state.hasChanged || state.saveInProgress || state.saveNeededAfterCurrentSave) return true;
    return false;
  }

  function snapshot(state: TextBlockProjectionSaveState<TContent>): TextBlockProjectionSaveStateSnapshot<TContent> {
    return { latestContent: state.latestContent, localVersion: state.localVersion, baseRevision: state.baseRevision, hasChanged: state.hasChanged, saveInProgress: state.saveInProgress, saveNeededAfterCurrentSave: state.saveNeededAfterCurrentSave };
  }

  function getSnapshot(blockID: string): TextBlockProjectionSaveStateSnapshot<TContent> | null {
    const state = blockSaves.get(blockID);
    return state ? snapshot(state) : null;
  }

  function startOneSave(blockID: string, state: TextBlockProjectionSaveState<TContent>): Promise<void> {
    if (!options) return Promise.reject(new Error("text_block_projection_save_controller_not_configured"));
    const sentVersion = state.localVersion;
    const content = state.latestContent;
    const baseRevision = state.baseRevision;
    state.saveInProgress = true;
    state.saveNeededAfterCurrentSave = false;
    options.onBlockSaveInProgressChange?.(blockID, true);
    const savePromise = (async () => {
      try {
        const ack = await options?.saveBlock({ blockID, content, sentVersion, baseRevision });
        const acknowledgedRevision = ack?.revision ?? baseRevision + 1;
        if (!Number.isInteger(acknowledgedRevision) || acknowledgedRevision <= baseRevision) throw new Error("invalid_projection_revision_ack");
        const latestState = blockSaves.get(blockID);
        if (!latestState) return;
        if (latestState.deleteRequested) {
          latestState.hasChanged = false;
          latestState.saveNeededAfterCurrentSave = false;
          return;
        }
        latestState.baseRevision = acknowledgedRevision;
        const fullySaved = latestState.localVersion === sentVersion;
        latestState.hasChanged = !fullySaved;
        latestState.saveNeededAfterCurrentSave = !fullySaved;
        options?.onSaveAcknowledged?.(blockID, content, acknowledgedRevision, fullySaved);
      } catch (cause) {
        const latestState = blockSaves.get(blockID);
        if (latestState) latestState.hasChanged = true;
        options?.onSaveError?.(blockID, cause);
        throw cause;
      } finally {
        const latestState = blockSaves.get(blockID);
        if (latestState) {
          latestState.saveInProgress = false;
          latestState.savePromise = undefined;
          options?.onBlockSaveInProgressChange?.(blockID, false);
        }
      }
    })();
    state.savePromise = savePromise;
    return savePromise;
  }

  async function saveLatestContent(blockID: string): Promise<void> {
    for (;;) {
      const state = blockSaves.get(blockID);
      if (!state) return;
      if (state.deleteRequested) return;
      if (state.saveInProgress) { if (state.savePromise) await state.savePromise; continue; }
      if (!state.hasChanged && !state.saveNeededAfterCurrentSave) return;
      await startOneSave(blockID, state);
    }
  }

  function startLatestContentSave(blockID: string): void { void saveLatestContent(blockID).catch(() => undefined); }

  async function flushChangedBlocks(): Promise<void> {
    const blockIDs = Array.from(blockSaves.entries()).filter(([, state]) => state.hasChanged || state.saveInProgress || state.saveNeededAfterCurrentSave).map(([blockID]) => blockID);
    for (const blockID of blockIDs) await saveLatestContent(blockID);
  }

  async function waitForInProgressSave(blockID: string): Promise<TextBlockProjectionSaveStateSnapshot<TContent> | null> {
    const state = blockSaves.get(blockID);
    if (state?.savePromise) await state.savePromise;
    return getSnapshot(blockID);
  }

  async function waitForInProgressSaveThenRemoveBlock(blockID: string): Promise<void> {
    const state = blockSaves.get(blockID);
    if (!state) return;
    state.deleteRequested = true;
    state.hasChanged = false;
    state.saveNeededAfterCurrentSave = false;
    if (state.savePromise) {
      try { await state.savePromise; } catch { /* Deletion still owns the next server action. */ }
    }
    blockSaves.delete(blockID);
  }

  return { configure, replaceBlocksAsHasNotChanged, replaceBlockAsHasNotChanged, adoptLatestRevision, clear, removeBlock, markHasChanged, hasAnyChangedOrSaveInProgress, getSnapshot, startLatestContentSave, saveLatestContent, waitForInProgressSave, waitForInProgressSaveThenRemoveBlock, flushChangedBlocks };
}
