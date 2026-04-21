import React from "react";

export interface FrameRightClickMenuProps {
  children: React.ReactNode;
  x: number;
  y: number;
  onClose: () => void;
}

const FrameRightClickMenu: React.FC<FrameRightClickMenuProps> = ({ children }) => {
  return <>{children}</>;
};

export default FrameRightClickMenu;
