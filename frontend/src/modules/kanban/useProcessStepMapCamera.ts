import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { StepMapPoint } from "./processStepMapGeometry.js";

type Camera = StepMapPoint & { zoom: number };
type Pan = { pointerID: number; start: StepMapPoint; camera: Camera };
const clampZoom = (zoom: number) => Math.max(.5, Math.min(8, zoom));
const interactiveTarget = ".process-step-map__step, button, input, select, textarea, [role='button']";

/** Local camera only: the same transform carries the Process frame, Steps, and routes. */
export function useProcessStepMapCamera(viewport: RefObject<HTMLDivElement>, isBlocked: () => boolean) {
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
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
  const zoomTo = (value: number, anchor: StepMapPoint) => {
    if (blocked.current() || pan.current || !viewport.current) return;
    const previous = cameraRef.current, zoom = clampZoom(value);
    const ratio = zoom / previous.zoom;
    update({ zoom, x: anchor.x - (anchor.x - previous.x) * ratio, y: anchor.y - (anchor.y - previous.y) * ratio });
  };

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest("input, select, textarea")) return;
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
  return { ...camera, panning, isPanning: () => pan.current !== null, startPan, movePan, endPan, cancelPan };
}
