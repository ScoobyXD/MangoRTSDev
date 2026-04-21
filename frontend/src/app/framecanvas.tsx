import React from "react";

export interface FrameCanvasProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const FrameCanvas: React.FC<FrameCanvasProps> = ({ children, style }) => {
  return <div style={style}>{children}</div>;
};

export default FrameCanvas;
