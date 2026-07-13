import React from "react";
import { createPortal } from "react-dom";

export const APP_MODAL_LAYER_Z_INDEX = 10100;

export type AppViewportAnchorRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function readViewportAnchorRect(element: Element | null): AppViewportAnchorRect | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function useAppViewportAnchorRect(
  anchorRef: React.RefObject<Element | null>,
): AppViewportAnchorRect | null {
  const [rect, setRect] = React.useState<AppViewportAnchorRect | null>(null);

  React.useLayoutEffect(() => {
    const element = anchorRef.current;
    if (!element) {
      setRect(null);
      return;
    }

    const update = () => {
      const next = readViewportAnchorRect(element);
      setRect((current) => (
        current
        && next
        && current.left === next.left
        && current.top === next.top
        && current.width === next.width
        && current.height === next.height
          ? current
          : next
      ));
    };
    const view = element.ownerDocument.defaultView;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    view?.addEventListener("resize", update);
    view?.addEventListener("scroll", update, true);
    update();
    return () => {
      observer?.disconnect();
      view?.removeEventListener("resize", update);
      view?.removeEventListener("scroll", update, true);
    };
  }, [anchorRef]);

  return rect;
}

const MODAL_FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "audio[controls]",
  "video[controls]",
  "iframe",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

const AppOverlayPortalTargetContext = React.createContext<HTMLElement | null>(null);

export function useAppOverlayPortalTarget(ownerDocument?: Document | null): HTMLElement | null {
  const modalLayer = React.useContext(AppOverlayPortalTargetContext);
  const targetDocument = ownerDocument ?? (typeof document === "undefined" ? null : document);
  return modalLayer ?? targetDocument?.body ?? null;
}

function elementIsVisibleForModalFocus(element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") return false;
    const view: Window | null = current.ownerDocument.defaultView;
    const style = view?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
  }
  return true;
}

type AppModalPortalProps = {
  children?: React.ReactNode;
  ownerDocument?: Document | null;
  trapFocus?: boolean;
  onRequestClose?: () => void;
};

/** Elevated overlays escape feature-local stacking contexts; blocking ones additionally share focus and Escape contracts. */
export const AppModalPortal: React.FC<AppModalPortalProps> = ({
  children,
  ownerDocument,
  trapFocus = true,
  onRequestClose,
}) => {
  const targetDocument = ownerDocument ?? (typeof document === "undefined" ? null : document);
  const layerRef = React.useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const trappingSessionRef = React.useRef(false);
  if (trapFocus && !trappingSessionRef.current && targetDocument) {
    restoreFocusRef.current = targetDocument.activeElement as HTMLElement | null;
  }
  trappingSessionRef.current = trapFocus;
  const [layerElement, setLayerElement] = React.useState<HTMLDivElement | null>(null);
  const onRequestCloseRef = React.useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;
  const closeOnEscape = Boolean(onRequestClose);
  const setLayerNode = React.useCallback((element: HTMLDivElement | null) => {
    layerRef.current = element;
    setLayerElement(element);
  }, []);

  React.useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !targetDocument || (!trapFocus && !closeOnEscape)) return undefined;
    const previousFocus = trapFocus ? restoreFocusRef.current : null;
    const isTopLayer = () => {
      const layers = Array.from(targetDocument.querySelectorAll<HTMLElement>("[data-mango-modal-layer=\"true\"]"));
      const trappingLayers = layers.filter((candidate) => candidate.dataset.mangoModalFocusTrap === "true");
      const activeLayers = trappingLayers.length > 0 ? trappingLayers : layers;
      return activeLayers[activeLayers.length - 1] === layer;
    };
    const focusableElements = () => Array.from(layer.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR))
      .filter(elementIsVisibleForModalFocus);
    const focusFirst = () => (focusableElements()[0] ?? layer).focus({ preventScroll: true });
    const focusLayerIfNeeded = () => {
      if (trapFocus && !layer.contains(targetDocument.activeElement)) focusFirst();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopLayer()) return;
      if (event.key === "Escape" && onRequestCloseRef.current && !event.defaultPrevented) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onRequestCloseRef.current();
        return;
      }
      if (!trapFocus || event.key !== "Tab") return;
      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        focusFirst();
        return;
      }
      const currentIndex = focusable.indexOf(targetDocument.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1)
        : (currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1);
      event.preventDefault();
      event.stopPropagation();
      focusable[nextIndex]?.focus({ preventScroll: true });
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!trapFocus || !isTopLayer() || layer.contains(event.target as Node)) return;
      focusFirst();
    };
    targetDocument.addEventListener("keydown", onKeyDown);
    if (trapFocus) targetDocument.addEventListener("focusin", onFocusIn, true);
    const view = targetDocument.defaultView;
    const frameID = trapFocus ? view?.requestAnimationFrame(focusLayerIfNeeded) : undefined;
    return () => {
      if (frameID !== undefined) view?.cancelAnimationFrame(frameID);
      targetDocument.removeEventListener("keydown", onKeyDown);
      if (trapFocus) targetDocument.removeEventListener("focusin", onFocusIn, true);
      if (trapFocus && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [closeOnEscape, targetDocument, trapFocus]);

  if (!targetDocument?.body) return null;
  return createPortal(
    <div
      ref={setLayerNode}
      tabIndex={-1}
      data-mango-modal-layer="true"
      data-mango-modal-focus-trap={trapFocus ? "true" : "false"}
      style={{ position: "relative", zIndex: trapFocus ? APP_MODAL_LAYER_Z_INDEX : APP_MODAL_LAYER_Z_INDEX - 10, isolation: "isolate" }}
    >
      <AppOverlayPortalTargetContext.Provider value={layerElement}>
        {children}
      </AppOverlayPortalTargetContext.Provider>
    </div>,
    targetDocument.body,
  );
};
