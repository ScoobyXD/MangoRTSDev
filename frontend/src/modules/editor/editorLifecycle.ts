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
  private readonly listeners = new Set<(snapshot: MangoEditorLifecycleSnapshot) => void>();

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
    this.pendingCount = Math.max(1, this.pendingCount);
    this.transition("dirty");
  }

  setPendingCount(count: number): void {
    this.pendingCount = Math.max(0, Math.trunc(count));
    if (this.pendingCount > 0) this.transition("dirty");
    else if (this.state === "dirty") this.transition("active");
    else this.publish();
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
    this.state = next;
    this.publish();
  }

  private publish(): void {
    const next = this.getSnapshot();
    this.listeners.forEach((listener) => listener(next));
  }
}
