import React, { useEffect, useRef, useState } from "react";

export interface FrameRightClickMenuProps {
  children: React.ReactNode;
  x: number;
  y: number;
  onClose: () => void;
}

const FrameRightClickMenu: React.FC<FrameRightClickMenuProps> = ({ children, x, y, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - rect.width - 8),
      y: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const timer = setTimeout(() => window.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  return (
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
    </div>
  );
};

export default FrameRightClickMenu;
