export type EditorDocumentSaveQueueState<TRequest> = {
  inFlight: boolean;
  activeRequest: TRequest | null;
  queuedRequests: readonly TRequest[];
  failedRequest: TRequest | null;
  failure: unknown;
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
  retryFailed: (requestOverride?: TRequest) => void;
  discardFailed: () => void;
  waitForIdle: () => Promise<void>;
  getState: () => EditorDocumentSaveQueueState<TRequest>;
};

/** Runs document saves one at a time and retains the exact failed/latest request until deliberate retry or discard. */
export function createEditorDocumentSaveQueue<TRequest>(): EditorDocumentSaveQueue<TRequest> {
  const queuedByTarget = new Map<string, TRequest>();
  let options: EditorDocumentSaveQueueOptions<TRequest> | null = null;
  let activeRequest: TRequest | null = null;
  let failedRequest: TRequest | null = null;
  let failure: unknown = null;
  let drainPromise: Promise<void> | null = null;

  function getState(): EditorDocumentSaveQueueState<TRequest> {
    return {
      inFlight: activeRequest !== null || drainPromise !== null,
      activeRequest,
      queuedRequests: [...queuedByTarget.values()],
      failedRequest,
      failure,
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
    while (!failedRequest && queuedByTarget.size > 0) {
      const nextEntry = queuedByTarget.entries().next().value as [string, TRequest] | undefined;
      if (!nextEntry) break;
      const [targetKey, request] = nextEntry;
      queuedByTarget.delete(targetKey);
      activeRequest = request;
      emitState();
      const persist = options?.persist;
      if (!persist) throw new Error("editor_document_save_queue_not_configured");
      try {
        await persist(request);
      } catch (cause) {
        failedRequest = request;
        failure = cause;
        activeRequest = null;
        emitState();
        throw cause;
      }
      activeRequest = null;
      emitState();
    }
  }

  function startDrainIfNeeded(): void {
    if (drainPromise || failedRequest || queuedByTarget.size === 0) return;
    const nextDrain = drainQueuedRequests();
    drainPromise = nextDrain;
    emitState();
    void nextDrain.then(() => settleDrain(nextDrain), () => settleDrain(nextDrain));
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
      if (failedRequest && options.targetKey(failedRequest) === targetKey) {
        failedRequest = request;
        emitState();
        return;
      }
      if (options.sameRequest(activeRequest, request)) {
        queuedByTarget.delete(targetKey);
        emitState();
        return;
      }
      queuedByTarget.set(targetKey, request);
      emitState();
      startDrainIfNeeded();
    },
    retryFailed(requestOverride) {
      if (!options || !failedRequest) return;
      const request = requestOverride ?? failedRequest;
      failedRequest = null;
      failure = null;
      queuedByTarget.set(options.targetKey(request), request);
      emitState();
      startDrainIfNeeded();
    },
    discardFailed() {
      failedRequest = null;
      failure = null;
      emitState();
      startDrainIfNeeded();
    },
    async waitForIdle() {
      for (;;) {
        if (failedRequest) throw failure ?? new Error("editor_document_save_failed");
        startDrainIfNeeded();
        const activeDrain = drainPromise;
        if (!activeDrain) return;
        await activeDrain;
      }
    },
    getState,
  };
}
