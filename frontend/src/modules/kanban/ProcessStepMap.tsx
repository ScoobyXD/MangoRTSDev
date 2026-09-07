import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { useAppFloatingMenuDismissal } from "../../app/AppModalPortal.js";
import { NODE_ICON_GRADIENT_END, NODE_ICON_GRADIENT_START } from "../../icons/EntityIcons.js";
import { APIHTTPError, isAbortError } from "../api/requestJSON.js";
import { readMangoTiptapDocumentText } from "../editor/tiptap/mangoTiptapDocument.js";
import { createProcessStep, createProcessStepRelationship, deleteProcessStep, deleteProcessStepRelationship, updateProcessStep, type ProcessStepMutationResult } from "./kanbanApi.js";
import type { ProcessStep, ProcessStepRelationship } from "./processWork.js";
import { completeStepMapLayout, defaultStepMapRoute, moveStepMapBox, snapStepMapCoordinate, stepMapAnchors, stepMapBounds, stepMapPath, stepMapSequence, STEP_MAP_GRID, type ProcessStepMapLayout, type StepMapBox, type StepMapPoint, type StepMapResizeHandle } from "./processStepMapGeometry.js";
import { getProcessStepMap, saveProcessStepMap } from "./processStepMapApi.js";
import { useProcessStepMapCamera } from "./useProcessStepMapCamera.js";
import "./processStepMap.css";

export type ProcessStepMapCommands = {
  readLayout: (signal: AbortSignal) => Promise<ProcessStepMapLayout>;
  saveLayout: (layout: ProcessStepMapLayout) => Promise<ProcessStepMapLayout>;
  createStep: (name: string) => Promise<ProcessStepMutationResult>;
  renameStep: (stepID: string, name: string) => Promise<ProcessStepMutationResult>;
  deleteStep: (stepID: string) => Promise<void>;
  connectSteps: (sourceID: string, targetID: string) => Promise<ProcessStepMutationResult>;
  disconnectSteps: (relationshipID: string) => Promise<void>;
};

export type ProcessStepMapActions = {
  createStep: () => void;
  disabled: boolean;
  busy: boolean;
};

export type ProcessStepMapEditorProps = {
  steps: ProcessStep[];
  relationships: ProcessStepRelationship[];
  canEdit: boolean;
  commands: ProcessStepMapCommands;
  onChanged?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onStepCreated?: (stepID: string) => void;
  authoring?: boolean;
  saveMode?: "saved" | "new";
  processName?: string;
  initialEditingStepID?: string;
  hoverModeEnabled?: boolean;
  renderActions?: (actions: ProcessStepMapActions) => React.ReactNode;
};

export type ProcessStepMapProps = Omit<ProcessStepMapEditorProps, "commands" | "saveMode"> & {
  apiBase: string;
  companyID: string;
  processID: string;
};

type Selection = { kind: "step" | "route"; id: string } | null;
type LayoutGesture = {
  kind: "move" | "resize" | "route";
  id: string;
  pointIndex: number;
  pointerID: number;
  start: StepMapPoint;
  layout: ProcessStepMapLayout;
  next: ProcessStepMapLayout;
  moved: boolean;
  bounds: ReturnType<typeof stepMapBounds>;
  resizeHandle: StepMapResizeHandle;
};
type ConnectionPort = "input" | "output";
type ConnectionGesture = {
  kind: "connect";
  id: string;
  port: ConnectionPort;
  pointerID: number | null;
  point: StepMapPoint;
  targetID: string | null;
  bounds: ReturnType<typeof stepMapBounds>;
};
type Gesture = LayoutGesture | ConnectionGesture;

const emptyLayout: ProcessStepMapLayout = { revision: 0, steps: [], routes: [] };
const resizeHandles: StepMapResizeHandle[] = ["nw", "n", "ne", "se", "s", "sw"];
const connectionPorts: ConnectionPort[] = ["input", "output"];
const message = (error: unknown) => error instanceof Error ? error.message : "The change could not be saved. Please try again.";

function traceGradient(id: string, source: StepMapBox, target: StepMapBox) {
  const { start, end } = stepMapAnchors(source, target);
  // User-space coordinates also paint traces whose width or height is zero.
  return <defs><linearGradient id={id} gradientUnits="userSpaceOnUse" x1={start.x} y1={start.y} x2={end.x} y2={end.y}>
    <stop stopColor={NODE_ICON_GRADIENT_START} /><stop offset="1" stopColor={NODE_ICON_GRADIENT_END} />
  </linearGradient></defs>;
}

export function ProcessStepMap(props: ProcessStepMapProps) {
  const { apiBase, companyID, processID, ...editorProps } = props;
  const commands = useMemo<ProcessStepMapCommands>(() => ({
    readLayout: (signal) => getProcessStepMap(apiBase, companyID, processID, signal),
    saveLayout: (layout) => saveProcessStepMap(apiBase, companyID, processID, layout),
    createStep: (name) => createProcessStep(apiBase, companyID, processID, name),
    renameStep: (stepID, name) => updateProcessStep(apiBase, companyID, processID, stepID, { name }),
    deleteStep: (stepID) => deleteProcessStep(apiBase, companyID, processID, stepID),
    connectSteps: (sourceID, targetID) => createProcessStepRelationship(apiBase, companyID, processID, sourceID, targetID),
    disconnectSteps: (relationshipID) => deleteProcessStepRelationship(apiBase, companyID, processID, relationshipID),
  }), [apiBase, companyID, processID]);
  return <ProcessStepMapEditor key={`${apiBase}:${companyID}:${processID}`} {...editorProps} commands={commands} />;
}

export function ProcessStepMapEditor({ commands, steps, relationships, canEdit, onChanged, onBusyChange, onStepCreated, authoring = false, saveMode = "saved", processName = "", initialEditingStepID, hoverModeEnabled = false, renderActions }: ProcessStepMapEditorProps) {
  const [layout, setLayout] = useState<ProcessStepMapLayout | null>(null);
  const [preview, setPreview] = useState<ProcessStepMapLayout | null>(null);
  const [connectionPreview, setConnectionPreview] = useState<ConnectionGesture | null>(null);
  const [selection, setSelection] = useState<Selection>(() => initialEditingStepID ? { kind: "step", id: initialEditingStepID } : null);
  const [editingStepID, setEditingStepID] = useState<string | null>(initialEditingStepID ?? null);
  const editingRef = useRef(editingStepID);
  const titleInput = useRef<HTMLInputElement>(null);
  const [hoveredStepID, setHoveredStepID] = useState<string | null>(null);
  const [name, setName] = useState(() => steps.find((step) => step.process_step_id === initialEditingStepID)?.name ?? "");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gestureActive, setGestureActive] = useState(false);
  const [contextMenu, setContextMenu] = useState<StepMapPoint | null>(null);
  const contextMenuContent = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [deleteRequested, setDeleteRequested] = useState(false);
  const deleteConfirm = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const readGeneration = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const refreshPending = useRef(false);
  const layoutRef = useRef(layout);
  const current = useRef({ steps, relationships, canEdit, onChanged, commands, onBusyChange, onStepCreated });
  current.current = { steps, relationships, canEdit, onChanged, commands, onBusyChange, onStepCreated };
  layoutRef.current = layout;
  const traceGradientID = `step-map-trace-${useId().replace(/:/g, "")}`;
  useAppFloatingMenuDismissal(deleteRequested, deleteConfirm, () => { setDeleteRequested(false); viewport.current?.focus({ preventScroll: true }); });
  useAppFloatingMenuDismissal(contextMenu !== null, contextMenuContent, () => setContextMenu(null));

  const load = useCallback(async () => {
    if (busyRef.current || gesture.current) { refreshPending.current = true; return; }
    refreshPending.current = false;
    const generation = ++readGeneration.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    try {
      const next = await current.current.commands.readLayout(controller.signal);
      if (!mounted.current || generation !== readGeneration.current || busyRef.current || gesture.current) return;
      if (next.revision >= (layoutRef.current?.revision ?? 0)) { layoutRef.current = next; setLayout(next); }
      setError("");
    } catch (cause) {
      if (!mounted.current || generation !== readGeneration.current || isAbortError(cause)) return;
      if (cause instanceof APIHTTPError && (cause.status === 403 || cause.status === 404)) { setLayout(null); layoutRef.current = null; }
      setError(message(cause));
    } finally {
      if (mounted.current && generation === readGeneration.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readGeneration.current += 1; readController.current?.abort(); gesture.current = null; current.current.onBusyChange?.(false); };
  }, []);
  useEffect(() => { onBusyChange?.(loading || busy || gestureActive); }, [onBusyChange, loading, busy, gestureActive]);
  const stepIDs = steps.map((step) => step.process_step_id).join(",");
  // Canonical Process refreshes replace relationships, including for layout changes; text edits do not.
  useEffect(() => { void load(); }, [load, stepIDs, relationships]);
  useEffect(() => {
    if (canEdit) return;
    if (editingRef.current) setName(current.current.steps.find((step) => step.process_step_id === editingRef.current)?.name ?? "");
    editingRef.current = null;
    setEditingStepID(null);
    gesture.current = null;
    setGestureActive(false);
    setPreview(null);
    setConnectionPreview(null);
    setDeleteRequested(false);
    setContextMenu(null);
  }, [canEdit]);

  const display = useMemo(() => completeStepMapLayout(preview ?? layout ?? emptyLayout, steps, relationships), [preview, layout, steps, relationships]);
  const boxes = useMemo(() => new Map(display.steps.map((box) => [box.process_step_id, box])), [display.steps]);
  const sequence = useMemo(() => stepMapSequence(display.steps, relationships), [display.steps, relationships]);
  const stepByID = useMemo(() => new Map(steps.map((step) => [step.process_step_id, step])), [steps]);
  const stepPreviews = useMemo(() => new Map(steps.map((step) => [step.process_step_id, readMangoTiptapDocumentText(step.body_json).replace(/\s+/g, " ").trim()])), [steps]);
  const routes = useMemo(() => relationships.flatMap((edge) => {
    const source = boxes.get(edge.source.resource_id), target = boxes.get(edge.target.resource_id);
    if (!source || !target) return [];
    const points = display.routes.find((route) => route.resource_operational_relationship_id === edge.resource_operational_relationship_id)?.points ?? defaultStepMapRoute(source, target);
    return [{ edge, source, target, points }];
  }), [relationships, boxes, display.routes]);
  const currentBounds = useMemo(() => stepMapBounds({ ...display, routes: routes.map(({ edge, points }) => ({ resource_operational_relationship_id: edge.resource_operational_relationship_id, points })) }), [display, routes]);
  const camera = useProcessStepMapCamera(viewport, () => gesture.current !== null, loading ? null : currentBounds, authoring);
  const frame = camera.initialFrame;
  const frameBounds = frame ? {
    x: Math.min(currentBounds.x, frame.x),
    y: Math.min(currentBounds.y, frame.y),
    width: Math.max(currentBounds.x + currentBounds.width, frame.x + frame.width) - Math.min(currentBounds.x, frame.x),
    height: Math.max(currentBounds.y + currentBounds.height, frame.y + frame.height) - Math.min(currentBounds.y, frame.y),
  } : currentBounds;
  const bounds = gesture.current?.bounds ?? frameBounds;
  const zoom = camera.zoom;
  const selectedStep = selection?.kind === "step" ? stepByID.get(selection.id) : undefined;
  const selectedRoute = selection?.kind === "route" ? routes.find(({ edge }) => edge.resource_operational_relationship_id === selection.id) : undefined;
  const disabled = !canEdit || busy || loading || !layout || gestureActive;
  useEffect(() => { setName(selectedStep?.name ?? ""); setDeleteRequested(false); }, [selectedStep?.process_step_id, selectedStep?.name, selection?.kind, selection?.id]);
  useEffect(() => {
    if (editingStepID && selectedStep?.process_step_id === editingStepID && !disabled) {
      titleInput.current?.focus();
      titleInput.current?.setSelectionRange(0, titleInput.current.value.length, "forward");
    }
  }, [editingStepID, selectedStep?.process_step_id, disabled]);
  useEffect(() => {
    const active = gesture.current;
    if (!active) return;
    const exists = active.kind === "route" ? relationships.some((edge) => edge.resource_operational_relationship_id === active.id) : steps.some((step) => step.process_step_id === active.id) && (active.kind !== "connect" || !active.targetID || steps.some((step) => step.process_step_id === active.targetID));
    if (!exists) { gesture.current = null; setGestureActive(false); setPreview(null); setConnectionPreview(null); if (refreshPending.current) void load(); }
  }, [steps, relationships, load]);

  const beginMutation = () => {
    if (busyRef.current || gesture.current || !current.current.canEdit || !layoutRef.current) return false;
    busyRef.current = true;
    readGeneration.current += 1;
    readController.current?.abort();
    setLoading(false);
    setBusy(true);
    setError("");
    setConflict(false);
    setNotice(saveMode === "new" ? "" : "Saving…");
    return true;
  };
  const finishMutation = () => {
    busyRef.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (refreshPending.current) void load();
  };

  const saveLayout = async (next: ProcessStepMapLayout) => {
    if (!beginMutation()) { setPreview(null); return; }
    try {
      const saved = await current.current.commands.saveLayout(completeStepMapLayout(next, current.current.steps, current.current.relationships));
      if (!mounted.current) return;
      layoutRef.current = saved;
      setLayout(saved);
      setNotice(saveMode === "new" ? "" : "Map saved.");
      current.current.onChanged?.();
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof APIHTTPError && cause.status === 409) {
        setConflict(true);
        setNotice("Someone changed this map. Loading the saved layout; try your change again.");
        refreshPending.current = true;
      } else {
        setError(message(cause));
        setNotice(saveMode === "new" ? "Your move was not kept. The previous layout is shown." : "Your move was not saved. The last saved layout is shown.");
      }
    } finally {
      if (mounted.current) setPreview(null);
      finishMutation();
    }
  };

  const changeDefinition = async (command: () => Promise<unknown>, success: string) => {
    if (!beginMutation()) return;
    try {
      await command();
      if (!mounted.current) return;
      setNotice(saveMode === "new" ? "" : success);
      setDeleteRequested(false);
      current.current.onChanged?.();
    } catch (cause) { if (mounted.current) { setError(message(cause)); setNotice(""); } }
    finally { finishMutation(); }
  };

  const withRoutePoints = (base: ProcessStepMapLayout, id: string, points: StepMapPoint[]): ProcessStepMapLayout => ({ ...base, routes: [...base.routes.filter((route) => route.resource_operational_relationship_id !== id), { resource_operational_relationship_id: id, points }] });
  const startGesture = (event: React.PointerEvent<HTMLElement>, kind: LayoutGesture["kind"], id: string, pointIndex = 0, resizeHandle: StepMapResizeHandle = "se") => {
    event.stopPropagation();
    if (disabled || busyRef.current || gesture.current || camera.isPanning() || event.button !== 0) return;
    if (editingRef.current) {
      finishRename();
      if (busyRef.current) return;
    }
    event.preventDefault();
    event.currentTarget.focus();
    const base = kind === "route" ? withRoutePoints(display, id, routes.find(({ edge }) => edge.resource_operational_relationship_id === id)!.points) : display;
    gesture.current = { kind, id, pointIndex, resizeHandle, pointerID: event.pointerId, start: { x: event.clientX, y: event.clientY }, layout: base, next: base, moved: false, bounds };
    setGestureActive(true);
    setContextMenu(null);
    setSelection({ kind: kind === "route" ? "route" : "step", id });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveGesture = (event: React.PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerID !== event.pointerId) return;
    if (active.kind === "connect") {
      const canvas = viewport.current?.querySelector<HTMLElement>(".process-step-map__canvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      active.point = { x: (event.clientX - rect.left) / zoom + active.bounds.x, y: (event.clientY - rect.top) / zoom + active.bounds.y };
      const port = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-step-map-port]");
      const targetID = port?.closest<HTMLElement>("[data-step-map-id]")?.dataset.stepMapId;
      active.targetID = port && viewport.current?.contains(port) && port.dataset.stepMapPort !== active.port && targetID !== active.id && targetID && boxes.has(targetID) ? targetID : null;
      setConnectionPreview({ ...active });
      return;
    }
    const delta = { x: (event.clientX - active.start.x) / zoom, y: (event.clientY - active.start.y) / zoom };
    if (Math.abs(delta.x) + Math.abs(delta.y) < 3 && !active.moved) return;
    active.moved = true;
    if (active.kind === "route") {
      const route = active.layout.routes.find((item) => item.resource_operational_relationship_id === active.id)!;
      active.next = withRoutePoints(active.layout, active.id, route.points.map((point, index) => index === active.pointIndex ? { x: snapStepMapCoordinate(point.x + delta.x), y: snapStepMapCoordinate(point.y + delta.y) } : point));
    } else active.next = { ...active.layout, steps: active.layout.steps.map((box) => box.process_step_id === active.id ? moveStepMapBox(box, delta, active.kind === "resize" ? active.resizeHandle : false) : box) };
    setPreview(active.next);
  };
  const endGesture = (event: React.PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerID !== event.pointerId) return;
    moveGesture(event);
    gesture.current = null;
    setGestureActive(false);
    if (active.kind === "connect") {
      setConnectionPreview(null);
      if (active.targetID) connectPortPair(active, active.targetID);
      else if (refreshPending.current) void load();
      return;
    }
    if (active.moved) void saveLayout(active.next);
    else if (refreshPending.current) void load();
  };
  const cancelGesture = () => {
    gesture.current = null;
    setGestureActive(false);
    setPreview(null);
    setConnectionPreview(null);
    if (refreshPending.current) void load();
  };
  const keyMove = (event: React.KeyboardEvent, box: StepMapBox, resize: StepMapResizeHandle | false = false) => {
    const delta = arrowDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    if (disabled || event.repeat) return;
    setSelection({ kind: "step", id: box.process_step_id });
    const next = { ...display, steps: display.steps.map((item) => item.process_step_id === box.process_step_id ? moveStepMapBox(item, delta, resize) : item) };
    setPreview(next);
    void saveLayout(next);
  };
  const createStep = () => changeDefinition(async () => {
    const result = await current.current.commands.createStep("New step");
    if (mounted.current && result.step) {
      setSelection({ kind: "step", id: result.step.process_step_id });
      setName(result.step.name);
      editingRef.current = result.step.process_step_id;
      setEditingStepID(result.step.process_step_id);
      current.current.onStepCreated?.(result.step.process_step_id);
    }
  }, "Step created. Select its name to rename it.");
  const startRename = (step: ProcessStep) => {
    if (disabled) return;
    setSelection({ kind: "step", id: step.process_step_id });
    setName(step.name);
    editingRef.current = step.process_step_id;
    setEditingStepID(step.process_step_id);
  };
  const finishRename = (cancel = false) => {
    const id = editingRef.current;
    if (!id) return;
    editingRef.current = null;
    setEditingStepID(null);
    const step = stepByID.get(id);
    const nextName = name.trim();
    if (cancel || !nextName || !step || nextName === step.name) { setName(step?.name ?? ""); return; }
    void changeDefinition(() => current.current.commands.renameStep(id, nextName), "Step renamed.");
  };

  const connectSteps = (sourceID: string, targetID: string) => {
    const source = stepByID.get(sourceID), target = stepByID.get(targetID);
    if (!current.current.canEdit || !source || !target || sourceID === targetID || source.logic_gate_id !== target.logic_gate_id) return;
    const existing = current.current.relationships.find((edge) => edge.source.resource_id === sourceID && edge.target.resource_id === targetID);
    if (existing) {
      setSelection({ kind: "route", id: existing.resource_operational_relationship_id });
      if (refreshPending.current) void load();
      return;
    }
    void changeDefinition(async () => {
      const result = await current.current.commands.connectSteps(sourceID, targetID);
      if (mounted.current && result.relationship) setSelection({ kind: "route", id: result.relationship.resource_operational_relationship_id });
    }, "Connection saved.");
  };
  const connectPortPair = (active: ConnectionGesture, targetID: string) => {
    if (active.port === "output") connectSteps(active.id, targetID);
    else connectSteps(targetID, active.id);
  };
  const beginConnection = (id: string, port: ConnectionPort, pointerID: number | null) => {
    if (disabled || busyRef.current || gesture.current || camera.isPanning()) return false;
    if (editingRef.current) {
      finishRename();
      if (busyRef.current) return false;
    }
    const box = boxes.get(id)!;
    const active: ConnectionGesture = { kind: "connect", id, port, pointerID, point: { x: box.x + (port === "output" ? box.width : 0), y: box.y + box.height / 2 }, targetID: null, bounds };
    gesture.current = active;
    setConnectionPreview(active);
    setGestureActive(true);
    setContextMenu(null);
    setSelection({ kind: "step", id });
    return true;
  };
  const startConnection = (event: React.PointerEvent<HTMLButtonElement>, id: string, port: ConnectionPort) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    event.preventDefault();
    if (!beginConnection(id, port, event.pointerId)) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const keyConnection = (event: React.KeyboardEvent<HTMLButtonElement>, id: string, port: ConnectionPort) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    const active = gesture.current;
    if (!active) { beginConnection(id, port, null); return; }
    if (active.kind !== "connect" || active.pointerID !== null || active.id === id || active.port === port) return;
    gesture.current = null;
    setConnectionPreview(null);
    setGestureActive(false);
    connectPortPair(active, id);
  };
  const connectionTrace = (() => {
    if (!connectionPreview) return null;
    const start = boxes.get(connectionPreview.id);
    if (!start) return null;
    const end = (connectionPreview.targetID && boxes.get(connectionPreview.targetID)) || { ...connectionPreview.point, process_step_id: "", width: 0, height: 0 };
    const [source, target] = connectionPreview.port === "output" ? [start, end] : [end, start];
    return { source, target, path: stepMapPath(source, target, defaultStepMapRoute(source, target)) };
  })();

  return <section className={`process-step-map process-step-map--canvas${authoring ? " process-step-map--authoring" : ""}`} aria-label="Process Step map">
    {renderActions?.({ createStep: () => void createStep(), disabled, busy: busy || loading || gestureActive })}
    {error && <div className="process-step-map__error" role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>Reload map</button></div>}
    <div className={`process-step-map__status${!loading && !conflict ? " is-hidden" : ""}`} role="status" aria-live="polite">{loading ? "Loading map…" : notice}</div>
    <div ref={viewport} tabIndex={0} aria-label="Process canvas. Drag blank space to pan; scroll to zoom." className={`process-step-map__viewport${camera.panning ? " is-panning" : ""}${connectionPreview ? " is-connecting" : ""}`} onPointerDown={camera.startPan} onPointerMove={(event) => { camera.movePan(event); moveGesture(event); }} onPointerUp={(event) => { camera.endPan(event); endGesture(event); }} onPointerCancel={() => { camera.cancelPan(); cancelGesture(); }} onLostPointerCapture={() => { camera.cancelPan(); if (gesture.current?.kind === "connect") cancelGesture(); }} onKeyDown={(event) => {
      if (event.defaultPrevented || (event.target as Element).closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") { camera.cancelPan(); cancelGesture(); return; }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!selectedStep && !selectedRoute) return;
      event.preventDefault();
      if (disabled || event.repeat) return;
      if (selectedStep) setDeleteRequested(true);
      else if (selectedRoute) void changeDefinition(() => current.current.commands.disconnectSteps(selectedRoute.edge.resource_operational_relationship_id), "Connection deleted. Both Steps are preserved.");
    }} onContextMenu={(event) => {
      const target = event.target as Element;
      if (target.closest("input, textarea, select")) return;
      event.preventDefault();
      event.stopPropagation();
      if (gesture.current || camera.isPanning()) return;
      const stepID = target.closest<HTMLElement>("[data-step-map-id]")?.dataset.stepMapId;
      const routeID = target.closest<HTMLElement>("[data-step-map-route-id]")?.dataset.stepMapRouteId;
      setSelection(stepID ? { kind: "step", id: stepID } : routeID ? { kind: "route", id: routeID } : null);
      setContextMenu({ x: event.clientX, y: event.clientY });
    }}>
      <div className="process-step-map__extent" style={{ width: bounds.width, height: bounds.height, minWidth: authoring ? undefined : `calc(100% - ${bounds.x}px)`, minHeight: authoring ? undefined : `calc(100% - ${bounds.y}px)` }}>
        <div className="process-step-map__canvas" style={{ width: "100%", height: "100%", transform: `translate(${camera.x + bounds.x * zoom}px, ${camera.y + bounds.y * zoom}px) scale(${zoom})` }}>
          <div className="process-step-map__process-outline" role="img" aria-label={`Process outline: ${processName.trim() || "Untitled Process"}`}><span aria-hidden="true">Process · {processName.trim() || "Untitled Process"}</span></div>
          {layout && <>
          <svg className="process-step-map__edges" width={bounds.width} height={bounds.height} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} aria-label="Step connections">
            {connectionTrace && <>{traceGradient(`${traceGradientID}-preview`, connectionTrace.source, connectionTrace.target)}<path className="process-step-map__connection-preview" d={connectionTrace.path} stroke={`url(#${traceGradientID}-preview)`} /></>}
            {routes.map(({ edge, source, target, points }) => {
              const selected = selectedRoute?.edge.resource_operational_relationship_id === edge.resource_operational_relationship_id;
              const hovered = hoverModeEnabled && (source.process_step_id === hoveredStepID || target.process_step_id === hoveredStepID);
              const gradientID = `${traceGradientID}-${edge.resource_operational_relationship_id}`;
              return <g key={edge.resource_operational_relationship_id} data-step-map-route-id={edge.resource_operational_relationship_id} className={selected ? "is-selected" : hovered ? "is-hovered" : undefined}>
                {traceGradient(gradientID, source, target)}
                <path className="process-step-map__edge-hit" d={stepMapPath(source, target, points)} tabIndex={0} role="button" aria-label={`Connection from ${stepByID.get(source.process_step_id)?.name} to ${stepByID.get(target.process_step_id)?.name}`} onFocus={() => setSelection({ kind: "route", id: edge.resource_operational_relationship_id })} onClick={() => setSelection({ kind: "route", id: edge.resource_operational_relationship_id })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection({ kind: "route", id: edge.resource_operational_relationship_id }); } }} />
                <path className="process-step-map__edge" d={stepMapPath(source, target, points)} stroke={`url(#${gradientID})`} />
              </g>;
            })}
          </svg>
          {steps.map((step) => {
            const box = boxes.get(step.process_step_id)!;
            const hovered = hoverModeEnabled && hoveredStepID === step.process_step_id && !gestureActive;
            const editing = editingStepID === step.process_step_id;
            return <article key={step.process_step_id} tabIndex={-1} data-step-map-id={step.process_step_id} className={`process-step-map__step${selectedStep?.process_step_id === step.process_step_id ? " is-selected" : ""}${hovered ? " is-hovered" : ""}`} style={{ left: box.x - bounds.x, top: box.y - bounds.y, width: box.width, height: box.height }} onPointerEnter={() => { if (hoverModeEnabled) setHoveredStepID(step.process_step_id); }} onPointerLeave={() => setHoveredStepID(null)} onPointerDown={(event) => startGesture(event, "move", step.process_step_id)} onDoubleClick={(event) => { if (!(event.target as Element).closest("input, .process-step-map__resize, .process-step-map__port")) startRename(step); }}>
              {connectionPorts.map((port) => <button key={port} type="button" className={`process-step-map__port is-${port}${connectionPreview?.targetID === step.process_step_id && connectionPreview.port !== port ? " is-connection-target" : ""}`} data-step-map-port={port} aria-label={`${port === "input" ? "Connect into" : "Connect from"} ${step.name}`} title="Drag to another Step's opposite anchor to connect. Or press Enter on each anchor." aria-disabled={!canEdit || busy || loading || !layout || (gestureActive && !connectionPreview)} onFocus={() => setSelection({ kind: "step", id: step.process_step_id })} onPointerDown={(event) => startConnection(event, step.process_step_id, port)} onKeyDown={(event) => keyConnection(event, step.process_step_id, port)} />)}
              {sequence.has(step.process_step_id) && <span className="process-step-map__sequence" aria-label={`Step number ${sequence.get(step.process_step_id)}`}>{sequence.get(step.process_step_id)}</span>}
              {editing ? <input ref={titleInput} className="process-step-map__title-input" aria-label="Step name" value={name} maxLength={200} readOnly={disabled} onChange={(event) => setName(event.target.value)} onPointerDown={(event) => event.stopPropagation()} onBlur={() => finishRename()} onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); finishRename(event.key === "Escape"); event.currentTarget.closest<HTMLElement>("article")?.focus(); }
              }} /> : <button className="process-step-map__step-title" type="button" title="Drag to move. Double-click or press F2 to name. Arrow keys move one grid square; Shift moves four." aria-label={`Move ${step.name}`} aria-disabled={disabled} onFocus={() => setSelection({ kind: "step", id: step.process_step_id })} onClick={() => { if (!disabled) setSelection({ kind: "step", id: step.process_step_id }); }} onKeyDown={(event) => { if (event.key === "F2") { event.preventDefault(); startRename(step); } else keyMove(event, box); }}>{step.name}</button>}
              {stepPreviews.get(step.process_step_id) && <span className="process-step-map__step-preview">{stepPreviews.get(step.process_step_id)}</span>}
              {resizeHandles.map((handle) => <button key={handle} type="button" className="process-step-map__resize" data-resize-handle={handle} aria-label={`Resize ${step.name}${handle === "se" ? "" : ` ${handle}`}`} title="Drag to resize, or use arrow keys." aria-disabled={disabled} onFocus={() => setSelection({ kind: "step", id: step.process_step_id })} onPointerDown={(event) => startGesture(event, "resize", step.process_step_id, 0, handle)} onKeyDown={(event) => keyMove(event, box, handle)} />)}
              {hovered && <div className="process-step-map__hover-preview" role="tooltip">{step.name}<span>{canEdit ? "Double-click to name this Step." : "Step connections are highlighted."}</span></div>}
            </article>;
          })}
          {selectedRoute && selectedRoute.points.map((point, index) => <button key={index} type="button" className="process-step-map__waypoint" data-step-map-route-id={selectedRoute.edge.resource_operational_relationship_id} style={{ left: point.x - bounds.x, top: point.y - bounds.y }} aria-label={`Move route point ${index + 1}`} title="Drag route point or use arrow keys. Delete removes it." aria-disabled={disabled} onPointerDown={(event) => startGesture(event, "route", selectedRoute.edge.resource_operational_relationship_id, index)} onKeyDown={(event) => {
            const delta = arrowDelta(event.key, event.shiftKey);
            if (!delta && event.key !== "Delete" && event.key !== "Backspace") return;
            event.preventDefault();
            event.stopPropagation();
            if (disabled || event.repeat) return;
            const points = delta ? selectedRoute.points.map((item, i) => i === index ? { x: snapStepMapCoordinate(item.x + delta.x), y: snapStepMapCoordinate(item.y + delta.y) } : item) : selectedRoute.points.filter((_, i) => i !== index);
            void saveLayout(withRoutePoints(display, selectedRoute.edge.resource_operational_relationship_id, points));
          }} />)}
          {steps.length === 0 && saveMode === "new" && <p className="process-step-map__empty">{authoring ? "Start this process with a right-click or by pressing the plus button." : "Create your first Step to start this Process."}</p>}
          </>}
        </div>
      </div>
    </div>
    {deleteRequested && selectedStep && <div ref={deleteConfirm} role="alertdialog" aria-label="Delete Step confirmation" className="process-step-map__confirm">
      <span>Delete “{selectedStep.name}”? {saveMode === "new" ? "It will be removed from this Process." : "Its Nodes keep their Process and status."}</span>
      <button type="button" className="process-step-map__danger" disabled={disabled} onClick={() => void changeDefinition(() => current.current.commands.deleteStep(selectedStep.process_step_id), "Step deleted. Its Nodes are preserved.")}>Confirm delete Step</button>
      <button type="button" autoFocus onClick={() => { setDeleteRequested(false); viewport.current?.focus({ preventScroll: true }); }}>Cancel</button>
    </div>}
    {contextMenu && <FrameRightClickMenu x={contextMenu.x} y={contextMenu.y} ariaLabel={selectedStep ? "Step actions" : selectedRoute ? "Connection actions" : "Process map creation"} onClose={() => setContextMenu(null)}>
      <div ref={contextMenuContent}>
      {selectedStep ? <>
        <button className="process-step-map__context-action" type="button" role="menuitem" disabled={disabled} onClick={() => { setContextMenu(null); startRename(selectedStep); }}>Rename Step</button>
        <button className="process-step-map__context-action process-step-map__danger" type="button" role="menuitem" disabled={disabled} onClick={() => { setContextMenu(null); setDeleteRequested(true); }}>Delete Step</button>
      </> : selectedRoute ? <>
        <button className="process-step-map__context-action" type="button" role="menuitem" disabled={disabled || selectedRoute.points.length >= 256} onClick={() => {
          setContextMenu(null);
          const last = selectedRoute.points[selectedRoute.points.length - 1] ?? defaultStepMapRoute(selectedRoute.source, selectedRoute.target)[0];
          void saveLayout(withRoutePoints(display, selectedRoute.edge.resource_operational_relationship_id, [...selectedRoute.points, { x: snapStepMapCoordinate(last.x + 32), y: snapStepMapCoordinate(last.y + 32) }]));
        }}>Add route point</button>
        <button className="process-step-map__context-action" type="button" role="menuitem" disabled={disabled} onClick={() => { setContextMenu(null); void saveLayout(withRoutePoints(display, selectedRoute.edge.resource_operational_relationship_id, defaultStepMapRoute(selectedRoute.source, selectedRoute.target))); }}>Reset route</button>
        <button className="process-step-map__context-action process-step-map__danger" type="button" role="menuitem" disabled={disabled} onClick={() => { setContextMenu(null); void changeDefinition(() => current.current.commands.disconnectSteps(selectedRoute.edge.resource_operational_relationship_id), "Connection deleted. Both Steps are preserved."); }}>Delete connection</button>
      </> : <button className="process-step-map__context-action" type="button" role="menuitem" disabled={disabled} onClick={() => { setContextMenu(null); void createStep(); }}>Create Step</button>}
      </div>
    </FrameRightClickMenu>}
  </section>;
}

function arrowDelta(key: string, large: boolean): StepMapPoint | null {
  const amount = STEP_MAP_GRID * (large ? 4 : 1);
  if (key === "ArrowLeft") return { x: -amount, y: 0 };
  if (key === "ArrowRight") return { x: amount, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -amount };
  if (key === "ArrowDown") return { x: 0, y: amount };
  return null;
}
