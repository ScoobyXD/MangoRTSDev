import React from "react";

export type FrameProps = React.HTMLAttributes<HTMLDivElement>;

// Shared frame wrapper used across modules so layout/container props stay centralized.
const Frame: React.FC<FrameProps> = ({ children, ...props }) => {
  return <div {...props}>{children}</div>;
};

export default Frame;
