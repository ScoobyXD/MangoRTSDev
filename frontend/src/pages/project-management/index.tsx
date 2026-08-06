import React from "react";
import type { ProjectLogicGateReturnContext } from "../../app/projectRouteHistory.js";
import { ProjectManagementContent } from "../../modules/project-management/ProjectManagementContent.js";

export type ProjectManagementPageProps = {
  onNodeOpen?: (nodeID: string) => void;
  onLogicGateOpen?: (logicGateID: string, label?: string, returnContext?: ProjectLogicGateReturnContext) => void;
  onProjectOpen?: (projectID: string) => void;
  onProjectCollapseToTab?: (target: { projectID: string; label: string }) => void;
  targetProjectID?: string;
  targetProjectInformationID?: string;
  targetProjectMentionUserID?: string;
  targetProjectRequestID?: number;
};

export function ProjectManagementPage({
  onNodeOpen,
  onLogicGateOpen,
  onProjectOpen,
  onProjectCollapseToTab,
  targetProjectID,
  targetProjectInformationID,
  targetProjectMentionUserID,
  targetProjectRequestID,
}: ProjectManagementPageProps) {
  return (
    <div style={pageShellStyle}>
      <ProjectManagementContent
        accent="#5b8def"
        onNodeOpen={onNodeOpen}
        onLogicGateOpen={onLogicGateOpen}
        onProjectOpen={onProjectOpen}
        onProjectCollapseToTab={onProjectCollapseToTab}
        targetProjectID={targetProjectID}
        targetProjectInformationID={targetProjectInformationID}
        targetProjectMentionUserID={targetProjectMentionUserID}
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
