import {
  editorTraceInstant,
  traceEditorFunction,
  type EditorTraceContext,
} from "./editorTrace.js";

export type MangoEditorLifecycleState = "sleeping" | "preparing" | "active" | "dirty" | "safely-inactive";

export type MangoEditorLifecycleSnapshot = {
  state: MangoEditorLifecycleState;
  pinned: boolean;
  pendingCount: number;
  targeted: boolean;
  nearViewport: boolean;
};

export class MangoEditorLifecycle {
  private state: MangoEditorLifecycleState = "sleeping";
  private pendingCount = 0;
  private targeted = false;
  private nearViewport = false;
  private lastPublished: MangoEditorLifecycleSnapshot | undefined;
  private readonly listeners = new Set<(snapshot: MangoEditorLifecycleSnapshot) => void>();

  constructor(private readonly traceContext: EditorTraceContext | null = null) {}

  getSnapshot(): MangoEditorLifecycleSnapshot {
    return {
      state: this.state,
      pinned: this.pendingCount > 0 || this.state === "dirty" || this.targeted,
      pendingCount: this.pendingCount,
      targeted: this.targeted,
      nearViewport: this.nearViewport,
    };
  }

  subscribe(listener: (snapshot: MangoEditorLifecycleSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  setNearViewport(value: boolean): void {
    this.nearViewport = value;
    if (value && this.state === "sleeping") this.transition("preparing");
    else if (!value && this.state === "preparing" && !this.targeted) this.transition("sleeping");
    else this.publish();
  }

  setTargeted(value: boolean): void {
    this.targeted = value;
    if (value && (this.state === "sleeping" || this.state === "safely-inactive")) this.transition("preparing");
    else this.publish();
  }

  activate(): void { this.transition(this.pendingCount > 0 ? "dirty" : "active"); }

  finishPreparation(): void {
    if (this.pendingCount > 0) this.transition("dirty");
    else if (this.targeted) this.transition("active");
    else this.transition("sleeping");
  }

  markDirty(): void {
    traceEditorFunction(this.traceContext, "lifecycle.mark_dirty", "editor.lifecycle", () => {
      this.pendingCount = Math.max(1, this.pendingCount);
      this.transition("dirty");
    });
  }

  setPendingCount(count: number): void {
    traceEditorFunction(this.traceContext, "lifecycle.set_pending_count", "editor.lifecycle", () => {
      this.pendingCount = Math.max(0, Math.trunc(count));
      if (this.pendingCount > 0) this.transition("dirty");
      else if (this.state === "dirty") this.transition("active");
      else this.publish();
    }, { requested_count: count });
  }

  requestSleep(): boolean {
    if (this.pendingCount > 0 || this.state === "dirty" || this.targeted) {
      this.publish();
      return false;
    }
    this.transition("safely-inactive");
    return true;
  }

  finishDeactivation(): void {
    if (this.pendingCount > 0 || this.targeted) return;
    this.transition(this.nearViewport ? "preparing" : "sleeping");
  }

  private transition(next: MangoEditorLifecycleState): void {
    const previous = this.state;
    this.state = next;
    editorTraceInstant(this.traceContext, "lifecycle.transition", "editor.lifecycle", {
      previous_state: previous,
      next_state: next,
      pending_count: this.pendingCount,
    });
    this.publish();
  }

  private publish(): void {
    traceEditorFunction(this.traceContext, "lifecycle.publish", "editor.lifecycle", () => {
      const next = this.getSnapshot();
      const previous = this.lastPublished;
      if (previous && previous.state === next.state && previous.pinned === next.pinned
        && previous.pendingCount === next.pendingCount && previous.targeted === next.targeted
        && previous.nearViewport === next.nearViewport) return;
      this.lastPublished = next;
      editorTraceInstant(this.traceContext, "lifecycle.snapshot", "editor.lifecycle", {
        state: next.state,
        pinned: next.pinned,
        pending_count: next.pendingCount,
        targeted: next.targeted,
        near_viewport: next.nearViewport,
        listener_count: this.listeners.size,
      });
      this.listeners.forEach((listener) => listener(next));
    });
  }
}
