import React from "react";
import { ProjectManagementContent } from "../../modules/project-management/ProjectManagementContent.js";

export type ProjectManagementPageProps = {
  onNodeOpen?: (nodeID: string) => void;
};

export function ProjectManagementPage({ onNodeOpen }: ProjectManagementPageProps) {
  return (
    <div style={pageShellStyle}>
      <ProjectManagementContent accent="#5b8def" onNodeOpen={onNodeOpen} />
    </div>
  );
}

const pageShellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};
