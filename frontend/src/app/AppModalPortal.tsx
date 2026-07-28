import React from "react";
import { createPortal } from "react-dom";

const APP_MODAL_LAYER_Z_INDEX = 10100;

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
  enabled = true,
): AppViewportAnchorRect | null {
  const [rect, setRect] = React.useState<AppViewportAnchorRect | null>(null);

  React.useLayoutEffect(() => {
    if (!enabled) {
      setRect((current) => current === null ? current : null);
      return undefined;
    }
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
  }, [anchorRef, enabled]);

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
const APP_MODAL_LAYER_SELECTOR = '[data-mango-modal-layer="true"]';

function activeAppModalLayer(targetDocument: Document, excludedLayer?: HTMLElement): HTMLElement | null {
  const layers = Array.from(targetDocument.querySelectorAll<HTMLElement>(APP_MODAL_LAYER_SELECTOR))
    .filter((layer) => layer !== excludedLayer);
  const trappingLayers = layers.filter((layer) => layer.dataset.mangoModalFocusTrap === "true");
  const activeLayers = trappingLayers.length > 0 ? trappingLayers : layers;
  return activeLayers[activeLayers.length - 1] ?? null;
}

/** Prevent background floating surfaces from consuming Escape ahead of the active modal. */
export function appOverlayCanHandleEscape(
  element: Element | null,
  targetDocument?: Document | null,
): boolean {
  const ownerDocument = targetDocument
    ?? element?.ownerDocument
    ?? (typeof document === "undefined" ? null : document);
  if (!ownerDocument) return false;
  const activeLayer = activeAppModalLayer(ownerDocument);
  return !activeLayer || element?.closest<HTMLElement>(APP_MODAL_LAYER_SELECTOR) === activeLayer;
}

const AppOverlayPortalTargetContext = React.createContext<HTMLElement | null>(null);

export function useAppOverlayPortalTarget(ownerDocument?: Document | null): HTMLElement | null {
  const modalLayer = React.useContext(AppOverlayPortalTargetContext);
  const targetDocument = ownerDocument ?? (typeof document === "undefined" ? null : document);
  return modalLayer ?? targetDocument?.body ?? null;
}

/** Shared outside-pointer/Escape behavior for floating menus, including trigger focus restoration. */
export function useAppFloatingMenuDismissal(
  open: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  additionalContainerRef?: React.RefObject<HTMLElement | null>,
  secondaryAdditionalContainerRef?: React.RefObject<HTMLElement | null>,
): void {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    if (!open) return undefined;
    const targetDocument = containerRef.current?.ownerDocument
      ?? (typeof document === "undefined" ? null : document);
    if (!targetDocument) return undefined;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !containerRef.current?.contains(target)
        && !additionalContainerRef?.current?.contains(target)
        && !secondaryAdditionalContainerRef?.current?.contains(target)
      ) onCloseRef.current();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!appOverlayCanHandleEscape(containerRef.current, targetDocument)) return;
      const trigger = containerRef.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]") ?? null;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onCloseRef.current();
      const restoreFocus = () => trigger?.focus({ preventScroll: true });
      const view = targetDocument.defaultView;
      if (view) view.requestAnimationFrame(restoreFocus);
      else restoreFocus();
    };

    targetDocument.addEventListener("pointerdown", closeOnPointerDown, true);
    targetDocument.addEventListener("keydown", closeOnEscape, true);
    return () => {
      targetDocument.removeEventListener("pointerdown", closeOnPointerDown, true);
      targetDocument.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [additionalContainerRef, containerRef, open, secondaryAdditionalContainerRef]);
}

function elementIsVisibleForModalFocus(element: HTMLElement): boolean {
  if (element.matches(":disabled") || element.tabIndex < 0 || element.getClientRects().length === 0) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.hidden || current.hasAttribute("inert") || current.getAttribute("aria-hidden") === "true") return false;
    const view: Window | null = current.ownerDocument.defaultView;
    const style = view?.getComputedStyle(current);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse") return false;
  }
  return true;
}

function appModalFocusableElements(layer: HTMLElement): HTMLElement[] {
  return Array.from(layer.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR))
    .filter(elementIsVisibleForModalFocus);
}

function appModalRestoreFocusTarget(targetDocument: Document): HTMLElement | null {
  const view = targetDocument.defaultView;
  const activeElement = targetDocument.activeElement;
  if (!view || !(activeElement instanceof view.HTMLElement)) return null;
  const menu = activeElement.closest<HTMLElement>('[role="menu"]');
  return menu?.parentElement?.querySelector<HTMLButtonElement>(':scope > button[aria-haspopup]') ?? activeElement;
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
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const trappingSessionRef = React.useRef(false);
  if (trapFocus && !trappingSessionRef.current && targetDocument) {
    restoreFocusRef.current = appModalRestoreFocusTarget(targetDocument);
  }
  trappingSessionRef.current = trapFocus;
  const [layerElement, setLayerElement] = React.useState<HTMLDivElement | null>(null);
  const onRequestCloseRef = React.useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;
  const setLayerNode = React.useCallback((element: HTMLDivElement | null) => {
    setLayerElement(element);
  }, []);

  React.useEffect(() => {
    const layer = layerElement;
    if (!layer || !targetDocument) return undefined;
    const previousFocus = trapFocus ? restoreFocusRef.current : null;
    const isTopLayer = () => activeAppModalLayer(targetDocument) === layer;
    const focusFirst = () => (appModalFocusableElements(layer)[0] ?? layer).focus({ preventScroll: true });
    const focusLayerIfNeeded = () => {
      if (trapFocus && !layer.contains(targetDocument.activeElement)) focusFirst();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopLayer()) return;
      if (event.key === "Escape" && !event.defaultPrevented && (trapFocus || onRequestCloseRef.current)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onRequestCloseRef.current?.();
        return;
      }
      // Inner controls such as the unified editor own Tab after preventing its
      // default action. The modal trap must only cycle focus for unclaimed Tab.
      if (!trapFocus || event.key !== "Tab" || event.defaultPrevented) return;
      const focusable = appModalFocusableElements(layer);
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
      if (!trapFocus) return;
      if (previousFocus?.isConnected && elementIsVisibleForModalFocus(previousFocus)) {
        previousFocus.focus({ preventScroll: true });
        if (targetDocument.activeElement === previousFocus) return;
      }
      const fallbackLayer = activeAppModalLayer(targetDocument, layer);
      (fallbackLayer ? appModalFocusableElements(fallbackLayer)[0] ?? fallbackLayer : null)?.focus({ preventScroll: true });
    };
  }, [layerElement, targetDocument, trapFocus]);

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
