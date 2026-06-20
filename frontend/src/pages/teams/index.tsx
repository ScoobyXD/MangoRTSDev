import React from "react";
import type { CurrentUserResponse } from "../../auth/cognitoAuth.js";
import { TeamsContent } from "../../modules/teams/TeamsContent.js";

export type TeamsPageProps = {
  me?: CurrentUserResponse;
};

export function TeamsPage({ me }: TeamsPageProps) {
  return (
    <div style={pageShellStyle}>
      <TeamsContent accent="#6366f1" me={me} />
    </div>
  );
}

const pageShellStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
};
