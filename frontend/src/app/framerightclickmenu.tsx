import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface FrameRightClickMenuProps {
  children: React.ReactNode;
  x: number;
  y: number;
  onClose: () => void;
  closeOnOutside?: boolean;
  width?: React.CSSProperties["width"];
  minWidth?: React.CSSProperties["minWidth"];
  maxWidth?: React.CSSProperties["maxWidth"];
  overflow?: React.CSSProperties["overflow"];
}

// Floating context-menu shell used by header/canvas/frame menus throughout the dashboard.
const FrameRightClickMenu: React.FC<FrameRightClickMenuProps> = ({ children, x, y, onClose, closeOnOutside = true, width, minWidth = 190, maxWidth, overflow = "hidden" }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  // Keep menu inside viewport bounds so right-click actions are always reachable.
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  // Use capture so nested modules that stop propagation still let menus close on outside clicks.
  useEffect(() => {
    if (!closeOnOutside) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => window.addEventListener("mousedown", handler, true), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handler, true);
    };
  }, [closeOnOutside, onClose]);

  return createPortal(
    <div
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
        overflow,
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

export default FrameRightClickMenu;
