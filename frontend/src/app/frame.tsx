import React from "react";

export type FrameProps = React.HTMLAttributes<HTMLDivElement>;

const Frame: React.FC<FrameProps> = ({ children, ...props }) => {
  return <div {...props}>{children}</div>;
};

export default Frame;
