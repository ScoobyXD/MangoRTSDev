import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { StepMapPoint } from "./processStepMapGeometry.js";

type Camera = StepMapPoint & { zoom: number };
type Bounds = StepMapPoint & { width: number; height: number };
type Pan = { pointerID: number; start: StepMapPoint; camera: Camera };
const clampZoom = (zoom: number) => Math.max(.5, Math.min(8, zoom));
const interactiveTarget = ".process-step-map__step, button, input, select, textarea, [role='button']";

/** Local camera only: the same transform carries the Process frame, Steps, and routes. */
export function useProcessStepMapCamera(viewport: RefObject<HTMLDivElement>, isBlocked: () => boolean, initialBounds: Bounds | null, authoring = false) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: .85 });
  const [initialFrame, setInitialFrame] = useState<Bounds | null>(null);
  const initialized = useRef(false);
  const [panning, setPanning] = useState(false);
  const cameraRef = useRef(camera);
  const pan = useRef<Pan | null>(null);
  const blocked = useRef(isBlocked);
  blocked.current = isBlocked;

  const update = (next: Camera) => { cameraRef.current = next; setCamera(next); };
  const viewArea = () => {
    const element = viewport.current!;
    const style = window.getComputedStyle(element);
    const left = parseFloat(style.paddingLeft) || 0, top = parseFloat(style.paddingTop) || 0;
    return { left, top, width: element.clientWidth - left - (parseFloat(style.paddingRight) || 0), height: element.clientHeight - top - (parseFloat(style.paddingBottom) || 0) };
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element || !initialBounds || initialized.current) return;
    const fit = () => {
      if (initialized.current) return;
      const area = viewArea();
      if (area.width <= 0 || area.height <= 0) return;
      if (authoring) {
        const zoom = clampZoom(Math.min(.85, area.width / initialBounds.width, area.height / initialBounds.height));
        const width = Math.max(initialBounds.width, area.width / zoom);
        const height = Math.max(initialBounds.height, area.height / zoom);
        setInitialFrame({ ...initialBounds, width, height });
        initialized.current = true;
        update({ zoom, x: (area.width - width * zoom) / 2 - initialBounds.x * zoom, y: (area.height - height * zoom) / 2 - initialBounds.y * zoom });
        return;
      }
      const width = Math.max(initialBounds.width, area.width - initialBounds.x);
      const height = Math.max(initialBounds.height, area.height - initialBounds.y);
      const zoom = clampZoom(Math.min(.85, (area.width - 16) / width, (area.height - 16) / height));
      initialized.current = true;
      update({ zoom, x: 8 - initialBounds.x * zoom, y: 8 - initialBounds.y * zoom });
    };
    fit();
    if (initialized.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [authoring, initialBounds, viewport]);
  const zoomTo = (value: number, anchor: StepMapPoint) => {
    if (blocked.current() || pan.current || !viewport.current) return;
    initialized.current = true;
    const previous = cameraRef.current, zoom = clampZoom(value);
    const ratio = zoom / previous.zoom;
    update({ zoom, x: anchor.x - (anchor.x - previous.x) * ratio, y: anchor.y - (anchor.y - previous.y) * ratio });
  };

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest("input, select, textarea, .process-step-map__step-editor")) return;
      event.preventDefault();
      const area = viewArea(), rect = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? area.height : 1);
      zoomTo(cameraRef.current.zoom * Math.exp(-delta * .002), { x: event.clientX - rect.left - area.left, y: event.clientY - rect.top - area.top });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [viewport]);

  const cancelPan = () => {
    if (!pan.current) return;
    update(pan.current.camera);
    pan.current = null;
    setPanning(false);
  };
  const startPan = (event: PointerEvent<HTMLDivElement>) => {
    if (blocked.current() || pan.current || event.button !== 0 || (event.target as Element).closest(interactiveTarget)) return;
    initialized.current = true;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    pan.current = { pointerID: event.pointerId, start: { x: event.clientX, y: event.clientY }, camera: cameraRef.current };
    setPanning(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const movePan = (event: PointerEvent<HTMLDivElement>) => {
    const active = pan.current;
    if (!active || active.pointerID !== event.pointerId) return;
    update({ ...active.camera, x: active.camera.x + event.clientX - active.start.x, y: active.camera.y + event.clientY - active.start.y });
  };
  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (pan.current?.pointerID !== event.pointerId) return;
    movePan(event);
    pan.current = null;
    setPanning(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return { ...camera, initialFrame, panning, isPanning: () => pan.current !== null, startPan, movePan, endPan, cancelPan };
}
