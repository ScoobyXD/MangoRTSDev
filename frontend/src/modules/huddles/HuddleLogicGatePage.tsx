import React, { useMemo, useState } from "react";
import { createRequestJSON } from "../api/requestJSON";
import { HuddleResourceSurface, type HuddleOpenResource } from "./HuddleResourceSurface";

export const HuddleLogicGatePage: React.FC<{
  apiBase: string;
  companyID: string;
  currentUserID: string;
  huddleLogicGateID: string;
  onClose: () => void;
}> = ({ apiBase, companyID, currentUserID, huddleLogicGateID, onClose }) => {
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const [fullscreen, setFullscreen] = useState(false);
  const resource = useMemo<HuddleOpenResource>(() => ({
    resourceType: "huddle_logic_gate",
    resourceID: huddleLogicGateID,
    name: "Huddle Process",
  }), [huddleLogicGateID]);
  const openNode = (node: HuddleOpenResource) => window.dispatchEvent(new CustomEvent("mangorts:huddle-open", { detail: node }));
  return (
    <main
      data-huddle-logic-gate-page="true"
      data-huddle-route={`/huddle-logic-gates/${encodeURIComponent(huddleLogicGateID)}`}
      style={fullscreen ? fullscreenPageStyle : pageStyle}
    >
      <HuddleResourceSurface
        apiBase={apiBase}
        companyID={companyID}
        currentUserID={currentUserID}
        resource={resource}
        requestJSON={requestJSON}
        fullscreen={fullscreen}
        onToggleFullscreen={() => setFullscreen((current) => !current)}
        onClose={onClose}
        onOpenNode={openNode}
      />
    </main>
  );
};

const pageStyle: React.CSSProperties = { width: "100%", height: "100%", minWidth: 0, minHeight: 0, overflow: "hidden", background: "linear-gradient(180deg,#f8fafc,#eef2f7)", borderRadius: 16 };
const fullscreenPageStyle: React.CSSProperties = { ...pageStyle, position: "fixed", inset: 0, zIndex: 12050, borderRadius: 0, padding: 4, boxSizing: "border-box" };
