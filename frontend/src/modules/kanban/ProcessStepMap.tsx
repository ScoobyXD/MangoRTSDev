import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { APIHTTPError, isAbortError } from "../api/requestJSON.js";
import { createProcessStep, createProcessStepRelationship, deleteProcessStep, deleteProcessStepRelationship, updateProcessStep } from "./kanbanApi.js";
import type { ProcessStep, ProcessStepRelationship } from "./processWork.js";
import { completeStepMapLayout, defaultStepMapRoute, moveStepMapBox, snapStepMapCoordinate, stepMapBounds, stepMapPath, STEP_MAP_GRID, type ProcessStepMapLayout, type StepMapBox, type StepMapPoint } from "./processStepMapGeometry.js";
import { getProcessStepMap, saveProcessStepMap } from "./processStepMapApi.js";
import "./processStepMap.css";

export type ProcessStepMapProps = {
  apiBase: string;
  companyID: string;
  processID: string;
  steps: ProcessStep[];
  relationships: ProcessStepRelationship[];
  canEdit: boolean;
  onChanged: () => void;
  isDark?: boolean;
};

type Selection = { kind: "step" | "route"; id: string } | null;
type Gesture = {
  kind: "move" | "resize" | "route";
  id: string;
  pointIndex: number;
  pointerID: number;
  start: StepMapPoint;
  layout: ProcessStepMapLayout;
  next: ProcessStepMapLayout;
  moved: boolean;
  bounds: ReturnType<typeof stepMapBounds>;
};

const emptyLayout: ProcessStepMapLayout = { revision: 0, steps: [], routes: [] };
const message = (error: unknown) => error instanceof Error ? error.message : "The change could not be saved. Please try again.";

export function ProcessStepMap(props: ProcessStepMapProps) {
  return <ProcessStepMapContent key={`${props.companyID}:${props.processID}`} {...props} />;
}

function ProcessStepMapContent({ apiBase, companyID, processID, steps, relationships, canEdit, onChanged, isDark = false }: ProcessStepMapProps) {
  const [layout, setLayout] = useState<ProcessStepMapLayout | null>(null);
  const [preview, setPreview] = useState<ProcessStepMapLayout | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [name, setName] = useState("");
  const [targetID, setTargetID] = useState("");
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteRequested, setDeleteRequested] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const readGeneration = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const refreshPending = useRef(false);
  const layoutRef = useRef(layout);
  const current = useRef({ steps, relationships, canEdit, onChanged });
  current.current = { steps, relationships, canEdit, onChanged };
  layoutRef.current = layout;
  const arrowID = `step-map-arrow-${useId().replace(/:/g, "")}`;

  const load = useCallback(async () => {
    if (busyRef.current || gesture.current) { refreshPending.current = true; return; }
    refreshPending.current = false;
    const generation = ++readGeneration.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    try {
      const next = await getProcessStepMap(apiBase, companyID, processID, controller.signal);
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
  }, [apiBase, companyID, processID]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; readGeneration.current += 1; readController.current?.abort(); gesture.current = null; };
  }, []);
  // The board refreshes these canonical arrays on Process realtime events, including layout changes.
  useEffect(() => { void load(); }, [load, steps, relationships]);
  useEffect(() => {
    if (canEdit) return;
    gesture.current = null;
    setPreview(null);
    setDeleteRequested(false);
  }, [canEdit]);

  const display = useMemo(() => completeStepMapLayout(preview ?? layout ?? emptyLayout, steps, relationships), [preview, layout, steps, relationships]);
  const boxes = useMemo(() => new Map(display.steps.map((box) => [box.process_step_id, box])), [display.steps]);
  const stepByID = useMemo(() => new Map(steps.map((step) => [step.process_step_id, step])), [steps]);
  const routes = useMemo(() => relationships.flatMap((edge) => {
    const source = boxes.get(edge.source.resource_id), target = boxes.get(edge.target.resource_id);
    if (!source || !target) return [];
    const points = display.routes.find((route) => route.resource_operational_relationship_id === edge.resource_operational_relationship_id)?.points ?? defaultStepMapRoute(source, target);
    return [{ edge, source, target, points }];
  }), [relationships, boxes, display.routes]);
  const currentBounds = useMemo(() => stepMapBounds({ ...display, routes: routes.map(({ edge, points }) => ({ resource_operational_relationship_id: edge.resource_operational_relationship_id, points })) }), [display, routes]);
  const bounds = gesture.current?.bounds ?? currentBounds;
  const selectedStep = selection?.kind === "step" ? stepByID.get(selection.id) : undefined;
  const selectedRoute = selection?.kind === "route" ? routes.find(({ edge }) => edge.resource_operational_relationship_id === selection.id) : undefined;
  const disabled = !canEdit || busy || loading || !layout;
  useEffect(() => { setName(selectedStep?.name ?? ""); setTargetID(""); setDeleteRequested(false); }, [selectedStep?.process_step_id, selectedStep?.name, selection?.kind, selection?.id]);
  useEffect(() => {
    const active = gesture.current;
    if (!active) return;
    const exists = active.kind === "route" ? relationships.some((edge) => edge.resource_operational_relationship_id === active.id) : steps.some((step) => step.process_step_id === active.id);
    if (!exists) { gesture.current = null; setPreview(null); if (refreshPending.current) void load(); }
  }, [steps, relationships, load]);

  const beginMutation = () => {
    if (busyRef.current || !current.current.canEdit) return false;
    busyRef.current = true;
    readGeneration.current += 1;
    readController.current?.abort();
    setLoading(false);
    setBusy(true);
    setError("");
    setNotice("Saving…");
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
      const saved = await saveProcessStepMap(apiBase, companyID, processID, completeStepMapLayout(next, current.current.steps, current.current.relationships));
      if (!mounted.current) return;
      layoutRef.current = saved;
      setLayout(saved);
      setNotice("Map saved.");
      current.current.onChanged();
    } catch (cause) {
      if (!mounted.current) return;
      if (cause instanceof APIHTTPError && cause.status === 409) {
        setNotice("Someone changed this map. Loading the saved layout; try your change again.");
        refreshPending.current = true;
      } else {
        setError(message(cause));
        setNotice("Your move was not saved. The last saved layout is shown.");
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
      setNotice(success);
      setDeleteRequested(false);
      current.current.onChanged();
    } catch (cause) { if (mounted.current) { setError(message(cause)); setNotice(""); } }
    finally { finishMutation(); }
  };

  const withRoutePoints = (base: ProcessStepMapLayout, id: string, points: StepMapPoint[]): ProcessStepMapLayout => ({ ...base, routes: [...base.routes.filter((route) => route.resource_operational_relationship_id !== id), { resource_operational_relationship_id: id, points }] });
  const startGesture = (event: React.PointerEvent<HTMLElement>, kind: Gesture["kind"], id: string, pointIndex = 0) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    const base = kind === "route" ? withRoutePoints(display, id, routes.find(({ edge }) => edge.resource_operational_relationship_id === id)!.points) : display;
    gesture.current = { kind, id, pointIndex, pointerID: event.pointerId, start: { x: event.clientX, y: event.clientY }, layout: base, next: base, moved: false, bounds };
    setSelection({ kind: kind === "route" ? "route" : "step", id });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const moveGesture = (event: React.PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerID !== event.pointerId) return;
    const delta = { x: (event.clientX - active.start.x) / zoom, y: (event.clientY - active.start.y) / zoom };
    if (Math.abs(delta.x) + Math.abs(delta.y) < 3 && !active.moved) return;
    active.moved = true;
    if (active.kind === "route") {
      const route = active.layout.routes.find((item) => item.resource_operational_relationship_id === active.id)!;
      active.next = withRoutePoints(active.layout, active.id, route.points.map((point, index) => index === active.pointIndex ? { x: snapStepMapCoordinate(point.x + delta.x), y: snapStepMapCoordinate(point.y + delta.y) } : point));
    } else active.next = { ...active.layout, steps: active.layout.steps.map((box) => box.process_step_id === active.id ? moveStepMapBox(box, delta, active.kind === "resize") : box) };
    setPreview(active.next);
  };
  const endGesture = (event: React.PointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerID !== event.pointerId) return;
    moveGesture(event);
    gesture.current = null;
    if (active.moved) void saveLayout(active.next);
    else if (refreshPending.current) void load();
  };
  const cancelGesture = () => {
    gesture.current = null;
    setPreview(null);
    if (refreshPending.current) void load();
  };
  const keyMove = (event: React.KeyboardEvent, box: StepMapBox, resize = false) => {
    const delta = arrowDelta(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    if (disabled || event.repeat) return;
    setSelection({ kind: "step", id: box.process_step_id });
    const next = { ...display, steps: display.steps.map((item) => item.process_step_id === box.process_step_id ? moveStepMapBox(item, delta, resize) : item) };
    setPreview(next);
    void saveLayout(next);
  };
  const fit = () => {
    const element = viewport.current;
    if (!element) return;
    setZoom(Math.max(.25, Math.min(1, (element.clientWidth - 24) / bounds.width, (element.clientHeight - 24) / bounds.height)));
    element.scrollTo?.({ top: 0, left: 0 });
  };

  return <section className={`process-step-map${isDark ? " process-step-map--dark" : ""}`} aria-label="Process Step map">
    <div className="process-step-map__toolbar">
      <button type="button" disabled={disabled} onClick={() => void changeDefinition(async () => {
        const result = await createProcessStep(apiBase, companyID, processID, "New step");
        if (mounted.current && result.step) setSelection({ kind: "step", id: result.step.process_step_id });
      }, "Step created. Give it a name below.")}>+ Create Step</button>
      <span className="process-step-map__hint">Drag Steps to arrange. Select a Step to name or connect it.</span>
      <div className="process-step-map__zoom"><button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.25, value - .25))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2, value + .25))}>+</button><button type="button" onClick={fit}>Fit</button></div>
    </div>
    {error && <div className="process-step-map__error" role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>Reload map</button></div>}
    <div className="process-step-map__status" role="status" aria-live="polite">{loading ? "Loading map…" : notice || (canEdit ? "Changes save when you finish moving or resizing." : "You can view this map.")}</div>
    <div ref={viewport} className="process-step-map__viewport" onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={cancelGesture} onKeyDown={(event) => { if (event.key === "Escape") cancelGesture(); }}>
      {layout && <div style={{ width: bounds.width * zoom, height: bounds.height * zoom }}>
        <div className="process-step-map__canvas" style={{ width: bounds.width, height: bounds.height, transform: `scale(${zoom})` }}>
          <svg className="process-step-map__edges" width={bounds.width} height={bounds.height} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} aria-label="Step connections">
            <defs><marker id={arrowID} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>
            {routes.map(({ edge, source, target, points }) => {
              const selected = selectedRoute?.edge.resource_operational_relationship_id === edge.resource_operational_relationship_id;
              return <g key={edge.resource_operational_relationship_id} className={selected ? "is-selected" : undefined}>
                <path className="process-step-map__edge-hit" d={stepMapPath(source, target, points)} tabIndex={0} role="button" aria-label={`Connection from ${stepByID.get(source.process_step_id)?.name} to ${stepByID.get(target.process_step_id)?.name}`} onClick={() => setSelection({ kind: "route", id: edge.resource_operational_relationship_id })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelection({ kind: "route", id: edge.resource_operational_relationship_id }); } }} />
                <path className="process-step-map__edge" d={stepMapPath(source, target, points)} markerEnd={`url(#${arrowID})`} />
              </g>;
            })}
          </svg>
          {steps.map((step) => {
            const box = boxes.get(step.process_step_id)!;
            return <article key={step.process_step_id} data-step-map-id={step.process_step_id} className={`process-step-map__step${selectedStep?.process_step_id === step.process_step_id ? " is-selected" : ""}`} style={{ left: box.x - bounds.x, top: box.y - bounds.y, width: box.width, height: box.height }}>
              <span className="process-step-map__port is-input" aria-hidden="true" /><span className="process-step-map__port is-output" aria-hidden="true" />
              <button className="process-step-map__step-title" type="button" title="Drag to move. Arrow keys move one grid square; Shift moves four." aria-label={`Move ${step.name}`} aria-disabled={disabled} onClick={() => { if (!disabled) setSelection({ kind: "step", id: step.process_step_id }); }} onPointerDown={(event) => startGesture(event, "move", step.process_step_id)} onKeyDown={(event) => keyMove(event, box)}>{step.name}</button>
              <span className="process-step-map__step-label">Step</span>
              <button type="button" className="process-step-map__resize" aria-label={`Resize ${step.name}`} title="Drag to resize, or use arrow keys." aria-disabled={disabled} onPointerDown={(event) => startGesture(event, "resize", step.process_step_id)} onKeyDown={(event) => keyMove(event, box, true)}>↘</button>
            </article>;
          })}
          {selectedRoute && selectedRoute.points.map((point, index) => <button key={index} type="button" className="process-step-map__waypoint" style={{ left: point.x - bounds.x, top: point.y - bounds.y }} aria-label={`Move route point ${index + 1}`} title="Drag route point or use arrow keys. Delete removes it." aria-disabled={disabled} onPointerDown={(event) => startGesture(event, "route", selectedRoute.edge.resource_operational_relationship_id, index)} onKeyDown={(event) => {
            const delta = arrowDelta(event.key, event.shiftKey);
            if (!delta && event.key !== "Delete" && event.key !== "Backspace") return;
            event.preventDefault();
            if (disabled || event.repeat) return;
            const points = delta ? selectedRoute.points.map((item, i) => i === index ? { x: snapStepMapCoordinate(item.x + delta.x), y: snapStepMapCoordinate(item.y + delta.y) } : item) : selectedRoute.points.filter((_, i) => i !== index);
            void saveLayout(withRoutePoints(display, selectedRoute.edge.resource_operational_relationship_id, points));
          }} />)}
          {steps.length === 0 && <p className="process-step-map__empty">Create your first Step, then connect the stages of this Process.</p>}
        </div>
      </div>}
    </div>
    {selectedStep && <div className="process-step-map__inspector" aria-label="Selected Step">
      <form onSubmit={(event) => { event.preventDefault(); if (name.trim() && name.trim() !== selectedStep.name) void changeDefinition(() => updateProcessStep(apiBase, companyID, processID, selectedStep.process_step_id, { name: name.trim() }), "Step renamed."); }}>
        <label>Step name<input aria-label="Step name" value={name} maxLength={200} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label><button type="submit" disabled={disabled || !name.trim() || name.trim() === selectedStep.name}>Save name</button>
      </form>
      <div className="process-step-map__connect"><label>Connect to<select aria-label="Connect to Step" value={targetID} disabled={disabled} onChange={(event) => setTargetID(event.target.value)}><option value="">Choose Step…</option>{steps.filter((step) => step.process_step_id !== selectedStep.process_step_id).map((step) => <option key={step.process_step_id} value={step.process_step_id}>{step.name}</option>)}</select></label><button type="button" disabled={disabled || !targetID} onClick={() => void changeDefinition(async () => {
        const result = await createProcessStepRelationship(apiBase, companyID, processID, selectedStep.process_step_id, targetID);
        if (mounted.current && result.relationship) setSelection({ kind: "route", id: result.relationship.resource_operational_relationship_id });
      }, "Connection saved. Select its route to arrange it.")}>Connect</button></div>
      <button type="button" className="process-step-map__danger" disabled={disabled} onClick={() => setDeleteRequested(true)}>Delete Step</button>
      {deleteRequested && <div role="alert" className="process-step-map__confirm">Delete “{selectedStep.name}”? Its Nodes keep their Process and status.<button type="button" disabled={disabled} onClick={() => void changeDefinition(() => deleteProcessStep(apiBase, companyID, processID, selectedStep.process_step_id), "Step deleted. Its Nodes are preserved.")}>Confirm delete Step</button><button type="button" onClick={() => setDeleteRequested(false)}>Cancel</button></div>}
    </div>}
    {selectedRoute && <div className="process-step-map__inspector" aria-label="Selected connection"><span>{stepByID.get(selectedRoute.source.process_step_id)?.name} → {stepByID.get(selectedRoute.target.process_step_id)?.name}</span><button type="button" disabled={disabled || selectedRoute.points.length >= 256} onClick={() => {
      const last = selectedRoute.points[selectedRoute.points.length - 1] ?? defaultStepMapRoute(selectedRoute.source, selectedRoute.target)[0];
      void saveLayout(withRoutePoints(display, selectedRoute.edge.resource_operational_relationship_id, [...selectedRoute.points, { x: snapStepMapCoordinate(last.x + 32), y: snapStepMapCoordinate(last.y + 32) }]));
    }}>Add route point</button><button type="button" disabled={disabled} onClick={() => void saveLayout(withRoutePoints(display, selectedRoute.edge.resource_operational_relationship_id, defaultStepMapRoute(selectedRoute.source, selectedRoute.target)))}>Reset route</button><button type="button" className="process-step-map__danger" disabled={disabled} onClick={() => void changeDefinition(() => deleteProcessStepRelationship(apiBase, companyID, processID, selectedRoute.edge.resource_operational_relationship_id), "Connection deleted. Both Steps are preserved.")}>Delete connection</button></div>}
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
