import React from "react";
import { ProjectManagementContent } from "../../modules/project-management/ProjectManagementContent.js";

export type ProjectManagementPageProps = {
  onNodeOpen?: (nodeID: string) => void;
  onLogicGateOpen?: (logicGateID: string) => void;
  onProjectOpen?: (projectID: string) => void;
  targetProjectID?: string;
  targetProjectRequestID?: number;
};

export function ProjectManagementPage({
  onNodeOpen,
  onLogicGateOpen,
  onProjectOpen,
  targetProjectID,
  targetProjectRequestID,
}: ProjectManagementPageProps) {
  return (
    <div style={pageShellStyle}>
      <ProjectManagementContent
        accent="#5b8def"
        onNodeOpen={onNodeOpen}
        onLogicGateOpen={onLogicGateOpen}
        onProjectOpen={onProjectOpen}
        targetProjectID={targetProjectID}
        targetProjectRequestID={targetProjectRequestID}
      />
    </div>
  );
}

const pageShellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};
