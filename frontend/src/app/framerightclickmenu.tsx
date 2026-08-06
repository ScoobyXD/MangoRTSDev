import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { appOverlayCanHandleEscape, useAppOverlayPortalTarget } from "./AppModalPortal";

export type FrameRightClickMenuClampInput = {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
};

export function clampFrameRightClickMenuPosition(input: FrameRightClickMenuClampInput): { x: number; y: number } {
  const margin = Math.max(0, input.margin ?? 8);
  const maxX = Math.max(margin, input.viewportWidth - input.menuWidth - margin);
  const maxY = Math.max(margin, input.viewportHeight - input.menuHeight - margin);
  return {
    x: Math.max(margin, Math.min(input.x, maxX)),
    y: Math.max(margin, Math.min(input.y, maxY)),
  };
}

export interface FrameRightClickMenuProps {
  children: React.ReactNode;
  x: number;
  ariaLabel?: string;
  y: number;
  onClose: () => void;
  closeOnOutside?: boolean;
  isConfirmActionMenu?: boolean;
  width?: React.CSSProperties["width"];
  minWidth?: React.CSSProperties["minWidth"];
  maxWidth?: React.CSSProperties["maxWidth"];
  maxHeight?: React.CSSProperties["maxHeight"];
  overflow?: React.CSSProperties["overflow"];
}

// Floating context-menu shell used by header/canvas/frame menus throughout the dashboard.
const FrameRightClickMenu: React.FC<FrameRightClickMenuProps> = ({ children, x, y, onClose, ariaLabel, closeOnOutside = true, isConfirmActionMenu = false, width, minWidth = 190, maxWidth, maxHeight = "calc(100vh - 16px)", overflow = "hidden" }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const portalTarget = useAppOverlayPortalTarget();
  const updatePosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const next = clampFrameRightClickMenuPosition({
      x,
      y,
      menuWidth: rect.width,
      menuHeight: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPos((current) => current.x === next.x && current.y === next.y ? current : next);
  }, [x, y]);

  useLayoutEffect(() => {
    updatePosition();
    const menu = menuRef.current;
    if (!menu) return undefined;
    let frameID = 0;
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frameID);
      frameID = window.requestAnimationFrame(updatePosition);
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(menu);
    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    scheduleUpdate();
    return () => {
      window.cancelAnimationFrame(frameID);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [updatePosition]);

  // Use capture so nested modules that stop propagation still let menus close on outside clicks.
  useEffect(() => {
    if (!closeOnOutside) return;
    const handler = (e: MouseEvent) => {
      const confirmMenuActive = document.querySelector("[data-mango-confirm-action-menu='true']");
      if (!isConfirmActionMenu && confirmMenuActive) return;
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => window.addEventListener("mousedown", handler, true), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handler, true);
    };
  }, [closeOnOutside, isConfirmActionMenu, onClose]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const confirmMenuActive = document.querySelector("[data-mango-confirm-action-menu='true']");
      if (!isConfirmActionMenu && confirmMenuActive) return;
      if (!appOverlayCanHandleEscape(menuRef.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", handler, true);
    return () => {
      document.removeEventListener("keydown", handler, true);
    };
  }, [isConfirmActionMenu, onClose]);

  useEffect(() => {
    if (isConfirmActionMenu) return;
    const handler = () => onClose();
    window.addEventListener("mango:confirm-action-complete", handler);
    return () => window.removeEventListener("mango:confirm-action-complete", handler);
  }, [isConfirmActionMenu, onClose]);

  return portalTarget ? createPortal(
    <div
      data-mango-confirm-action-menu={isConfirmActionMenu ? "true" : undefined}
      role={ariaLabel ? "menu" : undefined}
      aria-label={ariaLabel}
      className="mango-liquid-context-menu"
      ref={menuRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        background: "linear-gradient(145deg, rgba(255,255,255,0.72), rgba(245,248,252,0.52))",
        border: "1px solid rgba(255,255,255,0.64)",
        borderRadius: 14,
        boxShadow: "0 18px 44px rgba(15, 23, 42, 0.18), inset 1px 1px 0 rgba(255,255,255,0.72), inset -1px -1px 0 rgba(148,163,184,0.12)",
        backdropFilter: "blur(18px) saturate(1.3)",
        WebkitBackdropFilter: "blur(18px) saturate(1.3)",
        padding: "5px 0",
        zIndex: 1000,
        width,
        minWidth,
        maxWidth,
        maxHeight,
        overflow,
      }}
    >
      {children}
    </div>,
    portalTarget,
  ) : null;
};

export default FrameRightClickMenu;
