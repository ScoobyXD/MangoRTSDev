export type EditorTraceResourceType = "node" | "project" | "logic_gate" | "huddle_logic_gate" | "kpi";

export type EditorTraceDataValue = string | number | boolean | null;
export type EditorTraceData = Readonly<Record<string, EditorTraceDataValue | undefined>>;

export type EditorTraceContext = {
  readonly sessionID: string;
  readonly resourceType: EditorTraceResourceType;
  readonly documentLabel: string;
  inputSequence: number;
  currentInputID: number;
  transactionSequence: number;
  currentTransactionID: number;
};

export type EditorTraceEvent = {
  sequence: number;
  timestamp_us: number;
  phase: "begin" | "end" | "instant";
  category: string;
  name: string;
  session_id?: string;
  input_id?: number;
  transaction_id?: number;
  span_id?: number;
  duration_us?: number;
  outcome?: "ok" | "error" | "cancelled";
  data?: Record<string, EditorTraceDataValue>;
};

export type EditorTraceExport = {
  trace_format: "mango-editor-trace";
  trace_version: 1;
  started_at: string;
  stopped_at: string;
  duration_ms: number;
  page: {
    origin: string;
    pathname: string;
    user_agent: string;
    hardware_concurrency: number | null;
    device_memory_gib: number | null;
    visibility_state: string;
  };
  limits: {
    maximum_events: number;
    dropped_events: number;
  };
  sessions: Array<{
    session_id: string;
    resource_type: EditorTraceResourceType;
    document_label: string;
  }>;
  open_spans: Array<{
    span_id: number;
    name: string;
    category: string;
    session_id?: string;
    started_timestamp_us: number;
  }>;
  events: EditorTraceEvent[];
};

export type EditorTraceSpan = {
  readonly id: number;
  readonly traceToken: object;
  readonly startedAt: number;
  readonly name: string;
  readonly category: string;
  readonly context: EditorTraceContext | null;
};

type OpenTraceSpan = EditorTraceSpan;

type EditorTraceState = {
  traceToken: object;
  recording: boolean;
  startedAtEpochMs: number;
  startedAtPerformanceMs: number;
  stoppedAtEpochMs: number;
  stoppedAtPerformanceMs: number;
  sequence: number;
  spanSequence: number;
  events: EditorTraceEvent[];
  openSpans: Map<number, OpenTraceSpan>;
  droppedEvents: number;
  observerCleanups: Array<() => void>;
};

type TraceableProseMirrorNode = {
  type?: { name?: string };
  isText?: boolean;
  text?: string | null;
  nodeSize?: number;
  childCount?: number;
  marks?: readonly unknown[];
  descendants?: (callback: (node: TraceableProseMirrorNode) => boolean | void) => void;
};

const MAXIMUM_TRACE_EVENTS = 250_000;
const TRACE_QUERY_PARAMETER = "editorTrace";
const TRACE_PANEL_ATTRIBUTE = "data-mango-editor-trace-panel";
const SAFE_TRACE_STRING_DATA_KEYS = new Set([
  "document_label",
  "entry_name",
  "error_name",
  "input_type",
  "method",
  "metric",
  "next_state",
  "path",
  "previous_state",
  "reason",
  "resource_type",
  "result",
  "slowest_script_function",
  "slowest_script_path",
  "stage",
  "state",
  "status",
  "visibility_state",
]);
const sessions = new Map<string, EditorTraceContext>();
const rootContexts = new WeakMap<Element, EditorTraceContext>();

let traceState: EditorTraceState | null = null;
let traceSessionSequence = 0;
let forcedForTests = false;
let activeSynchronousContext: EditorTraceContext | null = null;
let tracePanel: HTMLElement | null = null;

function tracePerformanceNow(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function traceRequestedByURL(): boolean {
  if (forcedForTests) return true;
  if (typeof window === "undefined") return false;
  const requested = new URLSearchParams(window.location.search).get(TRACE_QUERY_PARAMETER) === "1";
  if (!requested) return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "dev.mangorts.com"
    || hostname.endsWith(".dev.mangorts.com");
}

function cleanTraceData(data: EditorTraceData | undefined): Record<string, EditorTraceDataValue> | undefined {
  if (!data) return undefined;
  const cleaned: Record<string, EditorTraceDataValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || (typeof value === "number" && !Number.isFinite(value))) continue;
    if (typeof value === "string" && !SAFE_TRACE_STRING_DATA_KEYS.has(key)) continue;
    cleaned[key] = typeof value === "string" ? value.slice(0, 500) : value;
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

export function sanitizeEditorTracePath(value: string): string {
  const pathname = value.split(/[?#]/, 1)[0] || "/";
  const editorJSONPath = pathname.match(/^\/v1\/editor-json\/(node|project|logic_gate)\/[^/]+\/documents\/[^/]+/);
  if (editorJSONPath) return `/v1/editor-json/${editorJSONPath[1]}/:resource_id/documents/:document_id`;
  return pathname
    .replace(
      /\/(nodes|projects|logic-gates)\/[^/]+/gi,
      (_match, collection: string) => `/${collection}/:resource_id`,
    )
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":uuid");
}

function contextEventFields(context: EditorTraceContext | null): Pick<
EditorTraceEvent,
"session_id" | "input_id" | "transaction_id"
> {
  if (!context) return {};
  return {
    session_id: context.sessionID,
    ...(context.currentInputID > 0 ? { input_id: context.currentInputID } : {}),
    ...(context.currentTransactionID > 0 ? { transaction_id: context.currentTransactionID } : {}),
  };
}

function relativeTimestampMicroseconds(state: EditorTraceState, timestamp: number): number {
  return Math.max(0, Math.round((timestamp - state.startedAtPerformanceMs) * 1_000));
}

function appendTraceEvent(
  state: EditorTraceState,
  event: Omit<EditorTraceEvent, "sequence" | "timestamp_us">,
  timestamp = tracePerformanceNow(),
): void {
  if (!state.recording) return;
  if (state.events.length >= MAXIMUM_TRACE_EVENTS) {
    state.droppedEvents += 1;
    return;
  }
  state.sequence += 1;
  state.events.push({
    sequence: state.sequence,
    timestamp_us: relativeTimestampMicroseconds(state, timestamp),
    ...event,
  });
}

function traceContextForEvent(event: Event): EditorTraceContext | null {
  if (typeof Element === "undefined") return null;
  for (const candidate of event.composedPath()) {
    if (candidate instanceof Element) {
      const context = rootContexts.get(candidate);
      if (context) return context;
    }
  }
  const target = event.target;
  if (!(target instanceof Element)) return null;
  let current: Element | null = target;
  while (current) {
    const context = rootContexts.get(current);
    if (context) return context;
    current = current.parentElement;
  }
  return null;
}

function inputEventData(event: Event): EditorTraceData {
  const input = event as InputEvent;
  return {
    cancelable: event.cancelable,
    default_prevented: event.defaultPrevented,
    input_type: typeof input.inputType === "string" ? input.inputType : "",
    data_length: typeof input.data === "string" ? input.data.length : 0,
    composing: Boolean(input.isComposing),
  };
}

function scheduleInputPaintCheck(context: EditorTraceContext, inputID: number, eventAt: number): void {
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
  const scheduledState = traceState;
  if (!scheduledState?.recording) return;
  window.requestAnimationFrame((firstFrameAt) => {
    if (traceState !== scheduledState || !scheduledState.recording) return;
    editorTraceInstant(context, "browser.animation_frame_after_input", "browser.paint", {
      input_id: inputID,
      elapsed_ms: Math.max(0, firstFrameAt - eventAt),
      visibility_state: document.visibilityState,
    }, firstFrameAt);
    window.requestAnimationFrame((secondFrameAt) => {
      if (traceState !== scheduledState || !scheduledState.recording) return;
      editorTraceInstant(context, "browser.second_animation_frame_after_input", "browser.paint", {
        input_id: inputID,
        elapsed_ms: Math.max(0, secondFrameAt - eventAt),
        frame_gap_ms: Math.max(0, secondFrameAt - firstFrameAt),
        visibility_state: document.visibilityState,
      }, secondFrameAt);
    });
  });
}

function installInputObservers(): () => void {
  if (typeof document === "undefined") return () => {};
  const eventNames = [
    "keydown", "beforeinput", "input", "compositionstart", "compositionupdate", "compositionend",
    "paste", "cut", "focusin", "focusout",
  ] as const;
  const listener = (event: Event) => {
    const context = traceContextForEvent(event);
    if (!context) return;
    const eventAt = tracePerformanceNow();
    if (event.type === "keydown") {
      context.inputSequence += 1;
      context.currentInputID = context.inputSequence;
      const keyboard = event as KeyboardEvent;
      editorTraceInstant(context, "dom.keydown", "input", {
        input_id: context.currentInputID,
        printable: keyboard.key.length === 1,
        repeat: keyboard.repeat,
        composing: keyboard.isComposing,
        alt: keyboard.altKey,
        ctrl: keyboard.ctrlKey,
        meta: keyboard.metaKey,
        shift: keyboard.shiftKey,
      }, eventAt);
      return;
    }
    if (event.type === "beforeinput" && context.currentInputID === 0) {
      context.inputSequence += 1;
      context.currentInputID = context.inputSequence;
    }
    editorTraceInstant(context, `dom.${event.type}`, "input", inputEventData(event), eventAt);
    if (event.type === "input") {
      const inputID = context.currentInputID;
      scheduleInputPaintCheck(context, inputID, eventAt);
      queueMicrotask(() => {
        if (context.currentInputID === inputID) context.currentInputID = 0;
      });
    }
  };
  eventNames.forEach((name) => document.addEventListener(name, listener, true));
  return () => eventNames.forEach((name) => document.removeEventListener(name, listener, true));
}

function installPerformanceObserver(
  type: string,
  callback: (entry: PerformanceEntry) => void,
  options: PerformanceObserverInit,
): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};
  if (Array.isArray(PerformanceObserver.supportedEntryTypes)
    && !PerformanceObserver.supportedEntryTypes.includes(type)) return () => {};
  try {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(callback));
    observer.observe(options);
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}

function installBrowserPerformanceObservers(state: EditorTraceState): Array<() => void> {
  const cleanups: Array<() => void> = [];
  cleanups.push(installPerformanceObserver("longtask", (entry) => {
    if (entry.startTime < state.startedAtPerformanceMs) return;
    appendTraceEvent(state, {
      phase: "instant",
      category: "browser.long_task",
      name: "browser.long_task",
      data: {
        duration_ms: entry.duration,
        entry_name: entry.name,
      },
    }, entry.startTime);
  }, { type: "longtask", buffered: true } as PerformanceObserverInit));
  cleanups.push(installPerformanceObserver("long-animation-frame", (entry) => {
    if (entry.startTime < state.startedAtPerformanceMs) return;
    const frame = entry as PerformanceEntry & {
      blockingDuration?: number;
      renderStart?: number;
      styleAndLayoutStart?: number;
      scripts?: Array<{
        duration?: number;
        forcedStyleAndLayoutDuration?: number;
        sourceFunctionName?: string;
        sourceURL?: string;
      }>;
    };
    const slowestScript = [...(frame.scripts ?? [])].sort((left, right) => (
      (right.duration ?? 0) - (left.duration ?? 0)
    ))[0];
    appendTraceEvent(state, {
      phase: "instant",
      category: "browser.long_animation_frame",
      name: "browser.long_animation_frame",
      data: {
        duration_ms: entry.duration,
        blocking_duration_ms: frame.blockingDuration ?? 0,
        render_start_offset_ms: frame.renderStart ? frame.renderStart - entry.startTime : 0,
        style_layout_start_offset_ms: frame.styleAndLayoutStart ? frame.styleAndLayoutStart - entry.startTime : 0,
        script_count: frame.scripts?.length ?? 0,
        slowest_script_duration_ms: slowestScript?.duration ?? 0,
        slowest_script_layout_ms: slowestScript?.forcedStyleAndLayoutDuration ?? 0,
        slowest_script_function: slowestScript?.sourceFunctionName ?? "",
        slowest_script_path: safeScriptPath(slowestScript?.sourceURL),
      },
    }, entry.startTime);
  }, { type: "long-animation-frame", buffered: true } as PerformanceObserverInit));
  cleanups.push(installPerformanceObserver("event", (entry) => {
    if (entry.startTime < state.startedAtPerformanceMs) return;
    const timing = entry as PerformanceEntry & {
      processingStart?: number;
      processingEnd?: number;
      interactionId?: number;
    };
    appendTraceEvent(state, {
      phase: "instant",
      category: "browser.event_timing",
      name: `browser.event_timing.${entry.name}`,
      data: {
        duration_ms: entry.duration,
        input_delay_ms: timing.processingStart ? timing.processingStart - entry.startTime : 0,
        processing_ms: timing.processingStart && timing.processingEnd
          ? timing.processingEnd - timing.processingStart
          : 0,
        interaction_id: timing.interactionId ?? 0,
      },
    }, entry.startTime);
  }, { type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit));

  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    let frameRequest = 0;
    let previousFrameAt = tracePerformanceNow();
    const onFrame = (frameAt: number) => {
      const gap = frameAt - previousFrameAt;
      if (typeof document === "undefined" || document.visibilityState === "visible") {
        if (gap >= 32) {
          appendTraceEvent(state, {
            phase: "instant",
            category: "browser.frame_gap",
            name: "browser.frame_gap",
            data: { gap_ms: gap },
          }, previousFrameAt);
        }
      }
      previousFrameAt = frameAt;
      if (state.recording) frameRequest = window.requestAnimationFrame(onFrame);
    };
    frameRequest = window.requestAnimationFrame(onFrame);
    cleanups.push(() => window.cancelAnimationFrame(frameRequest));
  }
  return cleanups;
}

function safeScriptPath(sourceURL: string | undefined): string {
  if (!sourceURL) return "";
  try {
    const parsed = new URL(sourceURL, typeof window === "undefined" ? "http://localhost" : window.location.href);
    return parsed.origin === (typeof window === "undefined" ? parsed.origin : window.location.origin)
      ? sanitizeEditorTracePath(parsed.pathname)
      : parsed.origin;
  } catch {
    return "";
  }
}

function startNewTrace(): EditorTraceState {
  if (traceState?.recording) return traceState;
  traceState?.observerCleanups.forEach((cleanup) => cleanup());
  const startedAtPerformanceMs = tracePerformanceNow();
  const state: EditorTraceState = {
    traceToken: {},
    recording: true,
    startedAtEpochMs: Date.now(),
    startedAtPerformanceMs,
    stoppedAtEpochMs: 0,
    stoppedAtPerformanceMs: 0,
    sequence: 0,
    spanSequence: 0,
    events: [],
    openSpans: new Map(),
    droppedEvents: 0,
    observerCleanups: [],
  };
  traceState = state;
  state.observerCleanups = [installInputObservers(), ...installBrowserPerformanceObservers(state)];
  for (const context of sessions.values()) {
    editorTraceInstant(context, "editor.session.available", "trace", {
      resource_type: context.resourceType,
      document_label: context.documentLabel,
    });
  }
  updateTracePanel("recording");
  return state;
}

function stopTrace(): void {
  const state = traceState;
  if (!state?.recording) return;
  state.stoppedAtEpochMs = Date.now();
  state.stoppedAtPerformanceMs = tracePerformanceNow();
  state.recording = false;
  state.observerCleanups.forEach((cleanup) => cleanup());
  state.observerCleanups = [];
  updateTracePanel("stopped");
}

function restartTrace(): EditorTraceState {
  stopTrace();
  return startNewTrace();
}

function ensureTracePanel(): void {
  if (forcedForTests || typeof document === "undefined" || tracePanel?.isConnected) return;
  const create = () => {
    if (tracePanel?.isConnected || !document.body) return;
    const panel = document.createElement("aside");
    panel.setAttribute(TRACE_PANEL_ATTRIBUTE, "true");
    panel.setAttribute("role", "status");
    panel.style.cssText = [
      "position:fixed", "right:12px", "top:12px", "z-index:2147483647",
      "display:flex", "align-items:center", "gap:8px", "padding:9px 10px",
      "font:600 12px/1.2 system-ui,sans-serif", "color:#fff", "background:#111827",
      "border:1px solid #ef4444", "border-radius:9px", "box-shadow:0 8px 28px rgba(0,0,0,.35)",
    ].join(";");
    const label = document.createElement("span");
    label.dataset.mangoEditorTraceStatus = "true";
    panel.append(label);
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "Stop & download";
    download.dataset.mangoEditorTraceDownload = "true";
    download.style.cssText = "font:inherit;padding:5px 8px;border:0;border-radius:6px;cursor:pointer;color:#111827;background:#fca5a5;";
    download.addEventListener("pointerdown", (event) => event.preventDefault());
    download.addEventListener("click", () => downloadEditorTrace());
    panel.append(download);
    const restart = document.createElement("button");
    restart.type = "button";
    restart.textContent = "Start new";
    restart.dataset.mangoEditorTraceRestart = "true";
    restart.style.cssText = "font:inherit;padding:5px 8px;border:1px solid #64748b;border-radius:6px;cursor:pointer;color:#fff;background:#334155;";
    restart.addEventListener("pointerdown", (event) => event.preventDefault());
    restart.addEventListener("click", () => restartTrace());
    panel.append(restart);
    document.body.append(panel);
    tracePanel = panel;
    updateTracePanel(traceState?.recording ? "recording" : "stopped");
  };
  if (document.body) create();
  else document.addEventListener("DOMContentLoaded", create, { once: true });
}

function updateTracePanel(status: "recording" | "stopped"): void {
  const label = tracePanel?.querySelector<HTMLElement>("[data-mango-editor-trace-status]");
  const download = tracePanel?.querySelector<HTMLButtonElement>("[data-mango-editor-trace-download]");
  if (label) {
    label.textContent = status === "recording"
      ? "● Editor trace recording"
      : `Editor trace stopped (${traceState?.events.length ?? 0} events)`;
    label.style.color = status === "recording" ? "#fca5a5" : "#d1fae5";
  }
  if (download) download.disabled = status !== "recording" && !traceState;
}

function tracePageMetadata(): EditorTraceExport["page"] {
  const nav = typeof navigator === "undefined" ? undefined : navigator as Navigator & { deviceMemory?: number };
  return {
    origin: typeof window === "undefined" ? "" : window.location.origin,
    pathname: typeof window === "undefined" ? "" : sanitizeEditorTracePath(window.location.pathname),
    user_agent: nav?.userAgent ?? "",
    hardware_concurrency: Number.isFinite(nav?.hardwareConcurrency) ? nav!.hardwareConcurrency : null,
    device_memory_gib: Number.isFinite(nav?.deviceMemory) ? nav!.deviceMemory! : null,
    visibility_state: typeof document === "undefined" ? "unknown" : document.visibilityState,
  };
}

function buildTraceExport(): EditorTraceExport {
  const state = traceState;
  if (!state) throw new Error("editor_trace_not_started");
  const stoppedAtPerformanceMs = state.recording ? tracePerformanceNow() : state.stoppedAtPerformanceMs;
  const stoppedAtEpochMs = state.recording ? Date.now() : state.stoppedAtEpochMs;
  return {
    trace_format: "mango-editor-trace",
    trace_version: 1,
    started_at: new Date(state.startedAtEpochMs).toISOString(),
    stopped_at: new Date(stoppedAtEpochMs).toISOString(),
    duration_ms: Math.max(0, stoppedAtPerformanceMs - state.startedAtPerformanceMs),
    page: tracePageMetadata(),
    limits: {
      maximum_events: MAXIMUM_TRACE_EVENTS,
      dropped_events: state.droppedEvents,
    },
    sessions: [...sessions.values()].map((context) => ({
      session_id: context.sessionID,
      resource_type: context.resourceType,
      document_label: context.documentLabel,
    })),
    open_spans: [...state.openSpans.values()].map((span) => ({
      span_id: span.id,
      name: span.name,
      category: span.category,
      ...(span.context ? { session_id: span.context.sessionID } : {}),
      started_timestamp_us: relativeTimestampMicroseconds(state, span.startedAt),
    })),
    events: [...state.events].sort((left, right) => (
      left.timestamp_us - right.timestamp_us || left.sequence - right.sequence
    )),
  };
}

function downloadEditorTrace(): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  stopTrace();
  const trace = buildTraceExport();
  const body = JSON.stringify(trace, null, 2);
  const blob = new Blob([body], { type: "application/json" });
  const hasObjectURL = typeof URL.createObjectURL === "function";
  const objectURL = hasObjectURL
    ? URL.createObjectURL(blob)
    : `data:application/json;charset=utf-8,${encodeURIComponent(body)}`;
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = `mango-editor-trace-${trace.started_at.replace(/[:.]/g, "-")}.json`;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  if (hasObjectURL) window.setTimeout(() => URL.revokeObjectURL(objectURL), 0);
}

function maybeCreateUserTimingMeasure(span: EditorTraceSpan, finishedAt: number): void {
  const duration = finishedAt - span.startedAt;
  if (duration < 8 || typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    performance.measure(
      `mango-editor:${span.context?.sessionID ?? "global"}:${span.category}:${span.name}`,
      { start: span.startedAt, end: finishedAt },
    );
  } catch {
    // User Timing is supplemental; the recorder remains authoritative.
  }
}

export function isEditorTraceEnabled(): boolean {
  return traceRequestedByURL();
}

export function isEditorTraceRecording(): boolean {
  return Boolean(traceState?.recording);
}

export function createEditorTraceContext(input: {
  resourceType: EditorTraceResourceType;
  documentLabel: string;
}): EditorTraceContext | null {
  if (!traceRequestedByURL()) return null;
  traceSessionSequence += 1;
  const context: EditorTraceContext = {
    sessionID: `editor-${traceSessionSequence}`,
    resourceType: input.resourceType,
    documentLabel: input.resourceType === "logic_gate"
      ? "Process editor"
      : input.resourceType === "project" ? "Project editor" : "Node editor",
    inputSequence: 0,
    currentInputID: 0,
    transactionSequence: 0,
    currentTransactionID: 0,
  };
  sessions.set(context.sessionID, context);
  ensureTracePanel();
  startNewTrace();
  editorTraceInstant(context, "editor.session.created", "trace", {
    resource_type: context.resourceType,
    document_label: context.documentLabel,
  });
  return context;
}

export function registerEditorTraceRoot(context: EditorTraceContext | null, root: Element): () => void {
  if (!context) return () => {};
  sessions.set(context.sessionID, context);
  rootContexts.set(root, context);
  root.setAttribute("data-mango-editor-trace-session", context.sessionID);
  editorTraceInstant(context, "editor.root.registered", "trace");
  return () => {
    editorTraceInstant(context, "editor.root.unregistered", "trace");
    rootContexts.delete(root);
    root.removeAttribute("data-mango-editor-trace-session");
  };
}

export function releaseEditorTraceContext(context: EditorTraceContext | null): void {
  if (!context) return;
  editorTraceInstant(context, "editor.session.released", "trace");
  sessions.delete(context.sessionID);
}

export function editorTraceNow(): number | undefined {
  return traceState?.recording ? tracePerformanceNow() : undefined;
}

export function beginEditorTraceSpan(
  context: EditorTraceContext | null,
  name: string,
  category: string,
  data?: EditorTraceData,
): EditorTraceSpan | null {
  const state = traceState;
  if (!state?.recording) return null;
  state.spanSequence += 1;
  const span: EditorTraceSpan = {
    id: state.spanSequence,
    traceToken: state.traceToken,
    startedAt: tracePerformanceNow(),
    name,
    category,
    context,
  };
  state.openSpans.set(span.id, span);
  appendTraceEvent(state, {
    phase: "begin",
    category,
    name,
    span_id: span.id,
    ...contextEventFields(context),
    data: cleanTraceData(data),
  }, span.startedAt);
  return span;
}

export function endEditorTraceSpan(
  span: EditorTraceSpan | null,
  data?: EditorTraceData,
  outcome: "ok" | "error" | "cancelled" = "ok",
): void {
  if (!span) return;
  const state = traceState;
  if (!state?.recording) return;
  if (state.traceToken !== span.traceToken) return;
  if (!state.openSpans.has(span.id)) return;
  const finishedAt = tracePerformanceNow();
  state.openSpans.delete(span.id);
  appendTraceEvent(state, {
    phase: "end",
    category: span.category,
    name: span.name,
    span_id: span.id,
    duration_us: Math.max(0, Math.round((finishedAt - span.startedAt) * 1_000)),
    outcome,
    ...contextEventFields(span.context),
    data: cleanTraceData(data),
  }, finishedAt);
  maybeCreateUserTimingMeasure(span, finishedAt);
}

export function editorTraceInstant(
  context: EditorTraceContext | null,
  name: string,
  category: string,
  data?: EditorTraceData,
  timestamp?: number,
): void {
  const state = traceState;
  if (!state?.recording) return;
  appendTraceEvent(state, {
    phase: "instant",
    category,
    name,
    ...contextEventFields(context),
    data: cleanTraceData(data),
  }, timestamp);
}

export function traceEditorFunction<T>(
  context: EditorTraceContext | null,
  name: string,
  category: string,
  work: () => T,
  data?: EditorTraceData,
): T {
  if (!traceState?.recording) return work();
  const span = beginEditorTraceSpan(context, name, category, data);
  try {
    const result = work();
    endEditorTraceSpan(span);
    return result;
  } catch (cause) {
    endEditorTraceSpan(span, { error_name: cause instanceof Error ? cause.name : "unknown" }, "error");
    throw cause;
  }
}

export function traceEditorAsyncFunction<T>(
  context: EditorTraceContext | null,
  name: string,
  category: string,
  work: () => Promise<T>,
  data?: EditorTraceData,
): Promise<T> {
  if (!traceState?.recording) return work();
  const span = beginEditorTraceSpan(context, name, category, data);
  let pending: Promise<T>;
  try {
    pending = work();
  } catch (cause) {
    endEditorTraceSpan(span, { error_name: cause instanceof Error ? cause.name : "unknown" }, "error");
    throw cause;
  }
  return pending.then(
    (result) => {
      endEditorTraceSpan(span);
      return result;
    },
    (cause) => {
      endEditorTraceSpan(span, { error_name: cause instanceof Error ? cause.name : "unknown" }, "error");
      throw cause;
    },
  );
}

export function runWithEditorTraceContext<T>(context: EditorTraceContext | null, work: () => T): T {
  const previous = activeSynchronousContext;
  activeSynchronousContext = context;
  try {
    return work();
  } finally {
    activeSynchronousContext = previous;
  }
}

export function getCurrentEditorTraceContext(): EditorTraceContext | null {
  return activeSynchronousContext;
}

export function recordEditorTraceDuration(
  context: EditorTraceContext | null,
  name: string,
  category: string,
  startedAt: number | undefined,
  data?: EditorTraceData,
): void {
  if (startedAt === undefined || !traceState?.recording) return;
  const span: EditorTraceSpan = { id: 0, traceToken: traceState.traceToken, startedAt, name, category, context };
  const finishedAt = tracePerformanceNow();
  appendTraceEvent(traceState, {
    phase: "instant",
    category,
    name,
    duration_us: Math.max(0, Math.round((finishedAt - startedAt) * 1_000)),
    ...contextEventFields(context),
    data: cleanTraceData(data),
  }, finishedAt);
  maybeCreateUserTimingMeasure(span, finishedAt);
}

export function recordEditorDocumentStructure(
  context: EditorTraceContext | null,
  documentNode: TraceableProseMirrorNode,
  reason: string,
): void {
  if (!context || !traceState?.recording) return;
  traceEditorFunction(context, "editor.document_structure", "editor.structure", () => {
    let nodes = 1;
    let textNodes = 0;
    let textCharacters = 0;
    let marks = 0;
    let maximumChildCount = Number(documentNode.childCount ?? 0);
    let blockNodes = 0;
    const blockTypes = new Set([
      "paragraph", "heading", "blockquote", "codeBlock", "listItem", "taskItem",
      "table", "tableRow", "tableCell", "tableHeader",
    ]);
    documentNode.descendants?.((node) => {
      nodes += 1;
      const nodeType = node.type?.name ?? "";
      if (blockTypes.has(nodeType)) blockNodes += 1;
      if (node.isText) {
        textNodes += 1;
        textCharacters += node.text?.length ?? 0;
      }
      marks += node.marks?.length ?? 0;
      maximumChildCount = Math.max(maximumChildCount, Number(node.childCount ?? 0));
      return true;
    });
    editorTraceInstant(context, "editor.document_structure.summary", "editor.structure", {
      reason,
      nodes,
      block_nodes: blockNodes,
      text_nodes: textNodes,
      text_characters: textCharacters,
      marks,
      maximum_child_count: maximumChildCount,
      document_node_size: Number(documentNode.nodeSize ?? 0),
    });
  }, { reason });
}

export function startEditorTraceForTests(): void {
  forcedForTests = true;
  startNewTrace();
}

export function restartEditorTraceForTests(): void {
  restartTrace();
}

export function stopEditorTraceForTests(): EditorTraceExport {
  stopTrace();
  return buildTraceExport();
}

export function resetEditorTraceForTests(): void {
  traceState?.observerCleanups.forEach((cleanup) => cleanup());
  traceState = null;
  sessions.clear();
  traceSessionSequence = 0;
  forcedForTests = false;
  activeSynchronousContext = null;
  tracePanel?.remove();
  tracePanel = null;
}
