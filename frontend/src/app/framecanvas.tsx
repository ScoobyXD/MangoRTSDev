import React from "react";

export type FrameCanvasProps = React.HTMLAttributes<HTMLDivElement>;

// Canvas surface wrapper for grid interactions (drag, resize, context menu hit-area).
const FrameCanvas: React.FC<FrameCanvasProps> = ({ children, ...props }) => {
  return <div {...props}>{children}</div>;
};

export default FrameCanvas;
