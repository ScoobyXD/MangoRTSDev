import React from "react";

export type FrameCanvasProps = React.HTMLAttributes<HTMLDivElement>;

const FrameCanvas: React.FC<FrameCanvasProps> = ({ children, ...props }) => {
  return <div {...props}>{children}</div>;
};

export default FrameCanvas;
