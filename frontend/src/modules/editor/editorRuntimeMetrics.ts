import {
  getCurrentEditorTraceContext,
  editorTraceInstant,
  traceEditorFunction,
} from "./editorTrace.js";

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
  | "full_document_serializations"
  | "network_saves"
  | "conflicts";

export type EditorRuntimeMetricsSnapshot = Readonly<Record<EditorRuntimeMetricName, number>>;

const metricNames: readonly EditorRuntimeMetricName[] = [
  "active_editors", "dirty_editors", "listeners", "observers", "recovery_requests",
  "indexeddb_reads", "indexeddb_writes", "image_requests", "transactions", "full_document_serializations",
  "network_saves", "conflicts",
];
const metrics = new Map<EditorRuntimeMetricName, number>(metricNames.map((name) => [name, 0]));
const listeners = new Set<(snapshot: EditorRuntimeMetricsSnapshot) => void>();

function snapshot(): EditorRuntimeMetricsSnapshot {
  return Object.freeze(Object.fromEntries(metricNames.map((name) => [name, metrics.get(name) ?? 0]))) as EditorRuntimeMetricsSnapshot;
}

function publish(): void {
  const traceContext = getCurrentEditorTraceContext();
  traceEditorFunction(traceContext, "runtime_metrics.publish", "editor.runtime_metrics", () => {
    const next = traceEditorFunction(
      traceContext,
      "runtime_metrics.snapshot",
      "editor.runtime_metrics",
      () => snapshot(),
    );
    traceEditorFunction(traceContext, "runtime_metrics.listeners", "editor.runtime_metrics", () => {
      listeners.forEach((listener) => listener(next));
    }, { listener_count: listeners.size });
    if (typeof window !== "undefined") {
      traceEditorFunction(traceContext, "runtime_metrics.window_event", "editor.runtime_metrics", () => {
        window.dispatchEvent(new window.CustomEvent("mango:editor-runtime-metrics", { detail: next }));
      });
    }
  });
}

export function incrementEditorRuntimeMetric(name: EditorRuntimeMetricName, amount = 1): void {
  const traceContext = getCurrentEditorTraceContext();
  traceEditorFunction(traceContext, "runtime_metrics.increment", "editor.runtime_metrics", () => {
    metrics.set(name, Math.max(0, (metrics.get(name) ?? 0) + amount));
    editorTraceInstant(traceContext, "runtime_metrics.value", "editor.runtime_metrics", {
      metric: name,
      amount,
      value: metrics.get(name) ?? 0,
    });
    publish();
  }, { metric: name, amount });
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
