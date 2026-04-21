import React from "react";

export interface FrameProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const Frame: React.FC<FrameProps> = ({ children, style }) => {
  return <div style={style}>{children}</div>;
};

export default Frame;
