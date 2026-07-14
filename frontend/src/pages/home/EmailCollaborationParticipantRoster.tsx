import React from "react";
import type {
  CommunicationsEmailCollaboration,
  CompanyUser,
  CompanyUserGroup,
} from "../../modules/communications/communicationsApi";
import {
  avatarBackgroundForName,
  initialsForName,
} from "../../modules/editor/NodeWorkspaceSurfaceShared";
import { buildEmailCollaborationParticipantRoster } from "./emailCollaborationChat";

export function EmailCollaborationParticipantRoster({
  collaboration,
  companyUsers,
  companyUserGroups,
  currentUserID,
}: {
  collaboration: CommunicationsEmailCollaboration | null;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  currentUserID: string;
}) {
  const principals = React.useMemo(
    () => buildEmailCollaborationParticipantRoster(collaboration, companyUsers, companyUserGroups, currentUserID),
    [collaboration, companyUserGroups, companyUsers, currentUserID],
  );
  if (principals.length === 0) return null;
  const participantCount = principals.reduce((total, principal) => total + principal.participantUserIDs.length, 0);
  return (
    <div
      role="list"
      aria-label={`${participantCount} email chat participant${participantCount === 1 ? "" : "s"}`}
      style={{ minWidth: 0, maxWidth: "100%", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4, overflowX: "auto", padding: "1px 0" }}
    >
      {principals.map((principal) => {
        const group = principal.kind === "group";
        const title = `${principal.label} - ${principal.detail}`;
        return (
          <span
            key={`${principal.kind}:${principal.id}`}
            role="listitem"
            aria-label={title}
            title={title}
            style={{ position: "relative", width: 23, height: 23, flex: "0 0 23px", borderRadius: 999, display: "grid", placeItems: "center", border: "1px solid rgba(255,255,255,0.88)", background: group ? "linear-gradient(135deg, #f97316, #fb7185 52%, #a855f7)" : avatarBackgroundForName(principal.label), color: "#ffffff", fontSize: 8, fontWeight: 900, boxShadow: "2px 2px 6px rgba(174,174,192,0.20), -2px -2px 6px rgba(255,255,255,0.78)", opacity: principal.prospective ? 0.78 : 1 }}
          >
            {group ? "GR" : initialsForName(principal.label)}
            {group && principal.participantUserIDs.length > 1 && (
              <span aria-hidden="true" style={{ position: "absolute", right: -3, bottom: -3, minWidth: 13, height: 13, padding: "0 2px", borderRadius: 999, display: "grid", placeItems: "center", border: "1px solid #ffffff", background: "#7c3aed", color: "#ffffff", fontSize: 7, lineHeight: 1, fontWeight: 900 }}>
                {principal.participantUserIDs.length}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
