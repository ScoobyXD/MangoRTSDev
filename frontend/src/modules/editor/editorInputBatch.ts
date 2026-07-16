import type { EditorDocumentChangeKind, EditorDocumentUndoSnapshot } from "./editorUndoHistory.js";

export const EDITOR_NATIVE_INPUT_IDLE_BATCH_MS = 160;
export const EDITOR_NATIVE_INPUT_MAX_BATCH_MS = 500;

export type PendingEditorNativeInputBatch = {
  root: HTMLElement;
  before: EditorDocumentUndoSnapshot | null;
  kind: EditorDocumentChangeKind;
};

export type EditorInputBatchScheduler = {
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
};

type MutableEditorNativeInputBatch = PendingEditorNativeInputBatch & {
  dirty: boolean;
};

type EditorNativeInputBatcherOptions = {
  idleMs?: number;
  maxMs?: number;
};

export class EditorNativeInputBatcher {
  private pending: MutableEditorNativeInputBatch | null = null;
  private idleTimer: unknown;
  private maxTimer: unknown;
  private readonly idleMs: number;
  private readonly maxMs: number;

  constructor(
    private readonly scheduler: EditorInputBatchScheduler,
    private readonly onFlush: (batch: PendingEditorNativeInputBatch) => string | undefined,
    options: EditorNativeInputBatcherOptions = {},
  ) {
    this.idleMs = Math.max(0, options.idleMs ?? EDITOR_NATIVE_INPUT_IDLE_BATCH_MS);
    this.maxMs = Math.max(this.idleMs, options.maxMs ?? EDITOR_NATIVE_INPUT_MAX_BATCH_MS);
  }

  begin(
    root: HTMLElement,
    kind: EditorDocumentChangeKind,
    captureBefore: () => EditorDocumentUndoSnapshot,
  ): void {
    this.flushBoundary(root, kind);
    if (this.pending) return;
    this.pending = { root, kind, before: captureBefore(), dirty: false };
  }

  flushBoundary(root: HTMLElement, kind: EditorDocumentChangeKind): string | undefined {
    if (!this.pending || (this.pending.root === root && this.pending.kind === kind)) return undefined;
    return this.flush();
  }

  markChanged(root: HTMLElement, deferFlush = false): void {
    if (this.pending && this.pending.root !== root) this.flush();
    if (!this.pending) this.pending = { root, kind: "unknown", before: null, dirty: false };
    this.pending.dirty = true;
    if (deferFlush) return;

    if (this.idleTimer !== undefined) this.scheduler.cancel(this.idleTimer);
    this.idleTimer = this.scheduler.schedule(() => {
      this.idleTimer = undefined;
      this.flush(root);
    }, this.idleMs);

    if (this.maxTimer === undefined) {
      this.maxTimer = this.scheduler.schedule(() => {
        this.maxTimer = undefined;
        this.flush(root);
      }, this.maxMs);
    }
  }

  flush(root?: HTMLElement | null): string | undefined {
    if (!this.pending || (root && this.pending.root !== root)) return undefined;
    const pending = this.pending;
    this.pending = null;
    this.clearTimers();
    if (!pending.dirty) return undefined;
    return this.onFlush({ root: pending.root, before: pending.before, kind: pending.kind });
  }

  discard(root?: HTMLElement | null): void {
    if (!this.pending || (root && this.pending.root !== root)) return;
    this.pending = null;
    this.clearTimers();
  }

  hasPendingChanges(root?: HTMLElement | null): boolean {
    return Boolean(this.pending?.dirty && (!root || this.pending.root === root));
  }

  private clearTimers(): void {
    if (this.idleTimer !== undefined) this.scheduler.cancel(this.idleTimer);
    if (this.maxTimer !== undefined) this.scheduler.cancel(this.maxTimer);
    this.idleTimer = undefined;
    this.maxTimer = undefined;
  }
}
