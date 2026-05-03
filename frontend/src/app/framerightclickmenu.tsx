import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface FrameRightClickMenuProps {
  children: React.ReactNode;
  x: number;
  y: number;
  onClose: () => void;
}

// Floating context-menu shell used by header/canvas/frame menus throughout the dashboard.
const FrameRightClickMenu: React.FC<FrameRightClickMenuProps> = ({ children, x, y, onClose }) => {
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
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => window.addEventListener("mousedown", handler, true), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handler, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        background: "#fff",
        border: "1px solid #e0e0e0",
        borderRadius: 10,
        boxShadow: "0 6px 24px rgba(0,0,0,0.12)",
        padding: "4px 0",
        zIndex: 1000,
        minWidth: 190,
      }}
    >
      {children}
    </div>,
    document.body,
  );
};

export default FrameRightClickMenu;
