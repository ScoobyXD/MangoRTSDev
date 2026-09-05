import { memo, useEffect, useMemo, useState } from "react";
import { LogicGateQDTracker } from "../logic-gates/LogicGateQDTracker.js";
import {
  logicGateDisplayRACIAssignments,
  logicGateRACIRolePresentation,
  type LogicGateResourceRACIPayload,
} from "../logic-gates/raciPresentation.js";
import type { LogicGateRACIAssignment } from "../logic-gates/types.js";

type ProcessMapQDRequestJSON = <T>(
  path: string,
  init?: RequestInit & { json?: unknown },
) => Promise<T>;

type ProcessMapQDCardProps = {
  apiBase: string;
  companyID: string;
  logicGateID: string;
  processName: string;
  pinned: boolean;
  requestJSON: ProcessMapQDRequestJSON;
  onClose: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
};

function assignmentLabel(assignment: LogicGateRACIAssignment): string {
  const principalType = assignment.principal_type === "group" ? "group" : "user";
  const principalID = (assignment.principal_id || assignment.user_id).trim();
  const candidates = principalType === "group"
    ? [assignment.principal_name]
    : [assignment.principal_name, assignment.user_display_name, assignment.user_email];
  return candidates
    .map((candidate) => candidate?.trim() ?? "")
    .find((candidate) => candidate && candidate !== principalID)
    ?? (principalType === "group" ? "Unknown group" : "Unknown user");
}

export const ProcessMapQDCard = memo(function ProcessMapQDCard({
  apiBase,
  companyID,
  logicGateID,
  processName,
  pinned,
  requestJSON,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: ProcessMapQDCardProps) {
  const [assignments, setAssignments] = useState<LogicGateRACIAssignment[]>([]);
  const [raciError, setRACIError] = useState("");

  useEffect(() => {
    let active = true;
    setAssignments([]);
    setRACIError("");
    void requestJSON<LogicGateResourceRACIPayload>(
      `/v1/resources/logic_gate/${encodeURIComponent(logicGateID)}/gvic?company_id=${encodeURIComponent(companyID)}`,
    ).then((policy) => {
      if (active) setAssignments(logicGateDisplayRACIAssignments(policy));
    }).catch(() => {
      if (active) setRACIError("Responsible and Accountable names are unavailable.");
    });
    return () => { active = false; };
  }, [companyID, logicGateID, requestJSON]);

  const assignmentsByRole = useMemo(() => ({
    responsible: assignments.filter((assignment) => assignment.role === "responsible"),
    accountable: assignments.filter((assignment) => assignment.role === "accountable"),
  }), [assignments]);

  return (
    <article
      className="nodrag nopan nowheel process-map-qd-card"
      aria-label={`${processName} Q, C and D`}
      onClick={(event) => event.stopPropagation()}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <header className="process-map-qd-card__header">
        <div>
          <span className="process-map-qd-card__eyebrow">Process performance</span>
          <h2>{processName}</h2>
        </div>
        {pinned && (
          <button type="button" aria-label={`Close ${processName} Q, C and D`} onClick={onClose}>×</button>
        )}
      </header>
      <LogicGateQDTracker
        apiBase={apiBase}
        companyID={companyID}
        logicGateID={logicGateID}
        canEdit={pinned}
        readOnly={!pinned}
        variant="card"
        requestJSON={requestJSON}
      />
      <footer className="process-map-qd-card__raci" aria-label="Responsible and Accountable">
        {(["responsible", "accountable"] as const).map((role) => {
          const presentation = logicGateRACIRolePresentation(role);
          const roleAssignments = assignmentsByRole[role];
          return (
            <div className="process-map-qd-card__raci-row" key={role}>
              <span className="process-map-qd-card__raci-role" style={{ color: presentation.accent }}>
                {role === "responsible" ? "R" : "A"}
              </span>
              <span className="process-map-qd-card__raci-label">{presentation.label}</span>
              <span className="process-map-qd-card__raci-names">
                {roleAssignments.length > 0
                  ? roleAssignments.map(assignmentLabel).join(", ")
                  : "Unassigned"}
              </span>
            </div>
          );
        })}
        {raciError && <p role="status">{raciError}</p>}
      </footer>
    </article>
  );
});
