export type EditorRuntimeMetricName =
  | "active_editors"
  | "dirty_editors"
  | "listeners"
  | "observers"
  | "recovery_requests"
  | "indexeddb_reads"
  | "indexeddb_writes"
  | "image_requests"
  | "transactions"
  | "network_saves"
  | "conflicts";

export type EditorRuntimeMetricsSnapshot = Readonly<Record<EditorRuntimeMetricName, number>>;

const metricNames: readonly EditorRuntimeMetricName[] = [
  "active_editors", "dirty_editors", "listeners", "observers", "recovery_requests",
  "indexeddb_reads", "indexeddb_writes", "image_requests", "transactions", "network_saves", "conflicts",
];
const metrics = new Map<EditorRuntimeMetricName, number>(metricNames.map((name) => [name, 0]));
const listeners = new Set<(snapshot: EditorRuntimeMetricsSnapshot) => void>();

function snapshot(): EditorRuntimeMetricsSnapshot {
  return Object.freeze(Object.fromEntries(metricNames.map((name) => [name, metrics.get(name) ?? 0]))) as EditorRuntimeMetricsSnapshot;
}

function publish(): void {
  const next = snapshot();
  listeners.forEach((listener) => listener(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new window.CustomEvent("mango:editor-runtime-metrics", { detail: next }));
  }
}

export function incrementEditorRuntimeMetric(name: EditorRuntimeMetricName, amount = 1): void {
  metrics.set(name, Math.max(0, (metrics.get(name) ?? 0) + amount));
  publish();
}

export function trackEditorRuntimeResource(name: "active_editors" | "dirty_editors" | "listeners" | "observers"): () => void {
  incrementEditorRuntimeMetric(name, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    incrementEditorRuntimeMetric(name, -1);
  };
}

export function getEditorRuntimeMetrics(): EditorRuntimeMetricsSnapshot { return snapshot(); }

export function subscribeEditorRuntimeMetrics(listener: (next: EditorRuntimeMetricsSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export function resetEditorRuntimeMetricsForTests(): void {
  metricNames.forEach((name) => metrics.set(name, 0));
  publish();
}
