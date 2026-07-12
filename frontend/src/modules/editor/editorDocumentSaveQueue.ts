export type EditorDocumentSaveQueueState<TRequest> = {
  inFlight: boolean;
  activeRequest: TRequest | null;
  queuedRequests: readonly TRequest[];
};

export type EditorDocumentSaveQueueOptions<TRequest> = {
  targetKey: (request: TRequest) => string;
  sameRequest: (left: TRequest | null, right: TRequest | null) => boolean;
  persist: (request: TRequest) => Promise<void>;
  onStateChange?: (state: EditorDocumentSaveQueueState<TRequest>) => void;
};

export type EditorDocumentSaveQueue<TRequest> = {
  configure: (options: EditorDocumentSaveQueueOptions<TRequest>) => void;
  enqueue: (request: TRequest) => void;
  waitForIdle: () => Promise<void>;
  getState: () => EditorDocumentSaveQueueState<TRequest>;
};

/**
 * Runs document saves one at a time while retaining the latest queued value for
 * every target. Replacing a queued value does not move that target behind other
 * targets, so cross-target ordering remains deterministic.
 */
export function createEditorDocumentSaveQueue<TRequest>(): EditorDocumentSaveQueue<TRequest> {
  const queuedByTarget = new Map<string, TRequest>();
  let options: EditorDocumentSaveQueueOptions<TRequest> | null = null;
  let activeRequest: TRequest | null = null;
  let drainPromise: Promise<void> | null = null;

  function getState(): EditorDocumentSaveQueueState<TRequest> {
    return {
      inFlight: activeRequest !== null || drainPromise !== null || queuedByTarget.size > 0,
      activeRequest,
      queuedRequests: [...queuedByTarget.values()],
    };
  }

  function emitState(): void {
    options?.onStateChange?.(getState());
  }

  function settleDrain(settledPromise: Promise<void>): void {
    if (drainPromise !== settledPromise) return;
    drainPromise = null;
    activeRequest = null;
    emitState();
    startDrainIfNeeded();
  }

  async function drainQueuedRequests(): Promise<void> {
    while (queuedByTarget.size > 0) {
      const nextEntry = queuedByTarget.entries().next().value as [string, TRequest] | undefined;
      if (!nextEntry) break;
      const [targetKey, request] = nextEntry;
      queuedByTarget.delete(targetKey);
      activeRequest = request;
      emitState();

      const persist = options?.persist;
      if (!persist) throw new Error("editor_document_save_queue_not_configured");
      await persist(request);
      activeRequest = null;
      emitState();
    }
  }

  function startDrainIfNeeded(): void {
    if (drainPromise || queuedByTarget.size === 0) return;
    const nextDrain = drainQueuedRequests();
    drainPromise = nextDrain;
    emitState();
    void nextDrain.then(
      () => settleDrain(nextDrain),
      () => settleDrain(nextDrain),
    );
  }

  return {
    configure(nextOptions) {
      options = nextOptions;
      emitState();
      startDrainIfNeeded();
    },
    enqueue(request) {
      if (!options) throw new Error("editor_document_save_queue_not_configured");
      const targetKey = options.targetKey(request);

      // If the latest value returns to the request already being persisted,
      // discard any superseded queued value for that target.
      if (options.sameRequest(activeRequest, request)) {
        queuedByTarget.delete(targetKey);
        emitState();
        return;
      }

      // Map#set replaces the value without changing insertion order. This is
      // the key distinction from a single queuedSaveRef: target B cannot erase
      // a pending latest value for target A.
      queuedByTarget.set(targetKey, request);
      emitState();
      startDrainIfNeeded();
    },
    async waitForIdle() {
      for (;;) {
        startDrainIfNeeded();
        const activeDrain = drainPromise;
        if (!activeDrain) return;
        try {
          await activeDrain;
        } catch {
          // Persistence owns user-facing error reporting. Match the existing
          // hook behavior by waiting for any remaining targets to drain.
        }
      }
    },
    getState,
  };
}
