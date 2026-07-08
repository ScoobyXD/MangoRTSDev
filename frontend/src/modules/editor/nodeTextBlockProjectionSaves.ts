export type TextBlockProjectionSaveRequest<TContent> = {
  blockID: string;
  content: TContent;
  sentVersion: number;
};

export type TextBlockProjectionSaveSeed<TContent> = {
  blockID: string;
  content: TContent;
};

export type TextBlockProjectionSaveStateSnapshot<TContent> = {
  latestContent: TContent;
  localVersion: number;
  hasChanged: boolean;
  saveInProgress: boolean;
  saveNeededAfterCurrentSave: boolean;
};

export type TextBlockProjectionSaveControllerOptions<TContent> = {
  saveBlock: (request: TextBlockProjectionSaveRequest<TContent>) => Promise<void>;
  onBlockSaveInProgressChange?: (blockID: string, saveInProgress: boolean) => void;
  onSaveError?: (blockID: string, cause: unknown) => void;
};

export type TextBlockProjectionSaveController<TContent> = {
  configure: (options: TextBlockProjectionSaveControllerOptions<TContent>) => void;
  replaceBlocksAsHasNotChanged: (blocks: TextBlockProjectionSaveSeed<TContent>[]) => void;
  clear: () => void;
  removeBlock: (blockID: string) => void;
  markHasChanged: (blockID: string, content: TContent) => number;
  hasAnyChangedOrSaveInProgress: () => boolean;
  getSnapshot: (blockID: string) => TextBlockProjectionSaveStateSnapshot<TContent> | null;
  startLatestContentSave: (blockID: string) => void;
  saveLatestContent: (blockID: string) => Promise<void>;
  flushChangedBlocks: () => Promise<void>;
};

type TextBlockProjectionSaveState<TContent> = TextBlockProjectionSaveStateSnapshot<TContent> & {
  savePromise?: Promise<void>;
};

export function createTextBlockProjectionSaveController<TContent>(): TextBlockProjectionSaveController<TContent> {
  const blockSaves = new Map<string, TextBlockProjectionSaveState<TContent>>();
  let options: TextBlockProjectionSaveControllerOptions<TContent> | null = null;

  function configure(nextOptions: TextBlockProjectionSaveControllerOptions<TContent>): void {
    options = nextOptions;
  }

  function replaceBlocksAsHasNotChanged(blocks: TextBlockProjectionSaveSeed<TContent>[]): void {
    blockSaves.clear();
    for (const block of blocks) {
      if (!block.blockID) continue;
      blockSaves.set(block.blockID, {
        latestContent: block.content,
        localVersion: 0,
        hasChanged: false,
        saveInProgress: false,
        saveNeededAfterCurrentSave: false,
      });
    }
  }

  function clear(): void {
    blockSaves.clear();
  }

  function removeBlock(blockID: string): void {
    blockSaves.delete(blockID);
  }

  function ensureBlock(blockID: string, content: TContent): TextBlockProjectionSaveState<TContent> {
    const existing = blockSaves.get(blockID);
    if (existing) return existing;
    const created: TextBlockProjectionSaveState<TContent> = {
      latestContent: content,
      localVersion: 0,
      hasChanged: false,
      saveInProgress: false,
      saveNeededAfterCurrentSave: false,
    };
    blockSaves.set(blockID, created);
    return created;
  }

  function markHasChanged(blockID: string, content: TContent): number {
    const state = ensureBlock(blockID, content);
    state.latestContent = content;
    state.localVersion += 1;
    state.hasChanged = true;
    if (state.saveInProgress) state.saveNeededAfterCurrentSave = true;
    return state.localVersion;
  }

  function hasAnyChangedOrSaveInProgress(): boolean {
    for (const state of blockSaves.values()) {
      if (state.hasChanged || state.saveInProgress || state.saveNeededAfterCurrentSave) return true;
    }
    return false;
  }

  function getSnapshot(blockID: string): TextBlockProjectionSaveStateSnapshot<TContent> | null {
    const state = blockSaves.get(blockID);
    if (!state) return null;
    return {
      latestContent: state.latestContent,
      localVersion: state.localVersion,
      hasChanged: state.hasChanged,
      saveInProgress: state.saveInProgress,
      saveNeededAfterCurrentSave: state.saveNeededAfterCurrentSave,
    };
  }

  function blockHasSaveToFlush(state: TextBlockProjectionSaveState<TContent>): boolean {
    return state.hasChanged || state.saveInProgress || state.saveNeededAfterCurrentSave;
  }

  function startOneSave(blockID: string, state: TextBlockProjectionSaveState<TContent>): Promise<void> {
    if (!options) return Promise.reject(new Error("text_block_projection_save_controller_not_configured"));
    const saveBlock = options.saveBlock;
    const onBlockSaveInProgressChange = options.onBlockSaveInProgressChange;
    const onSaveError = options.onSaveError;
    const sentVersion = state.localVersion;
    const content = state.latestContent;

    state.saveInProgress = true;
    state.saveNeededAfterCurrentSave = false;
    onBlockSaveInProgressChange?.(blockID, true);

    const savePromise = (async () => {
      try {
        await saveBlock({ blockID, content, sentVersion });
        const latestState = blockSaves.get(blockID);
        if (!latestState) return;
        if (latestState.localVersion === sentVersion) {
          latestState.hasChanged = false;
          latestState.saveNeededAfterCurrentSave = false;
        } else {
          latestState.hasChanged = true;
          latestState.saveNeededAfterCurrentSave = true;
        }
      } catch (cause) {
        const latestState = blockSaves.get(blockID);
        if (latestState) latestState.hasChanged = true;
        onSaveError?.(blockID, cause);
        throw cause;
      } finally {
        const latestState = blockSaves.get(blockID);
        if (latestState) {
          latestState.saveInProgress = false;
          latestState.savePromise = undefined;
          onBlockSaveInProgressChange?.(blockID, false);
        }
      }
    })();

    state.savePromise = savePromise;
    return savePromise;
  }

  async function saveLatestContent(blockID: string): Promise<void> {
    while (true) {
      const state = blockSaves.get(blockID);
      if (!state) return;
      if (state.saveInProgress) {
        if (state.savePromise) await state.savePromise;
        continue;
      }
      if (!state.hasChanged && !state.saveNeededAfterCurrentSave) return;
      await startOneSave(blockID, state);
    }
  }

  function startLatestContentSave(blockID: string): void {
    void saveLatestContent(blockID).catch(() => undefined);
  }

  async function flushChangedBlocks(): Promise<void> {
    const blockIDs = Array.from(blockSaves.entries())
      .filter(([, state]) => blockHasSaveToFlush(state))
      .map(([blockID]) => blockID);
    for (const blockID of blockIDs) {
      await saveLatestContent(blockID);
    }
  }

  return {
    configure,
    replaceBlocksAsHasNotChanged,
    clear,
    removeBlock,
    markHasChanged,
    hasAnyChangedOrSaveInProgress,
    getSnapshot,
    startLatestContentSave,
    saveLatestContent,
    flushChangedBlocks,
  };
}
